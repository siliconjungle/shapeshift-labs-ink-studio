const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

const absolute = filename => path.resolve(__dirname, '..', filename);
const cli = absolute('cli/ink-studio.js');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('an agent can pick, edit, reopen and deliver a single portable project revision', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-agent-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name);
  execFileSync(process.execPath, [absolute('examples/agent-project/demo.cjs'), dir]);

  const initial = file('relay-initial.ink.json'), revised = file('relay-revised.ink.json'), edit = file('relay-edit.json');
  const before = read(file('inspect-initial.json')), after = read(file('inspect-reopened.json'));
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.objects.children.find(node => node.key === 'solid:pedestal').solid.mat, 'bronze');
  const sample = read(file('sample-reopened.json'));
  assert.equal(sample.camera.yaw, .37);
  assert.equal(sample.compatibility.status, 'no-known-differences');
  assert.deepEqual(read(file('edit-preview.json')).sample.compatibility, sample.compatibility);
  assert.equal(read(file('sample-initial.json')).hit.object, 'relay-art');
  assert.deepEqual(read(file('sample-initial.json')).hit.pixelAt, [13, 22]);
  assert.notDeepEqual(fs.readFileSync(file('before.png')), fs.readFileSync(file('after.png')));
  assert.equal(JSON.parse(run('project', 'author', 'apply', initial, edit, '--out', revised)).next, after.base);

  function rejected(source, doc, out, message) {
    const result = spawnSync(process.execPath, [cli, 'project', 'author', 'apply', source, doc, '--out', out],
      { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
  rejected(revised, edit, file('stale.json'), /base is stale/);
  const broken = read(edit);
  broken.edits.push({ op: 'timeline.cue', id: 'relay-click', values: { cue: 'missing' } });
  const invalid = file('invalid.json');
  fs.writeFileSync(invalid, JSON.stringify(broken));
  rejected(initial, invalid, file('partial.json'), /name an asset or spatial cue/);
  rejected(initial, edit, initial, /output already contains a different revision/);
  assert.equal(JSON.parse(run('project', 'author', 'inspect', initial)).base, before.base);
  assert(!fs.existsSync(file('stale.json')));
  assert(!fs.existsSync(file('partial.json')));

  const moved = file('relocated/scene.ink.json');
  fs.mkdirSync(path.dirname(moved));
  fs.renameSync(revised, moved);
  fs.rmSync(file('source'), { recursive: true });
  const movedView = file('relocated/frame.png');
  run('project', 'author', 'sample', moved, '--at', '1.25', '--w', '240', '--h', '136', '--out', movedView);
  assert.deepEqual(fs.readFileSync(movedView), fs.readFileSync(file('after.png')));
  const exportSettings = ['--formats', 'still,loop', '--w', '96', '--h', '64', '--px', '1',
    '--from', '1', '--to', '1.5', '--fps', '8', '--still-scale', '1', '--t', '1.25'];
  const out = file('relocated/export');
  run('export-scene', moved, '--out', out, ...exportSettings);
  const exported = read(path.join(out, 'export.json'));
  assert.equal(exported.sequence.frameCount, 4);
  assert.deepEqual(exported.compatibility.samples, { sequence: 4, still: 1 });
  const wav = ink.readWav(path.join(out, exported.audio.mix));
  const onset = wav.samples.findIndex(n => Math.abs(n) > .001) / wav.channels / wav.sampleRate;
  assert(onset >= .25 && onset < .26, 'the relocated cue should land on the trimmed export clock');

  await t.test('Chrome edits and reopens that bundle, then the CLI exports the browser revision',
    { skip: !process.env.INK_TEST_CHROME }, () => {
      const original = fs.readFileSync(moved, 'utf8');
      const { snapshot, changed, reopenedMaterial } = runWebGL({},
        ({ KIT }, source) => KIT.authoring.projectBundles.open(source),
        (kit, open, backend, source) => {
          const project = open(kit, source);
          const editor = project.editor();
          editor.setMaterial('slate', 'solid:pedestal');
          const edited = project.withScene(editor.snapshot());
          const snapshot = JSON.stringify(edited.snapshot());
          const reopened = open(kit, snapshot);
          const view = backend(96, 64, { offscreen: true, colored: false });
          try {
            function sample(bundle) {
              const world = bundle.build();
              world.anim?.update(1 / 60, 1.25);
              view.draw(world, { time: 1.25 });
              return view.image();
            }
            return { snapshot, changed: sample(project) !== sample(reopened),
              reopenedMaterial: reopened.scene().solids.find(solid => solid.id === 'pedestal')?.mat };
          } finally { view.close(); }
        }, original);
      assert.equal(reopenedMaterial, 'slate');
      assert.equal(changed, true, 'the browser edit should change the reopened WebGL pixels');

      const saved = file('relocated/browser.ink.json');
      fs.writeFileSync(saved, snapshot);
      const restored = JSON.parse(run('project', 'author', 'inspect', saved));
      assert.equal(restored.id, after.id);
      assert.equal(restored.revision, after.revision + 1);
      assert.equal(restored.objects.children.find(node => node.key === 'solid:pedestal').solid.mat, 'slate');
      const pixel = JSON.parse(run('project', 'author', 'pixel', saved, 'relay-art', '--at', '13,22'));
      assert.equal(pixel.swatch, 'ceramic-light');

      const delivery = file('relocated/browser-export');
      run('export-scene', saved, '--out', delivery, ...exportSettings);
      const manifest = read(path.join(delivery, 'export.json'));
      assert.equal(manifest.scene, restored.id);
      assert.equal(manifest.sequence.frameCount, exported.sequence.frameCount);
      assert.notDeepEqual(fs.readFileSync(path.join(delivery, manifest.still.file)),
        fs.readFileSync(path.join(out, exported.still.file)));
      assert.deepEqual(fs.readFileSync(path.join(delivery, manifest.audio.mix)),
        fs.readFileSync(path.join(out, exported.audio.mix)));
    });
});
