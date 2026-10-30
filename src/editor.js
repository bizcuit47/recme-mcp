'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encoderArgs } = require('./recorder');

const AUDIO_FORMATS = {
  m4a: ['-c:a', 'aac', '-b:a', '256k'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-c:a', 'pcm_s16le'],
  flac: ['-c:a', 'flac'],
};

/** Cut / join / audio tools on top of ffmpeg. Segments are { start, end } in seconds of the source. */
class Editor {
  constructor(recorder) {
    this.recorder = recorder;
  }

  get ffmpeg() { return this.recorder.requireFfmpeg(); }

  info(name) {
    const file = this.recorder.resolveRecording(name);
    const bin = path.join(path.dirname(this.ffmpeg), 'ffprobe.exe');
    const r = spawnSync(fs.existsSync(bin) ? bin : 'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file],
      { windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Cannot read this file');
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const [n, d] = v && v.r_frame_rate ? v.r_frame_rate.split('/').map(Number) : [30, 1];
    return {
      name: path.basename(file),
      path: file,
      duration: parseFloat(j.format.duration) || 0,
      hasVideo: !!v,
      hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
      width: v && v.width,
      height: v && v.height,
      fps: d ? n / d : 30,
    };
  }

  /** Validate, clamp to the source length and drop tiny pieces. */
  normalizeSegments(segments, duration) {
    const segs = (segments && segments.length ? segments : [{ start: 0, end: duration }])
      .map((s) => ({ start: Math.max(0, Number(s.start)), end: Math.min(duration, Number(s.end)) }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= 0.05);
    // Order matters: pieces are joined exactly in the order given (so they can be rearranged).
    if (!segs.length) throw new Error('Nothing to export: no valid segments');
    return segs;
  }

  uniquePath(dir, base, ext) {
    let p = path.join(dir, `${base}.${ext}`);
    for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base}_${i}.${ext}`);
    return p;
  }

  run(args, totalSec, onProgress) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      let buf = '';
      p.stderr.on('data', (b) => { err = (err + b.toString()).slice(-3000); });
      p.stdout.on('data', (b) => {
        buf += b.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
          if (m && onProgress && totalSec > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSec));
        }
      });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')}`))));
    });
  }

  /**
   * Export the kept segments of a recording as a new MP4.
   * mode "precise": frame-accurate, re-encoded (same quality settings as recording).
   * mode "fast": no re-encoding; cuts snap to keyframes.
   * audio: "keep" | "remove"
   */
  async exportVideo({ name, segments, audio = 'keep', mode = 'precise', output }, onProgress) {
    const src = this.info(name);
    if (!src.hasVideo) throw new Error('This file has no video');
    const segs = this.normalizeSegments(segments, src.duration);
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    const keepAudio = audio !== 'remove' && src.hasAudio;
    const base = output ? path.basename(output).replace(/\.mp4$/i, '') : path.basename(src.name).replace(/\.[^.]+$/, '') + '_edit';
    const out = this.uniquePath(this.recorder.outputDir, base, 'mp4');

    if (mode === 'fast') {
      const list = path.join(os.tmpdir(), `recme-concat-${Date.now()}.txt`);
      const esc = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
      fs.writeFileSync(list, segs.map((s) => `file '${esc(src.path)}'\ninpoint ${s.start.toFixed(3)}\noutpoint ${s.end.toFixed(3)}`).join('\n'));
      try {
        await this.run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(keepAudio ? [] : ['-an']), '-movflags', '+faststart', out], total, onProgress);
      } finally {
        fs.rmSync(list, { force: true });
      }
    } else {
      let fc = '';
      segs.forEach((s, i) => {
        fc += `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
        if (keepAudio) fc += `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`;
      });
      fc += segs.map((_, i) => (keepAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('')
        + `concat=n=${segs.length}:v=1:a=${keepAudio ? 1 : 0}[vc]${keepAudio ? '[a]' : ''};[vc]format=yuv420p[v]`;
      const encoder = this.recorder.pickEncoder('auto');
      const args = ['-i', src.path, '-filter_complex', fc, '-map', '[v]'];
      if (keepAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
      args.push(...encoderArgs(encoder, 18), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out);
      await this.run(args, total, onProgress);
    }
    return { file: out, name: path.basename(out), duration_seconds: Math.round(total * 10) / 10, size_bytes: fs.statSync(out).size, mode, audio: keepAudio ? 'kept' : 'removed' };
  }

  /** Waveform picture of the audio track (PNG data URL) for the timeline. */
  async waveform(name, width = 1600, height = 72) {
    const src = this.info(name);
    if (!src.hasAudio) return null;
    const key = `${src.path}|${fs.statSync(src.path).mtimeMs}|${width}x${height}`;
    this.waveCache = this.waveCache || new Map();
    if (this.waveCache.has(key)) return this.waveCache.get(key);
    const png = await new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, ['-hide_banner', '-v', 'error', '-i', src.path, '-filter_complex',
        `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=0x8ab4ff:scale=sqrt`,
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = [];
      p.stdout.on('data', (c) => chunks.push(c));
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('waveform failed'))));
    });
    const url = `data:image/png;base64,${png.toString('base64')}`;
    if (this.waveCache.size > 8) this.waveCache.clear();
    this.waveCache.set(key, url);
    return url;
  }

  /** Save only the audio (optionally just the kept segments) as m4a / mp3 / wav / flac. */
  async extractAudio({ name, segments, format = 'm4a' }, onProgress) {
    const src = this.info(name);
    if (!src.hasAudio) throw new Error('This recording has no audio track (was system sound enabled?)');
    const codec = AUDIO_FORMATS[format];
    if (!codec) throw new Error(`Unknown format ${format}. Use: ${Object.keys(AUDIO_FORMATS).join(', ')}`);
    const segs = this.normalizeSegments(segments, src.duration);
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    const out = this.uniquePath(this.recorder.outputDir, path.basename(src.name).replace(/\.[^.]+$/, '') + '_audio', format);

    let fc = segs.map((s, i) => `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`).join('');
    fc += segs.map((_, i) => `[a${i}]`).join('') + `concat=n=${segs.length}:v=0:a=1[a]`;
    await this.run(['-i', src.path, '-filter_complex', fc, '-map', '[a]', '-vn', ...codec, out], total, onProgress);
    return { file: out, name: path.basename(out), duration_seconds: Math.round(total * 10) / 10, size_bytes: fs.statSync(out).size, format };
  }
}

module.exports = { Editor, AUDIO_FORMATS };
