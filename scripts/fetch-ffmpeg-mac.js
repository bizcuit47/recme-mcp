'use strict';

// Fills vendor/ffmpeg with STATIC ffmpeg + ffprobe for macOS so the .dmg/.zip works on a Mac that has no ffmpeg.
// (Homebrew's ffmpeg cannot be bundled: it links to dylibs that only exist on the build machine.)
//
// Sources (downloaded into a temp folder, nothing is added to package.json):
//   ffmpeg  : the npm package `ffmpeg-static` (its install script downloads the build for the chosen architecture)
//   ffprobe : the npm package `@ffprobe-installer/darwin-<arch>` (a real binary per architecture; the `ffprobe-static`
//             package labels an Intel binary as arm64, so it is not used)
// Architecture: this machine's, or set RECME_MAC_ARCH=x64|arm64 to build for the other one (an arm64 app can be
// built on an Intel Mac and the other way round; the binaries just cannot be run on the "wrong" machine).
// Then `npm run check:ffmpeg-mac` verifies the result (right architecture, static, runs, has avfoundation).
//
// Licence: the ffmpeg builds are GPL (see THIRD-PARTY-NOTICES.md). The licence text is copied next to them.
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

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recme-ffmpeg-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"recme-ffmpeg-fetch","private":true}');

function run(args, opts = {}) {
  const r = spawnSync(npm, args, { cwd: tmp, stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`npm ${args.join(' ')} failed`); process.exit(1); }
}

console.log(`Fetching static ffmpeg/ffprobe for macOS ${arch} ...`);

// ffmpeg-static downloads its binary in an install script and honours these to pick the target.
run(['install', '--no-audit', '--no-fund', 'ffmpeg-static'], {
  env: { ...process.env, npm_config_arch: arch, npm_config_platform: 'darwin' },
});

// A platform package for the other CPU cannot be `npm install`ed (os/cpu fields), but it can be packed and unpacked.
const probePkg = `@ffprobe-installer/darwin-${arch}`;
const packed = spawnSync(npm, ['pack', probePkg, '--silent'], { cwd: tmp, encoding: 'utf8' });
if (packed.status !== 0) { console.error(`npm pack ${probePkg} failed:\n${packed.stderr}`); process.exit(1); }
const tgz = packed.stdout.trim().split('\n').pop();
const probeDir = path.join(tmp, 'ffprobe-pkg');
fs.mkdirSync(probeDir);
const untar = spawnSync('tar', ['xzf', path.join(tmp, tgz), '-C', probeDir], { stdio: 'inherit' });
if (untar.status !== 0) { console.error('could not unpack ' + tgz); process.exit(1); }

const sources = {
  ffmpeg: path.join(tmp, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ffprobe: path.join(probeDir, 'package', 'ffprobe'),
  LICENSE: path.join(tmp, 'node_modules', 'ffmpeg-static', 'ffmpeg.LICENSE'),
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

// Make sure we really got the architecture we asked for (both files).
const want = arch === 'arm64' ? 'arm64' : 'x86_64';
let bad = false;
for (const name of ['ffmpeg', 'ffprobe']) {
  const f = spawnSync('file', [path.join(dest, name)], { encoding: 'utf8' }).stdout.trim();
  console.log(f);
  if (!f.includes(want)) { console.error(`${name} is not ${want}`); bad = true; }
}
if (bad) process.exit(1);
