'use strict';

const { BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * System-audio capture (WASAPI loopback) via a hidden Chromium page.
 * Returns { start(file) -> { startedAtMs }, stop() }.
 */
function createSystemAudio() {
  let win = null;
  let out = null;

  // Grant the worker's getDisplayMedia request with loopback audio, no picker UI.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch {
      callback({});
    }
  });

  ipcMain.handle('audio:chunk', (e, buf) => {
    if (win && e.sender === win.webContents && out) out.write(Buffer.from(buf));
  });

  async function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: path.join(__dirname, 'audio', 'worker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await win.loadFile(path.join(__dirname, 'audio', 'worker.html'));
  }

  return {
    async start(file) {
      await ensureWindow();
      out = fs.createWriteStream(file);
      try {
        const startedAtMs = await win.webContents.executeJavaScript('window.__startCapture()', true);
        return { startedAtMs };
      } catch (e) {
        out.destroy();
        out = null;
        throw e;
      }
    },
    async stop() {
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript('window.__stopCapture()', true);
      }
      if (out) {
        const o = out;
        out = null;
        await new Promise((resolve) => o.end(resolve));
      }
    },
  };
}

module.exports = { createSystemAudio };
