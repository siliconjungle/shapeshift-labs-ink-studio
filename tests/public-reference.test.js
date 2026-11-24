const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { differences } = require('../scripts/reference.js');
const { commandReference } = require('../scripts/reference-cli.js');
const { checkLinks } = require('../scripts/reference-links.js');
const { inventory, signature } = require('../scripts/reference-api.js');
const { interfaces } = require('../scripts/reference-interfaces.js');
const studio = require('..');

const root = path.resolve(__dirname, '..');
const cli = args => JSON.parse(execFileSync(process.execPath, ['cli/ink-studio.js', ...args, '--json'], {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
}));
const index = require('../docs/reference/index.json');
const entries = kind => index.entries.filter(entry => entry.kind === kind);
const temporaryDirectory = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-reference-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('the generated reference covers the live CLI, graphs and entry-point exports', async () => {
  assert.deepEqual(entries('command').map(entry => entry.title), cli(['help']).commands);
  const builtIn = studio.listGraphNodes().nodes.map(node => node.id);
  assert.deepEqual(entries('graph').map(entry => entry.id), builtIn);
  const known = new Set(builtIn);
  assert.deepEqual(entries('patch-node').map(entry => entry.id), cli(['patch', 'nodes']).nodes
    .map(node => node.id).filter(id => !known.has(id)));
  const [patchRun] = cli(['catalog', '--all', 'ink-studio patch run']).entries;
  assert.equal(patchRun.id, 'ink-studio patch run');
  assert.deepEqual(patchRun.flags, require('../cli/patch-cli.js').commandOptions.run);
  const documented = new Set(entries('api').map(entry => entry.id));
  const loaded = studio.load();
  const { KIT, ...toolkit } = loaded;
  for (const [prefix, value] of [
    ['node', studio], ['toolkit', toolkit], ['KIT', KIT],
    ['webgl', await import('../webgl.mjs')], ['webgpu', await import('../webgpu.mjs')],
    ['show-control', await import('../show-control.mjs')],
    ...interfaces(studio, loaded).map(({ name, value }) => [name, value])
  ]) for (const key of Object.keys(value)) {
    assert(documented.has(prefix + '.' + key), prefix + '.' + key);
  }
});

test('the command line can find a guide, a graph node and a qualified function', () => {
  assert(cli(['catalog', 'dither']).entries.some(entry => entry.id === 'look.viewDither'));
  assert(cli(['catalog', 'coverage', 'filter', '--all']).entries.some(entry =>
    entry.docs.some(file => file.startsWith('docs/texel-coverage.md'))));
  const guide = cli(['catalog', '--all', 'tightly packed top-down rgba8']).entries.find(entry =>
    entry.id === 'docs/patch-tooling.md');
  assert(guide?.docs[0].startsWith('docs/patch-tooling.md#'));
  const [node] = cli(['catalog', 'raster.resize', '--all']).entries;
  assert.equal(node.id, 'raster.resize');
  assert.equal(node.kind, 'graph');
  const [api] = cli(['catalog', 'KIT.pixelCanvasTransforms.plan', '--all']).entries;
  assert.equal(api.parameters, signature(studio.load().KIT.pixelCanvasTransforms.plan));
  assert.equal(api.source, 'src/pixel-canvas-transforms.js');
});

test('the docs comparison catches missing, edited and retired files', t => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, 'api.md'), 'before');
  fs.writeFileSync(path.join(directory, 'retired.md'), 'retired');
  const output = new Map([['api.md', 'after'], ['tool.md', 'new']]);
  assert.deepEqual(differences(directory, output), {
    changed: [['api.md', 'after'], ['tool.md', 'new']], extra: ['retired.md']
  });
});

test('the generator rejects a registered command without usage', t => {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(path.join(directory, 'cli'));
  fs.writeFileSync(path.join(directory, 'cli', 'ink-studio.js'),
    'console.log(JSON.stringify({commands:["documented","missing"], lines:["  documented <file>"]}));');
  assert.throws(() => commandReference(directory), /missing from help: missing/);
});

test('the generator rejects a registered graph subcommand without usage', t => {
  const directory = temporaryDirectory(t);
  const commands = path.join(directory, 'cli');
  fs.mkdirSync(commands);
  fs.writeFileSync(path.join(commands, 'ink-studio.js'),
    'console.log(JSON.stringify({commands:["graph"], lines:["  graph run <file>"]}));');
  fs.writeFileSync(path.join(commands, 'graph-cli.js'),
    'module.exports.commandOptions = {run:["out"],newAction:[]};');
  assert.throws(() => commandReference(directory), /missing from help: graph newAction/);
});

test('the link check validates actual headings and ignores fenced usage snippets', t => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, 'guide.md'), '# Guide\n\n## Lookup types\n\n```md\n[example](missing.md)\n```\n');
  checkLinks(directory, ['guide.md'], new Map([['generated.md', '# Generated\n\n[guide](guide.md#lookup-types)\n']]), []);
  assert.throws(() =>
    checkLinks(directory, ['guide.md'], new Map([['generated.md', '# Generated\n\n[guide](guide.md#stale)\n']]), []),
  /generated\.md → guide\.md#stale/);
});

test('function signatures preserve argument defaults, aliases and owning namespaces', () => {
  const method = ({ width = (1 + 2), caption = 'right )' } = {}, ...values) => [width, caption, values];
  const shape = { method };
  const rows = inventory([{ name: 'test', value: { original: shape, same: shape } }]).get('test');
  assert.deepEqual(rows, [
    { id: 'test.original', kind: 'namespace' },
    { id: 'test.original.method', kind: 'function', parameters: "({ width = (1 + 2), caption = 'right )' } = {}, ...values)", arity: 0 },
    { id: 'test.same', kind: 'alias', target: 'test.original' }
  ]);
  assert.equal(signature((expression = /\)\{/) => expression), '(expression = /\\)\\{/)' );
});
