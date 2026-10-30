'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const sourceSchema = z
  .object({
    type: z.enum(['desktop', 'display', 'window', 'region']).describe('desktop = all screens, display = one monitor, window = a window by title, region = a pixel rectangle'),
    index: z.number().int().optional().describe('Display index from list_displays (type=display)'),
    title: z.string().optional().describe('Exact window title (type=window)'),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  })
  .describe('What to capture. Defaults to the whole desktop.');

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e && e.message ? e.message : e) }] });

function safe(fn) {
  return async (args) => {
    try { return await fn(args || {}); } catch (e) { return fail(e); }
  };
}

function buildServer({ recorder, editor, share, getDisplays, resizeImage }) {
  const server = new McpServer({ name: 'recme', version: '1.0.0' });

  server.registerTool('get_status', {
    title: 'Recorder status',
    description: 'Current recorder state (idle/recording/stopping), elapsed time, output file and settings.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => text(recorder.status())));

  server.registerTool('list_displays', {
    title: 'List displays',
    description: 'Monitors available for capture with their position and size in physical pixels.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => text(getDisplays())));

  server.registerTool('list_audio_devices', {
    title: 'List audio devices',
    description: 'DirectShow audio input devices that can be passed as audio_device to start_recording.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => text(recorder.listAudioDevices())));

  server.registerTool('start_recording', {
    title: 'Start screen recording',
    description:
      'Start recording the screen to an MP4 file. Defaults to sharp output: native resolution (no downscaling), H.264 CRF 18, 30 fps, cursor visible. ' +
      'Use quality="ultra" for 60 fps / CRF 14. Returns immediately; call stop_recording to finish.',
    inputSchema: {
      quality: z.enum(['standard', 'high', 'ultra']).optional().describe('Preset, default "high"'),
      fps: z.number().int().min(5).max(120).optional().describe('Override preset frame rate'),
      source: sourceSchema.optional(),
      system_audio: z.boolean().optional().describe('Record the computer\'s sound output (what you hear). Default true.'),
      audio_device: z.string().optional().describe('Also record a microphone/input device, name from list_audio_devices'),
      cursor: z.boolean().optional().describe('Draw mouse cursor (default true)'),
      encoder: z.enum(['auto', 'libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf']).optional().describe('Default auto (hardware if available, else libx264)'),
      max_seconds: z.number().positive().optional().describe('Automatically stop after this many seconds'),
    },
  }, safe(async (args) => text(await recorder.start(args))));

  server.registerTool('stop_recording', {
    title: 'Stop screen recording',
    description: 'Stop the current recording and finalize the MP4. Returns file path, duration and size.',
    inputSchema: {},
  }, safe(async () => text(await recorder.stop())));

  server.registerTool('take_screenshot', {
    title: 'Take screenshot',
    description: 'Capture the screen now. Returns the image (downscaled to max_width for viewing) and saves the full-resolution PNG.',
    inputSchema: {
      source: sourceSchema.optional(),
      cursor: z.boolean().optional().describe('Include the mouse cursor (default false)'),
      max_width: z.number().int().min(320).max(4096).optional().describe('Width of the returned preview, default 1600. The saved file stays full resolution.'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ source, cursor, max_width }) => {
    const file = recorder.screenshot({ source, cursor });
    const preview = await resizeImage(file, max_width || 1600);
    return {
      content: [
        { type: 'image', data: preview.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `Full-resolution file: ${file}` },
      ],
    };
  }));

  server.registerTool('list_recordings', {
    title: 'List recordings',
    description: 'Recorded videos in the output folder, newest first.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => text({ folder: recorder.outputDir, recordings: recorder.listRecordings() })));

  server.registerTool('get_recording_info', {
    title: 'Recording info',
    description: 'Codec, resolution, frame rate, bitrate and duration of a recording (ffprobe).',
    inputSchema: { name: z.string().describe('File name from list_recordings') },
    annotations: { readOnlyHint: true },
  }, safe(({ name }) => text(recorder.probe(recorder.resolveRecording(name)) || 'ffprobe could not read the file')));

  server.registerTool('get_recording_frame', {
    title: 'View a frame of a recording',
    description: 'Extract one frame at the given time so you can check what was recorded.',
    inputSchema: {
      name: z.string().describe('File name from list_recordings'),
      seconds: z.number().min(0).describe('Time offset in seconds'),
      max_width: z.number().int().min(320).max(4096).optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ name, seconds, max_width }) => {
    const src = recorder.resolveRecording(name);
    const out = recorder.newFilePath('frame', 'png');
    recorder.extractFrame(src, seconds, out);
    const preview = await resizeImage(out, max_width || 1600);
    return { content: [{ type: 'image', data: preview.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Full-resolution file: ${out}` }] };
  }));

  const segmentsSchema = z.array(z.object({ start: z.number().min(0), end: z.number().positive() }))
    .describe('Pieces of the source to KEEP, in seconds, e.g. [{"start":0,"end":5},{"start":12,"end":30}]. Everything outside is cut away. Pieces are joined in the order given, so [{"start":12,"end":30},{"start":0,"end":5}] swaps them.');

  server.registerTool('trim_recording', {
    title: 'Cut a recording',
    description: 'Create a new MP4 containing only the given pieces of a recording (cut, trim or join). The original is never modified. ' +
      'mode "precise" (default) re-encodes for frame-accurate cuts; "fast" copies streams and snaps to keyframes.',
    inputSchema: {
      name: z.string().describe('File name from list_recordings'),
      segments: segmentsSchema,
      audio: z.enum(['keep', 'remove']).optional().describe('Remove = mute the output'),
      mode: z.enum(['precise', 'fast']).optional(),
    },
  }, safe(async (args) => text(await editor.exportVideo(args))));

  server.registerTool('extract_audio', {
    title: 'Separate audio',
    description: 'Save the audio of a recording as a separate file (m4a, mp3, wav or flac), optionally only the given pieces.',
    inputSchema: {
      name: z.string(),
      format: z.enum(['m4a', 'mp3', 'wav', 'flac']).optional().describe('Default m4a'),
      segments: segmentsSchema.optional(),
    },
  }, safe(async (args) => text(await editor.extractAudio(args))));

  server.registerTool('list_nearby_devices', {
    title: 'Nearby devices',
    description: 'Devices on the same Wi-Fi/LAN that run Recme or LocalSend and can receive files. Set scan=true to actively search the network.',
    inputSchema: { scan: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ scan }) => {
    if (scan) await share.scan();
    return text(share.devices().map((d) => ({ name: d.alias, ip: d.ip, type: d.deviceType })));
  }));

  server.registerTool('send_recording', {
    title: 'Send a file to a nearby device',
    description: 'Send a recording (or exported clip/audio) to another device on the same network. The person at that device must accept it. ' +
      'This shares the file outside this computer: only call it when the user explicitly asked to send it to that device.',
    inputSchema: {
      name: z.string().describe('File name from list_recordings'),
      device: z.string().describe('Device name or IP from list_nearby_devices'),
      pin: z.string().optional().describe('PIN of the receiving device, only if it asks for one and the user gave it'),
    },
    annotations: { openWorldHint: true },
  }, safe(async ({ name, device, pin }) => {
    const q = device.toLowerCase();
    const peer = share.devices().find((d) => d.alias.toLowerCase() === q || d.ip === q || d.id === device)
      || share.devices().find((d) => d.alias.toLowerCase().includes(q));
    if (!peer) throw new Error(`No nearby device matches "${device}". Call list_nearby_devices (scan=true) first.`);
    const file = recorder.resolveRecording(name);
    return text(await share.send(peer.id, [file], undefined, { pin: pin || '' }));
  }));

  server.registerTool('delete_recording', {
    title: 'Delete recording',
    description: 'Permanently delete a recording from the output folder. Ask the user before calling this.',
    inputSchema: { name: z.string() },
    annotations: { destructiveHint: true },
  }, safe(({ name }) => { recorder.deleteRecording(name); return text(`Deleted ${name}`); }));

  return server;
}

/**
 * Starts the local MCP endpoint (Streamable HTTP, stateless) on 127.0.0.1.
 * Protected by a bearer token plus Host/Origin checks so web pages cannot drive it.
 */
function startMcpHttp({ port, token, recorder, editor, share, getDisplays, resizeImage, onActivity }) {
  const tokenBuf = Buffer.from(token);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const authorized = (req) => {
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  };

  const httpServer = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

    if (!allowedHosts.has(req.headers.host || '') || req.headers.origin) return send(403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return send(200, { ok: true });
    if (url.pathname !== '/mcp') return send(404, { error: 'not found' });
    if (!authorized(req)) return send(401, { error: 'missing or invalid bearer token' });
    if (req.method !== 'POST') return send(405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server, use POST)' }, id: null });

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1e6) return send(413, { error: 'too large' });
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(400, { error: 'invalid JSON' }); }

    const server = buildServer({ recorder, editor, share, getDisplays, resizeImage });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      if (onActivity && parsed && parsed.method === 'tools/call') onActivity(parsed.params && parsed.params.name);
    } catch (e) {
      if (!res.headersSent) send(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => resolve(httpServer));
  });
}

module.exports = { startMcpHttp };
