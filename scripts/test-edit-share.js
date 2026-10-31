'use strict';

// Headless checks for the editor (cut / audio) and LAN sharing. No app window needed.
//   node scripts/test-edit-share.js [recording-with-audio.mp4]
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { Recorder } = require('../src/recorder');
const { Editor } = require('../src/editor');
const { LanShare, safeName } = require('../src/lan-share');

const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe(ffmpeg, file) {
  const bin = require('../src/platform').ffprobeFor(ffmpeg);
  const r = spawnSync(bin, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  return { duration: parseFloat(j.format.duration), types: j.streams.map((s) => s.codec_type), codecs: j.streams.map((s) => s.codec_name) };
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'recme-test-'));
  const recorder = new Recorder({ outputDir: work, getDisplays: () => [] });

  // Source clip: 8 s test pattern + 440 Hz tone, so the test does not depend on earlier recordings.
  const src = path.join(work, 'source.mp4');
  spawnSync(recorder.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', src], { stdio: 'ignore' });
  assert(fs.existsSync(src), 'created 8 s test clip');

  const editor = new Editor(recorder);
  const info = editor.info('source.mp4');
  assert(info.hasAudio && info.hasVideo && Math.abs(info.duration - 8) < 0.3, `info(): ${info.width}x${info.height}, ${info.duration.toFixed(2)} s, audio=${info.hasAudio}`);

  // Keep 0-2 s and 4-6 s  => 4 s
  const segs = [{ start: 0, end: 2 }, { start: 4, end: 6 }];
  const precise = await editor.exportVideo({ name: 'source.mp4', segments: segs, mode: 'precise' });
  let p = probe(recorder.ffmpeg, precise.file);
  assert(Math.abs(p.duration - 4) < 0.25 && p.types.includes('audio'), `precise cut: ${p.duration.toFixed(2)} s (want ~4), streams ${p.types}`);

  // Pieces are joined in the order given: [4-6 s] first, then [0-2 s]. Compare the first output frame with source frames.
  const frameAt = (file, ss, out) => spawnSync(recorder.ffmpeg, ['-y', '-hide_banner', '-v', 'error', '-ss', String(ss), '-i', file, '-frames:v', '1', out]);
  const psnr = (a, b) => {
    const r = spawnSync(recorder.ffmpeg, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /average:(inf|[\d.]+)/.exec(r.stderr);
    return m ? (m[1] === 'inf' ? 99 : parseFloat(m[1])) : 0;
  };
  const swapped = await editor.exportVideo({ name: 'source.mp4', segments: [{ start: 4, end: 6 }, { start: 0, end: 2 }], mode: 'precise' });
  frameAt(swapped.file, 0.2, path.join(work, 'o.png'));
  frameAt(src, 4.2, path.join(work, 'a4.png'));
  frameAt(src, 0.2, path.join(work, 'a0.png'));
  const like4 = psnr(path.join(work, 'o.png'), path.join(work, 'a4.png'));
  const like0 = psnr(path.join(work, 'o.png'), path.join(work, 'a0.png'));
  assert(like4 > like0 + 5 && Math.abs(probe(recorder.ffmpeg, swapped.file).duration - 4) < 0.25, `rearranged order is kept (first frame matches source@4s: ${like4.toFixed(1)} dB vs source@0s: ${like0.toFixed(1)} dB)`);

  const fast = await editor.exportVideo({ name: 'source.mp4', segments: [{ start: 1, end: 5 }], mode: 'fast' });
  p = probe(recorder.ffmpeg, fast.file);
  assert(p.duration > 3 && p.duration < 7, `fast cut: ${p.duration.toFixed(2)} s (keyframe-snapped)`);

  const muted = await editor.exportVideo({ name: 'source.mp4', segments: segs, audio: 'remove' });
  p = probe(recorder.ffmpeg, muted.file);
  assert(!p.types.includes('audio') && p.types.includes('video'), `mute: streams ${p.types}`);

  for (const format of ['m4a', 'mp3', 'wav', 'flac']) {
    const a = await editor.extractAudio({ name: 'source.mp4', segments: segs, format });
    p = probe(recorder.ffmpeg, a.file);
    assert(p.types.join() === 'audio' && Math.abs(p.duration - 4) < 0.3, `extract ${format}: ${p.codecs[0]}, ${p.duration.toFixed(2)} s`);
  }

  let threw = false;
  try { await editor.exportVideo({ name: '..\\..\\Windows\\win.ini', segments: segs }); } catch { threw = true; }
  assert(threw, 'path traversal in file name is rejected');

  // ---- LAN share: two nodes on this machine ----
  const dirA = path.join(work, 'A');
  const dirB = path.join(work, 'B');
  const A = new LanShare({ alias: 'Alice', fingerprint: 'a'.repeat(64), receiveDir: dirA, port: 54000 });
  const B = new LanShare({ alias: 'Bob', fingerprint: 'b'.repeat(64), receiveDir: dirB, port: 54010 });
  await A.start();
  await B.start();
  assert(A.port === 54000 && B.port === 54010, `servers listening on ${A.port} and ${B.port}`);

  A.addPeer(B.self(), '127.0.0.1');
  const peer = A.devices()[0];
  assert(peer && peer.alias === 'Bob', 'A knows B');

  B.on('incoming', (req) => setTimeout(() => B.respond(req.id, true), 100));
  let lastProgress = 0;
  const sent = await A.send(peer.id, [precise.file], (p2) => { lastProgress = p2.sent / p2.total; });
  const got = path.join(dirB, path.basename(precise.file));
  assert(fs.existsSync(got) && fs.readFileSync(got).equals(fs.readFileSync(precise.file)), `file transferred intact (${sent.bytes} bytes, progress ${Math.round(lastProgress * 100)}%)`);

  B.removeAllListeners('incoming');
  B.on('incoming', (req) => setTimeout(() => B.respond(req.id, false), 100));
  let declined = '';
  try { await A.send(peer.id, [fast.file]); } catch (e) { declined = e.message; }
  assert(/declined/.test(declined) && !fs.existsSync(path.join(dirB, path.basename(fast.file))), `decline is respected ("${declined}")`);

  B.receive = false;
  let off = '';
  try { await A.send(peer.id, [fast.file]); } catch (e) { off = e.message; }
  assert(off.length > 0, `receiving switched off is refused ("${off}")`);
  B.receive = true;

  // Hostile sender: path traversal in the announced file name, and an upload without a valid token.
  B.removeAllListeners('incoming');
  B.on('incoming', (req) => setTimeout(() => B.respond(req.id, true), 50));
  const post = (port, p, body, headers = {}) => new Promise((resolve) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    rq.end(data);
  });
  const prep = await post(B.port, '/api/localsend/v2/prepare-upload', { info: { alias: 'Mallory' }, files: { x: { id: 'x', fileName: '..\\..\\..\\evil.txt', size: 5 } } });
  const sess = JSON.parse(prep.body);
  assert(prep.status === 200 && sess.sessionId, 'hostile prepare-upload accepted by user flow');
  const bad = await post(B.port, `/api/localsend/v2/upload?sessionId=${sess.sessionId}&fileId=x&token=wrong`, 'hello', { 'Content-Type': 'application/octet-stream' });
  assert(bad.status === 403, `upload with wrong token -> ${bad.status}`);
  const ok = await post(B.port, `/api/localsend/v2/upload?sessionId=${sess.sessionId}&fileId=x&token=${sess.files.x}`, 'hello', { 'Content-Type': 'application/octet-stream' });
  const landed = fs.readdirSync(dirB).filter((f) => /evil/.test(f));
  assert(ok.status === 200 && landed.length === 1 && !fs.existsSync(path.join(work, 'evil.txt')), `traversal name saved safely as "${landed[0]}" inside the receive folder`);
  assert(safeName('con.txt') !== 'con.txt' && !/[<>:"/\\|?*]/.test(safeName('a<b>:c.txt')), 'safeName handles reserved/illegal names');

  A.stop();
  B.stop();

  // ---- HTTPS, certificate pinning, PIN, trusted devices ----
  const { loadOrCreateCert } = require('../src/identity');
  const idA = await loadOrCreateCert(path.join(work, 'tlsA'));
  const idB = await loadOrCreateCert(path.join(work, 'tlsB'));
  assert(/^[0-9a-f]{64}$/.test(idA.fingerprint) && idA.fingerprint !== idB.fingerprint, 'certificates generated, fingerprints are SHA-256 and unique');
  const reload = await loadOrCreateCert(path.join(work, 'tlsA'));
  assert(reload.fingerprint === idA.fingerprint, 'certificate is reused on the next start');

  const S = new LanShare({ alias: 'SecureSender', fingerprint: idA.fingerprint, identity: idA, https: true, receiveDir: path.join(work, 'S'), port: 54100 });
  const R = new LanShare({ alias: 'SecureReceiver', fingerprint: 'r'.repeat(64), identity: idB, https: true, receiveDir: path.join(work, 'R'), port: 54110, pin: '4242' });
  await S.start();
  await R.start();
  assert(R.self().protocol === 'https' && R.fingerprint === idB.fingerprint, 'receiver announces https + certificate fingerprint');

  S.addPeer(R.self(), '127.0.0.1');
  const rid = S.devices().find((d) => d.alias === 'SecureReceiver').id;
  R.on('incoming', (req) => setTimeout(() => R.respond(req.id, true), 50));
  const small = precise.file;

  let e1 = null;
  try { await S.send(rid, [small]); } catch (e) { e1 = e; }
  assert(e1 && e1.code === 'PIN', `no PIN -> refused ("${e1 && e1.message}")`);
  let e2 = null;
  try { await S.send(rid, [small], () => {}, { pin: '0000' }); } catch (e) { e2 = e; }
  assert(e2 && e2.code === 'PIN' && /wrong PIN/.test(e2.message), `wrong PIN -> refused ("${e2 && e2.message}")`);
  const okSend = await S.send(rid, [small], () => {}, { pin: '4242' });
  assert(okSend.bytes > 0 && fs.existsSync(path.join(work, 'R', path.basename(small))), 'right PIN over HTTPS -> file delivered');

  // brute force protection: 5 wrong PINs, then even a later attempt is blocked for a minute
  let blocked = '';
  for (let i = 0; i < 6; i++) { try { await S.send(rid, [small], () => {}, { pin: String(1000 + i) }); } catch (e) { blocked = e.message; } }
  assert(/too many/i.test(blocked), `PIN brute force is rate limited ("${blocked}")`);
  R.setPin('');

  // certificate pinning: announce a fingerprint that does not belong to the certificate
  const liar = { ...R.self(), fingerprint: 'f'.repeat(64) };
  const liarPeer = S.addPeer(liar, '127.0.0.1');
  let pinned = '';
  try { await S.send(liarPeer.id, [small]); } catch (e) { pinned = e.message; }
  assert(/certificate does not match/.test(pinned), `certificate mismatch is detected ("${pinned}")`);

  // trusted device: accepted without a prompt, but only when fingerprint and address both match
  R.removeAllListeners('incoming');
  let prompted = false;
  R.on('incoming', () => { prompted = true; });
  let auto = null;
  R.on('auto-accepted', (a) => { auto = a; });
  R.addPeer(S.self(), '127.0.0.1');
  R.trust(S.fingerprint, 'SecureSender');
  const t0 = await S.send(rid, [small]);
  assert(!prompted && auto && t0.bytes > 0, 'trusted device is accepted automatically, no prompt');
  R.untrust(S.fingerprint);
  R.on('incoming', (req) => setTimeout(() => R.respond(req.id, false), 50));
  let afterUntrust = '';
  try { await S.send(rid, [small]); } catch (e) { afterUntrust = e.message; }
  assert(prompted && /declined/.test(afterUntrust), 'after removing trust the user is asked again');

  // switching receiver back to plain HTTP at runtime
  await R.setHttps(false);
  assert(R.self().protocol === 'http' && R.fingerprint === 'r'.repeat(64), 'receiver switched to plain HTTP without restart');
  await R.setHttps(true);
  assert(R.self().protocol === 'https', 'and back to HTTPS');
  S.stop();
  R.stop();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
  process.exit();
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
