'use strict';

// Everything that differs between operating systems lives behind this adapter:
// how the screen / microphone are captured by ffmpeg, where ffmpeg is looked for, how windows and
// displays are measured, and how "start with the system" is registered.
//
//   win32  - the original, tested implementation (gdigrab, DirectShow, PowerShell)
//   darwin - macOS: written but NOT yet verified on a Mac (see docs/MACOS.md)
//   other  - helpers only (no screen capture); lets the editor / sharing code and the tests run anywhere
//
// Every adapter exports the same shape:
//   id, supportsCapture, hwEncoders, ffmpegNames, ffmpegCandidates(), ffprobeFor(ffmpegPath),
//   videoInput({ ffmpeg, source, fps, cursor, displays }) -> { args, filters, note? }
//   micInput(ffmpeg, deviceName) -> args
//   listAudioDevices(ffmpeg) -> string[]
//   captureStartRegex (RegExp | null)   epoch start time printed by ffmpeg, used to align the system sound
//   displays(screen), toPhysicalRect(screen, rect), toDipRect(screen, rect)
//   windows.list({ screen }) -> [{ title, process, pid, x, y, width, height }]   (physical pixels)
//   loginItem(app, { openAtLogin, startHidden, packaged }) -> options for app.set/getLoginItemSettings

const impl = process.platform === 'win32'
  ? require('./win32')
  : process.platform === 'darwin'
    ? require('./darwin')
    : require('./other');

module.exports = impl;
