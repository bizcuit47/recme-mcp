'use strict';

// Fills vendor/ffmpeg with STATIC ffmpeg + ffprobe for macOS so the .dmg/.zip works on a Mac that has no ffmpeg.
// (Homebrew's ffmpeg cannot be bundled: it links to dylibs that only exist on the build machine.)
//
// Source: the npm packages `ffmpeg-static` and `ffprobe-static`, installed into a temp folder (not added to
// package.json). Architecture: this machine's, or set RECME_MAC_ARCH=x64|arm64 to build for the other one.
// Then `npm run check:ffmpeg-mac` verifies the result (static, runs, has avfoundation).
//
// Licence: these ffmpeg builds are GPL (see THIRD-PARTY-NOTICES.md). The licence text is copied next to them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('fetch-ffmpeg-mac: run this on macOS.');
  process.exit(1);
}

const arch = process.env.RECME_MAC_ARCH || process.arch;
if (!['x64', 'arm64'].includes(arch)) {
  console.error(`Unsupported RECME_MAC_ARCH "${arch}" (use x64 or arm64).`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recme-ffmpeg-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"recme-ffmpeg-fetch","private":true}');

console.log(`Fetching static ffmpeg/ffprobe for macOS ${arch} ...`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['install', '--no-audit', '--no-fund', 'ffmpeg-static', 'ffprobe-static'], {
  cwd: tmp,
  stdio: 'inherit',
  // ffmpeg-static downloads its binary in an install script and honours these to pick the target.
  env: { ...process.env, npm_config_arch: arch, npm_config_platform: 'darwin' },
});
if (r.status !== 0) { console.error('npm install failed'); process.exit(1); }

const nm = path.join(tmp, 'node_modules');
const sources = {
  ffmpeg: path.join(nm, 'ffmpeg-static', 'ffmpeg'),
  ffprobe: path.join(nm, 'ffprobe-static', 'bin', 'darwin', arch, 'ffprobe'),
  LICENSE: path.join(nm, 'ffmpeg-static', 'ffmpeg.LICENSE'),
};

const dest = path.join(__dirname, '..', 'vendor', 'ffmpeg');
fs.mkdirSync(dest, { recursive: true });
for (const [name, from] of Object.entries(sources)) {
  if (!fs.existsSync(from)) { console.error(`missing ${from}`); process.exit(1); }
  const to = path.join(dest, name);
  fs.copyFileSync(from, to);
  if (name !== 'LICENSE') fs.chmodSync(to, 0o755);
  console.log('copied', name, (fs.statSync(to).size / 1e6).toFixed(1), 'MB');
}

// Downloaded files may carry a quarantine flag; a bundled binary must not.
spawnSync('xattr', ['-cr', dest]);
fs.rmSync(tmp, { recursive: true, force: true });

// Make sure we really got the architecture we asked for.
const f = spawnSync('file', [path.join(dest, 'ffmpeg')], { encoding: 'utf8' }).stdout;
const want = arch === 'arm64' ? 'arm64' : 'x86_64';
if (!f.includes(want)) { console.error(`ffmpeg is not ${want}: ${f.trim()}`); process.exit(1); }
console.log(f.trim());
