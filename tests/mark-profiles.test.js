'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const { prepare } = K.procedural.shapeSweeps;
const rect = (x, y) => [[-x, -y], [x, -y], [x, y], [-x, y]];
const bearing = { silhouette: [rect(.12, .09)], spacing: .5, depth: { back: .04, curve: [[0, .02], [.07, .12]] } };
const ridge = { silhouette: [rect(.14, .24)], spacing: .25, depth: { back: .04, curve: [[0, .12]] } };
const at = (x, y = 0, z = 0, pressure = 1) => ({ point: [x, y, z], pressure });
const make = (profile, poses, mix, pressureResponse) => prepare({ poses, pressureResponse,
  brush: { kind: 'mark-profile', profile, ...(mix && { mix }) } });
const close = (a, b, epsilon = 1e-10) => assert(Math.abs(a - b) < epsilon, `${a} expected near ${b}`);

test('authored silhouettes, relief curve, coverage, and grain stay local to a dab', () => {
  const profile = { ...bearing, silhouette: [rect(.12, .09), rect(.07, .04).map(([x, y]) => [x + .28, y])],
    coverage: { opacity: .83, feather: .04 }, grain: { amount: .30, scale: .04, seed: 41 } };
  const dab = make(profile, [at(0)]), shifted = make(profile, [at(3)]);
  assert.equal(dab.sampleCount, 1);
  assert(dab.sd(0, 0, .10) < 0);
  assert(dab.sd(.111, 0, .07) > 0);
  assert(dab.sd(.28, 0, .04) < 0);
  assert(dab.sd(.18, 0, .04) > 0);
  close(dab.opacityAt(0, 0, .1), shifted.opacityAt(3, 0, .1));
  assert(dab.opacityAt(0, 0, .1) > dab.opacityAt(.113, 0, .02));
  assert.notEqual(dab.opacityAt(0, 0, .1), dab.opacityAt(.04, 0, .1));
  const faded = make(profile, [at(0, 0, 0, .25)], null, { opacity: [0, 1] });
  close(faded.opacityAt(0, 0, .1), .25 * dab.opacityAt(0, 0, .1));
});

test('each profile keeps its stamp spacing while a local transition changes relief and opacity', () => {
  const poses = [at(0), at(2)];
  const stamped = make(bearing, poses);
  assert.equal(stamped.sampleCount, 5);
  assert(stamped.sd(.5, 0, .05) < 0);
  assert(stamped.sd(.25, 0, .05) > 0);
  const mixed = make(bearing, poses, { profile: ridge, range: [.25, .75] });
  assert(mixed.sd(0, .16, .04) > 0);
  assert(mixed.sd(1, .16, .04) < 0);
  assert(mixed.sd(1, .16, .10) > 0);
  assert(mixed.sd(2, .16, .10) < 0);
  close(mixed.opacityAt(1, .16, .04), .5);
  close(mixed.opacityAt(2, .16, .10), 1);
  assert(mixed.sampleCount > stamped.sampleCount);
  assert.throws(() => make(bearing, poses, { profile: ridge, range: [.8, .2] }), /mix needs.+range/);
  assert.throws(() => make({ ...bearing, depth: { curve: [[.1, .2]] } }, poses), /start at zero/);
  assert.throws(() => make({ ...bearing, silhouette: [rect(.12, 0)] }, poses), /no area/);
});

test('CLI reuses named profiles across attached marks and rejects removal of a live profile', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mark-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const marks = [-.23,.23].map((y, i) => ({ id: 'line-' + i, mat: 'ember', res: .045,
    brush: { kind: 'mark-profile', profile: 'fine', mix: { profile: 'ridge', range: [.25,.75] } },
    poses: [at(-.8, y, .47), at(.8, y, .47)], attachment: { kind: 'surface', slot: 'host',
      snap: { mode: 'surface', direction: [0, 0, 1], maxDistance: .5, offset: .022 } } }));
  const base = { id: 'guide', solids: [{ id: 'panel', kind: 'box', at: [0, 0, 0], half: [1.2, .8, .2], mat: 'stone' }] };
  const painting = { format: 'ink-studio/painting-3d', version: 1, id: 'surface', profiles: { fine: bearing, ridge }, marks };
  save('base.json', base);
  save('input.json', { id: 'detail', painting, bindings: { host: 'panel' } });
  const report = JSON.parse(run('painting-3d', 'apply', 'base.json', 'input.json', '--out', 'painted.json'));
  assert.deepEqual(report.profiles, ['fine', 'ridge']);
  assert(report.marks.every(row => row.profile === 'fine' && row.mix.profile === 'ridge' && row.contacts > 2));
  save('bad.json', { id: 'detail', profiles: { fine: null } });
  assert.throws(() => run('painting-3d', 'update', 'painted.json', 'bad.json', '--out', 'bad-result.json'), /Unknown mark profile fine/);
  assert(!fs.existsSync(path.join(dir, 'bad-result.json')));
  const taller = { ...ridge, depth: { back: .02, curve: [[0, .046], [.11, .20]] } };
  save('edit.json', { id: 'detail', profiles: { ridge: taller } });
  run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'edited.json');
  run('painting-3d', 'extract', 'edited.json', '--id', 'detail', '--out', 'brushes.json');
  assert.deepEqual(read('brushes.json'), { ...painting, profiles: { fine: bearing, ridge: taller } });
  for (const source of ['painted', 'edited']) run('render', source + '.json', '--w', '160', '--h', '110', '--ortho', '--out', source + '.png');
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'painted.png')), fs.readFileSync(path.join(dir, 'edited.png')));
});
