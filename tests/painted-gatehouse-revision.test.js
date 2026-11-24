'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const { portal, sign } = require('../examples/gatehouse-revision/portal.cjs');
const { run } = require('../examples/gatehouse-revision/demo.cjs');

test('the original and revised portal shells close around the entrance bevel', () => {
  for (const revised of [false, true]) {
    const { edges } = KIT.meshTopology.inspect(portal(revised));
    assert.equal(edges.filter(edge => edge.uses.some(use => use.face === sign)).length, 4);
    assert(edges.every(edge => edge.uses.length === (edge.uses[0].face === sign ? 1 : 2)));
  }
});

test('the painted gatehouse passes both edit paths and every native-grid orbit sample', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-gatehouse-edit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = await run(dir);
  assert.deepEqual(report.grid, { width: 128, height: 80 });
  assert.equal(report.frames.length, 9);
  assert.equal(report.replacementRevision, 2);
  assert.equal(report.atlases.native.texels, 6144);
  assert.equal(report.atlases.native.changed, 0);
  assert.equal(report.atlases.replacement.changed, 0);
  const image = PNG.read(path.join(dir, 'comparison.png'));
  assert.deepEqual([image.w, image.h], [768, 480]);
  const header = PNG.raster(path.join(dir, 'orbit.apng'));
  assert.deepEqual([header.w, header.h], [384, 80]);
  assert(fs.readFileSync(path.join(dir, 'orbit.apng')).includes(Buffer.from('acTL')));
});
