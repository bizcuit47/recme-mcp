'use strict';

const sel = document.getElementById('sel');
const sizeLabel = document.getElementById('size');
const dpr = window.devicePixelRatio || 1;
const MIN = 20;

let rect = null; // CSS pixels, relative to this overlay
let screenRect = null; // DIP coordinates across the whole desktop
let drag = null;
let usingGlobal = false;
let self = { id: 0, x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, scaleFactor: dpr };
let displays = [self];

function draw() {
  sel.hidden = !rect;
  if (!rect) return;
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.w + 'px';
  sel.style.height = rect.h + 'px';
  const scale = self.scaleFactor || dpr;
  sizeLabel.textContent = `${Math.floor(rect.w * scale)} × ${Math.floor(rect.h * scale)} px`;
  sel.classList.toggle('low', rect.y + rect.h > window.innerHeight - 60);
}

function displayAt(x, y) {
  const hit = displays.find((d) => x >= d.x && y >= d.y && x < d.x + d.width && y < d.y + d.height);
  if (hit) return hit;
  let best = displays[0];
  let bestD = Infinity;
  for (const d of displays) {
    const cx = Math.min(Math.max(x, d.x), d.x + d.width);
    const cy = Math.min(Math.max(y, d.y), d.y + d.height);
    const dist = (cx - x) ** 2 + (cy - y) ** 2;
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

/** Keep the whole box on one monitor so it can sit on whichever display the pointer is over. */
function clampToDisplay(r, display, min) {
  const w = Math.min(Math.max(r.w, min), display.width);
  const h = Math.min(Math.max(r.h, min), display.height);
  return {
    x: Math.round(Math.min(Math.max(r.x, display.x), display.x + display.width - w)),
    y: Math.round(Math.min(Math.max(r.y, display.y), display.y + display.height - h)),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function applyScreen(next) {
  screenRect = next;
  if (!next) { rect = null; draw(); return; }
  const owner = displayAt(next.x + next.w / 2, next.y + next.h / 2);
  if (!owner || owner.id !== self.id) { rect = null; draw(); return; }
  rect = { x: next.x - self.x, y: next.y - self.y, w: next.w, h: next.h };
  draw();
}

let publishFrame = 0;
let pending;
function publish(next) {
  pending = next;
  applyScreen(next);
  if (publishFrame) return;
  publishFrame = requestAnimationFrame(() => {
    publishFrame = 0;
    window.overlay.sync(pending);
  });
}

function moveTo(cx, cy) {
  if (!drag) return;
  const dx = cx - drag.sx;
  const dy = cy - drag.sy;
  const target = displayAt(cx, cy);
  if (!target) return;
  if (drag.mode === 'move') {
    publish(clampToDisplay({ x: drag.start.x + dx, y: drag.start.y + dy, w: drag.start.w, h: drag.start.h }, target, MIN));
    return;
  }
  if (drag.mode === 'new') {
    const start = displayAt(drag.sx, drag.sy);
    if (start && start.id === target.id) {
      publish(clampToDisplay({
        x: Math.min(drag.sx, cx),
        y: Math.min(drag.sy, cy),
        w: Math.abs(dx),
        h: Math.abs(dy),
      }, target, 0));
    } else {
      // Pointer crossed onto another monitor: carry the box there instead of leaving it behind.
      if (!drag.carried) {
        const w = screenRect && screenRect.w >= MIN ? screenRect.w : Math.abs(dx);
        const h = screenRect && screenRect.h >= MIN ? screenRect.h : Math.abs(dy);
        drag.carried = {
          w: Math.min(Math.max(w, MIN), target.width),
          h: Math.min(Math.max(h, MIN), target.height),
        };
      }
      publish(clampToDisplay({
        x: cx - drag.carried.w / 2,
        y: cy - drag.carried.h / 2,
        w: drag.carried.w,
        h: drag.carried.h,
      }, target, MIN));
    }
    return;
  }
  let { x, y, w, h } = drag.start;
  const hd = drag.handle;
  if (hd.includes('e')) w += dx;
  if (hd.includes('s')) h += dy;
  if (hd.includes('w')) { x += dx; w -= dx; }
  if (hd.includes('n')) { y += dy; h -= dy; }
  if (w < MIN) { if (hd.includes('w')) x -= MIN - w; w = MIN; }
  if (h < MIN) { if (hd.includes('n')) y -= MIN - h; h = MIN; }
  publish(clampToDisplay({ x, y, w, h }, target, MIN));
}

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('#bar')) return;
  const handle = e.target.dataset && e.target.dataset.h;
  const cursor = { x: self.x + e.clientX, y: self.y + e.clientY };
  if (handle && screenRect) drag = { mode: 'resize', handle, sx: cursor.x, sy: cursor.y, start: { ...screenRect } };
  else if (rect && screenRect && e.target.closest('#sel')) drag = { mode: 'move', sx: cursor.x, sy: cursor.y, start: { ...screenRect } };
  else if (!e.target.closest('#sel')) {
    drag = { mode: 'new', sx: cursor.x, sy: cursor.y };
    publish({ x: cursor.x, y: cursor.y, w: 0, h: 0 });
  } else return;
  usingGlobal = false;
  window.overlay.watchCursor(true);
});

document.addEventListener('mousemove', (e) => {
  if (!drag || usingGlobal) return;
  moveTo(self.x + e.clientX, self.y + e.clientY);
});

function endDrag() {
  if (!drag) return;
  const tiny = drag.mode === 'new' && screenRect && (screenRect.w < MIN || screenRect.h < MIN);
  drag = null;
  usingGlobal = false;
  window.overlay.watchCursor(false);
  if (tiny) publish(null);
}

document.addEventListener('mouseup', () => {
  if (!drag) { window.overlay.drop(); return; }
  endDrag();
});

const confirm = () => {
  if (screenRect && screenRect.w >= MIN && screenRect.h >= MIN) window.overlay.done(screenRect);
};
document.getElementById('ok').onclick = confirm;
document.getElementById('cancel').onclick = () => window.overlay.cancel();
document.addEventListener('dblclick', (e) => { if (!e.target.closest('#bar')) confirm(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.cancel();
  if (e.key === 'Enter') confirm();
});

window.overlay.onPlace((next) => applyScreen(next));
window.overlay.onDrop(() => endDrag());
window.overlay.onCursor((p) => {
  if (!drag || !p) return;
  usingGlobal = true;
  moveTo(p.x, p.y);
});

window.overlay.initialRect().then((info) => {
  if (!info) return;
  self = info.self;
  displays = info.displays && info.displays.length ? info.displays : [self];
  if (info.screen) applyScreen(info.screen);
});
