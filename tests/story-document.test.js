const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');

const cli = path.join(__dirname, '../cli/ink-studio.js');
const example = path.join(__dirname, '../examples/story-documents/burned-mill.json');
const graph = path.join(path.dirname(example), 'inspect.graph.json');
const source = JSON.parse(fs.readFileSync(example, 'utf8'));
const command = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('story document keeps stable IDs when labels and table order change', () => {
  const document = structuredClone(source);
  const { stories } = document;
  stories['mill-fire'].title = 'The mill caught fire';
  document.stories = Object.fromEntries(Object.entries(stories).reverse());
  const before = JSON.stringify(document);
  assert.equal(ink.validateStoryDocument(document), document);
  assert.equal(JSON.stringify(document), before);
  assert.deepEqual(ink.readStoryDocument(example), source);
  assert.equal(document.stories['mill-recovery'].stages.damage.story, 'mill-fire');
  assert.equal(document.stories['carry-grain'].roles.porter.ref, undefined);
});

test('story document validates the exact version, shape and namespace of each link', () => {
  const checks = [
    [d => { d.format = 'ink-studio/story-run'; }, /story\.format: expected ink-studio\/story/],
    [d => { d.version = 2; }, /story\.version: unsupported version 2/],
    [d => { d.stories = []; }, /story\.stories: expected an object/],
    [d => { d.stories = {}; }, /story\.stories: expected at least one entry/],
    [d => { d.stories.bad = { ...d.stories['mill-fire'], kind: 'chapter' }; }, /stories\.bad\.kind/],
    [d => { d.stories['mill-fire'].entry = 'collect'; }, /\.entry: unknown stage "collect"/],
    [d => { d.stories['mill-fire'].refs.push('missing'); }, /\.refs\[1\]: unknown reference/],
    [d => { d.stories['carry-grain'].roles.requester.ref = 'crossing'; }, /\.roles\.requester\.ref: reference kind must match "actor"/],
    [d => { d.stories['carry-grain'].stages.collect.roles.push('requester'); }, /\.roles\[2\]: duplicate role/],
    [d => { d.stories['carry-grain'].stages.collect.roles = ['missing']; }, /\.roles\[0\]: unknown role/],
    [d => { d.stories['mill-recovery'].stages.damage.story = 'missing'; }, /\.damage\.story: unknown story/],
    [d => { d.stories['mill-fire'].stages.assess.next['store-intact'].stage = 'assess'; }, /expected exactly one stage or outcome target/],
    [d => { d.stories['mill-fire'].stages.assess.next['store-intact'].outcome = 'settled'; }, /\.outcome: unknown outcome "settled"/],
    [d => { d.stories['mill-fire'].stages.assess.next = {}; }, /\.next: expected at least one entry/],
    [d => { d.stories['mill-fire'].stages.assess.next['store-intact'] = { end: 'stock-saved' }; }, /\.end: unknown field/],
    [d => { d.references['old-mill'].id = '../mill'; }, /\.old-mill\.id: expected an ID/],
    [d => { d.references.constructor = { kind: 'actor', id: 'replacement' }; }, /invalid ID "constructor"/],
    [d => { delete d.stories['mill-fire'].title; }, /\.title: required field/]
  ];
  for (const [change, expected] of checks) {
    const document = structuredClone(source);
    change(document);
    assert.throws(() => ink.validateStoryDocument(document), expected);
  }
});

test('story CLI validates and describes the example and reports invalid file references', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const check = command('story', 'validate', example);
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout), { format: 'ink-studio/story', version: 1, id: 'burned-mill', valid: true,
    stories: [{ id: 'mill-fire', kind: 'incident' }, { id: 'carry-grain', kind: 'questlet' }, { id: 'mill-recovery', kind: 'arc' }] });
  const selected = command('story', 'describe', example, 'mill-recovery');
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout), { documentId: source.id, version: 1, id: 'mill-recovery',
    definition: source.stories['mill-recovery'], references: source.references });
  assert.deepEqual(JSON.parse(command('story', 'describe', example).stdout), source);
  const missing = command('story', 'describe', example, 'missing');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /unknown story "missing"/);

  const invalid = path.join(dir, 'bad.json'), document = structuredClone(source);
  document.stories['mill-fire'].entry = 'absent';
  fs.writeFileSync(invalid, JSON.stringify(document));
  const bad = command('story', 'validate', invalid);
  assert.equal(bad.status, 1);
  assert(bad.stderr.includes(invalid));
  assert.match(bad.stderr, /story\.stories\.mill-fire\.entry: unknown stage "absent"/);
  assert.equal(bad.stdout, '');
});

test('normal graph assets can read an authored story by stable ID', () => {
  const project = ink.readGraphProject(graph);
  const result = project.run();
  assert.deepEqual(result.outputs.arc, source.stories['mill-recovery']);
  assert.deepEqual(JSON.parse(result.artifacts[0].bytes), source.stories['mill-recovery']);
});
