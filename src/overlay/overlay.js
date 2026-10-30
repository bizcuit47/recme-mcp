'use strict';

const sel = document.getElementById('sel');
const sizeLabel = document.getElementById('size');
const dpr = window.devicePixelRatio || 1;
const MIN = 20;
let rect = null; // CSS pixels, relative to this overlay (one overlay per display)
let drag = null;

function draw() {
  sel.hidden = !rect;
  if (!rect) return;
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.w + 'px';
  sel.style.height = rect.h + 'px';
  sizeLabel.textContent = `${Math.floor(rect.w * dpr)} × ${Math.floor(rect.h * dpr)} px`;
  sel.classList.toggle('low', rect.y + rect.h > window.innerHeight - 60);
}

const clampRect = (r) => {
  const w = Math.min(Math.max(r.w, MIN), window.innerWidth);
  const h = Math.min(Math.max(r.h, MIN), window.innerHeight);
  return { w, h, x: Math.min(Math.max(r.x, 0), window.innerWidth - w), y: Math.min(Math.max(r.y, 0), window.innerHeight - h) };
};

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('#bar')) return;
  const handle = e.target.dataset && e.target.dataset.h;
  if (handle) drag = { mode: 'resize', handle, sx: e.clientX, sy: e.clientY, start: { ...rect } };
  else if (rect && e.target.closest('#sel')) drag = { mode: 'move', sx: e.clientX, sy: e.clientY, start: { ...rect } };
  else {
    drag = { mode: 'new', sx: e.clientX, sy: e.clientY };
    rect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
  }
});

document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (drag.mode === 'new') {
    rect = { x: Math.min(drag.sx, e.clientX), y: Math.min(drag.sy, e.clientY), w: Math.abs(dx), h: Math.abs(dy) };
  } else if (drag.mode === 'move') {
    rect = clampRect({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
  } else {
    let { x, y, w, h } = drag.start;
    const hd = drag.handle;
    if (hd.includes('e')) w = drag.start.w + dx;
    if (hd.includes('s')) h = drag.start.h + dy;
    if (hd.includes('w')) { x = drag.start.x + dx; w = drag.start.w - dx; }
    if (hd.includes('n')) { y = drag.start.y + dy; h = drag.start.h - dy; }
    if (w < MIN) { if (hd.includes('w')) x -= MIN - w; w = MIN; }
    if (h < MIN) { if (hd.includes('n')) y -= MIN - h; h = MIN; }
    rect = { x: Math.max(x, 0), y: Math.max(y, 0), w: Math.min(w, window.innerWidth - Math.max(x, 0)), h: Math.min(h, window.innerHeight - Math.max(y, 0)) };
  }
  draw();
});

document.addEventListener('mouseup', () => {
  drag = null;
  if (rect && (rect.w < MIN || rect.h < MIN)) { rect = null; draw(); }
});

const confirm = () => { if (rect && rect.w >= MIN) window.overlay.done({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }); };
document.getElementById('ok').onclick = confirm;
document.getElementById('cancel').onclick = () => window.overlay.cancel();
document.addEventListener('dblclick', (e) => { if (!e.target.closest('#bar')) confirm(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.cancel();
  if (e.key === 'Enter') confirm();
});

window.overlay.initialRect().then((r) => { if (r) { rect = r; draw(); } });
