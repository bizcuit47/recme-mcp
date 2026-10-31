#!/usr/bin/env node
'use strict';

// recme: command line for a running Recme app. It talks to the same local MCP server Claude uses
// (127.0.0.1, bearer token), so everything Claude can do you can script from a terminal.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HELP = `recme - control the running Recme app from a terminal

Usage: recme <command> [options]

Recording
  status                          recorder state
  start [options]                 start recording
  stop                            stop and finish the file
  shot [options] [--save file]    screenshot (prints the full-resolution path; --save also writes the preview)
Looking around
  displays | mics | windows | areas
  list                            recordings, newest first
  info <name>                     codec, size, duration
  frame <name> <seconds> [--save file]
  overview <name> [--frames 9] [--save file]
Editing and sharing
  trim <name> --keep 0-5,12-30 [--mute] [--fast]
  audio <name> [--format m4a|mp3|wav|flac] [--keep 0-5]
  compress <name> --mb 25 [--max-width 1280]
  devices [--scan]                nearby devices
  send <name> <device> [--pin 1234]
  delete <name>
Saved areas
  area-save <name> <x> <y> <width> <height>
  area-delete <name>
Other
  tools                           list the MCP tools
  call <tool> ['{"json":"args"}'] call any tool directly

Start / screenshot source (default: whole desktop):
  --display N | --region x,y,w,h | --area NAME | --window-area TITLE | --window TITLE
Start options:
  --quality standard|high|ultra   --fps N   --mic "device name"   --no-system-audio
  --no-cursor   --encoder auto|libx264|h264_nvenc|h264_qsv|h264_amf   --max-seconds N

Connection: reads the token and port from Recme's config file. Override with RECME_URL and RECME_TOKEN,
or point RECME_CONFIG_DIR at a different profile folder. Add --json to print raw results.
`;

function configDir() {
  if (process.env.RECME_CONFIG_DIR) return process.env.RECME_CONFIG_DIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Recme');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Recme');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Recme');
}

function connection() {
  if (process.env.RECME_URL && process.env.RECME_TOKEN) return { url: process.env.RECME_URL, token: process.env.RECME_TOKEN };
  const file = path.join(configDir(), 'config.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw new Error(`Cannot read ${file}. Start Recme once so it creates its settings, or set RECME_URL and RECME_TOKEN.`);
  }
  if (!cfg.token) throw new Error(`No token in ${file}. Start Recme once.`);
  return { url: process.env.RECME_URL || `http://127.0.0.1:${cfg.port || 7777}/mcp`, token: cfg.token };
}

// --flag value / --flag=value / --bool, everything else is positional.
function parseArgs(argv, booleans) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2));
    if (eq > 0) opt[key] = a.slice(eq + 1);
    else if (booleans.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) opt[key] = true;
    else opt[key] = argv[++i];
  }
  return { pos, opt };
}

const BOOLEANS = new Set(['json', 'mute', 'fast', 'scan', 'no-system-audio', 'no-cursor', 'cursor', 'help']);

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} needs a number, got "${v}"`);
  return n;
}

function sourceFrom(opt) {
  if (opt.display !== undefined) return { type: 'display', index: num(opt.display, 'display') };
  if (opt.region) {
    const p = String(opt.region).split(',').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) throw new Error('--region needs x,y,width,height');
    return { type: 'region', x: p[0], y: p[1], width: p[2], height: p[3] };
  }
  if (opt.area) return { type: 'area', name: String(opt.area) };
  if (opt['window-area']) return { type: 'window_area', title: String(opt['window-area']) };
  if (opt.window) return { type: 'window', title: String(opt.window) };
  return undefined;
}

// "0-5,12-30" -> [{start:0,end:5},{start:12,end:30}]
function segmentsFrom(spec) {
  if (!spec || spec === true) throw new Error('--keep needs pieces like 0-5,12-30 (seconds)');
  return String(spec).split(',').map((piece) => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(piece);
    if (!m) throw new Error(`Bad piece "${piece}", use start-end in seconds, e.g. 0-5`);
    return { start: Number(m[1]), end: Number(m[2]) };
  });
}

function need(pos, n, usage) {
  if (pos.length < n) throw new Error(`Usage: recme ${usage}`);
}

// command -> [tool, args builder]
const COMMANDS = {
  status: () => ['get_status', {}],
  displays: () => ['list_displays', {}],
  mics: () => ['list_audio_devices', {}],
  windows: () => ['list_windows', {}],
  areas: () => ['list_areas', {}],
  list: () => ['list_recordings', {}],
  stop: () => ['stop_recording', {}],
  tools: () => [null, {}],
  start: (pos, o) => {
    const a = {};
    if (o.quality) a.quality = String(o.quality);
    if (o.fps) a.fps = num(o.fps, 'fps');
    const s = sourceFrom(o); if (s) a.source = s;
    if (o.mic) a.audio_device = String(o.mic);
    if (o['no-system-audio']) a.system_audio = false;
    if (o['no-cursor']) a.cursor = false;
    if (o.encoder) a.encoder = String(o.encoder);
    if (o['max-seconds']) a.max_seconds = num(o['max-seconds'], 'max-seconds');
    return ['start_recording', a];
  },
  shot: (pos, o) => {
    const a = {};
    const s = sourceFrom(o); if (s) a.source = s;
    if (o.cursor) a.cursor = true;
    if (o['max-width']) a.max_width = num(o['max-width'], 'max-width');
    return ['take_screenshot', a];
  },
  info: (pos) => { need(pos, 1, 'info <name>'); return ['get_recording_info', { name: pos[0] }]; },
  frame: (pos, o) => {
    need(pos, 2, 'frame <name> <seconds>');
    return ['get_recording_frame', { name: pos[0], seconds: num(pos[1], 'seconds') }];
  },
  overview: (pos, o) => {
    need(pos, 1, 'overview <name>');
    const a = { name: pos[0] };
    if (o.frames) a.frames = num(o.frames, 'frames');
    return ['get_recording_overview', a];
  },
  trim: (pos, o) => {
    need(pos, 1, 'trim <name> --keep 0-5,12-30');
    const a = { name: pos[0], segments: segmentsFrom(o.keep) };
    if (o.mute) a.audio = 'remove';
    if (o.fast) a.mode = 'fast';
    return ['trim_recording', a];
  },
  audio: (pos, o) => {
    need(pos, 1, 'audio <name>');
    const a = { name: pos[0] };
    if (o.format) a.format = String(o.format);
    if (o.keep) a.segments = segmentsFrom(o.keep);
    return ['extract_audio', a];
  },
  compress: (pos, o) => {
    need(pos, 1, 'compress <name> --mb 25');
    if (!o.mb) throw new Error('--mb is required, e.g. --mb 25');
    const a = { name: pos[0], target_mb: num(o.mb, 'mb') };
    if (o['max-width']) a.max_width = num(o['max-width'], 'max-width');
    return ['compress_recording', a];
  },
  devices: (pos, o) => ['list_nearby_devices', o.scan ? { scan: true } : {}],
  send: (pos, o) => {
    need(pos, 2, 'send <name> <device>');
    const a = { name: pos[0], device: pos[1] };
    if (o.pin) a.pin = String(o.pin);
    return ['send_recording', a];
  },
  delete: (pos) => { need(pos, 1, 'delete <name>'); return ['delete_recording', { name: pos[0] }]; },
  'area-save': (pos) => {
    need(pos, 5, 'area-save <name> <x> <y> <width> <height>');
    return ['save_area', { name: pos[0], x: num(pos[1], 'x'), y: num(pos[2], 'y'), width: num(pos[3], 'width'), height: num(pos[4], 'height') }];
  },
  'area-delete': (pos) => { need(pos, 1, 'area-delete <name>'); return ['delete_area', { name: pos[0] }]; },
  call: (pos) => {
    need(pos, 1, 'call <tool> [json]');
    let args = {};
    if (pos[1]) { try { args = JSON.parse(pos[1]); } catch { throw new Error('The arguments must be valid JSON, e.g. \'{"name":"x.mp4"}\''); } }
    return [pos[0], args];
  },
};

async function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(HELP); return 0; }
  const build = COMMANDS[cmd];
  if (!build) { process.stderr.write(`Unknown command "${cmd}". Run "recme help".\n`); return 2; }
  const { pos, opt } = parseArgs(argv.slice(1), BOOLEANS);
  if (opt.help) { process.stdout.write(HELP); return 0; }
  const [tool, args] = build(pos, opt);

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { url, token } = connection();
  const client = new Client({ name: 'recme-cli', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  } catch (e) {
    const text = String(e && e.message || e);
    // Network failures surface as "fetch failed" with the real cause nested (sometimes an AggregateError with no message).
    const msg = /401|Unauthorized/i.test(text) ? 'Recme rejected the token. Did you reset it? Check the config file or RECME_TOKEN.'
      : /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(text) || (e && e.cause) ? `Cannot reach Recme at ${url}. Is the app running?`
        : text;
    process.stderr.write(`${msg}\n`);
    return 3;
  }

  let code = 0;
  try {
    if (tool === null) {
      const { tools } = await client.listTools();
      for (const t of tools) process.stdout.write(`${t.name.padEnd(24)} ${String(t.description || '').split('. ')[0]}\n`);
      return 0;
    }
    const res = await client.callTool({ name: tool, arguments: args });
    if (opt.json) { process.stdout.write(`${JSON.stringify(res, null, 2)}\n`); return res.isError ? 1 : 0; }
    for (const part of res.content || []) {
      if (part.type === 'text') (res.isError ? process.stderr : process.stdout).write(`${part.text}\n`);
      else if (part.type === 'image') {
        if (opt.save && opt.save !== true) {
          fs.writeFileSync(String(opt.save), Buffer.from(part.data, 'base64'));
          process.stdout.write(`Preview saved to ${path.resolve(String(opt.save))}\n`);
        } else if (!res.isError) process.stdout.write('(image preview not shown; add --save file.png to keep it)\n');
      }
    }
    if (res.isError) code = 1;
  } finally {
    await client.close().catch(() => {});
  }
  return code;
}

module.exports = { parseArgs, segmentsFrom, sourceFrom, configDir };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.message || e}\n`); process.exit(1); });
}
