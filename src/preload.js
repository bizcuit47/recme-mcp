'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld('recme', {
  init: call('init'),
  start: call('start'),
  stop: call('stop'),
  status: call('status'),
  list: call('list'),
  open: call('open'),
  reveal: call('reveal'),
  remove: call('delete'),
  openFolder: call('openFolder'),
  copy: call('copy'),
  mcp: call('mcp'),
  chooseFolder: call('chooseFolder'),
  selectArea: call('selectArea'),
  openEditor: call('editor:open'),
  app: { get: call('app:get'), set: call('app:set') },
  sizes: { list: call('sizes:list'), save: call('sizes:save'), remove: call('sizes:remove') },
  areas: { list: call('areas:list'), save: call('areas:save'), remove: call('areas:remove') },
  hotkey: { get: call('hotkey:get'), set: call('hotkey:set') },
  ask: { get: call('ask:get'), set: call('ask:set') },
  resetToken: call('mcp:resetToken'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  share: {
    chooseReceiveDir: call('share:chooseReceiveDir'),
    trust: call('share:trust'),
    pick: call('share:pick'),
    register: call('share:register'),
    info: call('share:info'),
    scan: call('share:scan'),
    settings: call('share:settings'),
    send: call('share:send'),
    respond: call('share:respond'),
    openReceived: call('openReceived'),
  },
  on: (channel, cb) => {
    const allowed = ['share:devices', 'share:incoming', 'share:incoming-done', 'share:progress', 'share:received', 'share:auto-accepted', 'share-select', 'areas:changed'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, p) => cb(p));
  },
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onMcpActivity: (cb) => ipcRenderer.on('mcp-activity', (_e, l) => cb(l)),
});
