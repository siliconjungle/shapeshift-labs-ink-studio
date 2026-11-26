const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Ink = require('..');
const PNG = require('../cli/png.js');
const { document } = require('../cli/glb-file.js');
const { housing } = require('../examples/linked-material-preview/panels.cjs');

const embedded = rgb => ({
  encoding: 'png', base64: PNG.encode(3, 3, new Uint8Array(Array(9).fill(rgb).flat()), 3).toString('base64')
});
const left = [195, 60, 34], right = [27, 137, 186];
const graph = { format: 'ink-studio/graph-project', version: 1,
  inputs: { tile: { type: 'vec2', default: [0, 0] } },
  assets: { tile: { format: 'bitmap', tiles: [
    { udim: 1001, source: embedded(left) }, { udim: 1002, source: embedded(right) }
  ] } },
  nodes: { pigment: { op: 'bitmapAsset', inputs: { name: 'tile', tile: { input: 'tile' } } } },
  outputs: { pigment: { node: 'pigment', port: 'value' } },
  outputUsages: {
    pigment: { usage: 'baseColor', label: 'Pigment', order: 0, source: { output: 'pigment' },
      format: { format: 'png', bitDepth: 8 }, export: false }
  } };

function spec(targets, slots) {
  return { format: 'ink-studio/linked-material-preview', version: 1, label: 'Test preview', targets, slots,
    view: { width: 128, height: 96, steps: 1 } };
}
function decode(view) { return PNG.raster(Buffer.from(view.pick.split(',')[1], 'base64')); }
function sample(hits, x, y) {
  const at = (y * hits.w + x * 2) * 4, d = hits.data;
  return { index: d[at] - 1, uv: [(256 * d[at + 1] + d[at + 2]) / 65535, (256 * d[at + 4] + d[at + 5]) / 65535] };
}

test('a plane crossing the tile seam links exact native hits to both distinct bitmap evaluations', async () => {
  const project = Ink.createGraphProject(graph);
  const plan = spec([{ id: 'plane', kind: 'plane', slot: 'coat', uvGrid: [2, 1] }],
    { coat: { maps: { baseColor: { map: 'pigment' } }, tileInput: 'tile', tiles: [1001, 1002] } });
  const { data, files } = await Ink.createLinkedMaterialPreview(project, plan);
  const carrier = data.targets[0], [a, b] = carrier.regions, view = carrier.views[0];
  assert.deepEqual(carrier.regions.map(({ tile }) => tile), ['1001', '1002']);
  const leftMap = PNG.raster(files.get(a.maps[0].image)), rightMap = PNG.raster(files.get(b.maps[0].image));
  assert.deepEqual(Array.from(leftMap.data.subarray(0, 3)), left);
  assert.deepEqual(Array.from(rightMap.data.subarray(0, 3)), right);
  const hit = decode(view);
  const l = sample(hit, 43, 47), r = sample(hit, 85, 47);
  assert.equal(l.index, a.index);
  assert.equal(r.index, b.index);
  assert(Math.abs(l.uv[1] - .5) < .03 && Math.abs(r.uv[1] - .5) < .03);
  assert(l.uv[0] > .4 && l.uv[0] < .8 && r.uv[0] > .25 && r.uv[0] < .6);
  const nearTiles = Array.from({ length: 16 }, (_, i) => sample(hit, 56 + i, 47)).filter(row => row.index >= 0);
  const seam = nearTiles.findIndex(row => row.index === b.index);
  assert(nearTiles[seam - 1].uv[0] > .95 && nearTiles[seam].uv[0] < .05, 'tile seam should retain continuous geometry and reset local U');
});

test('imported meshes preserve slots, signed/vertical tiles, normals and Ink topology carriers', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-linked-preview-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'signed.obj'), [
    'v -1 -1 0', 'v 1 -1 0', 'v 1 1 0', 'v -1 1 0',
    'vt -1 1', 'vt 1 1', 'vt 1 2', 'vt -1 2', 'vn 0 0 1', 'usemtl coat',
    'f 1/1/1 2/2/1 3/3/1 4/4/1'
  ].join('\n'));
  const glb = document();
  glb.gltf.materials = [{ name: 'coat' }];
  glb.gltf.meshes = [{ primitives: [{
    attributes: {
      POSITION: glb.accessor(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0), 'VEC3', { bounds: true, target: 34962 }),
      TEXCOORD_0: glb.accessor(Float32Array.of(0, 1, 1, 1, 1, 0), 'VEC2', { target: 34962 }),
      NORMAL: glb.accessor(Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), 'VEC3', { target: 34962 })
    }, material: 0
  }] }];
  glb.gltf.nodes = [{ mesh: 0, scale: [1, 1, 2] }];
  glb.gltf.scenes[0].nodes = [0];
  fs.writeFileSync(path.join(directory, 'chart.glb'), glb.finish());
  fs.writeFileSync(path.join(directory, 'ink.json'), JSON.stringify(housing({ tiled: false })));
  const plan = spec([
    { id: 'sphere', kind: 'sphere', slot: 'coat' }, { id: 'cube', kind: 'cube', slot: 'coat' },
    { id: 'signed', kind: 'mesh', file: 'signed.obj' }, { id: 'gltf', kind: 'mesh', file: 'chart.glb' },
    { id: 'retained', kind: 'ink', file: 'ink.json' }
  ], { coat: { output: 'pigment', tiles: [[-1, 1], [0, 1], 1001] }, Enamel: { output: 'pigment' } });
  const source = path.join(directory, 'project.json'), planFile = path.join(directory, 'plan.json'), output = path.join(directory, 'preview');
  fs.writeFileSync(source, JSON.stringify(graph));
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const report = JSON.parse(execFileSync(process.execPath, [cli, 'graph', 'material-preview', source, planFile,
    '--out', output, '--json'], { encoding: 'utf8' }));
  assert(fs.existsSync(report.file));
  assert.deepEqual(report.targets.map(row => row.kind), ['sphere', 'cube', 'mesh', 'mesh', 'ink']);
  const imported = report.targets[2], retained = report.targets[4];
  assert.deepEqual(imported.regions.map(row => row.uv), [[-1, 1], [0, 1]]);
  assert(imported.views[0].pixels.every(n => n > 0));
  assert(report.targets[3].views[0].pixels[0] > 0);
  assert(retained.regions.some(row => row.slot === 'Bronze' && !row.maps.length));
  assert(retained.regions.some(row => row.slot === 'Enamel' && row.maps.length));
  assert(!Object.hasOwn(report.targets[0].views[0], 'pick'));
  assert(fs.readFileSync(path.join(output, 'data.js'), 'utf8').includes('data:image/png;base64,'));
});
