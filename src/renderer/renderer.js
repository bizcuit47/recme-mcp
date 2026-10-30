'use strict';

const $ = (id) => document.getElementById(id);
let state = { state: 'idle' };
let busy = false;

const fmtTime = (s) => {
  s = Math.floor(s || 0);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

function fill(select, items) {
  select.replaceChildren(...items.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
}

function showError(msg) {
  $('err').hidden = !msg;
  $('err').textContent = msg || '';
}

function render() {
  const rec = state.state === 'recording';
  const stopping = state.state === 'stopping';
  $('dot').classList.toggle('on', rec);
  setBadge('bRec', rec ? true : '');
  $('statePill').textContent = rec ? 'Recording' : stopping ? 'Saving…' : 'Idle';
  $('statePill').className = 'pill' + (rec ? ' rec' : '');
  $('timer').textContent = fmtTime(state.elapsed_seconds);
  const o = state.options;
  $('meta').textContent = rec && o
    ? `${o.fps} fps · ${o.encoder} · CRF ${o.crf} · ${fmtSize(state.size_bytes || 0)}`
    : stopping ? 'Finalizing file…' : 'Ready to record';
  const btn = $('recBtn');
  btn.textContent = rec ? 'Stop recording' : stopping ? 'Saving…' : 'Start recording';
  btn.classList.toggle('stop', rec);
  btn.disabled = busy || stopping;
  for (const id of ['source', 'quality', 'fps', 'encoder', 'audio', 'cursor', 'sysAudio', 'areaBtn', 'areaPreset', 'ax', 'ay', 'aw', 'ah']) $(id).disabled = rec || stopping;
  if (state.last_error && !rec) showError(state.last_error);
  else if (state.warning) showError(state.warning);
}

// ---- Custom recording area (physical pixels) ----
let displays = [];
const area = { x: 0, y: 0, w: 1280, h: 720 };
const AREA_KEY = 'recme.area';

function desktopBounds() {
  const x1 = Math.min(...displays.map((d) => d.x));
  const y1 = Math.min(...displays.map((d) => d.y));
  const x2 = Math.max(...displays.map((d) => d.x + d.width));
  const y2 = Math.max(...displays.map((d) => d.y + d.height));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Keep the area inside the desktop with even dimensions (H.264 requirement). */
function normalizeArea() {
  const b = desktopBounds();
  const n = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  area.w = Math.min(Math.max(n(area.w, 1280), 16), b.w);
  area.h = Math.min(Math.max(n(area.h, 720), 16), b.h);
  area.x = Math.min(Math.max(n(area.x, b.x), b.x), b.x + b.w - area.w);
  area.y = Math.min(Math.max(n(area.y, b.y), b.y), b.y + b.h - area.h);
  area.w -= area.w % 2;
  area.h -= area.h % 2;
  try { localStorage.setItem(AREA_KEY, JSON.stringify(area)); } catch { /* storage unavailable */ }
}

function renderArea() {
  $('ax').value = area.x; $('ay').value = area.y; $('aw').value = area.w; $('ah').value = area.h;
  $('areaHint').textContent = `Recording ${area.w} × ${area.h} px at (${area.x}, ${area.y}). Output keeps these exact pixels, no scaling.`;
}

function onSourceChange() {
  $('areaBox').hidden = $('source').value !== 'area';
}

function sourceFromSelect() {
  const v = $('source').value;
  if (v === 'area') {
    normalizeArea();
    return { type: 'region', x: area.x, y: area.y, width: area.w, height: area.h };
  }
  return v === 'desktop' ? { type: 'desktop' } : { type: 'display', index: Number(v) };
}

function initArea() {
  try { Object.assign(area, JSON.parse(localStorage.getItem(AREA_KEY)) || {}); } catch { /* use default */ }
  if (!localStorage.getItem(AREA_KEY)) {
    const p = displays[0];
    area.x = p.x + Math.floor((p.width - area.w) / 2);
    area.y = p.y + Math.floor((p.height - area.h) / 2);
  }
  normalizeArea();
  renderArea();
  for (const [id, key] of [['ax', 'x'], ['ay', 'y'], ['aw', 'w'], ['ah', 'h']]) {
    $(id).onchange = () => { area[key] = $(id).value; normalizeArea(); renderArea(); };
  }
  $('areaPreset').onchange = () => {
    const v = $('areaPreset').value;
    if (v === 'display') {
      const d = displays.find((x) => area.x >= x.x && area.x < x.x + x.width && area.y >= x.y && area.y < x.y + x.height) || displays[0];
      Object.assign(area, { x: d.x, y: d.y, w: d.width, h: d.height });
    } else if (v) {
      [area.w, area.h] = v.split('x').map(Number);
    }
    $('areaPreset').value = '';
    normalizeArea();
    renderArea();
  };
  $('areaBtn').onclick = async () => {
    $('areaBtn').disabled = true;
    const r = await window.recme.selectArea({ x: area.x, y: area.y, width: area.w, height: area.h });
    $('areaBtn').disabled = false;
    if (r.ok && r.data) {
      Object.assign(area, { x: r.data.x, y: r.data.y, w: r.data.width, h: r.data.height });
      normalizeArea();
      renderArea();
    }
  };
  $('source').onchange = onSourceChange;
}

async function toggle() {
  busy = true; render(); showError('');
  let r;
  if (state.state === 'recording') {
    r = await window.recme.stop();
    if (r.ok) $('meta').textContent = `Saved ${r.data.file}`;
  } else {
    r = await window.recme.start({
      quality: $('quality').value,
      fps: $('fps').value ? Number($('fps').value) : undefined,
      encoder: $('encoder').value,
      system_audio: $('sysAudio').checked,
      audio_device: $('audio').value || undefined,
      cursor: $('cursor').checked,
      source: sourceFromSelect(),
    });
    if (r.ok) state = r.data;
  }
  busy = false;
  if (!r.ok) showError(r.error);
  state = (await window.recme.status()).data;
  render();
  refreshList();
}

// ---- navigation (top menu) ----
const TABS = ['record', 'library', 'share', 'claude'];
const TAB_KEY = 'recme.tab';

function showTab(name) {
  if (!TABS.includes(name)) name = 'record';
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== name; });
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', String(on));
  });
  try { localStorage.setItem(TAB_KEY, name); } catch { /* storage unavailable */ }
  // Files can change outside the app (edits, received files, Claude): always show the current folder.
  if (name === 'library' || name === 'share') refreshList();
}

window.addEventListener('focus', () => refreshList());

document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key >= '1' && e.key <= '4') { e.preventDefault(); showTab(TABS[Number(e.key) - 1]); }
});

function setBadge(id, text) {
  $(id).hidden = !text;
  $(id).textContent = text === true ? '' : text || '';
}

// ---- library ----
let files = [];
let libFilter = 'all';
const isAudio = (n) => /\.(mp3|m4a|wav|flac)$/i.test(n);

document.querySelectorAll('#libFilter .chip').forEach((c) => {
  c.onclick = () => {
    libFilter = c.dataset.filter;
    document.querySelectorAll('#libFilter .chip').forEach((x) => x.classList.toggle('on', x === c));
    renderList();
  };
});

async function refreshList() {
  const r = await window.recme.list();
  files = r.ok ? r.data : [];
  const keep = $('shareFile').value;
  fill($('shareFile'), files.map((f) => [f.name, `${f.name} (${fmtSize(f.size_bytes)})`]));
  if (keep) $('shareFile').value = keep;
  setBadge('bLib', files.length ? String(files.length) : '');
  renderList();
}

function renderList() {
  const ul = $('list');
  ul.replaceChildren();
  const shown = files.filter((f) => libFilter === 'all' || (libFilter === 'audio') === isAudio(f.name));
  $('libSummary').textContent = files.length
    ? `${shown.length} of ${files.length} · ${fmtSize(files.reduce((a, f) => a + f.size_bytes, 0))} total`
    : '';
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = files.length ? 'Nothing in this filter' : 'No recordings yet. Go to Record and press Start recording.';
    ul.append(li);
    return;
  }
  for (const f of shown) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'name';
    info.innerHTML = '<div></div><div class="sub"></div>';
    info.children[0].textContent = f.name;
    info.children[1].textContent = `${fmtSize(f.size_bytes)} · ${new Date(f.created).toLocaleString()}`;
    const mk = (label, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = 'ghost ' + (cls || '');
      b.onclick = fn;
      return b;
    };
    li.append(
      info,
      mk('Play', () => window.recme.open(f.name)),
      ...(/\.(mp4|mkv|mp3|m4a|wav|flac)$/i.test(f.name) ? [mk('Edit', () => window.recme.openEditor(f.name))] : []),
      mk('Send', () => selectShareFile(f.name)),
      mk('Show', () => window.recme.reveal(f.name)),
      mk('Delete', async () => {
        if (!confirm(`Delete ${f.name}?`)) return;
        await window.recme.remove(f.name);
        refreshList();
      }, 'danger'),
    );
    ul.append(li);
  }
}

const TOOL_GROUPS = [
  ['Record', [
    ['start_recording', 'Start recording: area, quality, system sound, mic'],
    ['stop_recording', 'Finish and save the video'],
    ['get_status', 'Is it recording? how long, how big'],
    ['take_screenshot', 'Capture the screen so Claude can see it'],
    ['list_displays', 'Monitors available for capture'],
    ['list_audio_devices', 'Microphones / inputs'],
  ]],
  ['Review', [
    ['list_recordings', 'Files in your library'],
    ['get_recording_info', 'Resolution, codec, duration'],
    ['get_recording_frame', 'See a frame of a video at any time'],
  ]],
  ['Edit', [
    ['trim_recording', 'Cut, trim or join pieces into a new MP4'],
    ['extract_audio', 'Save the sound as m4a / mp3 / wav / flac'],
  ]],
  ['Share', [
    ['list_nearby_devices', 'Devices on your Wi-Fi'],
    ['send_recording', 'Send a file (receiver must accept)'],
  ]],
  ['Library', [
    ['delete_recording', 'Delete a file'],
  ]],
];

const PROMPTS = [
  'Record my screen for 15 seconds, then show me a frame from the middle.',
  'Record the area 1280x720 at the top-left with system sound for 30 seconds.',
  'Cut the last recording to the first 10 seconds and save only the audio as MP3.',
  'Send my latest recording to Pim\'s phone.',
];

function renderTools() {
  const box = $('toolList');
  box.replaceChildren();
  for (const [group, tools] of TOOL_GROUPS) {
    const g = document.createElement('div');
    g.className = 'tg';
    const h = document.createElement('h3');
    h.textContent = group;
    g.append(h);
    for (const [name, desc] of tools) {
      const row = document.createElement('div');
      row.className = 'tool';
      row.innerHTML = '<code></code><span></span>';
      row.children[0].textContent = name;
      row.children[1].textContent = desc;
      g.append(row);
    }
    box.append(g);
  }
  $('prompts').replaceChildren(...PROMPTS.map((p) => {
    const li = document.createElement('li');
    li.textContent = p;
    li.title = 'Click to copy';
    li.onclick = () => window.recme.copy(p);
    return li;
  }));
}

let mcpToken = '';
let tokenShown = false;

function renderMcp(m) {
  $('mcpPill').textContent = m.running ? 'Server running' : 'Server stopped';
  $('mcpPill').className = 'pill' + (m.running ? ' ok' : '');
  setBadge('bMcp', m.running ? true : '');
  $('mcpUrl').textContent = m.url;
  mcpToken = m.token || '';
  $('mcpToken').textContent = tokenShown ? mcpToken : '•'.repeat(24);
  $('cmdCode').textContent = m.claudeCode;
  $('cmdDesktop').textContent = m.claudeDesktop;
  $('mcpLog').textContent = m.log && m.log.length ? m.log.join('\n') : 'No calls yet';
}

$('tokenShow').onclick = () => {
  tokenShown = !tokenShown;
  $('mcpToken').textContent = tokenShown ? mcpToken : '•'.repeat(24);
  $('tokenShow').textContent = tokenShown ? 'Hide' : 'Show';
};
$('tokenCopy').onclick = async () => {
  await window.recme.copy(mcpToken);
  $('tokenCopy').textContent = 'Copied!';
  setTimeout(() => { $('tokenCopy').textContent = 'Copy'; }, 1200);
};
$('logClear').onclick = () => { $('mcpLog').textContent = 'No calls yet'; };
renderTools();

async function init() {
  const r = await window.recme.init();
  if (!r.ok) return showError(r.error);
  const d = r.data;
  state = d.status;
  displays = d.displays;
  fill($('source'), [
    ['desktop', 'All screens'],
    ...d.displays.map((x) => [String(x.index), `${x.label} — ${x.width}×${x.height}`]),
    ['area', 'Custom area…'],
  ]);
  initArea();
  fill($('quality'), Object.entries(d.quality).map(([k, v]) => [k, v.label]));
  $('quality').value = 'high';
  fill($('encoder'), d.encoders.map((e) => [e, e === 'auto' ? `Auto (${d.hwEncoders[0] || 'libx264'})` : e]));
  fill($('audio'), [['', 'None'], ...d.audioDevices.map((a) => [a, a])]);
  $('outDir').textContent = d.outputDir;
  if (!state.ffmpeg) showError('ffmpeg not found. Install it with: winget install Gyan.FFmpeg');
  renderMcp(d.mcp);
  render();
  refreshList();
  let saved = 'record';
  try { saved = localStorage.getItem(TAB_KEY) || 'record'; } catch { /* storage unavailable */ }
  showTab(saved);
}

$('recBtn').onclick = toggle;
$('folderBtn').onclick = () => window.recme.openFolder();
$('pickBtn').onclick = async () => {
  const r = await window.recme.chooseFolder();
  if (r.ok && r.data) { $('outDir').textContent = r.data; refreshList(); }
};
document.querySelectorAll('[data-copy]').forEach((b) => {
  b.onclick = async () => {
    await window.recme.copy($(b.dataset.copy).textContent);
    const old = b.textContent; b.textContent = 'Copied!';
    setTimeout(() => { b.textContent = old; }, 1200);
  };
});

// ---- sharing on the local network ----
// Files waiting to be sent: library files ({lib}) or files picked from the computer ({pid}).
let staged = [];

function stage(item) {
  const key = item.lib ? 'lib:' + item.lib : 'pid:' + item.pid;
  if (!staged.some((s) => s.key === key)) staged.push({ ...item, key });
  renderStaged();
}

function renderStaged() {
  const ul = $('staged');
  ul.replaceChildren();
  for (const s of staged) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'name';
    info.innerHTML = '<div></div><div class="sub"></div>';
    info.children[0].textContent = s.label;
    info.children[1].textContent = `${fmtSize(s.size || 0)} · ${s.lib ? 'from library' : 'from this computer'}`;
    const rm = document.createElement('button');
    rm.className = 'ghost';
    rm.textContent = 'Remove';
    rm.onclick = () => { staged = staged.filter((x) => x !== s); renderStaged(); };
    li.append(info, rm);
    ul.append(li);
  }
}

function selectShareFile(name) {
  const f = files.find((x) => x.name === name);
  stage({ lib: name, label: name, size: f ? f.size_bytes : 0 });
  showTab('share');
}

function stageComputerFiles(list) {
  for (const f of list) stage({ pid: f.id, label: f.name, size: f.size });
}

$('addLib').onclick = () => {
  const name = $('shareFile').value;
  if (name) selectShareFile(name);
};
$('browseBtn').onclick = async () => {
  const r = await window.recme.share.pick();
  if (r.ok) stageComputerFiles(r.data);
};

// Drag & drop. Dropping on the window anywhere else must not navigate away to the file.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
const dz = $('dropzone');
dz.addEventListener('dragover', () => dz.classList.add('over'));
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', async (e) => {
  dz.classList.remove('over');
  const paths = [...e.dataTransfer.files].map((f) => window.recme.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  const r = await window.recme.share.register(paths);
  if (r.ok) stageComputerFiles(r.data);
});

function renderDevices(devices) {
  const ul = $('devices');
  ul.replaceChildren();
  setBadge('bShare', devices.length ? String(devices.length) : '');
  if (!devices.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No devices found yet. Open Recme or LocalSend on the other device (same Wi-Fi), then press Find devices.';
    ul.append(li);
    return;
  }
  for (const d of devices) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'dev';
    info.innerHTML = '<div></div><div class="sub"></div>';
    info.children[0].textContent = d.alias;
    info.children[1].textContent = `${d.ip} · ${d.deviceType}${d.deviceModel ? ' · ' + d.deviceModel : ''}`;
    const t = document.createElement('button');
    t.className = 'ghost';
    t.textContent = d.trusted ? 'Trusted ✓' : 'Trust';
    t.title = d.trusted ? 'Click to stop accepting files from this device automatically' : 'Accept files from this device without asking';
    t.onclick = async () => {
      if (!d.trusted && !confirm(`Always accept files from "${d.alias}" without asking? (Only do this for your own devices.)`)) return;
      await window.recme.share.trust({ id: d.id, alias: d.alias, trust: !d.trusted });
      loadShare(false);
    };
    const b = document.createElement('button');
    b.textContent = 'Send';
    b.onclick = () => sendTo(d);
    li.append(info, t, b);
    ul.append(li);
  }
}

// ---- PIN prompt (the other device asked for one) ----
function askPin(title) {
  return new Promise((resolve) => {
    $('pinTitle').textContent = title;
    $('pinEntry').value = '';
    $('pinAsk').hidden = false;
    $('pinEntry').focus();
    const done = (v) => { $('pinAsk').hidden = true; $('pinSend').onclick = $('pinCancel').onclick = $('pinEntry').onkeydown = null; resolve(v); };
    $('pinSend').onclick = () => done($('pinEntry').value.trim());
    $('pinCancel').onclick = () => done(null);
    $('pinEntry').onkeydown = (e) => { if (e.key === 'Enter') done($('pinEntry').value.trim()); if (e.key === 'Escape') done(null); };
  });
}

function shareMessage(msg, isError) {
  const el = $('shareErr');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.style.color = isError ? '' : 'var(--ok)';
}

async function sendTo(device) {
  if (!staged.length) return shareMessage('Add at least one file to send first.', true);
  shareMessage('');
  $('shareProgress').hidden = false;
  $('shareBar').style.width = '0';
  $('shareText').textContent = `Waiting for ${device.alias} to accept…`;
  const items = staged.map((s) => (s.lib ? { lib: s.lib } : { pid: s.pid }));
  let pin = '';
  let r;
  for (;;) {
    r = await window.recme.share.send({ deviceId: device.id, items, pin });
    if (r.ok || !r.error.startsWith('PIN_REQUIRED|')) break;
    $('shareProgress').hidden = true;
    pin = await askPin(r.error.split('|')[1]);
    if (pin === null) { r = { ok: false, error: 'Cancelled' }; break; }
    $('shareProgress').hidden = false;
    $('shareText').textContent = `Waiting for ${device.alias} to accept…`;
  }
  $('shareProgress').hidden = true;
  if (r.ok) {
    shareMessage(`Sent ${staged.length} file${staged.length === 1 ? '' : 's'} to ${device.alias}`, false);
    staged = [];
    renderStaged();
  } else {
    shareMessage(r.error, true);
  }
}

async function loadShare(scan) {
  const r = scan ? await window.recme.share.scan() : await window.recme.share.info();
  if (!r.ok) return;
  const s = r.data;
  if (document.activeElement !== $('alias')) $('alias').value = s.alias;
  $('receive').checked = s.receive;
  renderReceiving(s);
  renderDevices(s.devices);
  if (s.error) shareMessage(s.error, true);
}

function renderReceiving(s) {
  $('recvDir').textContent = s.receiveDir;
  $('httpsOn').checked = s.https;
  $('httpsOn').disabled = !s.httpsAvailable;
  $('httpsNote').textContent = s.httpsAvailable ? (s.https ? '' : '(files travel unencrypted on your Wi-Fi)') : '(certificate unavailable)';
  $('pinState').textContent = s.hasPin ? 'PIN is on' : 'no PIN';
  const ul = $('trustedList');
  ul.replaceChildren();
  if (!s.trusted.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = 'None. Every incoming transfer asks you first.';
    ul.append(li);
  }
  for (const t of s.trusted) {
    const li = document.createElement('li');
    const n = document.createElement('div');
    n.className = 'name'; n.textContent = t.alias;
    const rm = document.createElement('button');
    rm.className = 'ghost'; rm.textContent = 'Remove';
    rm.onclick = async () => { await window.recme.share.trust({ id: t.id, alias: t.alias, trust: false }); loadShare(false); };
    li.append(n, rm);
    ul.append(li);
  }
}

$('recvChange').onclick = async () => { const r = await window.recme.share.chooseReceiveDir(); if (r.ok) renderReceiving(r.data); };
$('recvOpen').onclick = () => window.recme.share.openReceived();
$('httpsOn').onchange = async () => {
  const r = await window.recme.share.settings({ https: $('httpsOn').checked });
  if (r.ok) renderReceiving(r.data); else shareMessage(r.error, true);
};
$('pinSave').onclick = async () => {
  const r = await window.recme.share.settings({ pin: $('pinInput').value.trim() });
  if (r.ok) { $('pinInput').value = ''; renderReceiving(r.data); shareMessage($('pinState').textContent === 'PIN is on' ? 'PIN saved' : 'PIN removed', false); }
  else shareMessage(r.error, true);
};

// ---- app behaviour: tray and start with Windows ----
function renderApp(a) {
  $('closeTray').checked = a.closeToTray;
  $('autostart').checked = a.autostart;
  $('startHidden').checked = a.startHidden;
  $('startHidden').disabled = !a.autostart;
  if (!a.packaged) $('appHint').textContent = 'Running in the tray keeps the Claude connection and file receiving alive. Quit from the tray icon. (Development build: Windows start-up will launch this project folder.)';
}
async function loadApp() { const r = await window.recme.app.get(); if (r.ok) renderApp(r.data); }
for (const [id, key] of [['closeTray', 'closeToTray'], ['autostart', 'autostart'], ['startHidden', 'startHidden']]) {
  $(id).onchange = async () => { const r = await window.recme.app.set({ [key]: $(id).checked }); if (r.ok) renderApp(r.data); };
}
loadApp();

$('scanBtn').onclick = async () => {
  $('scanBtn').disabled = true; $('scanBtn').textContent = 'Searching…';
  await loadShare(true);
  $('scanBtn').disabled = false; $('scanBtn').textContent = 'Find devices';
};
$('alias').onchange = () => window.recme.share.settings({ alias: $('alias').value });
$('receive').onchange = () => window.recme.share.settings({ receive: $('receive').checked });
$('recvFolder').onclick = () => window.recme.share.openReceived();

let incomingId = null;
const answer = (accept) => {
  if (!incomingId) return;
  window.recme.share.respond({ id: incomingId, accept });
  incomingId = null;
  $('incoming').hidden = true;
};
$('inAccept').onclick = () => answer(true);
$('inDecline').onclick = () => answer(false);

window.recme.on('share:devices', renderDevices);
window.recme.on('share:incoming', (req) => {
  incomingId = req.id;
  $('inTitle').textContent = `${req.from} wants to send you ${req.files.length} file${req.files.length === 1 ? '' : 's'}`;
  $('inFiles').replaceChildren(...req.files.map((f) => Object.assign(document.createElement('li'), { textContent: `${f.name} — ${fmtSize(f.size)}` })));
  $('incoming').hidden = false;
});
window.recme.on('share:incoming-done', (id) => { if (id === incomingId) { incomingId = null; $('incoming').hidden = true; } });
window.recme.on('share:progress', (p) => {
  $('shareProgress').hidden = false;
  const done = p.direction === 'out' ? p.sent : p.received;
  const total = p.direction === 'out' ? p.total : p.size;
  $('shareBar').style.width = total ? Math.round((done / total) * 100) + '%' : '0';
  $('shareText').textContent = `${p.direction === 'out' ? 'Sending' : 'Receiving'} ${p.file} — ${fmtSize(done)} / ${fmtSize(total)}`;
});
window.recme.on('share:received', (r) => {
  $('shareProgress').hidden = true;
  shareMessage(`Received ${r.name} from ${r.from} (saved in Received folder)`, false);
});
window.recme.on('share-select', selectShareFile);
window.recme.on('share:auto-accepted', (r) => shareMessage(`Receiving ${r.files.length} file${r.files.length === 1 ? '' : 's'} from trusted device ${r.from}…`, false));
setInterval(() => loadShare(false), 5000);

window.recme.onState((s) => { state = s; render(); });
window.recme.onMcpActivity((log) => {
  $('mcpLog').textContent = log.join('\n');
  // Claude may have started/stopped a recording; keep the list fresh.
  refreshList();
});

init().then(() => loadShare(false));
