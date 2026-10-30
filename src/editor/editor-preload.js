'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld('editor', {
  info: call('editor:info'),
  waveform: call('editor:waveform'),
  exportVideo: call('editor:export'),
  extractAudio: call('editor:audio'),
  reveal: call('reveal'),
  share: call('share:select'),
  onProgress: (cb) => ipcRenderer.on('editor:progress', (_e, p) => cb(p)),
});
