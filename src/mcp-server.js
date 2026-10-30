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
    type: z.enum(['desktop', 'display', 'window', 'region', 'area', 'window_area']).describe(
      'desktop = all screens, display = one monitor, region = a pixel rectangle, ' +
      'area = a saved area by name (see list_areas), window_area = the screen rectangle a window occupies right now (part of the title is enough; see list_windows), ' +
      'window = capture one window by its exact title (may come out black for GPU-drawn windows, prefer window_area)'),
    name: z.string().optional().describe('Saved area name (type=area)'),
    index: z.number().int().optional().describe('Display index from list_displays (type=display)'),
    title: z.string().optional().describe('Window title (type=window: exact; type=window_area: part of the title is enough)'),
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

function buildServer({ recorder, editor, share, getDisplays, resizeImage, areas, windows, confirm }) {
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
  }, safe(async (args) => {
    await confirm('capture', 'Claude wants to start recording your screen.');
    return text(await recorder.start(args));
  }));

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
    await confirm('capture', 'Claude wants to take a screenshot of your screen.');
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
    await confirm('send', `Claude wants to send "${name}" to "${peer.alias}" (${peer.ip}).`);
    return text(await share.send(peer.id, [file], undefined, { pin: pin || '' }));
  }));

  server.registerTool('list_windows', {
    title: 'List open windows',
    description: 'Visible windows with their position and size on screen (physical pixels), front-most first. Use it to find e.g. the Unity window, then record it with source {type:"window_area", title:"Unity"}. ' +
      'Titles can contain private information, so only call it when it is needed for the task.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => {
    await confirm('capture', 'Claude wants to see the list of open windows (their titles).');
    return text(windows.list());
  }));

  server.registerTool('list_areas', {
    title: 'List saved areas',
    description: 'Named screen areas the user saved (for example "game" for the Game view of a Unity project). Record one with source {type:"area", name:"game"}.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => text(areas.list())));

  server.registerTool('save_area', {
    title: 'Save a named area',
    description: 'Remember a screen rectangle under a name so it can be recorded later with source {type:"area", name}. Coordinates are physical pixels (see list_displays / list_windows). Saving an existing name replaces it.',
    inputSchema: {
      name: z.string().min(1).max(40),
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().min(16),
      height: z.number().int().min(16),
    },
  }, safe(({ name, x, y, width, height }) => text(areas.save(name, { x, y, width, height }))));

  server.registerTool('delete_area', {
    title: 'Delete a saved area',
    description: 'Forget a saved area by name.',
    inputSchema: { name: z.string() },
  }, safe(({ name }) => text(areas.remove(name))));

  server.registerTool('compress_recording', {
    title: 'Make a file small enough to share',
    description: 'Create a smaller copy of a recording that fits under a size limit (for chat apps or email). Lowers resolution automatically when needed. The original is kept.',
    inputSchema: {
      name: z.string().describe('File name from list_recordings'),
      target_mb: z.number().min(1).max(2000).describe('Maximum size in MB, e.g. 8, 25'),
      max_width: z.number().int().min(320).optional().describe('Also cap the width in pixels (optional)'),
      segments: segmentsSchema.optional(),
    },
  }, safe(async ({ name, target_mb, max_width, segments }) => text(await editor.exportVideo({ name, segments, target_mb, max_width }))));

  server.registerTool('get_recording_overview', {
    title: 'See a whole recording at a glance',
    description: 'One picture with evenly spaced frames of a recording (left to right, top to bottom) plus the time of each frame. Cheaper than asking for frames one by one when you need to understand what happens in a clip.',
    inputSchema: {
      name: z.string().describe('File name from list_recordings'),
      frames: z.number().int().min(4).max(25).optional().describe('Number of frames, default 9'),
      width: z.number().int().min(240).max(960).optional().describe('Width of each frame in pixels, default 480'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ name, frames, width }) => {
    const file = recorder.resolveRecording(name);
    const o = editor.contactSheet(path.basename(file), frames, width);
    const list = o.times.map((t, i) => `${i + 1}: ${t.toFixed(1)}s`).join(', ');
    return {
      content: [
        { type: 'image', data: o.png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `${o.cols}x${o.rows} grid, read left to right then top to bottom. Clip length ${o.duration.toFixed(1)}s. Frame times: ${list}` },
      ],
    };
  }));

  server.registerTool('delete_recording', {
    title: 'Delete recording',
    description: 'Permanently delete a recording from the output folder. Ask the user before calling this.',
    inputSchema: { name: z.string() },
    annotations: { destructiveHint: true },
  }, safe(async ({ name }) => {
    recorder.resolveRecording(name); // fail early if it does not exist
    await confirm('delete', `Claude wants to permanently delete "${name}".`);
    recorder.deleteRecording(name);
    return text(`Deleted ${name}`);
  }));

  return server;
}

/**
 * Starts the local MCP endpoint (Streamable HTTP, stateless) on 127.0.0.1.
 * Protected by a bearer token plus Host/Origin checks so web pages cannot drive it.
 */
function startMcpHttp({ port, getToken, recorder, editor, share, getDisplays, resizeImage, areas, windows, confirm, onActivity }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const authorized = (req) => {
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const tokenBuf = Buffer.from(getToken()); // read every time so "reset token" takes effect immediately
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  };

  const httpServer = http.createServer(async (req, res) => {
    // One connection per request. Node closes idle keep-alive sockets after 5 s, and a client that reuses such a
    // socket gets ECONNRESET on its next call (MCP clients pause for much longer than that between calls).
    res.setHeader('Connection', 'close');
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

    const server = buildServer({ recorder, editor, share, getDisplays, resizeImage, areas, windows, confirm });
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
