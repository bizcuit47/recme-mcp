'use strict';

const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Quality presets. Default is "high": native resolution, no downscale, low CRF.
const QUALITY = {
  standard: { crf: 23, fps: 30, label: 'Standard (CRF 23, 30fps)' },
  high: { crf: 18, fps: 30, label: 'High (CRF 18, 30fps)' },
  ultra: { crf: 14, fps: 60, label: 'Ultra (CRF 14, 60fps)' },
};

const HW_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf'];

function findFfmpeg(configured) {
  // Installed app: ffmpeg ships in <install folder>/resources/ffmpeg. Otherwise fall back to the user's own copy.
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe') : null;
  const candidates = [bundled, configured, process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean);
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(winget)) {
      if (!/ffmpeg/i.test(pkg)) continue;
      const root = path.join(winget, pkg);
      for (const sub of fs.readdirSync(root)) {
        candidates.push(path.join(root, sub, 'bin', 'ffmpeg.exe'));
      }
    }
  } catch { /* winget folder not present */ }
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

function encoderArgs(encoder, crf) {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0', '-profile:v', 'high'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', String(crf), '-preset', 'medium'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-qp_b', String(crf)];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-profile:v', 'high'];
  }
}

class Recorder extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.outputDir
   * @param {string} [opts.ffmpegPath]
   * @param {() => Array} opts.getDisplays  returns [{index,label,x,y,width,height}] in physical pixels
   */
  constructor({ outputDir, ffmpegPath, getDisplays, systemAudio }) {
    super();
    this.systemAudio = systemAudio || null; // { start(file) -> {startedAtMs}, stop() }
    this.warning = null;
    this.outputDir = outputDir;
    this.getDisplays = getDisplays;
    this.ffmpeg = findFfmpeg(ffmpegPath);
    this.state = 'idle';
    this.proc = null;
    this.current = null;
    this.stopTimer = null;
    this.lastError = null;
    this.hwEncoders = [];
    fs.mkdirSync(outputDir, { recursive: true });
  }

  requireFfmpeg() {
    if (!this.ffmpeg) {
      throw new Error('ffmpeg not found. Install it (winget install Gyan.FFmpeg) or set FFMPEG_PATH.');
    }
    return this.ffmpeg;
  }

  /** Probe which hardware H.264 encoders actually work on this machine. */
  detectEncoders() {
    if (!this.ffmpeg) return [];
    this.hwEncoders = HW_ENCODERS.filter((enc) => {
      const r = spawnSync(
        this.ffmpeg,
        ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.2', ...encoderArgs(enc, 20), '-pix_fmt', 'yuv420p', '-f', 'null', '-'],
        { windowsHide: true, timeout: 8000 }
      );
      return r.status === 0;
    });
    return this.hwEncoders;
  }

  pickEncoder(requested) {
    if (requested && requested !== 'auto') return requested;
    return this.hwEncoders[0] || 'libx264';
  }

  /** DirectShow audio capture devices. */
  listAudioDevices() {
    if (!this.ffmpeg) return [];
    const r = spawnSync(this.ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    const devices = [];
    for (const line of (r.stderr || '').split(/\r?\n/)) {
      const m = line.match(/"(.+)" \(audio\)/);
      if (m) devices.push(m[1]);
    }
    return devices;
  }

  /** Bounding box of all monitors in physical pixels. */
  desktopBounds() {
    const ds = this.getDisplays();
    const x1 = Math.min(...ds.map((d) => d.x));
    const y1 = Math.min(...ds.map((d) => d.y));
    const x2 = Math.max(...ds.map((d) => d.x + d.width));
    const y2 = Math.max(...ds.map((d) => d.y + d.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  /** Fit a user-chosen area inside the desktop and make it even-sized (needed for H.264 yuv420p). */
  clampRegion(r) {
    const bounds = this.desktopBounds();
    const num = (v) => Math.round(Number(v));
    if (![r.x, r.y, r.width, r.height].every((v) => Number.isFinite(Number(v)))) throw new Error('Area needs numeric x, y, width and height');
    let x = Math.max(bounds.x, num(r.x));
    let y = Math.max(bounds.y, num(r.y));
    let width = Math.min(num(r.width), bounds.x + bounds.width - x);
    let height = Math.min(num(r.height), bounds.y + bounds.height - y);
    width -= width % 2;
    height -= height % 2;
    if (width < 16 || height < 16) throw new Error(`Area too small or outside the screen (min 16x16, desktop is ${bounds.width}x${bounds.height})`);
    return { x, y, width, height };
  }

  /** gdigrab input args for a capture source. Coordinates are physical pixels. */
  sourceArgs(source = { type: 'desktop' }) {
    switch (source.type) {
      case 'display': {
        const d = this.getDisplays().find((x) => x.index === source.index);
        if (!d) throw new Error(`Display ${source.index} not found`);
        return ['-offset_x', String(d.x), '-offset_y', String(d.y), '-video_size', `${d.width}x${d.height}`, '-i', 'desktop'];
      }
      case 'region': {
        const r = this.clampRegion(source);
        return ['-offset_x', String(r.x), '-offset_y', String(r.y), '-video_size', `${r.width}x${r.height}`, '-i', 'desktop'];
      }
      case 'window':
        return ['-i', `title=${source.title}`];
      default:
        return ['-i', 'desktop'];
    }
  }

  newFilePath(prefix, ext) {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    return path.join(this.outputDir, `${prefix}_${stamp}.${ext}`);
  }

  async start(options = {}) {
    const ffmpeg = this.requireFfmpeg();
    if (this.state !== 'idle') throw new Error(`Already ${this.state}`);

    const preset = QUALITY[options.quality] || QUALITY.high;
    const fps = Math.min(Math.max(Math.round(options.fps || preset.fps), 5), 120);
    const crf = options.crf ?? preset.crf;
    const encoder = this.pickEncoder(options.encoder);
    let source = options.source || { type: 'desktop' };
    if (source.type === 'region') source = { type: 'region', ...this.clampRegion(source) };
    const audio = options.audio_device || null;
    const file = options.file || this.newFilePath('rec', 'mp4');

    const args = ['-hide_banner', '-y'];
    args.push('-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', options.cursor === false ? '0' : '1', '-thread_queue_size', '1024');
    args.push(...this.sourceArgs(source));
    if (audio) {
      args.push('-f', 'dshow', '-rtbufsize', '256M', '-thread_queue_size', '1024', '-i', `audio=${audio}`);
    }
    // No resizing: crop (never scale) to even dimensions (required by yuv420p), tag BT.709 so colours stay accurate.
    args.push('-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p');
    args.push(...encoderArgs(encoder, crf));
    args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(fps));
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k');
    // Fragmented MP4: file stays playable even if the app crashes mid-recording.
    args.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof', file);

    // System audio (what you hear from the speakers) is captured by the app's loopback worker,
    // because ffmpeg/gdigrab cannot capture it. It is muxed into the video when recording stops.
    this.warning = null;
    let sysAudio = null;
    if (options.system_audio !== false && this.systemAudio) {
      const audioFile = file.replace(/\.mp4$/i, '') + '.sysaudio.webm';
      try {
        const r = await this.systemAudio.start(audioFile);
        sysAudio = { file: audioFile, startedAtMs: r.startedAtMs };
      } catch (e) {
        this.warning = `System audio unavailable, recording video only: ${e.message}`;
      }
    }

    this.lastError = null;
    this.state = 'recording';
    this.current = {
      file,
      startedAt: Date.now(),
      sysAudio,
      videoStartMs: null,
      options: { fps, crf, encoder, source, audio_device: audio, system_audio: !!sysAudio, quality: options.quality || 'high' },
    };
    const current = this.current;

    let stderr = '';
    const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc = proc;
    proc.stderr.on('data', (b) => {
      stderr = (stderr + b.toString()).slice(-4000);
      if (!current.videoStartMs) {
        // gdigrab reports its start time as epoch seconds; used to line the audio up with the first frame.
        const m = stderr.match(/Input #0, gdigrab[\s\S]*?start: (\d+\.\d+)/);
        if (m) current.videoStartMs = parseFloat(m[1]) * 1000;
      }
    });
    proc.on('error', (e) => {
      this.lastError = e.message;
    });
    proc.on('exit', (code, signal) => {
      const wasStopping = this.state === 'stopping';
      this.lastExit = { code, signal, stopping: wasStopping, tail: stderr.split(/\r?\n/).filter(Boolean).slice(-4) };
      if (!wasStopping && code !== 0) {
        this.lastError = `ffmpeg exited with code ${code}: ${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')}`;
      }
      clearTimeout(this.stopTimer);
      this.proc = null;
      if (wasStopping) return; // stop() finishes up (audio mux) and then goes idle
      this.state = 'idle';
      if (sysAudio) this.systemAudio.stop().catch(() => {});
      this.emit('finished', current);
      this.emit('change');
    });

    // Fail fast if ffmpeg dies during start-up (bad device name, unsupported encoder...).
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 1200);
      proc.once('exit', () => {
        clearTimeout(t);
        reject(new Error(this.lastError || 'ffmpeg exited immediately'));
      });
    });

    if (options.max_seconds) {
      this.stopTimer = setTimeout(() => this.stop().catch(() => {}), options.max_seconds * 1000);
    }
    this.emit('change');
    return this.status();
  }

  async stop() {
    if (this.state !== 'recording' || !this.proc) throw new Error('Not recording');
    clearTimeout(this.stopTimer);
    this.state = 'stopping';
    const proc = this.proc;
    const info = { ...this.current };
    this.emit('change');
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      try { proc.stdin.write('q'); proc.stdin.end(); } catch { /* already closed */ }
      setTimeout(() => proc.kill(), 15000).unref();
    });
    const durationSec = (Date.now() - info.startedAt) / 1000;
    try {
      await this.finalizeAudio(info);
      // Recording uses fragmented MP4 for crash safety; turn it into a normal seekable MP4 (stream copy, fast).
      if (!info.muxed) await this.remuxFaststart(info.file);
    } finally {
      this.state = 'idle';
      this.emit('finished', info);
      this.emit('change');
    }
    let size = 0;
    try { size = fs.statSync(info.file).size; } catch { /* missing */ }
    return { file: info.file, duration_seconds: Math.round(durationSec * 10) / 10, size_bytes: size, options: info.options, warning: this.warning };
  }

  async remuxFaststart(file) {
    if (!fs.existsSync(file)) return;
    const out = file.replace(/\.mp4$/i, '') + '.remux.mp4';
    const code = await new Promise((resolve) => {
      const p = spawn(this.ffmpeg, ['-hide_banner', '-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', out], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(-1));
      p.on('exit', resolve);
    });
    if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) fs.renameSync(out, file);
    else fs.rmSync(out, { force: true });
  }

  /** Stop the loopback capture and mux it into the finished video (video stream is copied, not re-encoded). */
  async finalizeAudio(info) {
    const { file, sysAudio, videoStartMs, options } = info;
    if (!sysAudio) return;
    try { await this.systemAudio.stop(); } catch (e) { this.warning = `System audio stop failed: ${e.message}`; }
    if (!fs.existsSync(sysAudio.file) || fs.statSync(sysAudio.file).size < 1000) {
      this.warning = 'No system audio was captured.';
      return;
    }
    let offset = videoStartMs ? (videoStartMs - sysAudio.startedAtMs) / 1000 : 0; // > 0: audio started earlier
    if (Math.abs(offset) > 5) offset = 0;
    const audioIn = offset >= 0
      ? ['-ss', offset.toFixed(3), '-i', sysAudio.file]
      : ['-itsoffset', (-offset).toFixed(3), '-i', sysAudio.file];
    const out = file.replace(/\.mp4$/i, '') + '.muxed.mp4';
    const args = ['-hide_banner', '-y', '-i', file, ...audioIn];
    if (options.audio_device) {
      args.push('-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,apad[a]', '-map', '0:v', '-map', '[a]');
    } else {
      args.push('-af', 'apad', '-map', '0:v', '-map', '1:a');
    }
    // apad makes the audio endless, so the output length is pinned to the video's with -t.
    const probed = this.probe(file);
    const duration = probed && probed.format && parseFloat(probed.format.duration);
    if (!duration) {
      this.warning = `Could not read video length, system audio kept separately: ${sysAudio.file}`;
      return;
    }
    args.push('-t', duration.toFixed(3));
    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);

    const code = await new Promise((resolve) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(-1));
      p.on('exit', resolve);
    });
    if (code === 0 && fs.existsSync(out)) {
      fs.renameSync(out, file);
      fs.rmSync(sysAudio.file, { force: true });
      info.muxed = true;
    } else {
      this.warning = `Could not merge system audio (kept separately: ${sysAudio.file})`;
      fs.rmSync(out, { force: true });
    }
  }

  status() {
    const base = { state: this.state, ffmpeg: this.ffmpeg, last_error: this.lastError, warning: this.warning, last_exit: this.lastExit };
    if (!this.current || this.state === 'idle') return base;
    let size = 0;
    try { size = fs.statSync(this.current.file).size; } catch { /* not yet created */ }
    return {
      ...base,
      file: this.current.file,
      elapsed_seconds: Math.round((Date.now() - this.current.startedAt) / 100) / 10,
      size_bytes: size,
      options: this.current.options,
    };
  }

  /** One PNG frame at native resolution. Returns the file path. */
  screenshot(options = {}) {
    const ffmpeg = this.requireFfmpeg();
    const file = this.newFilePath('shot', 'png');
    const args = ['-hide_banner', '-y', '-f', 'gdigrab', '-framerate', '1', '-draw_mouse', options.cursor ? '1' : '0', ...this.sourceArgs(options.source), '-frames:v', '1', file];
    const r = spawnSync(ffmpeg, args, { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`Screenshot failed: ${(r.stderr || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')}`);
    return file;
  }

  /** Extract a frame from a finished recording. */
  extractFrame(file, seconds, outFile) {
    const ffmpeg = this.requireFfmpeg();
    const r = spawnSync(ffmpeg, ['-hide_banner', '-y', '-ss', String(seconds), '-i', file, '-frames:v', '1', outFile], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0 || !fs.existsSync(outFile)) throw new Error('Could not extract frame (time beyond end of video?)');
    return outFile;
  }

  probe(file) {
    const ffprobe = path.join(path.dirname(this.requireFfmpeg()), 'ffprobe.exe');
    const bin = fs.existsSync(ffprobe) ? ffprobe : 'ffprobe';
    const r = spawnSync(bin, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,bit_rate:format=duration,size,bit_rate', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  }

  listRecordings() {
    return fs.readdirSync(this.outputDir)
      .filter((f) => /\.(mp4|mkv|mp3|m4a|wav|flac)$/i.test(f) && !/\.(muxed|remux|sysaudio)\./i.test(f))
      .map((f) => {
        const p = path.join(this.outputDir, f);
        const st = fs.statSync(p);
        return { name: f, path: p, size_bytes: st.size, created: st.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  /** Resolve a recording name to a path inside outputDir only (no path traversal). */
  resolveRecording(name) {
    const p = path.join(this.outputDir, path.basename(name));
    if (!fs.existsSync(p)) throw new Error(`Recording not found: ${name}`);
    return p;
  }

  deleteRecording(name) {
    fs.unlinkSync(this.resolveRecording(name));
  }
}

module.exports = { Recorder, QUALITY, encoderArgs };
