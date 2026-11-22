const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const { KIT: { world: W } } = load();
const R = W.runtime;
const examples = path.join(__dirname, '../examples/story-documents');
const example = name => path.join(examples, name + '.world.json');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const world = name => embedStoryDocuments(read(example(name)), example(name));
const json = value => JSON.parse(JSON.stringify(value));
const starts = run => run.checkpoint().history.filter(row => row.kind === 'story-started');
const startTicks = run => starts(run).map(({ story, tick, trigger }) => [story, tick, trigger]);

test('Burned Mill uses matching discovery and counted shortages, resets interrupted dwell, and routes a start to event actions', () => {
  const run = R.create(world('burned-mill'));
  run.advance(5);
  const checkpoint = json(run.checkpoint());
  const sampled = run.query().probe('world/story-triggers').value;
  assert.deepEqual(sampled['burned-mill/carry-grain'].progress['repeat-shortage'], ['4.0', '5.0']);
  assert.deepEqual(sampled['burned-mill/mill-recovery'].progress['grain-stays-low'], { matching: true, since: 5 });
  assert.deepEqual(startTicks(run), [['mill-fire', 1, 'survey-report']]);
  const loaded = R.create(checkpoint.world, { checkpoint });
  const fork = run.fork();
  run.advance(12);
  assert.deepEqual(startTicks(run), [
    ['mill-fire', 1, 'survey-report'], ['carry-grain', 6, 'repeat-shortage'], ['mill-recovery', 8, 'grain-stays-low']
  ]);
  const [, repeat, held] = starts(run);
  assert.deepEqual(repeat.evidence, { kind: 'event', events: ['4.0', '5.0', '6.0'] });
  assert.deepEqual(held.evidence, { kind: 'state', field: 'world/account', since: 5, ticks: 3 });
  const bell = run.checkpoint().history.find(row => row.kind === 'mill-bell');
  assert.equal(bell.story, 'carry-grain');
  assert.equal(bell.tick, 7);
  for (const branch of [loaded, fork]) {
    branch.advance(12);
    assert.deepEqual(branch.checkpoint(), run.checkpoint());
  }
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
  checkpoint.storyTriggerState['burned-mill/carry-grain'].progress['repeat-shortage'][0] = '8.0';
  assert.throws(() => R.create(checkpoint.world, { checkpoint }), /Invalid saved story trigger state/);
});

test('Empty Observatory starts from the actual completed move and a measured crossing', () => {
  const run = R.create(world('observatory'));
  run.advance(30);
  assert.deepEqual(startTicks(run), [['main-lens', 4, 'charge-crossed'], ['lookout-arrived', 20, 'arrival']]);
  const [power, arrival] = starts(run);
  assert.equal(power.stage, 'align');
  assert.equal(arrival.stage, 'survey');
  const [id] = arrival.evidence.events;
  assert(run.checkpoint().history.some(row => row.id === id && row.system === 'team' && row.kind === 'order-succeeded'));
  assert.equal(run.query().probe('power/charge', { entity: 'lookout' }).value, .75);
});

function waterStory(triggers) {
  return { format: 'ink-studio/story', version: 1, id: 'river', stories: {
    rescue: { title: 'River rescue', kind: 'incident', entry: 'go', triggers,
      stages: { go: { title: 'Go', next: { ready: { outcome: 'done' } } } }, outcomes: { done: { title: 'Done' } } }
  } };
}

test('initially true or missing state cannot fake a crossing, while sustained state measures from tick zero', () => {
  const when = { path: '/wet', value: true };
  const state = name => ({ field: 'world/entity', at: { entity: name }, when });
  const documents = [waterStory({ wet: { state: state('crossing') } }), waterStory({ wet: { state: state('spring'), hold: .25 } })];
  documents[1].id = 'spring';
  const edit = (tick, path, value) => ({ tick, action: 'world/patch', args: { edits: [{ op: 'set', path, value }] } });
  const run = R.create({ dt: .1, entities: { spring: { wet: true } }, storyDocuments: documents, commands: [
    edit(1, '/entities/crossing', { wet: true }), edit(4, '/entities/crossing/wet', false), edit(5, '/entities/crossing/wet', true)
  ] });
  run.advance(3);
  assert.deepEqual(starts(run).map(row => [row.document,row.tick,row.evidence.since]), [['spring',3,0]]);
  run.advance(6);
  assert.deepEqual(starts(run).map(row => [row.document,row.tick,row.evidence.since]), [['spring',3,0],['river',5,5]]);
});

test('story rules resolve ties by trigger ID, match committed events without retained history, and start only once', () => {
  const trigger = { event: { kind: 'arrival', system: 'world' } };
  const run = R.create({ storyDocuments: [waterStory({ last: trigger, first: trigger })], history: { enabled: false },
    commands: [1,2].map(tick => ({ tick, action: 'world/event', args: { kind: 'arrival' } })) });
  run.step();
  assert.equal(run.events.find(row => row.kind === 'story-started').trigger, 'first');
  run.step();
  assert.deepEqual(run.events.map(row => row.kind), ['arrival']);
  assert.equal(run.query().probe('world/story-triggers').value['river/rescue'].start.tick, 1);
});

test('repeat windows include the exact boundary and count distinct events at the same tick', () => {
  const document = waterStory({ repeat: { event: { kind: 'shortage' }, count: 3, within: .3 } });
  const commands = [1,4,4].map(tick => ({ tick, action: 'world/event', args: { kind: 'shortage' } }));
  const run = R.create({ dt: .1, storyDocuments: [document], commands });
  run.advance(4);
  assert.deepEqual(starts(run)[0].evidence.events, ['1.0', '4.0', '4.1']);
});

test('scene export can advance a world with an external story document', () => {
  const { readExportWorld } = require('../cli/scene-export-world.js');
  const run = readExportWorld(example('observatory'), load()).runtime();
  run.advance(30);
  assert.equal(starts(run).length, 2);
});

test('invalid trigger syntax, world references and duplicated documents are rejected', () => {
  const event = { kind: 'arrival' };
  const state = { field: 'unknown/charge', when: { op: 'gte', value: .6 } };
  for (const [rule, pattern] of [
    [{ event, count: 3 }, /within/], [{ event, within: 2 }, /within/], [{ event, state }, /unknown field/],
    [{ event: { ...event, where: { all: [], value: true } } }, /unknown field/],
    [{ state: { ...state, when: { op: 'gte', value: 'high' } } }, /expected a value/],
    [{ state: { ...state, when: { path: '/bad~2path', value: true } } }, /JSON Pointer/],
    [{ state, hold: 0 }, /positive duration/], [{ event: { kind: 'story-started' } }, /source event kind/]
  ]) assert.throws(() => validateStoryDocument(waterStory({ arrival: rule })), pattern);
  assert.throws(() => R.validate({ storyDocuments: [waterStory({ crossing: { state } })] }), /Unknown story query field/);
  assert.throws(() => R.validate({ storyDocuments: [waterStory({ arrival: { event: { ...event, system: 'missing' } } })] }), /Unknown story event source/);
  const document = waterStory({ arrival: { event } });
  assert.throws(() => R.validate({ storyDocuments: [document,document] }), /Duplicate story document ID/);
});

test('CLI embeds external story files in portable recordings and can probe and replay the demo', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-triggers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = path.join(dir, 'mill.json'), doc = path.join(dir, 'burned-mill.json'), take = path.join(dir, 'take.json');
  fs.copyFileSync(example('burned-mill'), manifest);
  fs.copyFileSync(path.join(examples, 'burned-mill.json'), doc);
  const cli = path.join(__dirname, '../cli/ink-studio.js');
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' }));
  command('sim', 'run', manifest, '--ticks', '12', '--record', take);
  fs.unlinkSync(doc);
  assert.equal(read(take).origin.world.storyDocuments[0].format, 'ink-studio/story');
  assert.equal(command('sim', 'replay', take).tick, 12);
  const report = command('probe', take, '--field', 'world/history', '--args', '{"where":{"path":"/kind","value":"story-started"}}');
  assert.deepEqual(report.value.events.map(row => row.tick), [1, 6, 8]);
});
