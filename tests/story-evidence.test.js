const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const filename = path.resolve(__dirname, '../examples/story-documents/relief-crossing.world.json');
const readWorld = () => embedStoryDocuments(JSON.parse(fs.readFileSync(filename, 'utf8')), filename);
const key = 'relief-crossing/evacuate';
const state = run => run.query().probe('world/story-lifecycle').value[key];
const json = value => JSON.parse(JSON.stringify(value));
const story = world => world.storyDocuments[0].stories.evacuate;
const command = (tick, action, args) => ({ tick, action: 'world/story-' + action,
  args: { document: 'relief-crossing', story: 'evacuate', reason: 'test', ...args } });
const prepare = { stage: 'prepare', visit: 1 };

test('transfer, physical repair and both agent positions produce receipts and unlock the authored route', () => {
  const run = R.create(readWorld());
  run.advance(3);
  const partial = run.history.find(row => row.requestId === 'small-delivery');
  assert.deepEqual([partial.requested, partial.applied, partial.status], [4, 2, 'partial']);
  assert.deepEqual(run.history.find(row => row.kind === 'story-progress-rejected').pending, ['deliver-crates', 'mend-brace']);
  assert.deepEqual(state(run).flow.current.objectives, {});
  assert.equal(run.query().probe('rig/fatigue', {}, { body: 'brace' }).value.yielded, true);

  run.advance(32);
  assert.equal(run.query().probe('rig/fatigue', {}, { body: 'brace' }).value.yielded, false);
  const row = state(run), [before, after] = row.flow.route;
  assert.deepEqual([row.status, row.outcome, before.leftAt, after.leftAt], ['completed', 'sheltered', 8, 20]);
  for (const [id, kind, system, tick] of [
    ['deliver-crates', 'transfer', 'world', 5],
    ['mend-brace', 'body-repaired', 'rig', 7]
  ]) {
    const source = run.history.find(row => row.tick === tick && row.kind === kind && row.system === system);
    assert.ok(source);
    assert.deepEqual(before.objectives[id], { result: 'completed', reason: 'evidence-confirmed', tick,
      receipt: { kind: 'event', event: source } });
  }
  const safety = after.objectives['party-safe'].receipt;
  assert.deepEqual([safety.kind, safety.tick, safety.field], ['state', 19, 'crew/agents']);
  for (const id of ['scout', 'medic']) assert.ok(safety.value[id].position[0] >= 1);
  const resolved = run.history.filter(row => row.kind === 'story-objective-resolved');
  assert.deepEqual(resolved.map(row => row.receipt),
    [before.objectives['deliver-crates'].receipt, before.objectives['mend-brace'].receipt, safety]);
});

test('receipts survive missing history, resume, and replay, and checkpoint validation checks the proof', () => {
  const input = readWorld();
  input.history = { enabled: false };
  const run = R.create(input);
  run.advance(10);
  const pending = json(run.checkpoint());
  const restored = R.create(pending.world, { checkpoint: pending });
  restored.advance(32);
  run.advance(32);
  assert.deepEqual(run.history, []);
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());

  for (const damage of [
    flow => delete flow.route[0].objectives['deliver-crates'].receipt,
    flow => { flow.route[0].objectives['deliver-crates'].receipt.event.applied = 2; },
    flow => { flow.route[0].objectives['mend-brace'].receipt.event.id = '6.0'; },
    flow => { flow.route[1].objectives['party-safe'].receipt.value.medic.position[0] = 0; }
  ]) {
    const saved = json(run.checkpoint());
    damage(saved.storyLifecycleState[key].flow);
    assert.throws(() => R.create(saved.world, { checkpoint: saved }), /Invalid saved story lifecycle/);
  }
});

test('only an active visit sees source events and manual completion cannot bypass evidence', () => {
  const input = readWorld(), stage = story(input).stages.prepare;
  delete input.eventActions;
  input.commands = [];
  stage.objectives = {
    delivery: { title: 'Delivery', evidence: { event: { kind: 'delivered' } } },
    extra: { title: 'Optional delivery', optional: true, evidence: { event: { kind: 'delivered' } } },
    derived: { title: 'Derived event', optional: true, evidence: { event: { kind: 'story-objective-resolved' } } }
  };
  const run = R.create(input);
  assert.throws(() => run.schedule([command(2, 'objective', { ...prepare, objective: 'delivery', result: 'completed' })]),
    /requires world evidence/);
  const delivered = (tick, label) => ({tick, action: 'world/event', args: {kind: 'delivered', label} });
  run.schedule([
    delivered(1, 'before activation'),
    command(2, 'objective', { ...prepare, objective: 'extra', result: 'skipped' }),
    command(2, 'transition', { to: 'suspended' }),
    delivered(3, 'during suspension'),
    delivered(4, 'on resume'),
    command(4, 'transition', { to: 'active' }),
    delivered(5, 'first eligible'),
    delivered(5, 'second eligible'),
    command(6, 'choose', { ...prepare, branch: 'cross' })
  ]);
  run.advance(4);
  assert.deepEqual(state(run).flow.current.objectives, { extra: { result: 'skipped', reason: 'test', tick: 2 } });
  run.advance(6);
  const [closed] = state(run).flow.route;
  assert.equal(closed.objectives.delivery.receipt.event.label, 'first eligible');
  assert.equal(closed.objectives.delivery.tick, 5);
  assert.deepEqual(closed.skipped, ['derived']);
});

test('query evidence retains its selected value and never confirms an unavailable sample', () => {
  const input = readWorld(), stage = story(input).stages.prepare;
  delete input.eventActions;
  input.commands = [];
  stage.objectives = {
    ledger: { title: 'Initial ledger value', evidence: { state: {
      field: 'world/account', args: { account: 'supplies/depot' }, select: '/balance', when: { value: 2 }
    } } },
    missing: { title: 'Unavailable target', evidence: { state: {
      field: 'world/position', at: { entity: 'missing' }, select: [0], when: { not: { value: 1 } }
    } } }
  };
  const run = R.create(input);
  run.advance(1);
  assert.deepEqual(state(run).flow.current.objectives, {});
  run.advance(2);
  assert.deepEqual(state(run).flow.current.objectives, { ledger: {
    result: 'completed', reason: 'evidence-confirmed', tick: 2, receipt: {
      kind: 'state', tick: 2, field: 'world/account', args: { account: 'supplies/depot' }, select: '/balance', value: 2
    }
  } });
});

test('evidence definitions reject mixed sources, bad selectors and unknown world bindings', () => {
  const input = readWorld(), rule = story(input).stages.prepare.objectives['deliver-crates'].evidence;
  rule.state = { field: 'missing/value', when: { value: true } };
  assert.throws(() => validateStoryDocument(input.storyDocuments[0]), /evidence.state: unknown field/);
  delete rule.event;
  rule.state.select = '/__proto__';
  assert.throws(() => validateStoryDocument(input.storyDocuments[0]), /evidence.state.select: expected a valid path/);
  delete rule.state.select;
  assert.throws(() => R.create(input), /Unknown objective evidence query field missing\/value/);
  delete rule.state;
  rule.event = { kind: 'transfer', system: 'missing' };
  assert.throws(() => R.create(input), /Unknown objective evidence event source missing/);
});
