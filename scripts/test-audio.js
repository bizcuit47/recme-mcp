'use strict';

// Records a 1280x720 area while a Windows sound plays, then reports whether the video has audible sound.
// Start the app first (npm start), then: npm run test:audio
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'Recme', 'config.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const client = new Client({ name: 'recme-audio-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
  }));
  const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

  await call('start_recording', { source: { type: 'region', x: 200, y: 200, width: 1280, height: 720 }, system_audio: true });
  await sleep(1500);
  spawn('powershell', ['-NoProfile', '-Command', "(New-Object Media.SoundPlayer 'C:/Windows/Media/Alarm05.wav').PlaySync()"], { stdio: 'ignore' });
  await sleep(5000);
  const res = await call('stop_recording');
  console.log('saved:', res.file, '| warning:', res.warning);

  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', res.file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const mean = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  const max = /max_volume: (-?[\d.]+) dB/.exec(r.stderr);
  console.log('audio mean/max volume:', mean && mean[1], max && max[1], 'dB');
  console.log(max && parseFloat(max[1]) > -40 ? 'PASS: system sound was captured' : 'FAIL: audio is silent');
  await client.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
