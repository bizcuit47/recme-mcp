'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  initialRect: () => ipcRenderer.invoke('overlay:initial'),
  done: (rect) => ipcRenderer.send('overlay:done', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  sync: (rect) => ipcRenderer.send('overlay:sync', rect),
  watchCursor: (on) => ipcRenderer.send('overlay:watch', !!on),
  drop: () => ipcRenderer.send('overlay:drop'),
  onPlace: (cb) => { ipcRenderer.on('overlay:place', (_e, rect) => cb(rect)); },
  onCursor: (cb) => { ipcRenderer.on('overlay:cursor', (_e, point) => cb(point)); },
  onDrop: (cb) => { ipcRenderer.on('overlay:drop', () => cb()); },
});
