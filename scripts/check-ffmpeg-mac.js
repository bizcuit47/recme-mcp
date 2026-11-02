'use strict';

// Run before `npm run dist:mac`. The app on another Mac cannot use Homebrew's ffmpeg (it links to dylibs under
// /opt/homebrew or /usr/local that only exist on the build machine), so vendor/ffmpeg must hold STATIC builds:
// only system libraries (/usr/lib, /System/Library) are allowed.
//
// Put the binaries there yourself (they are not in git):
//   vendor/ffmpeg/ffmpeg   vendor/ffmpeg/ffprobe   vendor/ffmpeg/LICENSE
// A static build for Intel Macs: the npm packages `ffmpeg-static` and `ffprobe-static` (bin/darwin/x64/ffprobe),
// or https://evermeet.cx/ffmpeg/ . For Apple Silicon use an arm64 static build and build on / for arm64.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('check-ffmpeg-mac: run this on macOS.');
  process.exit(1);
}

const dir = path.join(__dirname, '..', 'vendor', 'ffmpeg');
let bad = false;

for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    console.error(`MISSING ${file}`);
    bad = true;
    continue;
  }
  try { fs.chmodSync(file, 0o755); } catch { /* read-only is fine if it is already executable */ }

  const otool = spawnSync('otool', ['-L', file], { encoding: 'utf8' });
  if (otool.status !== 0) { console.error(`${name}: otool failed: ${otool.stderr}`); bad = true; continue; }
  const external = otool.stdout.split('\n').slice(1).map((l) => l.trim().split(' ')[0])
    .filter(Boolean).filter((l) => !l.startsWith('/usr/lib/') && !l.startsWith('/System/Library/'));
  if (external.length) {
    console.error(`${name} is NOT static, it needs: ${external.join(', ')}`);
    bad = true;
    continue;
  }

  const run = spawnSync(file, ['-version'], { encoding: 'utf8', timeout: 10000 });
  if (run.status !== 0) { console.error(`${name} does not run: ${run.stderr || run.error}`); bad = true; continue; }
  console.log(`ok  ${name}: ${run.stdout.split('\n')[0]}`);

  if (name === 'ffmpeg') {
    const dev = spawnSync(file, ['-hide_banner', '-devices'], { encoding: 'utf8', timeout: 10000 });
    if (!/avfoundation/.test(`${dev.stdout}${dev.stderr}`)) { console.error('ffmpeg has no avfoundation (cannot capture the screen)'); bad = true; }
  }
}

if (!fs.existsSync(path.join(dir, 'LICENSE'))) console.warn('WARNING: vendor/ffmpeg/LICENSE missing (add the licence text before distributing)');
if (bad) process.exit(1);
console.log('vendor/ffmpeg looks good for a macOS build.');
