'use strict';

// Visible windows with their position on screen (physical pixels), so a recording can be pointed at
// e.g. the Unity window without guessing coordinates. The OS-specific part lives in ./platform.
const platform = require('./platform');

/** Front-most first: [{ title, process, pid, x, y, width, height }] */
function listWindows(ctx = {}) {
  return platform.windows.list(ctx);
}

/** First window whose title contains `title` (case-insensitive). */
function findWindow(title, ctx = {}) {
  const q = String(title || '').toLowerCase();
  return listWindows(ctx).find((w) => w.title.toLowerCase().includes(q)) || null;
}

module.exports = { listWindows, findWindow };
