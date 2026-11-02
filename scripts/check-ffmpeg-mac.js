'use strict';

// Run before `npm run dist:mac`. The app on another Mac cannot use Homebrew's ffmpeg (it links to dylibs under
// /opt/homebrew or /usr/local that only exist on the build machine), so vendor/ffmpeg must hold STATIC builds:
// only system libraries (/usr/lib, /System/Library) are allowed.
//
// Put the binaries there yourself (they are not in git):
//   vendor/ffmpeg/ffmpeg   vendor/ffmpeg/ffprobe   vendor/ffmpeg/LICENSE
// `npm run fetch:ffmpeg-mac` fills it (RECME_MAC_ARCH=x64|arm64 picks the architecture; default is this machine's).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('check-ffmpeg-mac: run this on macOS.');
  process.exit(1);
}

const dir = path.join(__dirname, '..', 'vendor', 'ffmpeg');
let bad = false;

// Target architecture of the build (default: this machine). When it differs from the machine we are on (an arm64
// build made on an Intel Mac), the binaries cannot be run here, so we only check what can be read from the file.
const target = process.env.RECME_MAC_ARCH || process.arch;
const wantFile = target === 'arm64' ? 'arm64' : 'x86_64';
const canRun = target === process.arch;
if (!canRun) console.warn(`NOTE: target ${target} differs from this machine (${process.arch}); the binaries are not run, only inspected.`);

for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    console.error(`MISSING ${file}`);
    bad = true;
    continue;
  }
  try { fs.chmodSync(file, 0o755); } catch { /* read-only is fine if it is already executable */ }

  const kind = spawnSync('file', [file], { encoding: 'utf8' }).stdout || '';
  if (!kind.includes(wantFile)) { console.error(`${name} is not a ${wantFile} binary: ${kind.trim()}`); bad = true; continue; }

  const otool = spawnSync('otool', ['-L', file], { encoding: 'utf8' });
  if (otool.status !== 0) { console.error(`${name}: otool failed: ${otool.stderr}`); bad = true; continue; }
  const external = otool.stdout.split('\n').slice(1).map((l) => l.trim().split(' ')[0])
    .filter(Boolean).filter((l) => !l.startsWith('/usr/lib/') && !l.startsWith('/System/Library/'));
  if (external.length) {
    console.error(`${name} is NOT static, it needs: ${external.join(', ')}`);
    bad = true;
    continue;
  }

  if (!canRun) { console.log(`ok  ${name}: ${wantFile}, static (not run: other architecture)`); continue; }

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
