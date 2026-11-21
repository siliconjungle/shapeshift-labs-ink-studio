const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');

const kit = ink.load(), fps = { numerator: 30000, denominator: 1001 };
const clock = { fps, cuts: [{ frame: 2, id: 'close' }] };
const graph = (nodes, outputs) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const pixel = (r, x = 0, y = 0) => Array.from(r.data.slice((y * r.w + x) * 4, (y * r.w + x + 1) * 4));
const frame = (r, g, b, a) => ({ width: 1, height: 1, channels: 4, data: [r, g, b, a] });
const clear = frame(0, 0, 0, 0);
const feedbackProject = graph({
  echo: { op: 'anim.feedback', params: {
    frames: [frame(255, 0, 0, 255), clear, clear, frame(0, 255, 0, 255), clear],
    options: { fps: 30000 / 1001, dt: 1001 / 30000, halfLife: 1 }
  } }
}, { echo: { node: 'echo' }, checkpoint: { node: 'echo', port: 'checkpoint' } });

function chunks(bytes) {
  const rows = [];
  for (let i = 8; i < bytes.length;) {
    const size = bytes.readUInt32BE(i), name = bytes.toString('ascii', i + 4, i + 8);
    rows.push([name, bytes.subarray(i + 8, i + 8 + size)]);
    i += size + 12;
  }
  return rows;
}

test('numbered frames and a native fractional APNG share pixels through warm-up and a cut', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-graph-clip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  save('echo.json', feedbackProject);
  save('take.json', { format: 'ink-studio/take', version: 1, clock });
  const run = (...flags) => spawnSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'),
    'graph', 'clip', 'echo.json', '--output', 'echo', '--from', '1', '--to', '5', ...flags],
  { cwd: dir, encoding: 'utf8' });
  const result = run('--clock', 'take.json', '--warmup', '1', '--out', 'review');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'review/report.json'))), report);
  assert.deepEqual(report.warmup, { from: 0, count: 1 });
  assert.deepEqual(report.cuts, clock.cuts);
  assert.deepEqual(report.fps, fps);
  assert.deepEqual(report.frames.map(row => [row.frame, row.tick]), [[1, 2], [2, 4], [3, 6], [4, 8]]);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'review/frames')), report.frames.map(row => path.basename(row.file)));
  const images = report.frames.map(row => fs.readFileSync(path.join(dir, 'review', row.file)));
  const colors = images.map(bytes => pixel(PNG.raster(bytes)));
  assert.deepEqual(colors, [[255, 0, 0, 249], [0, 0, 0, 0], [0, 255, 0, 255], [0, 255, 0, 249]]);
  const animation = chunks(fs.readFileSync(path.join(dir, 'review', report.animation.file)));
  assert.equal(animation.find(([name]) => name === 'acTL')[1].readUInt32BE(0), 4);
  assert.deepEqual(animation.filter(([name]) => name === 'fcTL').map(([, data]) => [
    data.readUInt16BE(20), data.readUInt16BE(22)
  ]), Array(4).fill([1001, 30000]));
  const animatedPixels = animation.filter(([name]) => ['IDAT', 'fdAT'].includes(name))
    .map(([name, data]) => inflateSync(name === 'fdAT' ? data.subarray(4) : data));
  assert.deepEqual(animatedPixels, images.map(bytes => inflateSync(chunks(bytes).find(([name]) => name === 'IDAT')[1])));

  const cold = run('--clock', 'take.json', '--format', 'frames', '--out', 'cold');
  assert.equal(cold.status, 0, cold.stderr);
  assert.deepEqual(pixel(PNG.raster(path.join(dir, 'cold/frames/frame-000001.png'))), [0, 0, 0, 0]);
  assert.equal(fs.existsSync(path.join(dir, 'cold/clip.png')), false);
  const apng = run('--clock', 'take.json', '--format', 'apng', '--out', 'only-apng');
  assert.equal(apng.status, 0, apng.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'only-apng/frames')), false);
  const unsafe = run('--fps', '65536/2201', '--out', 'invalid-rate');
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /16-bit/);
  assert.equal(fs.existsSync(path.join(dir, 'invalid-rate')), false);
});

test('scene and scene.render outputs preserve screen feedback across rebuilt worlds and reset on a cut', () => {
  const scene = { type: 'world' };
  const operation = { time: true, outputs: { value: scene }, run() {
    const world = kit.makeBuilder(5, [0]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
    world.look = { renderGraph: { passes: [{ id: 'echo', type: 'feedback', halfLife: 1,
      layer: { resolution: [8, 6], source({ time }) {
        const rgba = new Uint8Array(8 * 6 * 4);
        if (time === 0) rgba.set([255, 0, 0, 255], (2 * 8 + 1) * 4);
        return { w: 8, h: 6, rgba };
      } } }] } };
    return { value: world };
  } };
  const output = { width: 8, height: 6, raw: true };
  const project = ink.createGraphProject(graph({ scene: { op: 'fixture' }, film: { op: 'scene.render',
    inputs: { source: { node: 'scene' }, options: output, channels: [] } }
  }, { world: { node: 'scene' }, film: { node: 'film' }, rendered: { node: 'film', port: 'frame' } }),
  { kit, operations: { fixture: operation } });
  for (const name of ['world', 'film', 'rendered']) {
    const result = project.clip({ output: name, from: 1, to: 3, warmup: 1, format: 'frames', renderOptions: output,
      clock: { fps: 1, cuts: [{ frame: 2, id: 'new-cue' }] } });
    assert.deepEqual(result.artifacts.map(item => pixel(PNG.raster(item.bytes), 1, 2)),
      [[127, 0, 0, 255], [0, 0, 0, 255]]);
  }
  assert.deepEqual(pixel(PNG.raster(PNG.encode(8, 6, project.run({ time: 1 }).outputs.film.data, 4)), 1, 2), [0, 0, 0, 255]);
});

test('numbered clips accept changing dimensions and check only emitted frames', () => {
  const project = ink.createGraphProject({ ...graph({
    canvas: { op: 'fixture' }
  }, { image: { node: 'canvas' }, width: { node: 'canvas', port: 'width' } }),
  assertions: [{ id: 'visible', output: 'width', op: 'min', value: 2 }] },
  { operations: { fixture: { time: true, outputs: { value: 'raster', width: 'number' }, run(_, { take }) {
    const width = take.frame + 1;
    return { width, value: { width, height: 1, data: Array(width).fill(128) } };
  } } } });
  const selection = { output: 'image', from: 1, to: 3, warmup: 8 };
  const result = project.clip({ ...selection, format: 'frames' });
  assert.equal(result.report.passed, true);
  assert.deepEqual(result.report.warmup, { from: 0, count: 1 });
  assert.deepEqual(result.report.frames.map(row => row.width), [2, 3]);
  assert.deepEqual(pixel(PNG.raster(result.artifacts[0].bytes)), [128, 128, 128, 255]);
  assert.throws(() => project.clip(selection), /same dimensions/);
});

test('feedback inside mapped reusable groups keeps a separate history per item', () => {
  const project = ink.createGraphProject({
    ...graph({
      rows: { op: 'array.map', group: 'trail', params: { items: [
        [frame(255, 0, 0, 255), clear, clear], [frame(0, 255, 0, 255), clear, clear]
      ] } },
      merged: { op: 'fixture', inputs: { images: { node: 'rows' } } }
    }, { image: { node: 'merged' } }),
    groups: {
      trail: { inputs: { item: 'array<raster>' },
        nodes: { echo: { op: 'anim.feedback', inputs: { frames: { input: 'item' } },
          params: { options: { dt: 1 / 24, fps: 24, halfLife: 1 } } } }, outputs: { value: { node: 'echo' } } }
    }
  }, { operations: { fixture: { inputs: { images: 'array<raster>' }, outputs: { value: 'raster' }, run({ images }) {
    return { value: { width: 2, height: 1, channels: 4, data: images.flatMap(image => Array.from(image.data)) } };
  } } } });
  const result = project.clip({ output: 'image', from: 1, to: 3, warmup: 1, format: 'frames',
    clock: { cuts: [{ frame: 2, id: 'cut' }] } });
  const [warm, cut] = result.artifacts.map(item => PNG.raster(item.bytes));
  assert.deepEqual(pixel(warm, 0, 0), [255, 0, 0, 247]);
  assert.deepEqual(pixel(warm, 1, 0), [0, 255, 0, 247]);
  assert.deepEqual(pixel(cut, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(cut, 1, 0), [0, 0, 0, 0]);
});
