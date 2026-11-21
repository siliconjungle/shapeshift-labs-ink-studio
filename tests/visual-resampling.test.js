const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const kit = ink.load(), K = kit.KIT, P = K.procedural, V = P.visualResampling;
const link = (node, port) => ({ node, ...(port && { port }) });
const spec = (nodes, outputs) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const raster = (data, channels = 1, width = 3, height = 1) => ({ width, height, channels, data });
const plane = value => Array.from(value.data);
const read = ({ artifacts }) => JSON.parse(artifacts.find(artifact => artifact.file === 'sample.json').bytes);

test('portable cropped spans preserve alpha, raw values and auxiliary validity across a tracked gap', () => {
  const fps = { numerator: 30000, denominator: 1001 };
  const rec = V.create({ fps, startFrame: 20, crop: [1, 0, 2, 1], region: 7 });
  const color = raster([11, 12, 13, 120, 31, 32, 33, 137, 51, 52, 53, 219], 4);
  const raw = raster([11.7, -22.5, 99.125]);
  const depth = raster([1, 3.5, 4.25]), motion = raster([-1, 0, -.5, 2.25, 1, 1], 2);
  rec.append(color, { data: raw, depth, motion, depthValid: raster([0, 1, 0]), labels: raster([0, 7, 8]) });
  assert.throws(() => rec.append(color, { labels: raster([7]), motion }), /aligned/);
  rec.append(color, { depth, motion, labels: raster([0, 0, 8]) });
  color.data[7] = 255;
  const source = JSON.parse(JSON.stringify(rec.snapshot()));
  const clip = V.compile(source), clock = K.timeDomains.take({ fps });
  const first = clip.sample(0);
  assert.deepEqual(plane(first.value), [31, 32, 33, 137, 0, 0, 0, 0]);
  assert.deepEqual(plane(first.data), [-22.5, 0]);
  assert.deepEqual(plane(first.depth), [3.5, 0]);
  assert.deepEqual(plane(first.depthValid), [255, 0]);
  assert.deepEqual(plane(first.motion), [-.5, 2.25, 0, 0]);
  assert.deepEqual(plane(first.motionValid), [255, 0]);
  assert.deepEqual(first.info, { localTime: 0, sourceFrame: 20, sourceTime: 20 * 1001 / 30000, origin: [1, 0], region: 7 });
  first.value.data[3] = 0;
  assert.equal(clip.sample(0).value.data[3], 137);
  const gap = clip.sample(clock.at(1).start, {}, clock.at(1));
  assert.deepEqual(plane(gap.value), Array(8).fill(0));
  assert.deepEqual(plane(gap.motionValid), [0, 0]);
  assert.equal(gap.info.sourceFrame, 21);
  assert.equal(clip.sample(0, { reverse: true }).frame, 1);
  assert.equal(clip.sample(clock.at(2).start, { mode: 'loop' }, clock.at(2)).frame, 0);
  assert.throws(() => V.compile({ ...source, frames: [{ ...source.frames[0], motionValid: undefined }] }), /auxiliary/);
  assert.throws(() => V.compile({ ...source, frames: [{ rgba: 'AA==' }] }), /encoded length/);
});

test('graph clip captures a native screen branch with original alpha and retimes its portable file in the CLI', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-sample-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nodes = {
    world: { op: 'scene.diorama', inputs: { definition: { id: 'bench', solids: [
      { id: 'cube', kind: 'box', at: [0, 0, 0], half: [.35, .35, .35], mat: { role: 'stone' }, res: .22 }
    ] } } },
    art: { op: 'raster.canvas', inputs: { width: 1, height: 1, color: [102, 195, 74, 113] } },
    slots: { op: 'data.record', inputs: { signal: link('art') } },
    film: { op: 'scene.render', inputs: { source: link('world'), renderGraphInputs: link('slots'),
      renderGraphCapture: ['signal'], options: { width: 12, height: 8, raw: true, renderGraph: { output: 'scene', passes: [
        { id: 'signal', type: 'composite', isolated: true, layer: { source: { slot: 'signal' }, rect: [1, 2, 6, 4] } }
      ] } }, channels: ['depth'] } }
  };
  const project = spec(nodes, { capture: link('film', 'frame') });
  const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  save('film.json', project);
  save('capture.json', { pass: 'graph:signal', crop: [0, 1, 8, 6] });
  const cli = path.join(__dirname, '../cli/ink-studio.js');
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: dir, encoding: 'utf8' }));
  const report = run('clip', 'film.json', '--output', 'capture', '--from', '1', '--to', '4', '--format', 'sample',
    '--capture-options', 'capture.json', '--fps', '8', '--out', 'recording');
  assert.equal(report.sample.file, 'sample.json');
  assert.equal(report.frames.length, 3);
  const replay = spec({
    sample: { op: 'jsonAsset', inputs: { name: 'recording' } },
    layer: { op: 'anim.visualSample', inputs: { source: link('sample'), options: { rate: .5, phase: .13 } } }
  }, { painting: link('layer'), info: link('layer', 'info') });
  replay.assets = { recording: { format: 'json', file: 'recording/sample.json' } };
  replay.exports = { painting: { output: 'painting', format: 'png' } };
  save('replay.json', replay);
  const shown = run('run', 'replay.json', '--at', '.25', '--out', 'reuse');
  assert.equal(shown.outputs.info.sourceFrame, 3);
  const png = require('../cli/png.js').raster(path.join(dir, 'reuse/artifacts/painting.png'));
  const alpha = [png.data[3], png.data[(2 * 8 + 2) * 4 + 3]];
  assert.deepEqual(alpha, [0, 113]);
});

test('native capture carries real depth and motion and invalidates the previous reference after cuts', () => {
  const A = P.sceneGraph;
  const world = A.world([A.object(A.box(), { id: 'sweep', material: 'iron', resolution: .16 })]);
  const operations = {
    source: { outputs: { value: 'world' }, run: () => ({ value: world }) },
    camera: { outputs: { value: 'record' }, time: true, run(_, { time }) {
      return { value: { yaw: time * 2, pitch: .25, dist: 4, target: [0, 0, 0] } };
    } }
  };
  const graph = ink.createGraphProject(spec({
    scene: { op: 'source' }, camera: { op: 'camera' },
    film: { op: 'scene.render', inputs: { source: link('scene'), camera: link('camera'), channels: ['depth', 'motion', 'normal'],
      options: { width: 32, height: 24, transparent: true, raw: true } } }
  }, { frame: link('film', 'frame'), world: link('scene') }), { kit, operations });
  const clock = { fps: 8, cuts: [{ frame: 2, id: 'next' }] };
  const result = V.compile(read(graph.clip({ output: 'frame', from: 0, to: 4, format: 'sample', clock })));
  const frames = [0, .125, .25, .375].map(time => result.sample(time));
  assert(frames[0].depthValid.data.some(Boolean));
  assert(!frames[0].motionValid.data.some(Boolean));
  assert(frames[1].motionValid.data.some(Boolean));
  assert(frames[1].motion.data.some(n => Math.abs(n) > .2));
  assert(!frames[2].motionValid.data.some(Boolean));
  assert(frames[3].motionValid.data.some(Boolean));
  const raw = V.compile(read(graph.clip({ output: 'world', from: 0, to: 1, format: 'sample',
    capture: { pass: 'normal', motion: false }, renderOptions: { width: 32, height: 24 } }))).sample(0);
  assert.equal(raw.data.channels, 3);
  assert.equal(raw.motion, null);
  assert(raw.data.data.some(n => Math.abs(n) > .1));
});

test('capture follows one moving region through warm-up and supports externally supplied planes', () => {
  const width = 8, height = 3;
  const outputs = { image: link('source'), plane: link('source', 'depth') };
  const operations = { moving: { outputs: { value: 'raster', depth: 'raster' }, time: true, run(_, { time }) {
    const x = Math.round(time * 4), pixels = width * height;
    return { value: raster(Array.from({ length: pixels }, (_, i) => {
      if (i === width + x) return [230, 140, 60, 170];
      if (i === width + 7) return [70, 200, 140, 255];
      return [0, 0, 0, 0];
    }).flat(), 4, width, height), depth: raster(Array(pixels).fill(2.75), 1, width, height) };
  } } };
  const graph = ink.createGraphProject(spec({ source: { op: 'moving' } }, outputs), { kit, operations });
  const settings = { output: 'image', from: 1, to: 4, warmup: 1, format: 'sample', clock: { fps: 4 },
    capture: { region: 1, depth: 'plane' } };
  const clip = V.compile(read(graph.clip(settings)));
  for (let f = 0; f < 3; f++) {
    const { value, depthValid, depth, info } = clip.sample(f / 4);
    assert.equal(value.data[(width + f + 1) * 4 + 3], 170);
    assert.equal(value.data[(width + 7) * 4 + 3], 0);
    assert.equal(depth.data[width + f + 1], 2.75);
    assert.equal(depthValid.data[width + 7], 0);
    assert.equal(info.region, 1);
  }
  assert.throws(() => graph.clip({ ...settings, capture: { depth: true } }), /Missing aligned native depth/);
});

test('linear pass capture retains the numeric color space and makes a display preview', () => {
  const graph = ink.createGraphProject(spec({
    source: { op: 'color.rasterToLinear', inputs: { source: raster([80, 120, 240, 128], 4, 1) } }
  }, { value: link('source') }), { kit });
  const { value, data } = V.compile(read(graph.clip({ output: 'value', to: 1, format: 'sample' }))).sample(0);
  assert.equal(data.colorSpace, 'srgb-linear');
  assert.deepEqual(plane(value), [80, 120, 240, 128]);
  assert(data.data[2] > data.data[0]);
});
