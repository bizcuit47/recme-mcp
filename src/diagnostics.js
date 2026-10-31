'use strict';

// Builds the text people paste into a bug report. It deliberately leaves out anything private:
// no token, PIN, certificate, device names, file names or folder paths (the user name is masked).

const MASK = (text, home) => {
  let t = String(text == null ? '' : text);
  if (home) t = t.split(home).join('~').split(home.replace(/\\/g, '/')).join('~');
  return t.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, '~').replace(/[A-Za-z]:\/Users\/[^/\s"']+/g, '~');
};

/**
 * @param {object} d  facts collected by the main process (see collectDiagnostics in main.js)
 * @returns {string}  Markdown, wrapped in <details> so it stays short inside a GitHub issue
 */
function buildReport(d) {
  const home = d.home || '';
  const m = (v) => MASK(v, home);
  const yes = (b) => (b ? 'yes' : 'no');
  const rows = [
    ['Recme', `${d.version} (${d.packaged ? 'installed app' : 'run from source'})`],
    ['Electron / Chromium / Node', `${d.electron} / ${d.chromium} / ${d.node}`],
    ['System', `${d.osVersion} ${d.arch}`],
    ['Platform support', `${d.platform}${d.captureSupported ? '' : ' (no screen capture)'}${d.platform === 'darwin' ? ' (macOS support is experimental)' : ''}`],
    ['CPU / RAM', `${d.cpu} / ${d.ramGb} GB`],
    ['GPU', d.gpu.length ? d.gpu.map((g) => `${g.name}${g.driver ? ` (driver ${g.driver})` : ''}${g.active ? ' [active]' : ''}`).join('; ') : 'unknown'],
    ['Displays', d.displays.map((s, i) => `${i + 1}: ${s.width}x${s.height} @${Math.round(s.scale * 100)}%${s.primary ? ' (primary)' : ''}`).join('; ')],
    ['ffmpeg', `${d.ffmpegVersion || 'NOT FOUND'} (${d.ffmpegBundled ? 'bundled' : 'from PATH/other'})`],
    ['Hardware encoders that work', d.hwEncoders.length ? d.hwEncoders.join(', ') : 'none (using libx264)'],
    ['Audio inputs found', String(d.audioInputs)],
    ['Claude connection (MCP)', d.mcpRunning ? `running on port ${d.mcpPort}` : 'NOT running'],
    ['File sharing', `port ${d.share.port}, ${d.share.https ? 'HTTPS' : 'plain HTTP'}, receiving ${yes(d.share.receive)}, PIN ${yes(d.share.hasPin)}, trusted devices ${d.share.trusted}${d.share.error ? `, error: ${m(d.share.error)}` : ''}`],
    ['Hotkey', `${d.hotkey.enabled ? d.hotkey.accelerator : 'off'}${d.hotkey.error ? ` (problem: ${m(d.hotkey.error)})` : ''}`],
    ['Tray / start with Windows', `tray ${yes(d.tray)}, close-to-tray ${yes(d.settings.closeToTray)}, autostart ${yes(d.settings.autostart)}`],
    ['Ask-first prompts', `send ${yes(d.settings.ask.send)}, delete ${yes(d.settings.ask.delete)}, capture ${yes(d.settings.ask.capture)}`],
    ['Last recording settings', d.lastStart ? m(JSON.stringify(d.lastStart)) : 'none yet'],
    ['Saved areas / own sizes', `${d.areasCount} / ${d.sizesCount}`],
    ['Recorder now', `${d.recorder.state}${d.recorder.lastError ? `, last error: ${m(d.recorder.lastError)}` : ''}${d.recorder.warning ? `, warning: ${m(d.recorder.warning)}` : ''}`],
  ];
  const table = ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`)].join('\n');
  const log = (d.logTail || []).map((l) => m(l)).join('\n') || '(empty)';
  return `<details><summary>Recme diagnostics</summary>\n\n${table}\n\nRecent log:\n\n\`\`\`text\n${log}\n\`\`\`\n\n</details>\n`;
}

module.exports = { buildReport, MASK };
