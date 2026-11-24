'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const R = require('../../cli/render.js');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const { coupler } = require('../mesh-edge-edit/fixture.cjs');

function materials() {
  const pigment = { oxide: 0x797076, 'oxide-edge': 0xa18880, joint: 0x518782, 'joint-edge': 0x66a09a,
    enamel: 0x455d80, 'enamel-edge': 0x58789e, badge: 0xb48b5c };
  return Object.entries(pigment).map(([id, color]) => ({ id, color }));
}

function run(directory) {
  const dir = path.resolve(directory), { KIT, makeBuilder } = ink.load(), api = KIT.meshTopology;
  const source = api.create(coupler(false)), w = 160, h = 112;
  const camera = { target: [0, 0, -.04], dist: 4.7, yaw: -.86, pitch: .33, ortho: true };
  const view = { w, h, camera, materials: materials() };
  const rim = layer => source.edges.filter(edge => edge.vertices.every(vertex => vertex.startsWith(layer + '/')));
  const base = { revision: api.revision(source), settings: { smooth: true, weighting: 'area-angle' },
    edges: rim('front').map(({ id }) => ({ id, smooth: false })),
    corners: [{ id: 'heel-nose/4/c0', normal: [.16, .89, .43] }] };
  const smooth = { id: 'smooth-housing', ...base }, crease = { id: 'keep-collars', ...base,
    edges: [...base.edges.map(row => ({ ...row, crease: 1 })),
      ...rim('heel').map(({ id }) => ({ id, crease: 1 }))] };
  const save = (name, value) => files.json(path.join(dir, name + '.json'), value);
  for (const [name, value] of Object.entries({ 'relay-cage': source, smooth, crease, view })) save(name, value);
  const cli = path.join(__dirname, '../../cli/ink-studio.js');
  function run(name, request, level) {
    const output = execFileSync(process.execPath, [cli, 'mesh-topology', 'shading', 'relay-cage.json',
      ...(request ? [request + '.json', '--out', name + '-cage.json'] : []),
      '--view', 'view.json', '--preview', name, '--subdivision', String(level), '--report', name + '-report.json'],
      { cwd: dir, encoding: 'utf8' });
    return output;
  }
  run('flat', null, 0);
  run('authored', 'smooth', 0);
  run('rounded', 'smooth', 2);
  run('creased', 'crease', 2);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'authored-cage.json'), 'utf8'));
  assert.deepEqual(after.vertices, source.vertices);
  const native = PNG.read(path.join(dir, 'authored/geometric.png'));
  assert.deepEqual(native, PNG.read(path.join(dir, 'flat/geometric.png')));
  const authored = PNG.read(path.join(dir, 'authored/shading.png'));
  assert.notDeepEqual(native, authored);

  const lamps = [{ id: 'key', shape: 'disk', at: [-1.9, 1.9, 2.4], normal: [0,-.45,-1],
    size: [.15,.15], color: '#ffe6ba', intensity: 4, radius: 7, sampleGrid: 1, visible: false, shadows: false }];
  function light(doc) {
    const world = makeBuilder(17, [0x14242e]).finish({
      meshes: [api.toSceneMesh(doc, { materials: view.materials })], radius: 6, dither: 0, cam: camera
    });
    return ink.render(world, { w, h, px: 1, raw: true, areaLights: lamps });
  }
  function picture(name, images, cols) {
    const composed = R.upscale(R.grid(images, cols), 2);
    PNG.write(path.join(dir, name + '.png'), composed.w, composed.h, composed.rgb);
  }
  const image = file => PNG.read(path.join(dir, file));
  picture('comparison', [light(source), native, image('flat/shading.png'), light(api.create(after)), native, authored], 3);
  picture('subdivision', [image('authored/beauty.png'), image('rounded/beauty.png'), image('creased/beauty.png')], 3);
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-shading');
