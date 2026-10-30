'use strict';

const $ = (id) => document.getElementById(id);
const video = $('video');
const MIN = 0.1; // shortest piece, seconds

let info = null;
let duration = 0;
let segs = []; // kept pieces of the source, in order
let sel = 0;
let cur = 0; // piece the playhead is in (needed because pieces can be rearranged, so source time alone is ambiguous)
let history = [];

const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const pct = (t) => (t / duration) * 100;

// ---- timeline view ----
// "Gaps closed" (default): pieces sit one after another, exactly like the exported video.
// "Original positions": every piece stays where it is in the source clip, removed parts show as gaps.
let ripple = true;
try { ripple = localStorage.getItem('recme.editor.ripple') !== '0'; } catch { /* storage unavailable */ }

const keptTotal = () => segs.reduce((a, s) => a + (s.end - s.start), 0);
const viewSpan = () => (ripple ? keptTotal() : duration) || 1;
const outOffset = (i) => { let o = 0; for (let k = 0; k < i; k++) o += segs[k].end - segs[k].start; return o; };
const vpct = (v) => (v / viewSpan()) * 100;

/** Source time -> position on the timeline axis (seconds). */
function toView(t) {
  if (!ripple) return t;
  const c = segs[cur];
  if (c && t >= c.start && t <= c.end + 0.05) return outOffset(cur) + Math.min(t - c.start, c.end - c.start);
  let o = 0;
  for (const s of segs) {
    if (t >= s.start && t < s.end) return o + (t - s.start);
    o += s.end - s.start;
  }
  return 0; // not inside any kept piece
}

/** Index of the piece that is drawn at this timeline position (seconds). */
function pieceAtView(v) {
  let o = 0;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i].end - segs[i].start;
    if (v < o + len) return i;
    o += len;
  }
  return segs.length - 1;
}

/** Make `cur` the piece that contains source time t (or the next piece after a removed part). */
function setCurFor(t) {
  const c = segs[cur];
  if (c && t >= c.start && t < c.end) return;
  let i = segAt(t);
  if (i < 0) {
    let best = -1;
    segs.forEach((s, k) => { if (s.start > t && (best < 0 || s.start < segs[best].start)) best = k; });
    i = best < 0 ? segs.length - 1 : best;
  }
  cur = i;
}

/** Timeline axis position (seconds) -> source time. */
function toSource(v) {
  if (!ripple) return v;
  let o = 0;
  for (const s of segs) {
    const len = s.end - s.start;
    if (v < o + len) return s.start + Math.max(0, v - o);
    o += len;
  }
  return segs[segs.length - 1].end;
}

function pushHistory() {
  history.push({ segs: clone(segs), sel });
  if (history.length > 100) history.shift();
}

function undo() {
  const h = history.pop();
  if (!h) return;
  segs = h.segs; sel = h.sel; cur = Math.min(cur, segs.length - 1);
  render();
}

function segAt(t) {
  return segs.findIndex((s) => t >= s.start && t < s.end);
}

function render() {
  const wrap = $('segs');
  wrap.replaceChildren();
  segs.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'seg' + (i === sel ? ' sel' : '');
    d.style.left = (ripple ? vpct(outOffset(i)) : pct(s.start)) + '%';
    d.style.width = vpct(s.end - s.start) + '%';
    for (const side of ['l', 'r']) {
      const h = document.createElement('div');
      h.className = 'h ' + side;
      h.onmousedown = (e) => startDrag(e, i, side);
      d.append(h);
    }
    wrap.append(d);
  });
  // The audio lane shows removed parts striped out, so video and sound stay in step.
  const mask = $('audioMask');
  mask.replaceChildren();
  let cursor = 0;
  for (const s of ripple ? [] : [...segs].sort((a, b) => a.start - b.start).concat([{ start: duration, end: duration }])) {
    if (s.start > cursor + 0.001) {
      const g = document.createElement('div');
      g.style.left = pct(cursor) + '%';
      g.style.width = pct(s.start - cursor) + '%';
      mask.append(g);
    }
    cursor = Math.max(cursor, s.end);
  }
  const total = keptTotal();
  $('kept').textContent = `${segs.length} piece${segs.length === 1 ? '' : 's'} · result ${fmt(total)}`;
  $('undo').disabled = !history.length;
  $('remove').disabled = segs.length <= 1;
  $('viewMode').textContent = ripple ? 'View: gaps closed' : 'View: original positions';
  document.body.classList.toggle('ripple', ripple);
  $('moveL').disabled = sel <= 0;
  $('moveR').disabled = sel >= segs.length - 1;
  renderRuler();
  drawWave();
  updateTime();
}

// Audio lane: the waveform is cut into the same pieces as the video lane.
let waveImg = null;
function drawWave() {
  const c = $('wave');
  if (!waveImg || c.hidden) return;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const span = viewSpan();
  let o = 0;
  for (const s of segs) {
    const len = s.end - s.start;
    const sx = (s.start / duration) * waveImg.width;
    const sw = (len / duration) * waveImg.width;
    const dx = ((ripple ? o : s.start) / span) * c.width;
    const dw = (len / span) * c.width;
    g.drawImage(waveImg, sx, 0, Math.max(sw, 1), waveImg.height, dx, 0, Math.max(dw, 1), c.height);
    o += len;
  }
}
window.addEventListener('resize', drawWave);

function renderRuler() {
  const r = $('ruler');
  r.replaceChildren();
  const steps = 8;
  const span = viewSpan();
  for (let i = 0; i <= steps; i++) {
    const s = document.createElement('span');
    s.style.left = (i / steps) * 100 + '%';
    const sec = Math.round((span * i) / steps);
    s.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    r.append(s);
  }
}

function showTime(t) {
  const v = toView(t);
  $('time').textContent = `${fmt(v)} / ${fmt(viewSpan())}`;
  $('time').title = ripple && Math.abs(keptTotal() - duration) > 0.01 ? `Position in the original clip: ${fmt(t)}` : '';
  $('playhead').style.left = vpct(v) + '%';
}

function updateTime() {
  showTime(video.currentTime);
  $('play').textContent = video.paused ? '▶' : '⏸';
  if (!seekDragging && duration) $('seek').value = Math.round((toView(video.currentTime) / viewSpan()) * 1000);
}

// Slider under the video: drag to move through the clip.
let seekDragging = false;
$('seek').addEventListener('pointerdown', () => { seekDragging = true; });
window.addEventListener('pointerup', () => { seekDragging = false; });
$('seek').addEventListener('input', () => {
  const v = (Number($('seek').value) / 1000) * viewSpan();
  const t = toSource(v);
  if (ripple) cur = pieceAtView(v); else setCurFor(t);
  if (cur !== sel) { sel = cur; render(); }
  video.currentTime = t;
  showTime(t);
});

$('viewMode').onclick = () => {
  ripple = !ripple;
  try { localStorage.setItem('recme.editor.ripple', ripple ? '1' : '0'); } catch { /* storage unavailable */ }
  render();
};
video.addEventListener('click', () => togglePlay());

function seek(t) {
  video.currentTime = Math.min(Math.max(t, 0), duration);
  setCurFor(video.currentTime);
  updateTime();
}

/** Piece under the playhead (cur if it contains the time, otherwise the first piece that does). */
function pieceUnderPlayhead() {
  const t = video.currentTime;
  const c = segs[cur];
  if (c && t >= c.start && t < c.end) return cur;
  return segAt(t);
}

// ---- editing ----
function split() {
  const t = video.currentTime;
  const i = pieceUnderPlayhead();
  if (i < 0) return;
  const s = segs[i];
  if (t - s.start < MIN || s.end - t < MIN) return;
  pushHistory();
  segs.splice(i, 1, { start: s.start, end: t }, { start: t, end: s.end });
  sel = i + 1;
  cur = i + 1;
  render();
}

function removePiece() {
  if (segs.length <= 1) return;
  pushHistory();
  segs.splice(sel, 1);
  sel = Math.min(sel, segs.length - 1);
  cur = Math.min(cur, segs.length - 1);
  render();
}

function trim(side) {
  const t = video.currentTime;
  const i = pieceUnderPlayhead() >= 0 ? pieceUnderPlayhead() : sel;
  const s = segs[i];
  if (side === 'in' && t < s.end - MIN && t > s.start) { pushHistory(); s.start = t; }
  else if (side === 'out' && t > s.start + MIN && t < s.end) { pushHistory(); s.end = t; }
  else return;
  sel = i;
  render();
}

/** Move a piece to a new place in the order (later or earlier in the result). */
function movePiece(from, to) {
  if (from === to || from < 0 || from >= segs.length || to < 0 || to >= segs.length) return;
  pushHistory();
  const [p] = segs.splice(from, 1);
  segs.splice(to, 0, p);
  sel = to;
  cur = to;
  render();
  seek(p.start);
}

function startDrag(e, i, side) {
  e.stopPropagation();
  e.preventDefault();
  pushHistory();
  sel = i;
  const rect = $('timeline').getBoundingClientRect();
  // A piece may grow until it touches another piece's source range (pieces can be in any order, so look at source times).
  let prevEnd = 0;
  let nextStart = duration;
  segs.forEach((o, k) => {
    if (k === i) return;
    if (o.end <= segs[i].start + 1e-6) prevEnd = Math.max(prevEnd, o.end);
    if (o.start >= segs[i].end - 1e-6) nextStart = Math.min(nextStart, o.start);
  });
  // Work with how far the mouse moved (in seconds), so the handle never jumps when grabbed off-centre.
  const x0 = e.clientX;
  const span0 = viewSpan();
  const start0 = segs[i].start;
  const end0 = segs[i].end;
  const move = (ev) => {
    const dsec = ((ev.clientX - x0) / rect.width) * span0;
    const s = segs[i];
    if (side === 'l') s.start = Math.min(Math.max(start0 + dsec, prevEnd), end0 - MIN);
    else s.end = Math.max(Math.min(end0 + dsec, nextStart), start0 + MIN);
    video.currentTime = side === 'l' ? s.start : Math.max(s.end - 0.04, s.start);
    render();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// Anywhere on the timeline (video lane, audio lane or the playhead) moves the playhead, also while dragging.
// Dragging a blue piece sideways (in the "gaps closed" view) moves it to another place in the result.
$('tracks').addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('h')) return;
  const rect = $('timeline').getBoundingClientRect();
  const viewAt = (ev) => Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1) * viewSpan();
  const fromEl = e.target.closest('.seg');
  const dragIdx = ripple && fromEl && segs.length > 1 ? [...$('segs').children].indexOf(fromEl) : -1;

  const clickIdx = ripple ? pieceAtView(viewAt(e)) : -1;
  if (clickIdx >= 0) cur = clickIdx;
  const t = ripple ? toSource(viewAt(e)) : viewAt(e);
  const i = ripple ? clickIdx : segAt(t);
  if (i >= 0) sel = i;
  seek(t);
  render();

  const x0 = e.clientX;
  const span = viewSpan();
  let dragging = false;
  let target = dragIdx;
  const mark = $('dropMark');

  const move = (ev) => {
    if (dragIdx >= 0 && (dragging || Math.abs(ev.clientX - x0) > 5)) {
      dragging = true;
      const dx = ev.clientX - x0;
      const el = $('segs').children[dragIdx];
      el.style.transform = `translateX(${dx}px)`;
      el.classList.add('moving');
      // Where would it land? Count the other pieces whose middle is to the left of this piece's middle.
      const len = segs[dragIdx].end - segs[dragIdx].start;
      const middle = ((outOffset(dragIdx) + len / 2) / span) * rect.width + dx;
      let before = 0;
      let o = 0;
      let boundary = 0; // seconds of the other pieces that stay in front of it
      segs.forEach((s, k) => {
        const l = s.end - s.start;
        if (k !== dragIdx && ((o + l / 2) / span) * rect.width < middle) { before++; boundary += l; }
        o += l;
      });
      target = before;
      mark.hidden = false;
      mark.style.left = vpct(boundary) + '%';
      return;
    }
    seek(ripple ? toSource(viewAt(ev)) : viewAt(ev));
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    mark.hidden = true;
    if (!dragging) return;
    if (target !== dragIdx) movePiece(dragIdx, target); else render();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---- playback: the program monitor skips removed parts ----
function tick() {
  if (!video.paused && segs.length) {
    const t = video.currentTime;
    let s = segs[cur];
    if (!s || t < s.start - 0.4 || t > s.end + 0.4) { setCurFor(t); s = segs[cur]; }
    if (t < s.start - 0.02) {
      video.currentTime = s.start; // before this piece: skip the removed part
    } else if (t >= s.end - 0.02) {
      // End of a piece: continue with the next one in the result order (which may be anywhere in the source).
      if (cur + 1 < segs.length) { cur++; video.currentTime = segs[cur].start; }
      else { video.pause(); seek(segs[cur].end); }
    }
  }
  updateTime();
  requestAnimationFrame(tick);
}

function togglePlay() {
  if (video.paused) {
    const last = segs[segs.length - 1];
    if (cur === segs.length - 1 && video.currentTime >= last.end - 0.05) { cur = 0; seek(segs[0].start); }
    video.play();
  } else video.pause();
}

$('play').onclick = togglePlay;
$('toStart').onclick = () => { cur = 0; seek(segs[0].start); };
$('toEnd').onclick = () => { cur = segs.length - 1; seek(segs[cur].end); };
$('moveL').onclick = () => movePiece(sel, sel - 1);
$('moveR').onclick = () => movePiece(sel, sel + 1);
$('split').onclick = split;
$('trimIn').onclick = () => trim('in');
$('trimOut').onclick = () => trim('out');
$('remove').onclick = removePiece;
$('undo').onclick = undo;
$('reset').onclick = () => { pushHistory(); segs = [{ start: 0, end: duration }]; sel = 0; cur = 0; render(); };

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z') { e.preventDefault(); undo(); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 's') split();
  else if (k === 'delete' || k === 'backspace') removePiece();
  else if (k === '[') trim('in');
  else if (k === ']') trim('out');
  else if (e.altKey && k === 'arrowleft') movePiece(sel, sel - 1);
  else if (e.altKey && k === 'arrowright') movePiece(sel, sel + 1);
  else if (k === 'arrowleft') seek(video.currentTime - (e.shiftKey ? 1 : 1 / (info.fps || 30)));
  else if (k === 'arrowright') seek(video.currentTime + (e.shiftKey ? 1 : 1 / (info.fps || 30)));
});

// ---- export ----
function busy(on, label) {
  for (const id of ['exportVideo', 'exportAudio', 'detach']) $(id).disabled = on || (id !== 'exportVideo' && !info.hasAudio);
  $('progressBox').hidden = !on;
  if (on) { $('error').hidden = true; $('bar').style.width = '0'; $('progressText').textContent = label || ''; }
}

function showError(msg) { $('error').hidden = false; $('error').textContent = msg; }

/** Adds a "saved file" card (newest first) with buttons to find or share it. */
function addResult(d) {
  $('resultsTitle').hidden = false;
  const box = document.createElement('div');
  box.className = 'result-item';
  const line = document.createElement('div');
  line.textContent = `Saved ${d.name} (${(d.size_bytes / 1e6).toFixed(1)} MB)`;
  const row = document.createElement('div');
  row.className = 'row';
  const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; };
  row.append(mk('Show in folder', () => window.editor.reveal(d.name)), mk('Share…', () => window.editor.share(d.name)));
  box.append(line, row);
  $('results').prepend(box);
}

const coversWholeClip = () => segs.length === 1 && segs[0].start < 0.05 && segs[0].end > duration - 0.05;

async function doExport(kind) {
  busy(true, kind === 'audio' ? 'Extracting audio…' : 'Exporting…');
  const payload = { name: info.name, segments: segs };
  const r = kind === 'audio'
    ? await window.editor.extractAudio({ ...payload, format: $('audioFormat').value })
    : await window.editor.exportVideo({ ...payload, audio: $('audioMode').value, mode: $('mode').value });
  busy(false);
  if (!r.ok) return showError(r.error);
  addResult(r.data);
}

/** Two files from one clip: the sound on its own, and the picture without sound. */
async function detach() {
  busy(true, 'Saving the audio…');
  const payload = { name: info.name, segments: segs };
  const a = await window.editor.extractAudio({ ...payload, format: $('audioFormat').value });
  if (!a.ok) { busy(false); return showError(a.error); }
  addResult(a.data);
  $('progressText').textContent = 'Saving the video without sound…';
  // Whole clip: copy the picture as it is (instant, lossless). Otherwise cut precisely.
  const v = await window.editor.exportVideo({ ...payload, audio: 'remove', mode: coversWholeClip() ? 'fast' : 'precise' });
  busy(false);
  if (!v.ok) return showError(v.error);
  addResult(v.data);
}
$('exportVideo').onclick = () => doExport('video');
$('exportAudio').onclick = () => doExport('audio');
$('detach').onclick = detach;
window.editor.onProgress((p) => {
  $('bar').style.width = Math.round(p * 100) + '%';
  $('progressText').textContent = `${Math.round(p * 100)}%`;
});

// ---- boot ----
(async () => {
  const name = new URLSearchParams(location.search).get('name');
  const r = await window.editor.info(name);
  if (!r.ok) { $('error').hidden = false; $('error').textContent = r.error; return; }
  info = r.data;
  duration = info.duration;
  segs = [{ start: 0, end: duration }];
  $('fileName').textContent = info.name;
  document.title = `Edit — ${info.name}`;
  $('noAudio').hidden = info.hasAudio;
  $('exportAudio').disabled = !info.hasAudio;
  $('detach').disabled = !info.hasAudio;
  $('noWave').hidden = info.hasAudio;
  if (!info.hasAudio) $('audioMode').disabled = true;
  video.src = info.fileUrl;
  renderRuler();
  render();
  requestAnimationFrame(tick);
  if (info.hasAudio) {
    window.editor.waveform(info.name).then((w) => {
      if (!w.ok || !w.data) return;
      waveImg = new Image();
      waveImg.onload = () => { $('wave').hidden = false; drawWave(); };
      waveImg.src = w.data;
    });
  }
})();
