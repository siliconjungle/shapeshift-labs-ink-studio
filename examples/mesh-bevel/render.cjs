'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const R = require('../../cli/render.js');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const fixture = require('./fixture.cjs');

function run(directory) {
  const dir = path.resolve(directory), api = ink.load().KIT.meshTopology;
  const doc = api.create(fixture.consoleMesh());
  const round = fixture.request(api, doc);
  const chamfer = fixture.request(api, doc, { id: 'chamfer-rim', bevel: { profile: 'chamfer', segments: 1, join: 'miter' } });
  const wide = fixture.request(api, doc, { id: 'wide-rim', bevel: { width: .33 } });
  const custom = fixture.request(api, doc, { id: 'custom-rim', bevel: { segments: 3,
    profile: { points: [[1, 0], [.45, .10], [.18, .36], [0, 1]] } } });
  const w = 160, h = 112, materials = fixture.materials();
  const camera = { target: [-.1, 0, 0], dist: 4.25, ortho: true };
  const front = { w, h, materials, camera: { ...camera, yaw: 0, pitch: 0 }, protectPixels: [
    { id: 'first-clear-pixel', at: [110, 55], kind: 'gap' },
    { id: 'second-clear-pixel', at: [111, 55], kind: 'gap' },
    { id: 'legend-color', at: [69, 46], kind: 'color' }
  ] };
  const orbit = { w, h, materials, camera: { ...camera, yaw: -.46, pitch: .43, dist: 4.75 } };
  const save = (name, data) => files.json(path.join(dir, name + '.json'), data);
  for (const [name, value] of Object.entries({ console: doc, round, chamfer, wide, custom, 'front-view': front, 'orbit-view': orbit }))
    save(name, value);

  const cli = path.join(__dirname, '../../cli/ink-studio.js');
  function replay(name, request, view, accept) {
    const reportFile = name + '-report.json', args = [cli, 'mesh-topology', 'bevel', 'console.json', request + '.json',
      '--view', view + '.json', '--preview', name, '--out', name + '-edited.json', '--report', reportFile];
    const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, accept ? 0 : 1, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(dir, reportFile), 'utf8'));
    assert.equal(report.canCommit, accept);
    if (!accept) assert(!fs.existsSync(path.join(dir, name + '-edited.json')));
    return report;
  }
  replay('chamfer-orbit', 'chamfer', 'orbit-view', true);
  replay('round-orbit', 'round', 'orbit-view', true);
  replay('custom-orbit', 'custom', 'orbit-view', true);
  const guard = replay('round-front', 'round', 'front-view', true);
  assert(guard.native.pixels.every(row => row.retained));
  assert.deepEqual(guard.native.pixels[2].after.rgb, [236, 211, 139]);
  const rejected = replay('wide-front', 'wide', 'front-view', false);
  assert.equal(rejected.protection.paint[0].reason, 'trimmed-paint');

  const grid = names => R.grid(names.map(name => PNG.read(path.join(dir, name))), names.length);
  const row = grid(['round-orbit/before.png', 'chamfer-orbit/after.png', 'round-orbit/after.png']);
  const frontRow = grid(['round-front/before.png', 'round-front/after.png', 'round-front/difference.png']);
  const comparison = R.upscale(R.grid([row, frontRow], 1), 2);
  PNG.write(path.join(dir, 'comparison.png'), comparison.w, comparison.h, comparison.rgb);
  const profiles = R.upscale(grid(['chamfer-orbit/normals.png', 'round-orbit/normals.png', 'custom-orbit/normals.png']), 2);
  PNG.write(path.join(dir, 'profiles.png'), profiles.w, profiles.h, profiles.rgb);
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-bevel');
