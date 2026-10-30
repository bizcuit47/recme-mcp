'use strict';

// Hidden page that records the system audio ("what you hear") using Electron's WASAPI loopback.
let recorder = null;
let stream = null;
let queue = Promise.resolve();

window.__startCapture = async () => {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  // Only the audio is wanted; drop the video track right away so no screen frames are processed.
  for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }
  if (!stream.getAudioTracks().length) throw new Error('Windows did not provide a loopback audio track');

  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    // Chain the sends so chunks reach the main process in order (and the last one is awaited on stop).
    queue = queue.then(async () => window.audioWorker.chunk(await e.data.arrayBuffer()));
  };
  const started = new Promise((resolve) => { recorder.onstart = () => resolve(Date.now()); });
  recorder.start(1000);
  return started;
};

window.__stopCapture = () => new Promise((resolve) => {
  if (!recorder || recorder.state === 'inactive') return resolve();
  recorder.onstop = async () => {
    for (const t of stream.getTracks()) t.stop();
    await queue;
    resolve();
  };
  recorder.stop();
});
