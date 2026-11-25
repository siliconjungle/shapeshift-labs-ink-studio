const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const project = spec => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...spec });
const link = (node, port = 'value') => ({ node, port });
const input = name => ({ input: name });
const native = op => ({
  inputs: { signal: { type: 'number', default: 2 }, amount: { type: 'number', default: 3 } },
  nodes: { lit: { op, inputs: { a: input('signal'), b: input('amount') } } },
  outputs: { brightness: link('lit') }
});
const editable = (id, graph) => Ink.openMaterialGraph(project(graph), { id });

function workspace(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-subgraph-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, at: file => path.join(root, file),
    command: (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: root, encoding: 'utf8' })) };
}

test('published inputs and outputs are typed, and independent instances can override, reset and replace', t => {
  const { root, at } = workspace(t);
  const sourceFile = at('signals.material.json'), options = { baseDir: root, sourceFile };
  const run = document => Ink.createGraphProject(document, options).run().outputs;
  let document = editable('signals', { inputs: { signal: { type: 'number', default: 4 } } });
  const edit = request => {
    const result = Ink.editMaterialSubgraph(document, request, options);
    document = result.document;
    return result.subgraph;
  };
  const description = edit({ kind: 'publish', group: 'Multiply', graph: editable('scale', native('multiply')).graph });
  assert.deepEqual(description.inputs.amount, { type: 'number', default: 3 });
  assert.deepEqual(description.outputs.brightness, { type: 'number' });
  assert.deepEqual(description.source, { kind: 'inline', file: sourceFile, groups: ['Multiply'] });
  edit({ kind: 'publish', group: 'Add', graph: editable('add', native('add')).graph });
  const alternate = native('multiply');
  alternate.nodes.lit = { op: 'data.typed', type: 'string', inputs: { value: 'light' } };
  edit({ kind: 'publish', group: 'StringOutput', graph: editable('wrong', alternate).graph });
  edit({ kind: 'insert', group: 'Multiply', node: 'west', overrides: { amount: 8 },
    connections: { signalWire: { from: input('signal'), port: 'signal' } } });
  edit({ kind: 'insert', group: 'Multiply', node: 'east', overrides: { amount: 2 } });

  document.graph.outputs = { westLight: {}, eastLight: {} };
  Object.assign(document.graph.links, {
    westWire: { from: link('west', 'brightness'), to: { output: 'westLight' }, label: 'Keep me' },
    eastWire: { from: link('east', 'brightness'), to: { output: 'eastLight' } }
  });
  assert.deepEqual(run(document), { westLight: 32, eastLight: 4 });
  const before = structuredClone(document);
  assert.throws(() => edit({ kind: 'override', node: 'west', overrides: { signal: 1 } }), /Disconnect west.signal/);
  assert.throws(() => edit({ kind: 'override', node: 'west', overrides: { amount: 'wrong' } }), /Wrong value/);
  assert.throws(() => edit({ kind: 'replace', node: 'west', group: 'StringOutput' }), /cannot preserve output west.brightness/);
  assert.deepEqual(document, before);

  const reset = edit({ kind: 'reset', node: 'west', ports: ['amount'] });
  assert.deepEqual(reset.instance.inputs.amount, { kind: 'value', type: 'number', value: 3, authored: false });
  assert.deepEqual(reset.instance.inputs.signal, { kind: 'input', type: 'number', id: 'signal', authored: true });
  assert.deepEqual(run(document), { westLight: 12, eastLight: 4 });
  edit({ kind: 'override', node: 'west', overrides: { amount: 7 } });
  const swapped = edit({ kind: 'replace', node: 'west', group: 'Add' });
  assert.equal(swapped.alias, 'Add');
  assert.equal(swapped.instance.inputs.amount.value, 7);
  assert.deepEqual(document.graph.links, before.graph.links);
  assert.deepEqual(run(document), { westLight: 11, eastLight: 4 });

  Ink.writeMaterialGraph(sourceFile, document);
  assert.deepEqual(Ink.readGraphProject(sourceFile).run().outputs, { westLight: 11, eastLight: 4 });
  const reopened = Ink.describeMaterialSubgraph(Ink.readMaterialGraph(sourceFile), { node: 'west' }, options);
  assert.deepEqual(reopened, swapped);
  assert.deepEqual(Ink.readGraphProject(sourceFile).describeSubgraph({ node: 'west' }), swapped);
});

test('portable publishing relocates nested definitions, pins revisions and navigates to the actual source', t => {
  const { root, at, command } = workspace(t);
  const leaf = Ink.publishMaterialSubgraph(at('library/level.json'), editable('gain', native('multiply')), { revision: 3 });
  assert.equal(leaf.outputs.brightness.type, 'number');
  const material = editable('stack', {
    inputs: { amount: { type: 'number', default: 5 } },
    groups: {
      Inner: { ...native('add') },
      Shared: { file: '../library/level.json', revision: leaf.revision, sha256: leaf.sha256 }
    },
    nodes: { wheel: { op: 'Shared', inputs: { amount: input('amount') } }, trim: { op: 'Inner' } },
    outputs: { brightness: link('wheel', 'brightness') }
  });
  Ink.writeMaterialGraph(at('author/source.material.json'), material);
  const published = command('publish-subgraph', 'author/source.material.json', '--out', 'published/stack.json', '--revision', '5');
  assert.equal(published.revision, 5);
  assert.equal(JSON.parse(fs.readFileSync(published.file)).groups.Shared.file, '../library/level.json');
  assert.throws(() => Ink.publishMaterialSubgraph(published.file, material,
    { baseDir: at('author'), revision: 6 }), /publication already exists/);

  let client = editable('client', { groups: { Stack: { file: 'published/stack.json', revision: 5, sha256: published.sha256 } } });
  client = Ink.editMaterialSubgraph(client, { kind: 'insert', node: 'dial', group: 'Stack' }, { baseDir: root }).document;
  client.graph.outputs.view = {};
  client.graph.links.view = { from: link('dial', 'brightness'), to: { output: 'view' } };
  Ink.writeMaterialGraph(at('client.material.json'), client);
  const runner = Ink.readGraphProject(at('client.material.json'));
  assert.equal(runner.run().outputs.view, 10);
  assert.deepEqual(runner.describeSubgraph({ node: 'dial' }).source,
    { kind: 'file', file: published.file, groups: [], revision: 5, sha256: published.sha256 });
  assert.deepEqual(runner.describeSubgraph({ scope: ['Stack'], node: 'trim' }).source,
    { kind: 'inline', file: published.file, groups: ['Inner'] });
  assert.equal(runner.describeSubgraph({ scope: ['Stack'], node: 'wheel' }).source.file, leaf.file);

  fs.writeFileSync(at('request.json'), JSON.stringify({ kind: 'override', node: 'dial', overrides: { amount: 7 } }));
  const saved = command('subgraph', 'client.material.json', 'request.json', '--out', 'retake/client.material.json');
  assert.equal(saved.subgraph.instance.inputs.amount.value, 7);
  assert.equal(Ink.readGraphProject(saved.file).run().outputs.view, 14);
  assert.equal(Ink.readGraphProject(at('client.material.json')).run().outputs.view, 10);
  fs.writeFileSync(at('request.json'), JSON.stringify({ kind: 'inspect', node: 'dial' }));
  assert.deepEqual(command('subgraph', saved.file, 'request.json').source, saved.subgraph.source);
});
