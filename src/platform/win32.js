'use strict';

// Windows adapter: the implementation Recme was built and tested on.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ffprobeNextTo } = require('./shared');

const ffmpegNames = { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' };

function ffmpegCandidates() {
  // The WinGet package folder (winget install Gyan.FFmpeg) is not always on PATH for GUI apps.
  const out = [];
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(winget)) {
      if (!/ffmpeg/i.test(pkg)) continue;
      const root = path.join(winget, pkg);
      for (const sub of fs.readdirSync(root)) out.push(path.join(root, sub, 'bin', 'ffmpeg.exe'));
    }
  } catch { /* winget folder not present */ }
  return out;
}

/** gdigrab input for a capture source. Coordinates are physical pixels. */
function videoInput({ source, fps, cursor, displays }) {
  const args = ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', cursor === false ? '0' : '1', '-thread_queue_size', '1024'];
  switch (source.type) {
    case 'display': {
      const d = displays.find((x) => x.index === source.index);
      if (!d) throw new Error(`Display ${source.index} not found`);
      args.push('-offset_x', String(d.x), '-offset_y', String(d.y), '-video_size', `${d.width}x${d.height}`, '-i', 'desktop');
      break;
    }
    case 'region':
      args.push('-offset_x', String(source.x), '-offset_y', String(source.y), '-video_size', `${source.width}x${source.height}`, '-i', 'desktop');
      break;
    case 'window':
      args.push('-i', `title=${source.title}`);
      break;
    default:
      args.push('-i', 'desktop');
  }
  return { args, filters: [] };
}

function micInput(_ffmpeg, deviceName) {
  return ['-f', 'dshow', '-rtbufsize', '256M', '-thread_queue_size', '1024', '-i', `audio=${deviceName}`];
}

/** DirectShow audio capture devices. */
function listAudioDevices(ffmpeg) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { windowsHide: true, encoding: 'utf8' });
  const devices = [];
  for (const line of (r.stderr || '').split(/\r?\n/)) {
    const m = line.match(/"(.+)" \(audio\)/);
    if (m) devices.push(m[1]);
  }
  return devices;
}

/** Monitors in physical pixels (what ffmpeg gdigrab expects). */
function displays(screen) {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => {
    const r = screen.dipToScreenRect(null, d.bounds);
    return {
      index: i,
      label: `Display ${i + 1}${d.id === primary ? ' (primary)' : ''}`,
      x: r.x, y: r.y,
      width: Math.floor(d.bounds.width * d.scaleFactor), height: Math.floor(d.bounds.height * d.scaleFactor),
      scale_factor: d.scaleFactor,
    };
  });
}

const toPhysicalRect = (screen, rect) => screen.dipToScreenRect(null, rect);
const toDipRect = (screen, rect) => screen.screenToDipRect(null, rect);

function loginItem(app, { openAtLogin, startHidden, packaged }) {
  const args = [];
  if (!packaged) args.push(app.getAppPath());
  if (startHidden) args.push('--hidden');
  return { openAtLogin, path: process.execPath, args };
}

module.exports = {
  id: 'win32',
  supportsCapture: true,
  hwEncoders: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  ffmpegNames,
  ffmpegCandidates,
  ffprobeFor: (ffmpegPath) => ffprobeNextTo(ffmpegPath, ffmpegNames.ffprobe),
  videoInput,
  micInput,
  listAudioDevices,
  // gdigrab prints its start time as epoch seconds; the main process uses it to line the system sound up with the picture.
  captureStartRegex: /Input #0, gdigrab[\s\S]*?start: (\d+\.\d+)/,
  displays,
  toPhysicalRect,
  toDipRect,
  windows: { list: () => require('./win32-windows').listWindows() },
  loginItem,
};
