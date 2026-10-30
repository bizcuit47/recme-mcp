'use strict';

// Calls the edit / share MCP tools of the running app. Needs a recording in the output folder:
//   node scripts/test-mcp-edit.js <recording-name.mp4>
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'Recme', 'config.json'), 'utf8'));
const name = process.argv[2];
if (!name) { console.error('usage: node scripts/test-mcp-edit.js <recording-name.mp4>'); process.exit(1); }

(async () => {
  const client = new Client({ name: 'recme-edit-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
  }));
  const t = async (tool, args = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return (r.isError ? 'ERROR: ' : '') + r.content[0].text.replace(/\s+/g, ' ');
  };
  console.log('trim_recording   :', await t('trim_recording', { name, segments: [{ start: 1, end: 3 }, { start: 9, end: 11 }] }));
  console.log('extract_audio    :', await t('extract_audio', { name, format: 'mp3', segments: [{ start: 0, end: 5 }] }));
  console.log('list_nearby      :', await t('list_nearby_devices'));
  console.log('send (no device) :', await t('send_recording', { name, device: 'nonexistent-device' }));
  console.log('traversal name   :', await t('trim_recording', { name: '..' + path.sep + '..' + path.sep + 'x.mp4', segments: [{ start: 0, end: 1 }] }));
  await client.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
