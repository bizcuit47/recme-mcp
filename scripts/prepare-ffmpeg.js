'use strict';

// Copies ffmpeg and ffprobe into vendor/ffmpeg so the installer can ship them (Recme needs both).
// Uses FFMPEG_PATH / ffmpeg on PATH / the WinGet or Homebrew install, the same lookup the app itself uses.
// For a macOS build you can instead set FFMPEG_PATH and FFPROBE_PATH to the binaries to bundle.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Recorder } = require('../src/recorder');
const platform = require('../src/platform');

const rec = new Recorder({ outputDir: os.tmpdir(), getDisplays: () => [] });
if (!rec.ffmpeg) {
  console.error(`ffmpeg not found. Install it first: ${platform.id === 'darwin' ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg'}`);
  process.exit(1);
}
// "ffmpeg" (bare name) means it is on PATH: resolve it to a real file.
let ffmpeg = rec.ffmpeg;
if (!path.isAbsolute(ffmpeg)) {
  const r = require('child_process').spawnSync(process.platform === 'win32' ? 'where' : 'which', [ffmpeg], { encoding: 'utf8' });
  ffmpeg = r.stdout.split(/\r?\n/).find(Boolean);
}
const dir = path.dirname(ffmpeg);
const dest = path.join(__dirname, '..', 'vendor', 'ffmpeg');
fs.mkdirSync(dest, { recursive: true });
for (const f of [platform.ffmpegNames.ffmpeg, platform.ffmpegNames.ffprobe]) {
  const from = f === platform.ffmpegNames.ffprobe && process.env.FFPROBE_PATH ? process.env.FFPROBE_PATH : path.join(dir, f);
  if (!fs.existsSync(from)) { console.error(`${f} not found next to ${ffmpeg}`); process.exit(1); }
  fs.copyFileSync(from, path.join(dest, f));
  console.log('copied', f, (fs.statSync(from).size / 1e6).toFixed(0), 'MB');
}
// The GPL licence text that comes with the build must travel with the binaries.
for (const f of ['LICENSE']) {
  const from = path.join(dir, '..', f);
  if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(dest, f)); console.log('copied', f); }
  else console.warn(`WARNING: ${f} not found next to the ffmpeg build; add it to vendor/ffmpeg manually before distributing`);
}
