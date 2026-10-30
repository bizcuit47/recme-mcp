'use strict';

// End-to-end check of Recme's MCP server. Start the app first (npm start), then: npm run test:mcp
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || os.homedir(), 'Recme', 'config.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (r) => r.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} ${c.mimeType}, ${c.data.length} b64 chars]`)).join('\n');

(async () => {
  const client = new Client({ name: 'recme-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
  }));

  const tools = await client.listTools();
  console.log('tools:', tools.tools.map((t) => t.name).join(', '));

  console.log('\nlist_displays:', body(await client.callTool({ name: 'list_displays', arguments: {} })));
  console.log('\ntake_screenshot:', body(await client.callTool({ name: 'take_screenshot', arguments: {} })));

  console.log('\nstart_recording:', body(await client.callTool({ name: 'start_recording', arguments: { quality: 'high', max_seconds: 30 } })));
  await sleep(5000);
  console.log('\nget_status:', body(await client.callTool({ name: 'get_status', arguments: {} })));
  const stop = await client.callTool({ name: 'stop_recording', arguments: {} });
  console.log('\nstop_recording:', body(stop));

  const file = JSON.parse(stop.content[0].text).file;
  const name = path.basename(file);
  console.log('\nget_recording_info:', body(await client.callTool({ name: 'get_recording_info', arguments: { name } })));
  console.log('\nget_recording_frame:', body(await client.callTool({ name: 'get_recording_frame', arguments: { name, seconds: 2 } })));

  // Security: wrong token must be rejected.
  const bad = await fetch(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' }, body: '{}' });
  console.log('\nwrong token ->', bad.status);

  await client.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
