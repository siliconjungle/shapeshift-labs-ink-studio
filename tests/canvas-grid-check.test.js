const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { measure, trackEdge } = require('../cli/canvas-grid-metrics.js');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const chrome = process.env.INK_TEST_CHROME;
const exec = promisify(execFile);
const line = (...values) => ({ w: values.length, h: 1, rgb: Uint8Array.from(values.flatMap(v => [v, v, v])) });

test('pixel rulers isolate complete cells and detect colors mixed by the compositor', () => {
  const probe = { id: 'ruler', kind: 'ruler', axis: 'x', start: [0, 0], length: 5 };
  const native = line(0, 255, 0, 255, 0);
  const area = { origin: [0, 0], scale: [2, 1] };

  const clean = measure(native, line(0, 0, 255, 255, 0, 0, 255, 255, 0, 0), area, probe);
  assert.deepEqual(clean.widths, [2]);
  assert.deepEqual(clean.flags, []);
  const smeared = measure(native, line(0, 0, 100, 255, 255, 0, 255, 255, 0, 0), area, probe);
  assert.deepEqual(smeared.widths, [1, 2]);
  assert.equal(smeared.mixed, 1);
  assert.deepEqual(smeared.flags, ['ruler-mixed-colors', 'uneven-cell-widths']);
  const merged = measure(native, line(0, 0, 0, 0, 0, 0, 255, 255, 0, 0), area, probe);
  assert.deepEqual(merged.flags, ['ruler-cells-lost-or-split']);
});

test('the same native advance flags variable displayed stride and motion on a native hold', () => {
  const state = { advances: 0, strides: {} };
  const samples = [[4, 12], [5, 17], [6, 23], [6, 24]].map(([native, device]) => ({ native, device, flags: [] }));
  samples.forEach(sample => trackEdge(sample, state, 5.5));
  assert.deepEqual(state.strides, { 1: { 5: 1, 6: 1 } });
  assert.deepEqual(samples.map(sample => sample.flags), [[], [], ['uneven-edge-stride'], ['edge-moves-on-native-hold']]);
});

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-canvas-check-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Chrome captures the composed Ink canvas and flags unequal cells and pan steps at fractional scale',
  { skip: !chrome }, async t => {
    const cwd = temp(t);
    fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({ cases: [
      { width: 416, height: 380, dpr: 1 },
      { width: 443, height: 380, dpr: 1.25 }
    ], frames: 9 }));
    await assert.rejects(exec(process.execPath, [cli, 'canvas-grid-check', 'plan.json',
      '--out', 'out', '--fail-on-flags'], { cwd, timeout: 30000 }), error => {
      assert.equal(error.code, 2, error.stderr);
      assert.match(error.stdout, /416×380 at DPR 1 clean/);
      assert.match(error.stdout, /uneven-cell-widths, uneven-edge-stride/);
      return true;
    });
    const at = file => path.join(cwd, 'out', file);
    const report = JSON.parse(fs.readFileSync(at('report.json'), 'utf8'));
    const [integer, fractional] = report.cases;
    assert.deepEqual(integer.flags, []);
    assert.deepEqual(integer.frames[0].samples[0].widths, [4]);
    assert.equal(integer.frames[0].imageRendering, 'pixelated');
    for (const sample of fractional.frames[0].samples.slice(0, 2))
      assert.deepEqual(sample.widths, [5, 6]);
    assert.deepEqual(Object.keys(fractional.edgeStrides['leading edge']['1']), ['5', '6']);
    const { edge, beforeEdge } = fractional.evidence;
    assert.equal(beforeEdge.frame, edge.frame - 1);
    const composed = PNG.layout(at(edge.composited)), reference = PNG.layout(at(edge.native));
    assert.deepEqual([composed.w, composed.h], [554, 475]);
    assert.deepEqual([reference.w, reference.h], [96, 64]);
    const raster = PNG.read(at(edge.native));
    assert.notDeepEqual(raster.rgb, PNG.read(at(beforeEdge.native)).rgb);
  });

test('a project fixture keeps its own CSS and opaque native readbacks',
  { skip: !chrome }, async t => {
    const cwd = temp(t);
    fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({
      page: 'picture.html', cases: [{ width: 240, height: 160, dpr: 1.5 }], frames: 7
    }));
    fs.writeFileSync(path.join(cwd, 'picture.html'), `<!doctype html>
<style>canvas{width:128px;height:80px;image-rendering:auto}</style>
<canvas width="24" height="15"></canvas>
<script>
const canvas = document.querySelector('canvas'), context = canvas.getContext('2d', { alpha: false });
globalThis.inkCanvasGrid = {
  canvas,
  probes: [
    { id: 'custom ruler', kind: 'ruler', axis: 'x', start: [2, 3], length: 18 },
    { id: 'custom edge', kind: 'edge', axis: 'x', start: [2, 10], length: 18 }
  ],
  draw({ pan }) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 24, 15);
    context.fillStyle = '#fff';
    for (let x = 3; x < 20; x += 2) context.fillRect(x, 1, 1, 5);
    context.fillRect(8 + Math.round(pan), 7, 24, 7);
    const { data } = context.getImageData(0, 0, 24, 15);
    return data.filter((_, i) => i % 4 < 3);
  }
};
</script>`);
    await exec(process.execPath, [cli, 'canvas-grid-check', 'plan.json', '--out', 'out'], { cwd, timeout: 30000 });
    const { cases: [result] } = JSON.parse(fs.readFileSync(path.join(cwd, 'out/report.json'), 'utf8'));
    assert.equal(result.frames[0].imageRendering, 'auto');
    assert.deepEqual(result.native, { width: 24, height: 15 });
    assert(result.flags.some(flag => flag.probe === 'custom ruler' && flag.kind === 'ruler-mixed-colors'));
    assert(result.flags.some(flag => flag.probe === 'custom edge' && flag.kind === 'edge-mixed-colors'));
  });
