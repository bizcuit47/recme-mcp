'use strict';

// Send / receive files on the local network using the LocalSend v2 protocol
// (multicast discovery on 224.0.0.167:53317 + REST over HTTP). Every incoming transfer
// has to be accepted by the user before any byte is written.

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MULTICAST = '224.0.0.167';
const DEFAULT_PORT = 53317;
const API = '/api/localsend/v2';
const ACCEPT_TIMEOUT_MS = 60000;
const MAX_PIN_FAILS = 5; // wrong PINs per IP per minute

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const FINGERPRINT_RE = /^[0-9a-f]{64}$/i;

const MIME = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.png': 'image/png', '.webm': 'video/webm' };

const isPrivate = (ip) => {
  ip = String(ip || '').replace(/^::ffff:/, '');
  return ip === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
};

function safeName(name) {
  let n = path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (!n || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n;
  return n.slice(0, 150);
}

function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

class LanShare extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.alias        name shown to other devices
   * @param {string} o.fingerprint  stable random id
   * @param {string} o.receiveDir   where accepted files are saved
   * @param {boolean} [o.receive]   allow incoming transfers
   * @param {number} [o.port]
   */
  constructor({ alias, fingerprint, receiveDir, receive = true, port = DEFAULT_PORT, identity = null, https: useHttps = false, pin = '', trusted = [] }) {
    super();
    this.alias = alias;
    this.identity = identity; // { key, cert, fingerprint } for HTTPS
    this.https = !!(useHttps && identity);
    this.plainFingerprint = fingerprint;
    this.fingerprint = this.https ? identity.fingerprint : fingerprint;
    this.pin = String(pin || '');
    this.trusted = Array.isArray(trusted) ? trusted : []; // [{ id, alias }] devices whose transfers are accepted automatically
    this.pinFails = new Map(); // ip -> { count, since }
    this.receiveDir = receiveDir;
    this.receive = receive;
    this.port = port;
    this.peers = new Map(); // fingerprint -> device
    this.pending = new Map(); // requestId -> { resolve, timer }
    this.sessions = new Map(); // sessionId -> { files: {id: {name,size,token,path}}, from }
    this.server = null;
    this.socket = null;
    this.lastError = null;
  }

  self(announce) {
    const info = {
      alias: this.alias,
      version: '2.0',
      deviceModel: 'Recme',
      deviceType: 'desktop',
      fingerprint: this.fingerprint,
      port: this.port,
      protocol: this.https ? 'https' : 'http',
      download: false,
    };
    if (announce !== undefined) info.announce = announce;
    return info;
  }

  // ---------- lifecycle ----------
  async listen() {
    const handler = (req, res) => this.handle(req, res).catch((e) => {
      if (!res.headersSent) this.json(res, 500, { message: String(e.message || e) });
    });
    this.server = this.https
      ? https.createServer({ key: this.identity.key, cert: this.identity.cert }, handler)
      : http.createServer(handler);
    // Prefer the standard port so other LocalSend apps can find us; fall back to the next free one.
    const first = this.port;
    for (let p = first; p < first + 10; p++) {
      try {
        await new Promise((resolve, reject) => {
          this.server.once('error', reject);
          this.server.listen(p, '0.0.0.0', () => { this.server.removeListener('error', reject); resolve(); });
        });
        this.port = p;
        return;
      } catch (e) {
        if (e.code !== 'EADDRINUSE' || p === first + 9) throw e;
      }
    }
  }

  async start() {
    await this.listen();
    this.startMulticast();
    this.announce();
  }

  /** Switch between encrypted (HTTPS) and plain HTTP receiving without restarting the app. */
  async setHttps(enabled) {
    if (enabled && !this.identity) throw new Error('No TLS certificate available');
    if (!!enabled === this.https) return;
    await new Promise((resolve) => { this.server.close(resolve); this.server.closeAllConnections && this.server.closeAllConnections(); });
    this.https = !!enabled;
    this.fingerprint = this.https ? this.identity.fingerprint : this.plainFingerprint;
    this.sessions.clear();
    await this.listen();
    this.announce();
  }

  setPin(pin) { this.pin = String(pin || '').slice(0, 12); this.pinFails.clear(); }

  trust(id, alias) {
    if (!this.trusted.some((t) => t.id === id)) this.trusted.push({ id, alias });
    this.emit('trusted-changed', this.trusted);
  }

  untrust(id) {
    this.trusted = this.trusted.filter((t) => t.id !== id);
    this.emit('trusted-changed', this.trusted);
  }

  stop() {
    try { this.server && this.server.close(); } catch { /* closing */ }
    try { this.socket && this.socket.close(); } catch { /* closing */ }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(false); }
  }

  setAlias(alias) { this.alias = alias; this.announce(); }

  // ---------- discovery ----------
  startMulticast() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = sock;
    sock.on('error', (e) => { this.lastError = `Discovery: ${e.message}`; });
    sock.on('message', (msg, rinfo) => {
      let d;
      try { d = JSON.parse(msg.toString()); } catch { return; }
      if (!d || !d.fingerprint || d.fingerprint === this.fingerprint || !isPrivate(rinfo.address)) return;
      this.addPeer(d, rinfo.address);
      if (d.announce || d.announcement) this.register(this.peers.get(d.fingerprint)).catch(() => {});
    });
    sock.bind(DEFAULT_PORT, () => {
      for (const a of localAddresses()) {
        try { sock.addMembership(MULTICAST, a.address); } catch { /* adapter without multicast */ }
      }
    });
  }

  announce() {
    if (!this.socket) return;
    const msg = Buffer.from(JSON.stringify(this.self(true)));
    for (const a of localAddresses()) {
      try {
        this.socket.setMulticastInterface(a.address);
        this.socket.send(msg, DEFAULT_PORT, MULTICAST);
      } catch { /* interface unusable */ }
    }
  }

  addPeer(d, ip) {
    const prev = this.peers.get(d.fingerprint);
    const peer = {
      id: d.fingerprint,
      alias: d.alias || ip,
      ip,
      port: d.port || DEFAULT_PORT,
      protocol: d.protocol === 'https' ? 'https' : 'http',
      deviceType: d.deviceType || 'desktop',
      deviceModel: d.deviceModel || '',
      lastSeen: Date.now(),
    };
    this.peers.set(d.fingerprint, peer);
    if (!prev || prev.alias !== peer.alias || prev.ip !== peer.ip) this.emit('devices', this.devices());
    return peer;
  }

  devices() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    return [...this.peers.values()].filter((p) => p.lastSeen > cutoff).sort((a, b) => a.alias.localeCompare(b.alias));
  }

  /** Re-announce and probe the local /24 networks (for Wi-Fi that blocks multicast). */
  async scan() {
    this.announce();
    const jobs = [];
    for (const a of localAddresses()) {
      const base = a.address.split('.').slice(0, 3).join('.');
      for (let i = 1; i < 255; i++) {
        const ip = `${base}.${i}`;
        if (ip !== a.address) jobs.push(ip);
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const ip = jobs[next++];
        await this.probe(ip);
      }
    };
    await Promise.all(Array.from({ length: 64 }, worker));
    return this.devices();
  }

  async probe(ip) {
    for (const protocol of ['https', 'http']) {
      try {
        const info = await this.request({ ip, port: DEFAULT_PORT, protocol }, 'GET', `${API}/info`, null, 700);
        if (info && info.fingerprint && info.fingerprint !== this.fingerprint) {
          this.addPeer({ ...info, protocol }, ip);
          return;
        }
      } catch { /* nothing there */ }
    }
  }

  register(peer) {
    return this.request(peer, 'POST', `${API}/register`, this.self(), 3000).then((r) => r);
  }

  // ---------- low-level client ----------
  request(target, method, urlPath, body, timeout = 8000, rawStream = null) {
    return new Promise((resolve, reject) => {
      const lib = target.protocol === 'https' ? https : http;
      const payload = body ? Buffer.from(JSON.stringify(body)) : null;
      const headers = {};
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
      if (rawStream) { headers['Content-Type'] = rawStream.type; headers['Content-Length'] = rawStream.size; }
      const req = lib.request({
        host: target.ip, port: target.port, method, path: urlPath, headers,
        rejectUnauthorized: false, // LocalSend peers use self-signed certificates
        agent: false, // a fresh connection per request: pooled sockets would skip the certificate check below
        timeout: rawStream ? 0 : timeout,
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* not json */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else { const e = new Error(`HTTP ${res.statusCode}`); e.status = res.statusCode; reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      // HTTPS peers announce SHA-256(certificate) as their fingerprint: make sure we reached that device.
      if (target.protocol === 'https' && FINGERPRINT_RE.test(target.id || '')) {
        req.on('socket', (s) => {
          s.once('secureConnect', () => {
            const cert = s.getPeerCertificate();
            if (!cert || !cert.raw || sha256hex(cert.raw) !== target.id.toLowerCase()) {
              req.destroy(new Error('its certificate does not match the fingerprint it announced'));
            }
          });
        });
      }
      if (rawStream) rawStream.pipe(req);
      else req.end(payload);
    });
  }

  // ---------- sending ----------
  /**
   * Send files to a device. Resolves when the receiver accepted and every file was uploaded.
   * @param {string} deviceId  fingerprint (id) from devices()
   * @param {string[]} files   absolute paths
   */
  async send(deviceId, files, onProgress = () => {}, { pin = '' } = {}) {
    const peer = this.peers.get(deviceId);
    if (!peer) throw new Error('Device not found. Refresh the list.');
    const meta = {};
    const list = files.map((p, i) => {
      const st = fs.statSync(p);
      const id = `f${i}`;
      meta[id] = { id, fileName: path.basename(p), size: st.size, fileType: MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' };
      return { id, path: p, size: st.size, name: path.basename(p) };
    });

    let prep;
    try {
      const q = pin ? `?pin=${encodeURIComponent(pin)}` : '';
      prep = await this.request(peer, 'POST', `${API}/prepare-upload${q}`, { info: this.self(), files: meta }, ACCEPT_TIMEOUT_MS + 10000);
    } catch (e) {
      if (e.status === 401) {
        const err = new Error(pin ? `${peer.alias}: wrong PIN` : `${peer.alias} requires a PIN`);
        err.code = 'PIN';
        throw err;
      }
      if (e.status === 429) throw new Error(`${peer.alias}: too many wrong PIN attempts, try again in a minute`);
      if (e.status === 403) throw new Error(`${peer.alias} declined the transfer`);
      if (e.status === 409) throw new Error(`${peer.alias} is busy with another transfer`);
      throw new Error(`Could not reach ${peer.alias}: ${e.message}`);
    }
    const total = list.reduce((a, f) => a + f.size, 0);
    let done = 0;
    try {
      for (const f of list) {
        const token = prep.files && prep.files[f.id];
        if (!token) continue; // receiver skipped this file
        const stream = fs.createReadStream(f.path);
        stream.type = 'application/octet-stream';
        stream.size = f.size;
        let sent = 0;
        stream.on('data', (c) => { sent += c.length; onProgress({ file: f.name, sent: done + sent, total }); });
        const q = `${API}/upload?sessionId=${encodeURIComponent(prep.sessionId)}&fileId=${encodeURIComponent(f.id)}&token=${encodeURIComponent(token)}`;
        await this.request(peer, 'POST', q, null, 0, stream);
        done += f.size;
      }
    } catch (e) {
      this.request(peer, 'POST', `${API}/cancel?sessionId=${encodeURIComponent(prep.sessionId)}`, null, 3000).catch(() => {});
      throw new Error(`Transfer to ${peer.alias} failed: ${e.message}`);
    }
    onProgress({ file: '', sent: total, total, finished: true });
    return { device: peer.alias, files: list.map((f) => f.name), bytes: total };
  }

  // ---------- receiving ----------
  respond(requestId, accept) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.resolve(!!accept);
    return true;
  }

  json(res, code, obj) {
    const body = Buffer.from(JSON.stringify(obj || {}));
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
  }

  readJson(req, limit = 2e6) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > limit) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    const ip = req.socket.remoteAddress;
    if (!isPrivate(ip)) return this.json(res, 403, { message: 'LAN only' });
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && (route === `${API}/info` || route === '/api/localsend/v1/info')) return this.json(res, 200, this.self());

    if (req.method === 'POST' && route === `${API}/register`) {
      const d = await this.readJson(req);
      if (d.fingerprint && d.fingerprint !== this.fingerprint) this.addPeer(d, ip.replace(/^::ffff:/, ''));
      return this.json(res, 200, this.self());
    }

    if (!this.receive && route.startsWith(API)) return this.json(res, 403, { message: 'Receiving is turned off' });

    if (req.method === 'POST' && route === `${API}/prepare-upload`) {
      const body = await this.readJson(req);
      const files = Object.values(body.files || {});
      if (!files.length) return this.json(res, 400, { message: 'No files' });

      // Optional PIN (LocalSend protocol: ?pin=...). Wrong guesses are rate limited per IP.
      if (this.pin) {
        const given = url.searchParams.get('pin') || '';
        const now = Date.now();
        let rec = this.pinFails.get(ip);
        if (!rec || now - rec.since > 60000) rec = { count: 0, since: now };
        this.pinFails.set(ip, rec);
        if (rec.count >= MAX_PIN_FAILS) return this.json(res, 429, { message: 'Too many attempts' });
        const a = Buffer.from(given);
        const b = Buffer.from(this.pin);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          if (given) rec.count++;
          return this.json(res, 401, { message: given ? 'Invalid PIN' : 'PIN required' });
        }
      }

      if ([...this.pending.values()].length || this.activeSession()) return this.json(res, 409, { message: 'Busy' });

      const requestId = crypto.randomUUID();
      const from = (body.info && body.info.alias) || ip;
      const summary = files.map((f) => ({ name: safeName(f.fileName), size: Number(f.size) || 0 }));

      // Trusted devices are accepted without asking. The device must be one we discovered at this very address.
      const claimed = body.info && body.info.fingerprint;
      const known = claimed && this.peers.get(claimed);
      const trusted = !!known && known.ip === ip.replace(/^::ffff:/, '') && this.trusted.some((t) => t.id === claimed);
      let accepted = trusted;
      if (trusted) {
        this.emit('auto-accepted', { from, files: summary });
      } else {
        this.emit('incoming', { id: requestId, from, files: summary, fingerprint: claimed || null });
        accepted = await new Promise((resolve) => {
          const timer = setTimeout(() => { this.pending.delete(requestId); resolve(false); }, ACCEPT_TIMEOUT_MS);
          this.pending.set(requestId, { resolve, timer });
          // Sender gave up (closed the connection) before the user answered.
          res.on('close', () => { if (this.pending.has(requestId) && !res.writableEnded) this.respond(requestId, false); });
        });
        this.emit('incoming-done', requestId);
      }
      if (!accepted) return this.json(res, 403, { message: 'Declined' });

      fs.mkdirSync(this.receiveDir, { recursive: true });
      const sessionId = crypto.randomUUID();
      const session = { id: sessionId, from, ip, files: {}, started: Date.now() };
      const tokens = {};
      for (const f of files) {
        const token = crypto.randomBytes(16).toString('hex');
        tokens[f.id] = token;
        session.files[f.id] = { name: safeName(f.fileName), size: Number(f.size) || 0, token, done: false };
      }
      this.sessions.set(sessionId, session);
      return this.json(res, 200, { sessionId, files: tokens });
    }

    if (req.method === 'POST' && route === `${API}/upload`) {
      const q = url.searchParams;
      const session = this.sessions.get(q.get('sessionId'));
      const f = session && session.files[q.get('fileId')];
      if (!session || !f || f.done || f.token !== q.get('token') || session.ip !== ip) return this.json(res, 403, { message: 'Invalid session' });

      const dest = this.uniqueReceivePath(f.name);
      const part = dest + '.part';
      const out = fs.createWriteStream(part);
      let got = 0;
      let aborted = false;
      const fail = (code, msg) => { aborted = true; out.destroy(); fs.rmSync(part, { force: true }); if (!res.headersSent) this.json(res, code, { message: msg }); };
      req.on('data', (c) => {
        got += c.length;
        if (got > f.size + 1024 && f.size > 0) { req.destroy(); return fail(413, 'Larger than announced'); }
        this.emit('progress', { direction: 'in', file: f.name, received: got, size: f.size, from: session.from });
      });
      req.on('aborted', () => fail(400, 'Aborted'));
      req.pipe(out);
      out.on('finish', () => {
        if (aborted) return;
        fs.renameSync(part, dest);
        f.done = true;
        f.path = dest;
        this.emit('received', { file: dest, name: path.basename(dest), size: got, from: session.from });
        this.json(res, 200, {});
        if (Object.values(session.files).every((x) => x.done)) this.sessions.delete(session.id);
      });
      return undefined;
    }

    if (req.method === 'POST' && route === `${API}/cancel`) {
      this.sessions.delete(url.searchParams.get('sessionId'));
      return this.json(res, 200, {});
    }

    return this.json(res, 404, { message: 'Not found' });
  }

  activeSession() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.started > 15 * 60 * 1000) this.sessions.delete(id);
    }
    return this.sessions.size > 0;
  }

  uniqueReceivePath(name) {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let p = path.join(this.receiveDir, name);
    for (let i = 2; fs.existsSync(p) || fs.existsSync(p + '.part'); i++) p = path.join(this.receiveDir, `${base} (${i})${ext}`);
    return p;
  }
}

module.exports = { LanShare, safeName };
