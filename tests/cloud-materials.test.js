'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

function plate() {
  const points = Array.from({ length: 25 }, (_, row) => [row % 5 - 2, Math.floor(row / 5) - 2, .3]);
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  return ['ply', 'format ascii 1.0', 'element vertex ' + points.length, ...fields.map(n => 'property float ' + n),
    'end_header', ...points.map(point => [...point, -.4, -.4, -.4, 1, 0, 0, 0, 2.9, .5, -.25, -.6].join(' ')), ''].join('\n');
}

test('headless material recovery preserves capture and records uncertainty for degree zero', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-cloud-materials-')), file = n => path.join(root, n);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name)));
  const bytes = name => fs.readFileSync(file(name));
  const run = (...args) => spawnSync(process.execPath, [cli, 'cloud-materials', ...args], { encoding: 'utf8' });
  const success = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  fs.writeFileSync(file('plate.ply'), plate());
  write('plan.json', { normalToward: [0, 0, 1], fallbackRoughness: .69 });
  success('recover', file('plate.ply'), '--plan', file('plan.json'), '--out', file('recovered'));
  const material = read('recovered/material.json'), info = read('recovered/report.json');
  assert.deepEqual(bytes('plate.ply'), bytes('recovered/capture.ply'));
  assert.equal(material.source.degree, 0);
  assert.equal(info.illumination.source, 'chromaticity-groups');
  assert.equal(info.illumination.key, 0);
  assert.equal(info.illumination.exposureUncertainty, 1);
  assert.equal(info.uncertainty.roughness.high, 25);
  assert(material.rows.every(row => row.roughness === .69 && row.evidence === 'dc-only' && row.uncertainty.roughness === 1));
  assert(material.rows.every(row => row.normal[2] > .999 && row.normalSource === 'neighborhood'));

  const spec = file('patch.json'), target = 12;
  const override = (input, out, changes) => {
    write('patch.json', { format: 'ink-studio/cloud-materials-overrides', version: 1, sourceSha256: material.source.sha256,
      edits: [{ row: target, ...changes }] });
    success('override', file(input), spec, '--out', file(out));
  };
  override('recovered/material.json', 'edited', { pigment: [.4, .15, .61], normal: [0, 1, 1], roughness: .1 });
  const row = JSON.parse(success('inspect', file('edited/material.json'), '--row', String(target)));
  assert.equal(row.effective.roughness, .1);
  assert.equal(row.recovered.roughness, .69);
  assert.equal(row.recovered.uncertainty.roughness, 1);
  assert.deepEqual(row.effective.pigment, [.4, .15, .61]);
  assert(row.effective.normal[1] > .7);
  assert.deepEqual(bytes('plate.ply'), bytes('edited/capture.ply'));

  override('edited/material.json', 'reset', { pigment: null, normal: null, roughness: null });
  assert.deepEqual(read('reset/material.json'), material);
  write('view.json', { width: 56, height: 52, captured: 1, camera: { ortho: true, yaw: .3, pitch: .12 } });
  for (const version of ['recovered', 'edited']) success('render', file(version + '/material.json'), file('view.json'),
    '--out', file(version + '.png'));
  assert.deepEqual(bytes('edited.png'), bytes('recovered.png'));

  fs.appendFileSync(file('edited/capture.ply'), '\n');
  const mismatch = run('render', file('edited/material.json'), file('view.json'), '--out', file('mismatch.png'));
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /fingerprint differs/);
  assert(!fs.existsSync(file('mismatch.png')));
});
