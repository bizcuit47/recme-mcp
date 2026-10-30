'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, clipboard, nativeImage, dialog, Tray, Menu } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Recorder, QUALITY } = require('./recorder');
const { startMcpHttp } = require('./mcp-server');
const { createSystemAudio } = require('./system-audio');
const { Editor } = require('./editor');
const { LanShare } = require('./lan-share');
const { loadOrCreateCert } = require('./identity');
const { pathToFileURL } = require('url');

app.setName('Recme');
app.setAppUserModelId('com.recme.app'); // Windows: notifications, taskbar grouping

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let recorder = null;
let editor = null;
let share = null;
let mcpServer = null;
let config = null;
let tray = null;
let isQuitting = false;
let hintedTray = false;
const startHidden = process.argv.includes('--hidden');
const mcpLog = [];

function loadConfig() {
  const file = path.join(app.getPath('userData'), 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  cfg.port = cfg.port || 7777;
  cfg.token = cfg.token || crypto.randomBytes(24).toString('hex');
  cfg.outputDir = cfg.outputDir || path.join(os.homedir(), 'Videos', 'Recme');
  cfg.alias = cfg.alias || `Recme ${os.hostname()}`.slice(0, 40);
  cfg.fingerprint = cfg.fingerprint || crypto.randomBytes(32).toString('hex');
  if (typeof cfg.receive !== 'boolean') cfg.receive = true;
  if (typeof cfg.https !== 'boolean') cfg.https = true; // encrypted receiving, like LocalSend
  if (typeof cfg.closeToTray !== 'boolean') cfg.closeToTray = true;
  if (typeof cfg.startHidden !== 'boolean') cfg.startHidden = true; // only applies when started by Windows
  cfg.pin = typeof cfg.pin === 'string' ? cfg.pin : '';
  cfg.trusted = Array.isArray(cfg.trusted) ? cfg.trusted : [];
  cfg.receiveDir = cfg.receiveDir || '';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return cfg;
}

/** Monitors in physical pixels (what ffmpeg gdigrab expects). */
function getDisplays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => {
    const r = screen.dipToScreenRect(null, d.bounds);
    return {
      index: i,
      label: `Display ${i + 1}${d.id === primary ? ' (primary)' : ''}`,
      x: r.x, y: r.y,
      width: Math.floor(d.bounds.width * d.scaleFactor), height: Math.floor(d.bounds.height * d.scaleFactor),
      scale_factor: d.scaleFactor,
    };
  });
}

async function resizeImage(file, maxWidth) {
  const img = nativeImage.createFromPath(file);
  const { width } = img.getSize();
  return (width > maxWidth ? img.resize({ width: maxWidth, quality: 'best' }) : img).toPNG();
}

/**
 * Full-screen selection overlay on every monitor. Resolves to a rect in physical pixels
 * ({x,y,width,height}) or null when cancelled.
 */
function selectArea(initial) {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays();
    const overlays = new Map(); // webContents id -> { win, display }
    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      ipcMain.removeHandler('overlay:initial');
      ipcMain.removeListener('overlay:done', onDone);
      ipcMain.removeListener('overlay:cancel', onCancel);
      for (const { win: w } of overlays.values()) if (!w.isDestroyed()) w.destroy();
      if (win && !win.isDestroyed()) { win.show(); win.focus(); }
      resolve(result);
    };

    const onDone = (e, r) => {
      const o = overlays.get(e.sender.id);
      if (!o) return;
      const dip = { x: o.display.bounds.x + r.x, y: o.display.bounds.y + r.y, width: r.w, height: r.h };
      const phys = screen.dipToScreenRect(null, dip);
      // dipToScreenRect rounds outwards; derive the size from the scale factor so 1 CSS px stays exact.
      finish({
        x: phys.x,
        y: phys.y,
        width: Math.floor(r.w * o.display.scaleFactor),
        height: Math.floor(r.h * o.display.scaleFactor),
      });
    };
    const onCancel = () => finish(null);

    ipcMain.handle('overlay:initial', (e) => {
      const o = overlays.get(e.sender.id);
      if (!o || !initial) return null;
      const dip = screen.screenToDipRect(null, initial);
      const rel = { x: dip.x - o.display.bounds.x, y: dip.y - o.display.bounds.y, w: dip.width, h: dip.height };
      const b = o.display.bounds;
      const inside = rel.x >= 0 && rel.y >= 0 && rel.x + rel.w <= b.width && rel.y + rel.h <= b.height;
      return inside ? rel : null;
    });
    ipcMain.on('overlay:done', onDone);
    ipcMain.on('overlay:cancel', onCancel);

    if (win && !win.isDestroyed()) win.hide();

    displays.forEach((display, i) => {
      const w = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'overlay', 'overlay-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      overlays.set(w.webContents.id, { win: w, display });
      w.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
      w.once('ready-to-show', () => { w.show(); if (i === 0) w.focus(); });
    });
  });
}

/** Red frame drawn just outside the recorded area (click-through, so it is not part of the video). */
let areaFrame = null;
function syncAreaFrame() {
  const st = recorder.status();
  const src = st.state === 'recording' && st.options && st.options.source;
  if (!src || src.type !== 'region') {
    if (areaFrame && !areaFrame.isDestroyed()) areaFrame.destroy();
    areaFrame = null;
    return;
  }
  if (areaFrame && !areaFrame.isDestroyed()) return;
  const pad = 4;
  const dip = screen.screenToDipRect(null, { x: src.x, y: src.y, width: src.width, height: src.height });
  areaFrame = new BrowserWindow({
    x: dip.x - pad, y: dip.y - pad, width: dip.width + pad * 2, height: dip.height + pad * 2,
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
  });
  areaFrame.setIgnoreMouseEvents(true);
  areaFrame.setAlwaysOnTop(true, 'screen-saver');
  const html = '<body style="margin:0;overflow:hidden"><div style="position:fixed;inset:0;border:' + pad + 'px solid #ff4d5e;box-sizing:border-box"></div></body>';
  areaFrame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  areaFrame.once('ready-to-show', () => areaFrame && !areaFrame.isDestroyed() && areaFrame.showInactive());
}

function mcpInfo() {
  const url = `http://127.0.0.1:${config.port}/mcp`;
  const auth = `Bearer ${config.token}`;
  return {
    url,
    token: config.token,
    running: !!mcpServer,
    claudeCode: `claude mcp add --transport http recme ${url} --header "Authorization: ${auth}"`,
    claudeDesktop: JSON.stringify({
      mcpServers: {
        recme: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--allow-http', '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: auth },
        },
      },
    }, null, 2),
    log: mcpLog.slice(-20),
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', recorder.status());
}

/** App / tray icon drawn in code: a red ring, or a solid red disc while recording. */
function makeIcon(size, recording) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  const ring = Math.max(2, size / 8);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = Math.min(1, Math.max(0, r + 0.5 - d));
      const inRing = d > r - ring;
      const [R, G, B] = recording || inRing ? [255, 77, 94] : [24, 27, 34];
      const i = (y * size + x) * 4;
      buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = Math.round(a * 255); // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(true); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'Recme',
    icon: makeIcon(64, false),
    show,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Closing the window keeps Recme (recorder, MCP server, sharing) running in the tray.
  win.on('close', (e) => {
    if (isQuitting || !config.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!hintedTray && process.platform === 'win32') {
      hintedTray = true;
      tray.displayBalloon({ iconType: 'info', title: 'Recme is still running', content: 'It stays in the system tray so Claude can keep using it. Right-click the icon to quit.' });
    }
  });
  win.on('closed', () => { win = null; });
}

function loginItemOptions(openAtLogin) {
  const args = [];
  if (!app.isPackaged) args.push(app.getAppPath());
  if (config.startHidden) args.push('--hidden');
  return { openAtLogin, path: process.execPath, args };
}

function appSettings() {
  const login = app.getLoginItemSettings({ path: process.execPath, args: loginItemOptions(true).args });
  return { closeToTray: config.closeToTray, startHidden: config.startHidden, autostart: !!login.openAtLogin, packaged: app.isPackaged };
}

function updateTray() {
  if (!tray) return;
  const st = recorder.status();
  const rec = st.state === 'recording';
  tray.setImage(makeIcon(32, rec));
  const secs = Math.floor(st.elapsed_seconds || 0);
  const time = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
  tray.setToolTip(rec ? `Recme: recording ${time}` : `Recme: ready · Claude connection ${mcpServer ? 'on' : 'off'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Recme', click: showWindow },
    {
      label: rec ? `Stop recording (${time})` : st.state === 'stopping' ? 'Saving…' : 'Start recording',
      enabled: st.state !== 'stopping',
      click: async () => {
        try { if (recorder.state === 'recording') await recorder.stop(); else await recorder.start({}); } catch (e) { tray.displayBalloon({ iconType: 'error', title: 'Recme', content: e.message }); }
      },
    },
    { label: 'Open recordings folder', click: () => shell.openPath(recorder.outputDir) },
    { type: 'separator' },
    { label: 'Quit Recme', click: () => app.quit() },
  ]));
}

function createTray() {
  try {
    tray = new Tray(makeIcon(32, false));
    tray.on('click', showWindow);
    updateTray();
  } catch (e) {
    tray = null; // no tray available: closing the window will quit instead
  }
}

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  handle('init', () => ({
    status: recorder.status(),
    displays: getDisplays(),
    audioDevices: recorder.listAudioDevices(),
    encoders: ['auto', 'libx264', ...recorder.hwEncoders],
    hwEncoders: recorder.hwEncoders,
    quality: QUALITY,
    outputDir: recorder.outputDir,
    mcp: mcpInfo(),
  }));
  handle('start', (opts) => recorder.start(opts));
  handle('stop', () => recorder.stop());
  handle('status', () => recorder.status());
  handle('list', () => recorder.listRecordings());
  handle('open', (name) => shell.openPath(recorder.resolveRecording(name)));
  handle('reveal', (name) => shell.showItemInFolder(recorder.resolveRecording(name)));
  handle('delete', (name) => recorder.deleteRecording(name));
  handle('openFolder', () => shell.openPath(recorder.outputDir));
  handle('copy', (text) => clipboard.writeText(String(text)));
  handle('mcp', () => mcpInfo());
  handle('selectArea', (initial) => selectArea(initial));
  handle('chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    config.outputDir = r.filePaths[0];
    recorder.outputDir = config.outputDir;
    share.receiveDir = path.join(config.outputDir, 'Received');
    saveConfig();
    return config.outputDir;
  });

  // ---- editor ----
  handle('editor:open', (name) => { openEditor(recorder.resolveRecording(name) && name); });
  handle('editor:info', (name) => {
    const info = editor.info(name);
    return { ...info, fileUrl: pathToFileURL(info.path).href };
  });
  ipcMain.handle('editor:waveform', async (_e, name) => {
    try { return { ok: true, data: await editor.waveform(name) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  const progressTo = (sender) => (p) => { if (!sender.isDestroyed()) sender.send('editor:progress', p); };
  ipcMain.handle('editor:export', async (e, args) => {
    try { return { ok: true, data: await editor.exportVideo(args, progressTo(e.sender)) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('editor:audio', async (e, args) => {
    try { return { ok: true, data: await editor.extractAudio(args, progressTo(e.sender)) }; } catch (err) { return { ok: false, error: err.message }; }
  });

  // ---- local network sharing ----
  handle('share:info', () => shareInfo());
  handle('share:scan', async () => { await share.scan(); return shareInfo(); });
  handle('share:settings', async ({ alias, receive, https, pin }) => {
    if (typeof alias === 'string' && alias.trim()) { config.alias = alias.trim().slice(0, 40); share.setAlias(config.alias); }
    if (typeof receive === 'boolean') { config.receive = receive; share.receive = receive; }
    if (typeof https === 'boolean') { await share.setHttps(https); config.https = https; }
    if (typeof pin === 'string') {
      if (pin && !/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4 to 12 digits (or empty for no PIN)');
      config.pin = pin;
      share.setPin(pin);
    }
    saveConfig();
    return shareInfo();
  });
  handle('share:chooseReceiveDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Folder for received files', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return shareInfo();
    config.receiveDir = r.filePaths[0];
    share.receiveDir = config.receiveDir;
    saveConfig();
    return shareInfo();
  });
  handle('share:trust', ({ id, alias, trust }) => {
    if (trust) share.trust(id, alias); else share.untrust(id);
    return shareInfo();
  });

  // ---- app behaviour (tray, start with Windows) ----
  handle('app:get', () => appSettings());
  handle('app:set', ({ closeToTray, startHidden: hidden, autostart }) => {
    if (typeof closeToTray === 'boolean') config.closeToTray = closeToTray;
    if (typeof hidden === 'boolean') config.startHidden = hidden;
    saveConfig();
    const current = app.getLoginItemSettings({ path: process.execPath, args: loginItemOptions(true).args }).openAtLogin;
    const want = typeof autostart === 'boolean' ? autostart : current;
    // Re-register so a changed "start hidden" option takes effect.
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: loginItemOptions(true).args });
    app.setLoginItemSettings(loginItemOptions(want));
    return appSettings();
  });
  // Files from anywhere on the computer: picked with the system dialog (or dropped), kept by id in the main process.
  handle('share:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose files to send', properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : registerPaths(r.filePaths);
  });
  handle('share:register', (paths) => registerPaths(Array.isArray(paths) ? paths : []));
  handle('share:send', async ({ deviceId, items, pin }) => {
    if (!Array.isArray(items) || !items.length) throw new Error('Choose at least one file to send');
    const files = items.map((it) => {
      if (it.lib) return recorder.resolveRecording(it.lib);
      const p = pickedPaths.get(it.pid);
      if (!p || !fs.existsSync(p)) throw new Error('A chosen file is no longer available. Add it again.');
      return p;
    });
    try {
      return await share.send(deviceId, files, (p) => { if (win && !win.isDestroyed()) win.webContents.send('share:progress', { direction: 'out', ...p }); }, { pin: typeof pin === 'string' ? pin : '' });
    } catch (e) {
      // The renderer asks the user for the PIN and retries.
      if (e.code === 'PIN') throw new Error(`PIN_REQUIRED|${e.message}`);
      throw e;
    }
  });
  handle('share:respond', ({ id, accept }) => share.respond(id, accept));
  handle('share:select', (name) => {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('share-select', name); }
  });
  handle('openReceived', () => { fs.mkdirSync(share.receiveDir, { recursive: true }); return shell.openPath(share.receiveDir); });
}

const pickedPaths = new Map(); // id -> absolute path chosen by the user

function registerPaths(paths) {
  const out = [];
  for (const p of paths.slice(0, 50)) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      const id = crypto.randomUUID();
      pickedPaths.set(id, path.resolve(p));
      out.push({ id, name: path.basename(p), size: st.size });
    } catch { /* unreadable, skip */ }
  }
  return out;
}

function saveConfig() {
  fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify(config, null, 2));
}

function shareInfo() {
  return {
    alias: share.alias,
    receive: share.receive,
    port: share.port,
    receiveDir: share.receiveDir,
    https: share.https,
    httpsAvailable: !!share.identity,
    hasPin: !!share.pin,
    trusted: share.trusted,
    devices: share.devices().map((d) => ({ ...d, trusted: share.trusted.some((t) => t.id === d.id) })),
    error: share.lastError,
  };
}

function openEditor(name) {
  const w = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Recme Editor',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'editor', 'editor-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.loadFile(path.join(__dirname, 'editor', 'editor.html'), { query: { name } });
}

app.whenReady().then(async () => {
  config = loadConfig();
  recorder = new Recorder({ outputDir: config.outputDir, ffmpegPath: config.ffmpegPath, getDisplays, systemAudio: createSystemAudio() });
  recorder.detectEncoders();
  editor = new Editor(recorder);
  let identity = null;
  try { identity = await loadOrCreateCert(path.join(app.getPath('userData'), 'tls')); } catch (e) { mcpLog.push(`TLS certificate unavailable: ${e.message}`); }
  share = new LanShare({
    alias: config.alias,
    fingerprint: config.fingerprint,
    receive: config.receive,
    receiveDir: config.receiveDir || path.join(config.outputDir, 'Received'),
    identity,
    https: config.https,
    pin: config.pin,
    trusted: config.trusted,
  });
  const toWin = (channel) => (payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  share.on('trusted-changed', (list) => { config.trusted = list; saveConfig(); toWin('share:devices')(share.devices()); });
  share.on('auto-accepted', toWin('share:auto-accepted'));
  share.on('devices', toWin('share:devices'));
  share.on('incoming', (r) => { showWindow(); toWin('share:incoming')(r); });
  share.on('incoming-done', toWin('share:incoming-done'));
  share.on('progress', toWin('share:progress'));
  share.on('received', toWin('share:received'));
  share.start().catch((e) => { share.lastError = `Network sharing unavailable: ${e.message}`; });
  recorder.on('change', () => { pushState(); syncAreaFrame(); updateTray(); });
  setInterval(() => { if (recorder.state === 'recording') { pushState(); updateTray(); } }, 1000);

  try {
    mcpServer = await startMcpHttp({
      port: config.port,
      token: config.token,
      recorder,
      editor,
      share,
      getDisplays,
      resizeImage,
      onActivity: (tool) => {
        mcpLog.push(`${new Date().toLocaleTimeString()}  ${tool}`);
        if (win && !win.isDestroyed()) win.webContents.send('mcp-activity', mcpInfo().log);
      },
    });
  } catch (e) {
    mcpLog.push(`MCP server failed to start: ${e.message}`);
  }

  registerIpc();
  createTray();
  // Started by Windows with --hidden: stay in the tray and only open the window when asked.
  createWindow(!(startHidden && tray));
});

app.on('second-instance', () => showWindow());

let finishingRecording = false;
app.on('before-quit', async (e) => {
  isQuitting = true;
  if (finishingRecording || !recorder || recorder.state !== 'recording') return;
  e.preventDefault();
  finishingRecording = true;
  try { await recorder.stop(); } catch { /* ignore */ }
  app.quit();
});

app.on('will-quit', () => { if (share) share.stop(); });
// With a tray icon the app keeps running without a window; without one, closing the window quits.
app.on('window-all-closed', () => { if (!tray) app.quit(); });
