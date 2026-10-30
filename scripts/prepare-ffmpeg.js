'use strict';

// Copies ffmpeg.exe and ffprobe.exe into vendor/ffmpeg so the installer can ship them (Recme needs both).
// Uses FFMPEG_PATH / ffmpeg on PATH / the WinGet install, the same lookup the app itself uses.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Recorder } = require('../src/recorder');

const rec = new Recorder({ outputDir: os.tmpdir(), getDisplays: () => [] });
if (!rec.ffmpeg) {
  console.error('ffmpeg not found. Install it first: winget install Gyan.FFmpeg');
  process.exit(1);
}
// "ffmpeg" (bare name) means it is on PATH: resolve it to a real file.
let ffmpeg = rec.ffmpeg;
if (!path.isAbsolute(ffmpeg)) {
  const r = require('child_process').spawnSync('where', [ffmpeg], { encoding: 'utf8' });
  ffmpeg = r.stdout.split(/\r?\n/).find(Boolean);
}
const dir = path.dirname(ffmpeg);
const dest = path.join(__dirname, '..', 'vendor', 'ffmpeg');
fs.mkdirSync(dest, { recursive: true });
for (const f of ['ffmpeg.exe', 'ffprobe.exe']) {
  const from = path.join(dir, f);
  if (!fs.existsSync(from)) { console.error(`${f} not found next to ${ffmpeg}`); process.exit(1); }
  fs.copyFileSync(from, path.join(dest, f));
  console.log('copied', f, (fs.statSync(from).size / 1e6).toFixed(0), 'MB');
}
