// Headless checks for the recme CLI's argument handling (no app needed).
'use strict';
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { parseArgs, segmentsFrom, sourceFrom } = require('../src/cli');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS: ${name}`); };
const BOOL = new Set(['mute', 'cursor', 'scan', 'json']);

ok('flags with values, booleans and positionals', () => {
  const r = parseArgs(['clip.mp4', '--keep', '0-5,12-30', '--mute', '--mb=25'], BOOL);
  assert.deepStrictEqual(r.pos, ['clip.mp4']);
  assert.strictEqual(r.opt.keep, '0-5,12-30');
  assert.strictEqual(r.opt.mute, true);
  assert.strictEqual(r.opt.mb, '25');
});
ok('boolean flag does not swallow the next positional', () => {
  const r = parseArgs(['--mute', 'clip.mp4'], BOOL);
  assert.deepStrictEqual(r.pos, ['clip.mp4']);
});
ok('segments parse in order', () => {
  assert.deepStrictEqual(segmentsFrom('12-30, 0-5.5'), [{ start: 12, end: 30 }, { start: 0, end: 5.5 }]);
});
ok('bad segments are rejected', () => {
  assert.throws(() => segmentsFrom('abc'), /Bad piece/);
  assert.throws(() => segmentsFrom(true), /--keep needs/);
});
ok('source flags', () => {
  assert.deepStrictEqual(sourceFrom({ display: '1' }), { type: 'display', index: 1 });
  assert.deepStrictEqual(sourceFrom({ region: '10,20,300,200' }), { type: 'region', x: 10, y: 20, width: 300, height: 200 });
  assert.deepStrictEqual(sourceFrom({ area: 'game' }), { type: 'area', name: 'game' });
  assert.deepStrictEqual(sourceFrom({ 'window-area': 'Unity' }), { type: 'window_area', title: 'Unity' });
  assert.strictEqual(sourceFrom({}), undefined);
  assert.throws(() => sourceFrom({ region: '1,2,3' }), /--region needs/);
});

const run = (args, env = {}) => spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

ok('help works without the app', () => {
  const r = run(['help']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /recme - control the running Recme app/);
});
ok('unknown command exits 2', () => {
  assert.strictEqual(run(['nope']).status, 2);
});
ok('missing argument prints usage', () => {
  const r = run(['trim'], { RECME_URL: 'http://127.0.0.1:9/mcp', RECME_TOKEN: 'x' });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /Usage: recme trim/);
});
ok('app not running gives a friendly error', () => {
  const r = run(['status'], { RECME_URL: 'http://127.0.0.1:9/mcp', RECME_TOKEN: 'x' });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /Is the app running/);
});

console.log(`\nALL ${n} CLI CHECKS PASSED`);
