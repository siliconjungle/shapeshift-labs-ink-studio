const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ink = require('..');

const CLI = path.resolve(__dirname, '../cli/ink-studio.js');
const kit = ink.load(), convert = kit.KIT.procedural.conversions;
const link = (node, port = 'value') => ({ node, port });
const op = (name, inputs) => ({ op: name, inputs });
const graph = (nodes, outputs = {}) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const project = (nodes, outputs) => ink.createGraphProject(graph(nodes, outputs));
const near = (actual, expected, tolerance = 1e-9) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert(Math.abs(actual[i] - expected[i]) < tolerance, `${actual[i]} differs from ${expected[i]}`);
};

test('pixel edges, texel centers and offscreen UVs invert without an implicit flip', () => {
  const size = { width: 120, height: 80 };
  assert.deepEqual(convert.pixelToUV([.5, .5], size), [.5 / 120, .5 / 80]);
  assert.deepEqual(convert.uvToPixel([1, 1], size), [120, 80]);
  assert.deepEqual(convert.uvToPixel([-.5, 1.5], size), [-60, 120]);
  const spec = project({
    uv: op('coord.pixelToUV', { point: [13.5, 20.5], ...size }),
    pixel: op('coord.uvToPixel', { point: link('uv'), ...size })
  }, { pixel: link('pixel') });
  near(spec.run().outputs.pixel, [13.5, 20.5]);
  assert.throws(() => convert.pixelToUV([0, 0], { width: 0, height: 2 }), /positive integer pixel count/);
});

test('project and unproject match raster pixel centers and axial depth in both projections', () => {
  for (const projection of ['orthographic', 'perspective']) {
    const workspace = project({
      field: op('sdf.shape', { kind: 'sphere' }),
      render: op('sdf.render', { source: link('field'), camera: { projection, yaw: .3, pitch: .15, composition: [.59, .44] },
        options: { width: 52, height: 36, shadows: false } }),
      grid: op('coord.renderGrid', { report: link('render', 'report') }),
      eye: op('coord.project', { point: [.2, .3, .2], grid: link('grid') }),
      back: op('coord.unproject', { point: link('eye'), depth: link('eye', 'depth'), grid: link('grid') })
    }, { frame: link('render', 'frame'), grid: link('grid'), position: link('back') });
    const { frame, grid, position } = workspace.run().outputs;
    near(position, [.2, .3, .2]);
    assert.equal(grid.ortho, projection === 'orthographic');
    assert.deepEqual([grid.width, grid.height], [52, 36]);
    const index = frame.passes.depth.findIndex(Number.isFinite);
    assert(index >= 0);
    const pixel = [index % grid.width + .5, Math.floor(index / grid.width) + .5];
    const world = [...frame.passes.position.slice(index * 3, index * 3 + 3)];
    const result = convert.project(world, grid);
    near(result.value, pixel, 1e-5);
    near(convert.unproject(pixel, frame.passes.depth[index], grid), world, 1e-5);
    assert.equal(result.visible, true);
  }

  const grid = convert.cameraGrid({ dist: 4 }, { width: 64, height: 48 });
  assert.throws(() => convert.project([0, 0, 5], grid), /behind the camera plane/);
  assert.equal(convert.project([8, 0, 0], grid).visible, false);
});

test('fractional frame rates preserve frame boundaries and expose signed rounding', () => {
  const fps = { numerator: 30000, denominator: 1001 };
  for (const frame of [-29, 0, 1, 30, 149, 5357]) {
    const seconds = convert.toSeconds(frame, fps);
    for (const round of ['floor', 'ceil', 'nearest', 'exact'])
      assert.equal(convert.toFrames(seconds, fps, round), frame);
  }
  assert.equal(convert.toSeconds(30, fps), 1.001);
  assert.equal(convert.toFrames(-.125, 12, 'floor'), -2);
  assert.equal(convert.toFrames(-.125, 12, 'ceil'), -1);
  assert.equal(convert.toFrames(-.125, 12, 'nearest'), -1);
  assert.throws(() => convert.toFrames(.02, 24, 'exact'), /between frames/);
  assert.throws(() => convert.toSeconds(1.2, 24), /integer frame index/);
  assert.throws(() => convert.toSeconds(12, 0), /frame rate/);
});

test('RGB transfer curves preserve alpha and round-trip byte RGBA at PNG export', () => {
  near(convert.toLinear([.5, .5, .5, .25]), [.21404114048223255, .21404114048223255, .21404114048223255, .25]);
  near(convert.toDisplay([.21404114048223255, .21404114048223255, .21404114048223255, .25]), [.5, .5, .5, .25]);
  assert.deepEqual(convert.toRGB8(convert.fromRGB8([20, 128, 205, 47])), [20, 128, 205, 47]);
  near(convert.toDisplay([-.1, .5, 2]), [0, .7353569830524495, 1]);
  assert.throws(() => convert.toDisplay([-.1, .5, 2], 'error'), /outside/);
  const body = graph({
    source: op('raster.canvas', { width: 2, height: 1, color: [128, 20, 230, 64] }),
    linear: op('color.rasterToLinear', { source: link('source') }),
    display: op('color.rasterToDisplay', { source: link('linear') })
  }, { source: link('source'), linear: link('linear'), display: link('display') });
  body.exports = { original: { output: 'source', format: 'png' }, converted: { output: 'display', format: 'png' } };
  const runner = ink.createGraphProject(body), run = runner.run();
  assert(run.outputs.linear.data instanceof Float32Array);
  near([...run.outputs.linear.data.slice(0, 4)], [.2158605001, .0069954102, .7912979403, 64 / 255], 1e-6);
  assert.deepEqual(run.outputs.display.data, run.outputs.source.data);
  assert.deepEqual(run.artifacts[0].bytes, run.artifacts[1].bytes);
  const inspect = runner.inspect({ output: 'linear' });
  assert.equal(inspect.artifacts[0].format, 'json');
  assert.equal(inspect.report.value.colorSpace, 'srgb-linear');
  assert.equal(runner.clip({ output: 'display', from: 0, to: 1 }).report.frames.length, 1);
  assert.throws(() => runner.clip({ output: 'linear', from: 0, to: 1 }), /needs display RGB/);
  body.exports.invalid = { output: 'linear', format: 'png' };
  assert.throws(() => ink.createGraphProject(body), /image export invalid needs display RGB.*color.rasterToDisplay/);
});

test('bad links identify the source, destination, units and available conversion', t => {
  const pixels = graph({
    source: op('coord.uvToPixel', { point: [.5, .5], width: 64, height: 64 }),
    field: op('proc.noise', {}), sample: op('materialSample', { uv: link('source'), source: link('field') })
  });
  assert.throws(() => ink.createGraphProject(pixels),
    /sample\.uv: source\.value provides top-left pixel coordinates, expected normalized top-left UV coordinates.*coord.pixelToUV/);
  assert.throws(() => project({ time: op('time', {}), bad: op('time.toSeconds', { frame: link('time'), fps: 24 }) }),
    /bad\.frame.*seconds.*integer frame index.*time.toFrames/);
  assert.throws(() => project({ linear: op('color.toLinear', { source: [.5, .5, .5] }),
    canvas: op('raster.canvas', { width: 1, height: 1, color: link('linear') }) }),
  /canvas\.color.*linear sRGB.*byte levels.*color.toDisplay, then color.toRGB8/);
  assert.throws(() => project({ color: op('color.toLinear', { source: [128, 128, 128] }) }),
    /color\.source.*expected display sRGB/);
  assert.throws(() => project({ canvas: op('raster.canvas', { width: 1, height: 1 }),
    wrong: op('color.rasterToDisplay', { source: link('canvas') }) }),
  /wrong\.source.*display RGB.*linear RGB.*color.rasterToLinear/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-convert-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'invalid.json');
  fs.writeFileSync(file, JSON.stringify(pixels));
  const result = spawnSync(process.execPath, [CLI, 'graph', 'validate', file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sample\.uv.*source\.value.*coord.pixelToUV/);
});
