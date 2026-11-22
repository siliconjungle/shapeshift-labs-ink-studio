const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const kit = ink.load(), W = kit.KIT.world, R = W.runtime;
const world = require('../examples/visual-consequences/clay-crossing.world.json');
const repair = require('../examples/visual-consequences/repair.actions.json');
const cleaning = require('../examples/visual-consequences/cleaning.actions.json');
const visual = (run, options) => W.visual(kit, run.view(), run.query(), options);
const active = scene => Object.fromEntries(scene.visualConsequences.active.map(row => [row.id, row]));
const restore = saved => R.create(saved.world, { checkpoint: JSON.parse(JSON.stringify(saved)) });

test('site receipts render a scar, repaired joint and heavier trail after history eviction and checkpoint reload', () => {
  const run = R.create(world);
  const initial = visual(run);
  assert.deepEqual(initial.visualConsequences.active, []);
  assert.equal(initial.paintCorrections, undefined);
  run.advance(8);
  const early = visual(run);
  assert.equal(active(early)['worn-trail'].amount, .2);
  const fixed = run.fork({ branch: 'fixed' });
  const cleaned = run.fork({ branch: 'cleaned' });
  fixed.schedule(repair);
  cleaned.schedule(cleaning);
  for (const branch of [run, fixed, cleaned]) branch.advance(620);

  const checkpoint = fixed.checkpoint(), scene = visual(fixed), marks = active(scene);
  const expected = ['bridge-patch', 'kiln-char', 'worn-trail'];
  assert.deepEqual(Object.keys(marks), expected);
  assert(scene.paintCorrections.rows.length > 100);
  assert(Object.values(marks).every(row => row.samples > 100 && row.status === 'painted'));
  assert.equal(marks['worn-trail'].value, 5);
  assert.equal(marks['worn-trail'].amount, 1);
  assert.equal(marks['worn-trail'].change.id, '28.0');
  assert.equal(checkpoint.siteHistoryState.records['crossing/trail'].history[0].outcome, 'survey-saved');
  assert.equal(checkpoint.history.length, 0);
  assert(!checkpoint.worldFactState.events.some(row => row.id === '1.0'));
  assert.equal(marks['kiln-char'].cause.beatId, 'ink:beat:clay-crossing/main/1.0');
  assert.equal(marks['bridge-patch'].cause.beatId, 'ink:beat:clay-crossing/fixed/12.0');
  assert(!active(visual(cleaned))['kiln-char']);
  assert(!active(visual(run))['bridge-patch']);
  const east = branch => branch.query().probe('crossing/bodies').value['east-deck'];
  assert(east(fixed).half[0] > east(run).half[0]);
  assert.equal(visual(fixed, { visualConsequences: false }).paintCorrections, undefined);

  const saved = visual(restore(checkpoint), { time: 9000 });
  assert.deepEqual(saved.visualConsequences, scene.visualConsequences);
  assert.deepEqual(saved.paintCorrections.rows, scene.paintCorrections.rows);
  assert.deepEqual(fixed.checkpoint(), checkpoint);
});

test('transient paint combines with persistent site marks and a missing surface stays inspectable', async () => {
  const source = structuredClone(world);
  source.visual.consequences.rules['kiln-char'].paint.select = { entity: 'unloaded-floor' };
  const run = R.create(source);
  run.advance(3);
  const plan = { format: W.eventVisualEffects.planFormat, version: 1, id: 'kiln-fx', rules: {
    flash: { on: { kind: 'world-fact' }, cue: { kind: 'mark',
      detail: { pattern: 'soot', duration: 1, length: .7, width: .4, color: '#141b28' } } }
  } };
  const eventEffects = await W.eventVisualEffects.replay(run.recording(), plan);
  const scene = visual(run, { eventEffects });
  const missing = active(scene)['kiln-char'];
  assert.equal(missing.status, 'no-surface');
  assert.equal(missing.samples, 0);
  assert.equal(missing.cause.id, '1.0');
  assert(scene.eventEffects.marks[0].samples > 0);

  const original = R.create(world);
  original.advance(3);
  const combined = visual(original, { eventEffects });
  assert.equal(combined.paint.layers.length, 2);
  assert(combined.paint.layers.some(layer => layer.id.startsWith('event-fx-')));
  assert(combined.paint.layers.some(layer => layer.id === 'consequence-kiln-char'));
  source.visual.consequences.rules['kiln-char'].field = 'typo';
  assert.throws(() => R.create(source), /one state field or visits/);
});

test('simulation render publishes beat-linked paint evidence and supports a matched view with paint off', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-consequences-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const file = name => path.join(dir, name);
  const read = name => JSON.parse(fs.readFileSync(file(name)));
  fs.writeFileSync(file('world.json'), JSON.stringify(world));
  call('sim', 'run', 'world.json', '--ticks', '7', '--checkpoint', 'saved.json');
  call('sim', 'render', 'saved.json', '--w', '96', '--h', '64', '--out', 'marked.png', '--recipe', 'render.shot.json');
  call('sim', 'render', 'saved.json', '--w', '96', '--h', '64', '--out', 'bare.png', '--consequences', 'off');
  assert(!fs.existsSync(file('bare-consequences.json')));
  assert(!fs.readFileSync(file('marked.png')).equals(fs.readFileSync(file('bare.png'))));
  assert(read('render.shot.json').output.sidecars['-consequences.json']);
  const matched = JSON.parse(call('beat', 'ink:beat:clay-crossing/main/1.0', 'marked-consequences.json'));
  assert.equal(matched.matches[0].artifact, 'marked.png');
  assert.match(matched.matches[0].pointer, /\/cause$/);
});
