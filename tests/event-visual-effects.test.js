const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const kit = ink.load(), K = kit.KIT, W = K.world, Fx = W.eventVisualEffects;
const example = '../examples/event-visual-effects/';
const plan = require(example + 'spillway.effects-plan.json');
const world = require(example + 'spillway.world.json');

test('recorded coordinates and loads drive native optics, splats, surface paint and palette with exact lifetimes', async () => {
  const run = W.runtime.create(world);
  run.advance(92);
  const recording = run.recording(), sheet = await Fx.replay(recording, plan);
  assert.equal(sheet.presentationCues.cues.length, 14);
  assert.equal(recording.end.history.length, 0);
  const track = Fx.open(sheet);
  assert.equal(track.sample(.3999).active.length, 0);
  const sceneRun = W.runtime.openRecording(recording);
  sceneRun.advance(37);
  const view = sceneRun.view(), checkpoint = sceneRun.checkpoint();
  const bare = W.visual(kit, view, sceneRun.query());
  const scene = W.visual(kit, view, sceneRun.query(), { eventEffects: sheet });
  assert.equal(scene.areaLights.length, 1);
  assert.deepEqual(scene.areaLights[0].at, [1.58, 1.14, .65]);
  assert.equal(scene.areaLights[0].intensity, 3.8 * .94);
  assert.equal(scene.shapedAtmosphere.length, 1);
  assert(scene.shapedAtmosphere[0].field.sample(1.58, .54, .65) > .95);
  assert.equal(scene.shapedAtmosphere[0].field.sample(-1.63, .54, -.2), 0);
  assert(scene.count > bare.count);
  assert.deepEqual(scene.look.effectPalettes.sky.colors, world.commands[1].args.ramp);
  assert.equal(scene.paint.layers.length, 2);
  assert(scene.paintCorrections.rows.length > 20);
  assert(scene.paint.layers.every(layer => layer.decals.length > 10));
  assert(scene.eventEffects.active.every(row => W.inspectionLinks.identify(row.source) === row.beatId));
  assert.deepEqual(sceneRun.checkpoint(), checkpoint);
  assert.equal(track.sample(2.4).active.some(row => row.kind === 'shader'), false);
  assert.equal(track.sample(5.2).active.length, 0);
  assert.equal(track.sample(1.85, { world: world.id, stream: { lineage: [
    { fromTick: 0, branch: 'main' }, { fromTick: 9, branch: 'alternate' }
  ] } }).active.length, 1);
});

test('entity locations come from the verified commit tick and portable event logs need recorded coordinates', async () => {
  const run = W.runtime.create({ id: 'moving-emitter', dt: .1, history: { enabled: false },
    entities: { valve: { position: [1, 2, 3] } },
    commands: [
      { tick: 1, action: 'world/event', args: { kind: 'discharge', at: { entity: 'valve' } } },
      { tick: 2, action: 'world/patch', args: { edits: [{ op: 'set', path: '/entities/valve/position', value: [3, 2, 1] }] } }
    ] });
  run.advance(2);
  const recording = run.recording(), definition = {
    format: Fx.planFormat, version: 1, id: 'emitter', rules: {
      discharge: { on: { kind: 'discharge' }, cue: { kind: 'shader', target: 'water', delay: .1,
        detail: { value: 12, range: [0, 20], duration: .3, attack: .1, release: .2 } } }
    }
  };
  assert.deepEqual(run.query().target({ entity: 'valve' }).point, [3, 2, 1]);
  const sheet = await Fx.replay(recording, definition), track = Fx.open(sheet);
  const [cue] = sheet.presentationCues.cues;
  assert.deepEqual(cue.source.timecode, { numerator: 1, denominator: 10 });
  assert.deepEqual(cue.timecode, { numerator: 1, denominator: 5 });
  assert.deepEqual(track.sample(.2).active[0].at, [1, 2, 3]);
  assert.equal(track.sample(.4).active[0].amount, .3);
  assert.equal(track.sample(.5).active.length, 0);

  const log = { format: W.storyEvents.envelopeFormat, version: 1, world: 'moving-emitter',
    dt: .1, from: 0, to: 2, coverage: 'complete', dropped: 0, events: [] };
  await W.storySceneTimeline.scan(recording, row => { if (row.kind === 'discharge') log.events.push(row); });
  assert.throws(() => Fx.project(log, definition), /needs event value visual\/point/);
  log.events = log.events.map(row => ({ ...row, payload: { ...row.payload, trace: { xyz: [2, 4, 6] } } }));
  definition.rules.discharge.cue.bindings = { '/point': '/payload/trace/xyz' };
  const imported = Fx.project(log, definition);
  assert.deepEqual(imported.presentationCues.cues[0].detail.point, [2, 4, 6]);
  assert.equal(imported.presentationCues.cues[0].beatId, cue.beatId);
  const graph = ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1,
    nodes: { effect: { op: 'scene.eventEffects', inputs: { sheet: imported, channel: 'water' } } },
    outputs: { position: { node: 'effect', port: 'position' }, amount: { node: 'effect', port: 'amount' } }
  });
  const watches = { position: { output: 'position' }, amount: { output: 'amount' } };
  assert.deepEqual((await graph.previewFrame(watches, { time: .3 })).values, { position: [2, 4, 6], amount: .6 });
  assert.deepEqual((await graph.previewFrame(watches, { time: .5 })).values, { position: [0, 0, 0], amount: 0 });
});

test('sim render records the effect sheet dependency and preserves input files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-effects-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const save = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
  save('spillway.json', world);
  save('plan.json', plan);
  call('sim', 'run', 'spillway.json', '--ticks', '40', '--record', 'run.json');
  call('story', 'effects', 'run.json', 'plan.json', '--out', 'effects.json');
  call('sim', 'render', 'run.json', '--ticks', '12', '--event-effects', 'effects.json', '--w', '80', '--h', '60',
    '--out', 'frame.png', '--recipe', 'shot.json');
  assert.equal(read('frame-effects.json').active.length, 7);
  assert(read('shot.json').inputs.some(row => row.file === 'effects.json'));
  assert(read('shot.json').output.sidecars['-effects.json']);
  assert.throws(() => call('story', 'effects', 'run.json', 'plan.json', '--out', 'run.json'), /separate from source files/);
  assert.equal(read('run.json').end.tick, 40);
});
