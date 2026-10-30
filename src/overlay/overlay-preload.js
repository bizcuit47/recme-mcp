'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  initialRect: () => ipcRenderer.invoke('overlay:initial'),
  done: (rect) => ipcRenderer.send('overlay:done', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
});
