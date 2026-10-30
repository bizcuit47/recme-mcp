'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioWorker', {
  chunk: (buffer) => ipcRenderer.invoke('audio:chunk', buffer),
});
