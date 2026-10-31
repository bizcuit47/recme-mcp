'use strict';

// Fallback for systems without screen capture support (Linux for now): the editor, file sharing and the
// tests still work, recording says clearly that it is not supported.

const { ffprobeNextTo, scaleRect } = require('./shared');

const unsupported = () => { throw new Error(`Screen recording is not supported on ${process.platform} yet (Windows is supported, macOS is in development).`); };
const ffmpegNames = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

module.exports = {
  id: process.platform,
  supportsCapture: false,
  hwEncoders: [],
  ffmpegNames,
  ffmpegCandidates: () => [],
  ffprobeFor: (ffmpegPath) => ffprobeNextTo(ffmpegPath, ffmpegNames.ffprobe),
  videoInput: unsupported,
  micInput: unsupported,
  listAudioDevices: () => [],
  captureStartRegex: null,
  displays: (screen) => screen.getAllDisplays().map((d, i) => ({ index: i, label: `Display ${i + 1}`, ...scaleRect(d.bounds, d.scaleFactor), scale_factor: d.scaleFactor })),
  toPhysicalRect: (_screen, rect) => rect,
  toDipRect: (_screen, rect) => rect,
  windows: { list: () => [] },
  loginItem: (_app, { openAtLogin }) => ({ openAtLogin }),
};
