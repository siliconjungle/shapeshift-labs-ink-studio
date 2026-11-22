const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const Assets = require('../cli/asset-references.js');
const api = ink.load().KIT.authoring.assetReferences;

const camera = yaw => ({ shots: { watch: { target: [0, 1, 0], dist: 8, yaw } } });
const ref = (revision, extra = {}) => ({ asset: 'dock/camera', revision, ...extra });
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-asset-references-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name);
  const save = (name, value) => {
    const data = JSON.stringify(value) + '\n';
    fs.writeFileSync(file(name), data);
    return Assets.hash(data);
  };
  const first = save('camera-1.json', camera(.25)), second = save('camera-2.json', camera(.75));
  const manifest = { format: api.format, version: 1, entries: [
    { ...ref(1), kind: 'rig', file: 'camera-1.json', sha256: first },
    { ...ref(2), kind: 'rig', file: 'camera-2.json', sha256: second }
  ] };
  save('assets.json', manifest);
  return { file, save, manifest, first, second };
}

test('named revisions reject any fallback, kind mismatch, duplicate or content drift', t => {
  const { file, save, manifest, first, second } = setup(t);
  const registry = Assets.open(api, file('assets.json'));
  assert.equal(Assets.parse(registry.resolve(ref(1), 'rig').bytes).shots.watch.yaw, .25);
  assert.equal(Assets.parse(registry.resolve(ref(2, { sha256: second }), 'rig').bytes).shots.watch.yaw, .75);
  assert.throws(() => registry.resolve(ref(3), 'rig'), /Unknown asset revision dock\/camera@3/);
  assert.throws(() => registry.resolve(ref(1), 'effect'), /kind rig.*effect/);
  assert.throws(() => registry.resolve(ref(2, { sha256: first })), /does not match registry/);
  assert.throws(() => api.compile({ ...manifest, entries: [...manifest.entries, manifest.entries[0]] }), /Duplicate/);
  assert.throws(() => api.compile({ ...manifest, entries: manifest.entries.map((entry, i) => i === 0 ? entry :
    { ...entry, kind: 'effect' }) }), /kind changed/);
  const before = save('new-name.json', camera(.25));
  assert.equal(before, first);
  save('moved.json', { ...manifest, entries: [{ ...manifest.entries[0], file: 'new-name.json' }] });
  assert.equal(Assets.open(api, file('moved.json')).resolve(ref(1, { sha256: first }), 'rig').sha256, first);
  save('camera-1.json', camera(.5));
  assert.throws(() => registry.resolve(ref(1)), /SHA-256 mismatch/);
});

test('portable scenes carry selected assets and preserve their pins across unrelated edits', t => {
  const { file, save } = setup(t);
  save('scene.json', { id: 'asset-dock', style: 'slate', assetRegistry: 'assets.json', cameraRig: ref(1),
    solids: [{ kind: 'ball', id: 'lamp', at: [0, 1, 0], r: .6, res: .15, mat: 'pale' }] });
  const { project } = ink.packProject(file('scene.json'), { out: file('project.json') });
  assert.deepEqual(project.files().sort(), ['assets.json', 'camera-1.json', 'scene.json']);
  const revised = project.withScene({ ...project.scene(), name: 'Closed dock' });
  assert.deepEqual(JSON.parse(revised.snapshot().files['scene.json'].data).cameraRig, ref(1));
  assert.equal(revised.scene().cameraRig.shots.watch.yaw, .25);
  const tampered = revised.snapshot();
  tampered.files['camera-1.json'].data = JSON.stringify(camera(.4));
  save('tampered.json', tampered);
  assert.throws(() => ink.readProjectBundle(file('tampered.json')), /SHA-256 mismatch.*dock\/camera@1/);
  fs.unlinkSync(file('camera-1.json'));
  const relocated = ink.readProjectBundle(file('project.json'));
  assert.equal(relocated.scene().cameraRig.shots.watch.yaw, .25);
  assert(relocated.build().count > 0);
});
