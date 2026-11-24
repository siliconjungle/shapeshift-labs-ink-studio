'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const R = require('../../cli/render.js');
const files = require('../../cli/asset-files.js');
const sample = require('./fixture.cjs');

function dial() {
  const width = 52, height = 32, pixels = new Uint8Array(width * height * 4);
  const glyphs = ['1110111', '0010101', '1110101', '1000101', '1110111'];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, width - x - 1, y, height - y - 1);
    const mark = glyphs[y - 6]?.[x - 22] === '1';
    const display = x > 4 && x < 47 && y >= 14 && y <= 23;
    const tick = y === 25 && x > 6 && x < 45 && (x + 1) % 4 === 0;
    const bar = display && x >= 8 && x <= 34 && (x - 8) % 4 < 3 && y >= 17 && y <= 20;
    const border = y === 13 && x > 4 && x < 47;
    const color = mark ? [232, 225, 161] : bar && x >= 31 ? [232, 168, 94] : bar ? [118, 195, 153] :
      tick || border ? [63, 124, 117] : display || edge === 0 ? [16, 33, 39] : edge === 1 ? [80, 139, 125] : [32, 72, 75];
    pixels.set([...color, 255], (y * width + x) * 4);
  }
  return { width, height, pixels };
}

function trim() {
  const width = 48, height = 8, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = y === 1 ? [225, 172, 102] : y === 7 ? [103, 64, 51] :
      y > 2 && y < 6 && x % 8 === 3 ? [234, 188, 119] : [169, 110, 70];
    pixels.set([...color, 255], (y * width + x) * 4);
  }
  return { width, height, pixels };
}

const colors = { case: 0x425f6a, cavity: 0x20343b, strap: 0x83a7a4, paint: 0x42978c,
  index: 0xe7cb86, well: 0x916047, lining: 0x456677 };
const materials = Object.entries(colors).map(([id, color]) => ({ id, color })).concat(
  { id: 'trim', color: 0xffffff, texture: trim() }, { id: 'dial', color: 0xffffff, texture: dial() });

function run(directory) {
  const dir = path.resolve(directory), { KIT, makeBuilder } = ink.load(), api = KIT.meshTopology;
  const collar = api.create(sample.collar()), meter = api.create(sample.meter()), canopy = api.create(sample.canopy());
  const examples = [];
  function edit(name, source, kind, distance, ids, styles) {
    const request = sample.request(api, source, name, kind, distance, ids, styles);
    const plan = api.planFaceRegion(source, request);
    examples.push({ name, source, request, plan });
    assert.equal(plan.report.canCommit, name !== 'thin-wall', JSON.stringify(plan.report.issues));
    return plan.document;
  }
  const raised = edit('raise-collar', collar, 'extrude', .34,
    collar.faces.filter(face => face.id.startsWith('rim/')).map(face => face.id),
    { rim: { material: 'trim', uv: 'strip' } });
  const framed = edit('inset-dial', meter, 'inset', .21, ['gauge'], { rim: { material: 'trim', uv: 'per-edge' } });
  const well = { minWall: .18, rim: { material: 'well', uv: 'strip' } };
  const recessed = edit('recess-dial', framed, 'extrude', -.38, ['gauge'], well);
  edit('thin-wall', framed, 'extrude', -.76, ['gauge'], well);
  const shell = edit('thicken-hood', canopy, 'thicken', .25, canopy.faces.map(face => face.id),
    { minWall: .16, rim: { material: 'trim', uv: 'strip' }, interior: { material: 'lining', uv: 'planar' } });

  function stage(doc, camera) {
    const meshes = [api.toSceneMesh(doc, { materials })];
    const world = makeBuilder(42, [0x13242d]).finish({ meshes, dither: 0, radius: 6,
      cam: { target: [0, 0, 0], dist: 4.65, ortho: true, ...camera } });
    return ink.render(world, { w: 148, h: 118, px: 1, raw: true });
  }
  const rotor = { yaw: -.37, pitch: .45 }, panel = { yaw: -.27, pitch: .31 };
  const hood = { yaw: -.40, pitch: -.27 };
  const images = [stage(collar, rotor), stage(framed, panel), stage(canopy, hood),
    stage(raised, rotor), stage(recessed, panel), stage(shell, hood)];
  const picture = R.upscale(R.grid(images, 3), 2);
  const stages = R.upscale(R.grid([stage(meter, panel), images[1], images[4]], 3), 2);

  fs.mkdirSync(dir, { recursive: true });
  const save = (name, data) => files.json(path.join(dir, name + '.json'), data);
  PNG.write(path.join(dir, 'comparison.png'), picture.w, picture.h, picture.rgb);
  PNG.write(path.join(dir, 'dial-stages.png'), stages.w, stages.h, stages.rgb);
  for (const { name, source, request, plan } of examples) {
    save(name + '-before', source);
    save(name + '-request', request);
    save(name + '-report', plan.report);
    if (plan.report.canCommit) save(name + '-after', plan.document);
  }
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-face-region');
