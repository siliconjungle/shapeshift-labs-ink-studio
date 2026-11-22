const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();

const W = K.world, api = W.actorPerformance;
const scope = { story: 'harbor-watch/dispatch', role: 'pilot' };
const signal = { duration: .4, tracks: { arm: [{ time: 0, angle: 0 }, { time: .4, angle: .8 }] } };
const brow = { duration: .3, tracks: { brow: [{ time: 0, scale: 1.25 }] } };
const cue = (kind, target, detail, extra = {}) => ({ kind, target, detail, ...extra });

function definition() {
  return { format: api.planFormat, version: 1, id: 'dispatch-performance',
    cast: { pilot: { role: scope, visible: false, node: 'left', label: 'Pilot', sockets: { hand: 'grip' },
      gestures: { signal }, expressions: { brow } },
    keeper: { actor: 'watch-keeper', node: 'right', sockets: { hand: 'grip' } } },
    props: { chart: { home: 'stand', transform: { position: [0, .1, 0] } } },
    rules: {
      'a-enter': { on: { kind: 'warning' }, cue: cue('cast', 'pilot', { visible: true }) },
      'b-gesture': { on: { kind: 'warning' }, cue: cue('gesture', 'pilot', { clip: 'signal' }) },
      'c-expression': { on: { kind: 'warning' }, cue: cue('expression', 'pilot', { clip: 'brow' }) },
      'd-dialogue': { on: { kind: 'warning' }, cue: cue('dialogue', 'pilot', { text: '', duration: .5 },
        { bindings: { '/text': '/payload/transcript' } }) },
      'e-prop': { on: { kind: 'warning' }, cue: cue('prop', 'chart', { actor: 'pilot', socket: 'hand' }) },
      'f-handoff': { on: { kind: 'pass-chart' }, cue: cue('prop', 'chart', { actor: 'keeper', socket: 'hand' }) },
      'g-return': { on: { kind: 'put-chart-away' }, cue: cue('prop', 'chart', { actor: null }) }
    } };
}

function recording() {
  const world = structuredClone(require('../examples/world-access/harbor.world.json'));
  world.storyDocuments[0].stories.dispatch.roles = { pilot: { kind: 'actor' } };
  world.storyBindings = { [scope.story]: { pilot: { kind: 'actor', value: { entity: 'west-lantern' } } } };
  world.commands.push(...[
    [2, 'warning', { transcript: 'Tide & wind <danger> --> wait\n\nNow.' }],
    [5, 'pass-chart', {}], [9, 'put-chart-away', {}]
  ].map(([tick, kind, data]) => ({ tick, action: 'world/event', args: {
    kind, ...data, ...(tick === 2 && { timing: { format: 'ink-studio/event-time', time: .185 } })
  } })));
  const run = W.runtime.create(world);
  run.advance(12);
  return run.recording();
}

test('verified actor replay resolves cast, layers gestures and expressions, and hands a prop to another socket', async () => {
  const tape = recording(), sheet = await api.replay(tape, definition()), adapter = api.open(sheet);
  assert.deepEqual(tape.end.history, []);
  assert.deepEqual(sheet.cast.pilot.actor, { entity: 'west-lantern' });
  assert.equal(adapter.sample(0).cast.pilot.visible, false);
  assert.equal(adapter.sample(0).props.chart.parent, 'stand');
  const posed = adapter.sample(.4);
  assert.equal(posed.cast.pilot.visible, true);
  assert(Math.abs(posed.cast.pilot.pose.arm.angle - .4) < 1e-9);
  assert.equal(posed.cast.pilot.pose.brow.scale, 1.25);
  assert.deepEqual(posed.props.chart.parent, { node: 'left', socket: 'grip' });
  assert.equal(posed.lettering[0].time, .2);
  assert.deepEqual(posed.lettering[0].source.timecode, { numerator: 37, denominator: 200 });
  assert.equal(posed.lettering[0].beatId, 'ink:beat:lantern-harbor/main/2.0');
  const graph = { nodes: { left: { sockets: { grip: { position: [1, 2, 0] } } },
    right: { sockets: { grip: { position: [3, 2, 0] } } }, stand: {}, chart: {} } };
  assert.deepEqual(api.scene(graph, posed).frame('chart').position, [1, 2.1, 0]);
  const handed = adapter.sample(.5);
  assert.deepEqual(handed.props.chart.parent, { node: 'right', socket: 'grip' });
  assert.deepEqual(api.scene(graph, handed).frame('chart').position, [3, 2.1, 0]);
  assert.deepEqual(adapter.sample(.7).lettering, []);
  assert.deepEqual(adapter.sample(.7).cast.pilot.pose, {});
  assert.equal(adapter.sample(.9).props.chart.parent, 'stand');
  assert.deepEqual(adapter.sample(.4), posed);
});

test('a portable cue sheet supports edited placement and exact sampling through graph ports', async () => {
  const plan = definition(), original = await api.replay(recording(), plan);
  plan.cast.pilot.actor = { entity: 'another-rig-cast' };
  const cueSheet = structuredClone(original.presentationCues);
  const speech = cueSheet.cues.find(row => row.kind === 'dialogue');
  speech.time = 1;
  delete speech.timecode;
  const sheet = api.project(cueSheet, plan), graph = K.procedural.graph.create({
    nodes: { performance: { op: 'scene.actorPerformance', inputs: { sheet, actor: 'pilot' } } },
    outputs: { caption: { node: 'performance', port: 'caption' }, pose: { node: 'performance', port: 'pose' },
      lettering: { node: 'performance', port: 'lettering' } }
  });
  const frame = K.timeDomains.take({ fps: 10 }).at(10), out = graph.evaluate({}, { take: frame }).outputs;
  assert.match(out.caption, /Tide & wind/);
  assert.deepEqual(out.pose, {});
  assert.equal(out.lettering[0].source.tick, 2);
  assert.equal(out.lettering[0].beatId, speech.beatId);
  const invalid = structuredClone(sheet);
  invalid.presentationCues.cues.find(row => row.kind === 'prop').detail.socket = 'missing';
  assert.throws(() => api.open(invalid), /cast socket/);
});

test('the CLI writes a native cue timeline, exact lettering and escaped portable captions', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-actor-performance-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  fs.writeFileSync(file('world.run.json'), JSON.stringify(recording()));
  fs.writeFileSync(file('plan.json'), JSON.stringify(definition()));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const command = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
  const output = command('story', 'performance', 'world.run.json', 'plan.json', '--out', 'stage');
  assert.equal(output.status, 0, output.stderr);
  const vtt = fs.readFileSync(file('stage/captions.vtt'), 'utf8');
  assert.match(vtt, /WEBVTT\n\ncue-\d+\n00:00:00\.200 --> 00:00:00\.700\nPilot: Tide &amp; wind &lt;danger&gt; --&gt; wait\nNow\./);
  const native = command('timeline', 'stage/timeline.json');
  assert.equal(native.status, 0, native.stderr);
  assert.equal(JSON.parse(native.stdout).cues.filter(row => row.kind === 'dialogue').length, 1);
  fs.mkdirSync(file('protected'));
  fs.linkSync(file('plan.json'), file('protected/performance.json'));
  const protectedFile = command('story', 'performance', 'world.run.json', 'plan.json', '--out', 'protected');
  assert.equal(protectedFile.status, 1);
  assert.match(protectedFile.stderr, /separate from source files/);

  const plan = definition(), scene = JSON.stringify({ id: 'chart' });
  const sha256 = createHash('sha256').update(scene).digest('hex');
  plan.props.chart.scene = { asset: 'harbor/chart', revision: 1 };
  fs.writeFileSync(file('plan.json'), JSON.stringify(plan));
  fs.writeFileSync(file('chart.json'), scene);
  fs.writeFileSync(file('catalog.json'), JSON.stringify({ format: 'ink-studio/asset-registry', version: 1,
    entries: [{ ...plan.props.chart.scene, kind: 'scene', file: 'chart.json', sha256 }] }));
  const pinned = command('story', 'performance', 'world.run.json', 'plan.json', '--out', 'pinned',
    '--asset-registry', 'catalog.json');
  assert.equal(pinned.status, 0, pinned.stderr);
  const sheet = JSON.parse(fs.readFileSync(file('pinned/performance.json')));
  assert.deepEqual(api.open(sheet).sample(.5).props.chart.scene, { ...plan.props.chart.scene, sha256 });
});
