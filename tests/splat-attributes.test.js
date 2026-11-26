'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const kit = require('..').load().KIT;
const Plan = require('../cli/splat-attribute-plan.js');
const Exchange = require('../cli/splat-exchange.js');
const Fit = require('../cli/splat-fit-asset.js');
const { fixture } = require('../examples/shared-splat-attributes/vane.cjs');

test('splat plans bind directional color and retain weights by ID through removal and export', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-splat-attributes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cloud.inksplats'), { source, definition, donor } = fixture(kit);
  fs.writeFileSync(file, JSON.stringify(source));
  const world = await Exchange.load(file, kit);
  const { asset, data, report } = Plan.plan(world, definition, kit, () => donor);
  assert.equal(report.removed.length, 4);
  const baked = Fit.bake(world, asset);
  assert.equal(baked.count, world.count - 4);
  const table = Plan.attributes(Plan.catalog(baked, kit), kit, data);
  fs.writeFileSync(file, JSON.stringify(Exchange.serialize(baked, table)));
  const reopened = await Exchange.load(file, kit);
  assert.deepEqual(reopened.gaussianHarmonics.sh, baked.gaussianHarmonics.sh);
  assert.deepEqual(reopened.renderMetadata.normals, baked.renderMetadata.normals);
  assert.deepEqual(reopened.data, baked.data);

  const recipe = { ...definition, selections: [{ id: 'worked', where: [{ channel: 'weight/curl', min: .67 }] }],
    rowEdits: [], outliers: [], transfers: [], groups: [{ ...definition.groups[0], id: 'again', selection: 'worked',
      weight: 'weight/curl', modifiers: [{ type: 'taper', axis: [0,1,0], length: 2, amount: -.05 }] }] };
  const second = Plan.plan(reopened, recipe, kit, () => assert.fail('Retained weights should need no donor'));
  assert(second.asset.groups[0].mask.some(([, value]) => value >= .67 && value < 1));
  assert(!second.asset.groups[0].members.some(id => report.removed.includes(id)));

  const changed = { ...world, gaussianHarmonics: { ...world.gaussianHarmonics, sh: world.gaussianHarmonics.sh.slice() } };
  changed.gaussianHarmonics.sh[0] += .03;
  assert.throws(() => Fit.prepare(changed, asset), /does not match the source cloud/);
});
