'use strict';

const fs = require('fs');
const path = require('path');

/** ffprobe next to ffmpeg when it is there, otherwise whatever "ffprobe" resolves to on PATH. */
function ffprobeNextTo(ffmpegPath, ffprobeName) {
  const sibling = path.join(path.dirname(ffmpegPath || ''), ffprobeName);
  return fs.existsSync(sibling) ? sibling : 'ffprobe';
}

/** Same rounding everywhere: display rectangles in physical pixels from Electron's point/DIP bounds. */
function scaleRect(rect, scale) {
  return { x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) };
}

module.exports = { ffprobeNextTo, scaleRect };
