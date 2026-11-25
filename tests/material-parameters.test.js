const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const input = name => ({ input: name });
const socket = (type, value) => ({ type, default: value });
const row = (result, id) => result.parameters.find(parameter => parameter.id === id);
const select = options => options.map(([label, value]) => ({ label, value }));

function fixture() {
  return Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1,
    inputs: { advance: socket('boolean', false), material: socket('string', 'sea'),
      samples: socket('pixelCount', 16), pitch: { type: 'number', quantity: { unit: 'mm' }, default: .2 } },
    nodes: {
      scale: { op: 'multiply', params: { a: { value: .65 }, b: 2 } },
      sum: { op: 'add', inputs: { a: { node: 'scale' }, b: .4 } }
    },
    outputs: { shine: { node: 'sum' }, material: input('material'), advance: input('advance'),
      samples: input('samples'), pitch: input('pitch') }
  }, { id: 'glaze' });
}

const expose = {
  kind: 'expose', parameters: {
    material: { label: 'Glaze color', group: 'Finish', widget: 'select', order: 10, default: 'ash',
      options: select([['Sea green', 'sea'], ['Ash copper', 'ash']]) },
    shine: { target: { node: 'scale', port: 'a' }, label: 'Gloss strength', group: 'Finish', widget: 'slider',
      min: 0, max: 1, step: .05, units: 'weight', order: 20 },
    trace: { target: { node: 'sum', port: 'b' }, label: 'Trace', group: 'Detail', widget: 'number',
      min: 0, max: 1, step: .1, default: .6, order: 40, visibleWhen: { source: 'control', name: 'advance' } },
    advance: { label: 'Detail controls', group: 'Detail', widget: 'toggle', default: true, order: 30 },
    samples: { label: 'Samples', group: 'Details', order: 50, options: select([['Draft', 16], ['Full', 64]]) },
    pitch: { label: 'Pixel pitch', group: 'Details', order: 60 }
  }
};

function workspace(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-parameters-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const at = name => path.join(directory, name);
  const json = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value));
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args],
    { cwd: directory, encoding: 'utf8' }));
  return { at, json, command };
}

test('batch exposure preserves node literals, declared defaults and typed presentation metadata', t => {
  const { at, json, command } = workspace(t);
  const before = fixture();
  Ink.writeMaterialGraph(at('before.json'), before);
  json('expose.json', expose);
  const result = command('material-parameters', at('before.json'), at('expose.json'), '--out', at('material.json'));
  const after = Ink.readMaterialGraph(result.file);
  assert.deepEqual(Ink.readMaterialGraph(at('before.json')), before);
  assert.deepEqual(result.inspector.parameters.map(parameter => parameter.id), ['material', 'shine', 'advance', 'trace', 'samples', 'pitch']);
  assert.deepEqual(row(result.inspector, 'shine'), {
    id: 'shine', input: 'shine', label: 'Gloss strength', group: 'Finish', type: 'number', widget: 'slider', units: 'weight',
    min: 0, max: 1, step: .05, order: 20, default: .65, origin: 'socket', visible: true, status: 'visible', value: .65
  });
  assert.equal(row(result.inspector, 'material').origin, 'parameter');
  assert.equal(row(result.inspector, 'pitch').units, 'mm');
  assert.equal(row(result.inspector, 'samples').options[1].value, 64);
  assert.equal(after.graph.inputs.trace.definition.default, .4);
  assert.equal(after.controls.trace.default, .6);
  assert.equal(after.graph.nodes.scale.params.a, undefined);
  const link = Object.entries(after.graph.links).find(([, binding]) => binding.from.input === 'shine');
  assert.match(link[0], /^link-exposed-/);
  assert.deepEqual(link[1], { from: input('shine'), to: { node: 'scale', slot: 'params', port: 'a' } });
  assert.deepEqual(Ink.editMaterialParameters(before, expose).document.graph.links, after.graph.links);
  assert.deepEqual(Ink.readGraphProject(result.file).run().outputs,
    { shine: 1.9, material: 'ash', advance: true, samples: 16, pitch: .2 });
  assert.equal(Ink.inspectMaterialVisibility(after).controls.trace.visible, true);
  assert.equal(command('material-parameters', result.file).parameters[0].label, 'Glaze color');

  assert.throws(() => Ink.editMaterialParameters(before, { kind: 'expose',
    parameters: { valid: { target: { node: 'scale', port: 'a' } }, linked: { target: { node: 'sum', port: 'a' } } } }),
  /Cannot expose wired/);
  assert.equal(before.graph.nodes.scale.params.a.value, .65);
  const named = Ink.editMaterialParameters(before, { kind: 'expose', parameters: {
    materialBase: { target: { node: 'scale', port: 'b' } }
  } });
  assert.equal(row(named.inspector, 'materialBase').value, 2);
  assert.throws(() => Ink.editMaterialParameters(before, { kind: 'expose',
    parameters: { advance: { widget: 'number' } } }), /do not match its boolean/);
  assert.throws(() => Ink.editMaterialParameters(after, { kind: 'expose',
    parameters: { shine: { input: 'trace' } } }), /Cannot reassign/);
});

test('set and selected or full reset keep overrides separate from shared defaults', t => {
  const { at, command, json } = workspace(t);
  const definition = Ink.editMaterialParameters(fixture(), expose).document;
  const options = { kind: 'set', instance: 'kiln', values: { shine: .15, material: 'sea', samples: 64, advance: false } };
  let edited = Ink.editMaterialParameters(definition, options);
  assert.equal(row(edited.inspector, 'shine').origin, 'override');
  assert.equal(row(edited.inspector, 'trace').visible, false);
  assert.deepEqual(Ink.createGraphProject(edited.document, { instance: 'kiln' }).run().outputs,
    { shine: 2 * .15 + .6, material: 'sea', advance: false, samples: 64, pitch: .2 });
  assert.throws(() => Ink.editMaterialParameters(edited.document, { ...options, values: { shine: 2 } }), /authored bounds/);
  assert.throws(() => Ink.editMaterialParameters(edited.document, { ...options, values: { samples: 17 } }), /one of its enum/);
  assert.throws(() => Ink.editMaterialParameters(edited.document, { ...options, values: { material: 0 } }), /string/);
  assert.equal(edited.document.instances.kiln.overrides.shine, .15);
  const manual = structuredClone(edited.document);
  manual.controls.shine.default = 4;
  assert.throws(() => Ink.openMaterialGraph(manual), /authored bounds/);

  const explicit = Ink.inspectMaterialParameters(edited.document, { instance: 'kiln', inputs: { shine: .35 } });
  assert.equal(row(explicit, 'shine').origin, 'input');
  assert.equal(row(explicit, 'shine').value, .35);
  const erroneous = Ink.inspectMaterialParameters(edited.document, { instance: 'kiln', inputs: { shine: 'wrong' } });
  assert.equal(row(erroneous, 'shine').valueError.code, 'invalid-parameter-value');
  assert.equal(row(erroneous, 'material').value, 'sea');

  Ink.writeMaterialGraph(at('instance.json'), edited.document);
  json('reset.json', { kind: 'reset', instance: 'kiln', controls: ['material', 'shine'] });
  const report = command('material-parameters', at('instance.json'), at('reset.json'), '--out', at('reset.material.json'));
  assert.equal(row(report.inspector, 'material').value, 'ash');
  assert.equal(row(report.inspector, 'samples').value, 64);
  assert.equal(row(report.inspector, 'shine').value, .65);
  const partial = Ink.readMaterialGraph(report.file);
  edited = Ink.editMaterialParameters(partial, { kind: 'reset', instance: 'kiln' });
  assert.deepEqual(edited.document.instances.kiln.overrides, {});
  assert.deepEqual(edited.document.controls, definition.controls);
  assert.deepEqual(Ink.createGraphProject(edited.document, { instance: 'kiln' }).run().outputs,
    Ink.createGraphProject(definition).run().outputs);
});
