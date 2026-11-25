const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const input = name => ({ input: name });
const inspect = (document, instance) => Ink.inspectMaterialPresets(document, { instance });
const edit = (document, request) => Ink.editMaterialPresets(document, request).document;
const set = (document, instance, values) => Ink.editMaterialParameters(document, { kind: 'set', instance, values }).document;
const row = (instance, id) => instance.parameters.find(parameter => parameter.id === id);
const instance = (document, id) => inspect(document, id).instances[0];

function fixture(id = 'plate') {
  const authored = Ink.openMaterialGraph({ format: 'ink-studio/graph-project', version: 1, nodes: {},
    inputs: { pigment: { type: 'string', default: 'sea' }, gloss: { type: 'number', default: .4 },
      layering: { type: 'record', default: { coat: [1, 2], salt: true } }, ash: { type: 'boolean', default: false },
      required: 'number' },
    outputs: { pigment: input('pigment'), gloss: input('gloss'), layering: input('layering'), ash: input('ash') }
  }, { id });
  return Ink.editMaterialParameters(authored, { kind: 'expose', parameters: {
    pigment: { label: 'Colorway', options: [{ label: 'Sea green', value: 'sea' }, { label: 'Ember', value: 'ember' }] },
    gloss: { label: 'Gloss', min: 0, max: 1, default: .5 }
  } }).document;
}

function workspace(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-presets-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const at = name => path.join(directory, name);
  return { at, json: (name, value) => fs.writeFileSync(at(name), JSON.stringify(value)),
    command: (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: directory })) };
}

test('named sets track exact applied values across independent edits, renames, copies and resaves', () => {
  let doc = fixture();
  doc = set(doc, 'kiln', { ash: true, layering: { salt: true, coat: [1, 2] } });
  doc = set(doc, 'coastal', { required: 2 });
  assert.deepEqual(instance(doc, 'kiln').changes.map(change => change.id), ['ash']);
  doc = edit(doc, { kind: 'save', id: 'warm', label: 'Warm glaze', values: { pigment: 'ember', gloss: .75 } });
  const packaged = edit(doc, { kind: 'apply', id: 'warm', instance: 'kiln' });
  assert.equal(doc.instances.kiln.overrides.pigment, undefined);
  assert.equal(packaged.instances.kiln.overrides.ash, true);
  assert.deepEqual(instance(packaged, 'kiln').changes.map(change => change.id), ['ash']);
  assert.deepEqual(row(instance(packaged, 'kiln'), 'gloss').comparison,
    { origin: 'preset', baseline: .75, changed: false, changedFromDefault: true });
  assert.deepEqual(instance(packaged, 'coastal').changes.map(change => change.id), ['required']);

  doc = set(packaged, 'kiln', { gloss: .9 });
  assert.deepEqual(instance(doc, 'kiln').changes.filter(change => change.id === 'gloss'), [{
    id: 'gloss', label: 'Gloss', origin: 'preset', changed: true, changedFromDefault: true, baseline: .75, value: .9
  }]);
  const hashInput = Ink.createGraphProject(doc, { instance: 'coastal' }).artifactIdentity();
  doc = edit(doc, { kind: 'rename', id: 'warm', label: 'Evening glaze' });
  doc = edit(doc, { kind: 'copy', id: 'warm', to: 'variant', label: 'Evening variation' });
  assert.equal(instance(doc, 'kiln').preset.label, 'Evening glaze');
  assert.deepEqual(doc.presets.variant.values, doc.presets.warm.values);
  assert.deepEqual(Ink.createGraphProject(doc, { instance: 'coastal' }).artifactIdentity(), hashInput);

  doc = edit(doc, { kind: 'save', id: 'warm', instance: 'kiln', controls: ['pigment', 'gloss'] });
  assert.equal(doc.presets.warm.label, 'Evening glaze');
  assert.equal(doc.presets.warm.values.gloss, .9);
  assert.deepEqual(instance(doc, 'kiln').preset, { id: 'warm', label: 'Evening glaze', updated: true });
  assert.equal(row(instance(doc, 'kiln'), 'gloss').comparison.baseline, .75);
  assert.equal(row(Ink.inspectMaterialParameters(doc, { instance: 'kiln' }), 'gloss').comparison.changed, true);
  doc = edit(doc, { kind: 'apply', id: 'warm', instance: 'kiln' });
  assert.equal(row(instance(doc, 'kiln'), 'gloss').comparison.changed, false);
  assert.equal(instance(doc, 'kiln').preset.updated, false);

  doc = edit(doc, { kind: 'save', id: 'default-set', label: 'Defaults' });
  assert.equal(doc.presets['default-set'].values.gloss, .5);
  assert.equal(Object.hasOwn(doc.presets['default-set'].values, 'required'), false);
  assert.throws(() => edit(doc, { kind: 'save', id: 'bad-capture', controls: ['required'] }), /known material parameter/);
});

test('the CLI writes, reads and applies a portable package through typed graph execution', t => {
  const { at, json, command } = workspace(t);
  const source = fixture();
  const ready = edit(source, { kind: 'save', id: 'dusk', label: 'Dusk', values: { gloss: .8, pigment: 'ember', required: 7 } });
  Ink.writeMaterialGraph(at('source.material.json'), ready);
  const file = at('presets.json');
  const written = command('material-presets', at('source.material.json'), '--export', file, '--presets', 'dusk');
  const bundle = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(bundle, Ink.exportMaterialPresets(ready, { ids: ['dusk'] }));
  assert.equal(written.file, file);
  assert.equal(bundle.material, 'plate');
  assert.equal(bundle.presets.dusk.label, 'Dusk');

  Ink.writeMaterialGraph(at('other.material.json'), fixture('another'));
  const imported = command('material-presets', at('other.material.json'), file, '--out', at('imported.material.json'));
  assert.deepEqual(imported.inspector.presets[0], { id: 'dusk', ...bundle.presets.dusk, compatible: true });
  json('apply.json', { kind: 'apply', id: 'dusk', instance: 'review' });
  const applied = command('material-presets', imported.file, at('apply.json'), '--out', at('selected.material.json'));
  const project = Ink.readGraphProject(applied.file, { instance: 'review' });
  assert.equal(project.run().outputs.gloss, .8);
  assert.equal(project.run().outputs.pigment, 'ember');
  assert.equal(command('material-presets', applied.file, '--instance', 'review').instances[0].changes.length, 0);
  assert.equal(Ink.readMaterialGraph(applied.file).instances.review.preset.id, 'dusk');
});

test('imports validate as a batch and preserve previously applied snapshots on replacement', () => {
  let doc = fixture();
  doc = edit(doc, { kind: 'save', id: 'warm', values: { gloss: .6 } });
  doc = edit(doc, { kind: 'apply', id: 'warm', instance: 'kiln' });
  const example = Ink.exportMaterialPresets(doc), original = structuredClone(doc);
  const invalid = { ...example, presets: { next: { label: 'Next', values: { gloss: .9 } },
    broken: { label: 'Broken', values: { gloss: 'oops' } } } };
  assert.throws(() => edit(doc, { kind: 'import', bundle: invalid }), /number/);
  assert.deepEqual(doc, original);
  assert.throws(() => edit(doc, { kind: 'import', bundle: example }), /already exists/);
  const changed = { ...example, presets: { warm: { label: 'Warm', values: { gloss: .9 } } } };
  doc = edit(doc, { kind: 'import', bundle: changed, replace: true });
  assert.equal(instance(doc, 'kiln').preset.updated, true);
  assert.equal(row(instance(doc, 'kiln'), 'gloss').comparison.changed, false);
  assert.equal(row(instance(doc, 'kiln'), 'gloss').value, .6);

  const otherSchema = structuredClone(doc);
  otherSchema.controls.gloss.max = .8;
  assert.equal(inspect(otherSchema).presets[0].compatible, false);
  assert.throws(() => edit(otherSchema, { kind: 'apply', id: 'warm', instance: 'kiln' }), /authored bounds/);
  assert.equal(row(instance(otherSchema, 'kiln'), 'gloss').value, .6);
});
