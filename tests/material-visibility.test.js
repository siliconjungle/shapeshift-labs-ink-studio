const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const project = graph => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...graph });
const input = name => ({ input: name });
const node = (id, port) => ({ node: id, port });
const source = (kind, name) => ({ source: kind, name });
const expr = (op, ...args) => ({ op, args });
const edit = (id, spec) => Ink.openMaterialGraph(project(spec), { id });
const spec = (type, value) => ({ type, default: value });

function material() {
  const doc = edit('glaze', {
    inputs: { finish: spec('string', 'matte'), light: spec('boolean', false),
      extent: spec('pixelCount', 24), raw: spec('any', 3), required: 'number', spread: spec('number', 0) },
    outputs: { dry: input('extent'), shine: input('light'), faults: { value: 14 }, limiting: input('spread') }
  });
  doc.controls.gloss = { input: 'finish', label: 'Finish' };
  delete doc.controls.finish;
  doc.controls.light.visibleWhen = expr('eq', source('control', 'gloss'), 'glazed');
  doc.controls.raw.visibleWhen = source('input', 'raw');
  doc.controls.required.visibleWhen = expr('gt', source('input', 'required'), 0);
  doc.controls.spread.visibleWhen = expr('and', source('input', 'light'),
    expr('gt', expr('divide', 1, source('input', 'spread')), 0));
  doc.graph.inputs.extent.visibleWhen = expr('gte', source('input', 'extent'), 24);
  doc.graph.outputs.shine.visibleWhen = source('control', 'light');
  doc.graph.outputs.faults.visibleWhen = expr('gt', source('input', 'extent'), { literal: '16' });
  doc.graph.outputs.limiting.visibleWhen = expr('or', true, expr('eq', source('input', 'doesNotExist'), false));
  doc.instances.kiln = { overrides: { gloss: 'glazed', light: true, spread: 2, required: 1 } };
  return doc;
}

function workspace(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-visibility-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const at = name => path.join(directory, name);
  const json = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value));
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args],
    { cwd: directory, encoding: 'utf8' }));
  return { directory, at, json, command };
}

test('visibility uses typed input and control IDs, isolates malformed rules, and respects active instance values', t => {
  const { at, json, command } = workspace(t);
  const doc = material(), file = at('glaze.material.json');
  Ink.writeMaterialGraph(file, doc);
  assert.deepEqual(Ink.readMaterialGraph(file), doc);
  const start = Ink.inspectMaterialVisibility(doc);
  assert.equal(start.controls.light.visible, false);
  assert.equal(start.controls.spread.status, 'hidden');
  assert.equal(start.controls.raw.diagnostic.code, 'unsupported-type');
  assert.equal(start.controls.required.diagnostic.code, 'missing-value');
  assert.equal(start.inputs.extent.visible, true);
  assert.equal(start.outputs.shine.visible, false);
  assert.equal(start.outputs.dry.visible, true);
  assert.equal(start.outputs.faults.visible, true);
  assert.deepEqual(start.outputs.faults.diagnostic, {
    kind: 'output', id: 'faults', rulePath: '/graph/outputs/faults/visibleWhen',
    path: '/graph/outputs/faults/visibleWhen/args/1', code: 'type-mismatch',
    message: 'gt expects number but received string'
  });
  assert.equal(start.outputs.limiting.diagnostic.code, 'unknown-reference');
  assert.equal(start.outputs.limiting.diagnostic.path, '/graph/outputs/limiting/visibleWhen/args/1/args/0');

  const kiln = command('material-visibility', file, '--instance', 'kiln');
  assert.equal(kiln.controls.light.visible, true);
  assert.equal(kiln.outputs.shine.visible, true);
  assert.equal(kiln.controls.spread.visible, true);
  json('inputs.json', { light: true, spread: 0, extent: '24' });
  const badValues = command('material-visibility', file, '--instance', 'kiln', '--inputs', at('inputs.json'));
  assert.equal(badValues.inputs.extent.diagnostic.code, 'wrong-value-type');
  assert.equal(badValues.controls.spread.diagnostic.code, 'nonfinite-result');
  assert.equal(badValues.outputs.shine.status, 'visible');
  const broken = structuredClone(doc);
  broken.controls.light.visibleWhen = { source: 'control', name: { toString: 3 } };
  broken.graph.outputs.shine.visibleWhen = expr('add', 1, 2);
  const malformed = Ink.inspectMaterialVisibility(broken);
  assert.equal(malformed.controls.light.diagnostic.code, 'invalid-reference');
  assert.equal(malformed.outputs.shine.diagnostic.code, 'nonboolean-result');

  // These are editor rules, while typed graph evaluation and artifact hashing use the same graph.
  const checked = Ink.createGraphProject(doc, { instance: 'kiln' });
  assert.equal(checked.run().outputs.shine, true);
  assert.equal(checked.run({ inputs: { light: false } }).outputs.shine, false);
  broken.graph.outputs.shine.visibleWhen = false;
  assert.equal(Ink.createGraphProject(broken, { instance: 'kiln' }).plan().projectHash, checked.plan().projectHash);
  const offline = structuredClone(doc);
  offline.resources.photo = { definition: { format: 'png', file: 'missing.png' } };
  assert.deepEqual(Ink.inspectMaterialVisibility(offline), start);
});

function group() {
  const definition = edit('clearcoat', {
    inputs: { wet: spec('boolean', false), amount: spec('number', .5) },
    outputs: { coat: input('amount'), dry: input('wet') }
  });
  definition.graph.inputs.amount.visibleWhen = source('input', 'wet');
  definition.graph.outputs.coat.visibleWhen = source('control', 'wet');
  definition.graph.outputs.dry.visibleWhen = expr('not', source('input', 'wet'));
  return definition;
}

test('inline and published group ports evaluate using actual instance bindings and report their source path', t => {
  const { directory, at, command, json } = workspace(t);
  const definition = group();
  const published = Ink.publishMaterialSubgraph(at('coat.group.json'), definition, { revision: 3 });
  const groupSource = JSON.parse(fs.readFileSync(published.file));
  assert.deepEqual(groupSource.inspector.outputs.coat.visibleWhen, source('control', 'wet'));

  const root = edit('finish', {
    inputs: { wet: spec('boolean', true) },
    groups: { Coating: { file: 'coat.group.json', revision: 3, sha256: published.sha256 } },
    nodes: {
      signal: { op: 'lessThan', inputs: { a: 0, b: 1 } },
      dry: { op: 'Coating' },
      live: { op: 'Coating', inputs: { wet: input('wet') } },
      dynamic: { op: 'Coating', inputs: { wet: node('signal', 'value') } }
    },
    outputs: { a: node('dry', 'coat'), b: node('live', 'coat'), c: node('dynamic', 'coat') }
  });
  const inline = structuredClone(definition.graph);
  inline.outputs.coat.visibleWhen = source('input', 'wet');
  inline.outputs.dry.visibleWhen = expr('lt', source('input', 'wet'), .1);
  root.graph.groups.Inline = { graph: inline };
  root.graph.nodes.inline = { op: 'Inline', inputs: { wet: true } };
  const project = Ink.createGraphProject(root, { baseDir: directory });
  assert.equal(project.describeSubgraph({ node: 'dry' }).visibility.inputs.amount.visible, false);
  assert.equal(project.describeSubgraph({ node: 'live' }).visibility.outputs.coat.visible, true);
  assert.equal(project.describeSubgraph({ node: 'live', inputs: { wet: false } }).visibility.outputs.coat.visible, false);
  const dynamic = project.describeSubgraph({ node: 'dynamic' }).visibility.outputs.coat;
  assert.equal(dynamic.status, 'error');
  assert.equal(dynamic.diagnostic.path, '/inspector/outputs/coat/visibleWhen');
  assert.equal(project.describeSubgraph({ node: 'dynamic', inputs: { wet: true } }).visibility.outputs.coat.visible, true);
  assert.deepEqual(project.run().outputs, { a: .5, b: .5, c: .5 });

  const side = Ink.inspectMaterialVisibility(root, { scope: ['Inline'] });
  assert.equal(side.inputs.amount.visible, false);
  assert.equal(side.outputs.dry.diagnostic.path, '/graph/groups/Inline/graph/outputs/dry/visibleWhen/args/0');
  const issued = Ink.describeMaterialSubgraph(root, { node: 'inline' }, { baseDir: directory });
  assert.equal(issued.visibility.outputs.coat.visible, true);
  assert.equal(issued.visibility.outputs.dry.diagnostic.path, side.outputs.dry.diagnostic.path);
  const report = project.describeSubgraph({ node: 'inline' });
  report.visibility.outputs.coat.visibleWhen.name = 'mutated-report';
  inline.outputs.coat.visibleWhen = false;
  assert.equal(project.describeSubgraph({ node: 'inline' }).visibility.outputs.coat.visible, true);
  Ink.writeMaterialGraph(at('finish.material.json'), root);
  json('inspect.json', { kind: 'inspect', node: 'dynamic', inputs: { wet: true } });
  const described = command('subgraph', at('finish.material.json'), at('inspect.json'));
  assert.equal(described.visibility.outputs.coat.visible, true);
});
