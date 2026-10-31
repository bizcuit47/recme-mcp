'use strict';

// macOS adapter.
//
// !! UNTESTED ON A MAC !!  Written from ffmpeg's and Apple's documentation, not run on real hardware.
// Everything marked UNVERIFIED below is a guess that needs a Mac to confirm. See docs/MACOS.md.

const { spawnSync } = require('child_process');
const { ffprobeNextTo, scaleRect } = require('./shared');

const ffmpegNames = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

// GUI apps on macOS do not inherit the shell's PATH, so the usual Homebrew/MacPorts places are listed explicitly.
const ffmpegCandidates = () => ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg'];

/** AVFoundation devices as ffmpeg sees them: { video: [{index,name}], audio: [{index,name}] } */
function avfoundationDevices(ffmpeg) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8', timeout: 10000 });
  const video = [];
  const audio = [];
  let section = null;
  for (const line of (r.stderr || '').split(/\r?\n/)) {
    if (/AVFoundation video devices/i.test(line)) { section = video; continue; }
    if (/AVFoundation audio devices/i.test(line)) { section = audio; continue; }
    const m = line.match(/\[(\d+)\]\s+(.+)$/);
    if (section && m) section.push({ index: Number(m[1]), name: m[2].trim() });
  }
  return { video, audio };
}

function videoInput({ ffmpeg, source, fps, cursor, displays }) {
  if (source.type === 'window') {
    throw new Error('Capturing one window by its title is not available on macOS. Use window_area (the rectangle where the window is).');
  }
  const screens = avfoundationDevices(ffmpeg).video.filter((d) => /^Capture screen/i.test(d.name));
  if (!screens.length) {
    throw new Error('ffmpeg found no screen to capture. Allow Recme in System Settings > Privacy & Security > Screen Recording, then restart Recme.');
  }
  // UNVERIFIED: the order of Electron's displays is assumed to equal the order of "Capture screen N".
  let displayIndex = 0;
  const filters = [];
  let note;
  if (source.type === 'display') {
    displayIndex = source.index;
  } else if (source.type === 'region') {
    const d = displays.find((x) => source.x >= x.x && source.x < x.x + x.width && source.y >= x.y && source.y < x.y + x.height) || displays[0];
    displayIndex = d.index;
    // avfoundation always captures a whole screen, so the area is cut out afterwards.
    // UNVERIFIED: the captured frame is assumed to be in physical pixels (Retina: 2x the point size).
    filters.push(`crop=${source.width}:${source.height}:${source.x - d.x}:${source.y - d.y}`);
  } else {
    const primary = displays.find((d) => d.primary);
    displayIndex = primary ? primary.index : 0;
    note = 'On macOS "All screens" records the main display only.';
  }
  const device = screens[Math.min(displayIndex, screens.length - 1)];
  return {
    args: ['-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', cursor === false ? '0' : '1', '-i', `${device.index}:none`],
    filters,
    note,
  };
}

function micInput(ffmpeg, deviceName) {
  const dev = avfoundationDevices(ffmpeg).audio.find((a) => a.name === deviceName);
  if (!dev) throw new Error(`Microphone "${deviceName}" was not found`);
  return ['-f', 'avfoundation', '-thread_queue_size', '1024', '-i', `:${dev.index}`];
}

const listAudioDevices = (ffmpeg) => avfoundationDevices(ffmpeg).audio.map((d) => d.name);

/** Displays in "physical" pixels: points x scale factor, so the same area maths works as on Windows. */
function displays(screen) {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => {
    const r = scaleRect(d.bounds, d.scaleFactor);
    return { index: i, label: `Display ${i + 1}${d.id === primary ? ' (primary)' : ''}`, x: r.x, y: r.y, width: r.width, height: r.height, scale_factor: d.scaleFactor, primary: d.id === primary };
  });
}

// Electron on macOS works in points; multiply by the scale factor of the display the rectangle is on.
const toPhysicalRect = (screen, rect) => scaleRect(rect, screen.getDisplayMatching(rect).scaleFactor);

function toDipRect(screen, rect) {
  const d = displays(screen).find((x) => rect.x >= x.x && rect.x < x.x + x.width && rect.y >= x.y && rect.y < x.y + x.height) || displays(screen)[0];
  const s = d.scale_factor;
  return { x: Math.round(rect.x / s), y: Math.round(rect.y / s), width: Math.round(rect.width / s), height: Math.round(rect.height / s) };
}

// Window list through JXA (JavaScript for Automation). UNVERIFIED on a real Mac.
// Window titles are only returned once Recme has the Screen Recording permission; until then the app name is used.
const JXA = `
ObjC.import('CoreGraphics');
const opts = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
const raw = $.CGWindowListCopyWindowInfo(opts, $.kCGNullWindowID);
const arr = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
const out = [];
for (const w of arr) {
  if (w.kCGWindowLayer !== 0) continue;
  const b = w.kCGWindowBounds;
  out.push({ title: w.kCGWindowName || w.kCGWindowOwnerName || '', process: w.kCGWindowOwnerName || '', pid: w.kCGWindowOwnerPID, x: b.X, y: b.Y, width: b.Width, height: b.Height });
}
JSON.stringify(out);
`;

function listWindows({ screen }) {
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', JXA], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error(`Could not list windows: ${(r.stderr || '').trim().split(/\r?\n/)[0] || 'osascript failed'}`);
  return JSON.parse(r.stdout.trim() || '[]')
    .map((w) => {
      const scale = screen.getDisplayNearestPoint({ x: Math.round(w.x), y: Math.round(w.y) }).scaleFactor;
      return { ...w, ...scaleRect(w, scale) };
    })
    .filter((w) => w.width >= 40 && w.height >= 40);
}

const loginItem = (_app, { openAtLogin, startHidden }) => ({ openAtLogin, openAsHidden: !!startHidden });

module.exports = {
  id: 'darwin',
  supportsCapture: true,
  hwEncoders: ['h264_videotoolbox'],
  ffmpegNames,
  ffmpegCandidates,
  ffprobeFor: (ffmpegPath) => ffprobeNextTo(ffmpegPath, ffmpegNames.ffprobe),
  videoInput,
  micInput,
  listAudioDevices,
  captureStartRegex: null, // avfoundation timestamps are not epoch time: no automatic sound alignment
  displays,
  toPhysicalRect,
  toDipRect,
  windows: { list: listWindows },
  loginItem,
};
