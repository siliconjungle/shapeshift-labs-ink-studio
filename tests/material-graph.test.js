const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createGraphProject, readGraphProject, openMaterialGraph, readMaterialGraph, writeMaterialGraph,
  findGraphGroupUsers, packProject } = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const legacy = {
  format: 'ink-studio/graph-project', version: 1,
  inputs: { level: { type: 'number', default: 4 } },
  nodes: {
    swatch: { op: 'pngAsset', inputs: { name: 'painter' } },
    gain: { op: 'Scale', inputs: { level: { input: 'level' } } },
    sum: { op: 'add', params: { a: { node: 'gain', port: 'scaled' } },
      inputs: { b: { keys: [{ time: 0, value: 1 }, { time: 1, value: 3 }] } } }
  },
  groups: {
    Scale: {
      inputs: { level: 'number' },
      nodes: { step: { op: 'Gain', inputs: { value: { input: 'level' } } } },
      outputs: { scaled: { node: 'step' } },
      groups: { Gain: { file: 'scale.json', revision: 3 } }
    }
  },
  outputs: { amount: { node: 'sum' }, baseColor: { node: 'swatch' }, constant: { value: { node: 'motif' } } },
  assets: { painter: { file: 'pressed.png', format: 'png' } },
  exports: { baseColor: { output: 'baseColor', format: 'png' } },
  seed: 12
};

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'pressed.png'), PNG.encode(1, 1, Uint8Array.of(80, 140, 170, 255), 4));
  fs.writeFileSync(path.join(root, 'scale.json'), JSON.stringify({
    format: 'ink-studio/graph-group', version: 1, revision: 3, inputs: { value: 'number' },
    nodes: { step: { op: 'multiply', inputs: { a: { input: 'value' }, b: 2 } } },
    outputs: { value: { node: 'step' } }
  }));
  return root;
}

test('migrates graph v1 and losslessly saves edits, links, nested groups and per-instance controls', t => {
  const root = workspace(t);
  const material = openMaterialGraph(legacy, { id: 'ink-glaze' });
  const baseline = createGraphProject(legacy, { baseDir: root }).run({ time: 0.5 });
  const migrated = createGraphProject(material, { baseDir: root }).run({ time: 0.5 });
  assert.deepEqual(migrated.outputs, baseline.outputs);
  assert.deepEqual(migrated.artifacts, baseline.artifacts);
  assert.equal(migrated.report.projectHash, baseline.report.projectHash);
  assert.deepEqual(openMaterialGraph(legacy), openMaterialGraph(legacy));

  const link = Object.keys(material.graph.links).find(key => material.graph.links[key].to.output === 'baseColor');
  material.graph.links[link].extensions = { 'studio.route': { bend: [9, 12] } };
  material.graph.inputs.level.label = 'Glaze value';
  material.graph.nodes.swatch.label = 'Artist-painted body';
  material.graph.outputs.baseColor.label = 'Albedo';
  material.resources.painter.label = 'Original press';
  material.controls.strength = { ...material.controls.level, label: 'Strength' };
  delete material.controls.level;
  material.instances.ember = { overrides: { strength: 9 } };
  material.instances.ash = { overrides: { strength: 2 } };
  material.extensions = { 'studio.layout': { future: [true, null, { x: 16 }] } };
  const file = path.join(root, 'review', 'ink-glaze.json');
  const relocated = writeMaterialGraph(file, material, { baseDir: root });
  assert.equal(relocated.resources.painter.definition.file, '../pressed.png');
  assert.equal(relocated.graph.groups.Scale.graph.groups.Gain.reference.file, '../scale.json');
  assert.equal(material.resources.painter.definition.file, 'pressed.png');
  const reopened = readMaterialGraph(file);
  assert.deepEqual(reopened, relocated);
  assert.equal(readGraphProject(file, { instance: 'ember' }).run().outputs.amount, 19);
  assert.equal(readGraphProject(file, { instance: 'ash' }).run().outputs.amount, 5);
  assert.equal(readGraphProject(file, { instance: 'ember' }).run({ inputs: { level: 6 } }).outputs.amount, 13);
  assert.throws(() => readGraphProject(file, { instance: 'missing' }), /Unknown material instance/);
  const bytes = fs.readFileSync(file);
  writeMaterialGraph(file, reopened);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.throws(() => writeMaterialGraph(path.join(root, 'pressed.png'), material), /overwrite its dependency/);
  assert.deepEqual(findGraphGroupUsers(path.join(root, 'scale.json'), { root }).projects.map(x => x.project),
    ['review/ink-glaze.json']);
  const take = path.join(root, 'take.json');
  fs.writeFileSync(take, JSON.stringify({ format: 'ink-studio/take', version: 1, id: 'light', graph: 'review/ink-glaze.json' }));
  const bundle = path.join(root, 'review-bundle.json');
  assert.deepEqual(packProject(take, { out: bundle, root }).project.files(),
    ['pressed.png', 'review/ink-glaze.json', 'scale.json', 'take.json']);
  assert.equal(readGraphProject(bundle, { instance: 'ember' }).run().outputs.amount, 19);

  const amountLink = Object.keys(reopened.graph.links).find(key => reopened.graph.links[key].to.output === 'amount');
  reopened.graph.links[amountLink].from = { node: 'gain', port: 'scaled' };
  writeMaterialGraph(file, reopened);
  assert.deepEqual(readMaterialGraph(file).graph.links[amountLink].to, { output: 'amount' });
  assert.equal(readGraphProject(file, { instance: 'ember' }).run().outputs.amount, 18);
});

test('reopening permits drafts and unknown operations while rejecting corrupt identity and future versions', () => {
  const draft = openMaterialGraph(legacy);
  draft.graph.nodes.swatch.op = 'plugin.futurePaint';
  delete draft.graph.links[Object.keys(draft.graph.links).find(key => draft.graph.links[key].to.output === 'baseColor')];
  assert.deepEqual(openMaterialGraph(draft), draft);
  assert.throws(() => createGraphProject(draft), /Unbound material output baseColor/);
  assert.throws(() => openMaterialGraph({ ...draft, version: 2 }), /Unsupported material graph version 2/);
  assert.throws(() => openMaterialGraph(draft, { id: 'renamed' }), /cannot be reassigned/);
  draft.graph.links.dangling = { from: { node: 'missing' }, to: { output: 'baseColor' } };
  assert.throws(() => openMaterialGraph(draft), /source node on link dangling/);
  draft.graph.links.dangling.from.node = 'swatch';
  draft.graph.links.duplicate = { ...draft.graph.links.dangling };
  assert.throws(() => openMaterialGraph(draft), /already bound on link duplicate/);
});

test('graph CLI opens, saves, and runs the versioned document through normal graph commands', t => {
  const root = workspace(t);
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: root }));
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify(legacy));
  const receipt = command('material', 'legacy.json', '--id', 'first-glaze', '--out', 'saved/material.json');
  assert.equal(receipt.id, 'first-glaze');
  const material = command('material', 'saved/material.json');
  assert.equal(material.graph.nodes.swatch.op, 'pngAsset');
  material.instances.bright = { overrides: { level: 7 } };
  writeMaterialGraph(path.join(root, 'saved/material.json'), material);
  assert.equal(command('run', 'saved/material.json', '--instance', 'bright').outputs.amount, 15);
});
