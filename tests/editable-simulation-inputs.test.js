const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: K } = require('..').load();
const I = K.simulationInputs, D = K.cellular.domain;
const json = data => JSON.parse(JSON.stringify(data));

test('tick-zero and scheduled marks compose in authored order on legacy lattice grids', () => {
  const build = seed => I.lattice(K.cellular.create({ seed, width: 5, height: 1, states: 5,
    initial: ({ x, random }) => x === 4 ? Math.floor(random() * 4) : 0, rule: ({ state }) => Math.max(state - 1, 0) }));
  const run = I.create({ seed: 40, build, marks: [
    { id: 'pin', tick: 0, kind: 'pin', cells: [[0, 0]], value: 3 },
    { id: 'paint', tick: 0, kind: 'brush', stroke: { points: [[1, 0, 0], [3, 0, 0]], radius: .1 }, value: 2 },
    { id: 'cut', tick: 0, kind: 'obstacle', cells: [[2, 0]] },
    { id: 'open', tick: 2, kind: 'obstacle', cells: [[2, 0]], enabled: false },
    { id: 'replace', tick: 2, kind: 'inject', cells: [[2, 0]], mode: 'replace', value: 1 },
    { id: 'add', tick: 2, kind: 'inject', cells: [[2, 0]], value: 2 }
  ] });
  const initial = run.frame();
  assert.deepEqual([...initial.cells.slice(0, 4)], [3, 2, 0, 2]);
  assert.equal(initial.locked[0], 1);
  assert.equal(initial.blocked[2], 1);
  const second = run.seek(2);
  assert.deepEqual([...second.cells.slice(0, 4)], [3, 0, 3, 0]);
  assert.equal(second.blocked, undefined);
  run.put({ id: 'pin', kind: 'pin', cells: [[0, 0]], value: 4 });
  assert.equal(run.record().marks[0].tick, 0);
  assert.equal(run.frame().cells[0], 4);
  assert.equal(initial.cells[0], 3);
  assert.deepEqual(run.seek(0).cells.slice(1), initial.cells.slice(1));
  assert.equal(run.record().seed, 40);
  assert(Object.isFrozen(run.record().marks[0].cells[0]));
});

test('graph obstacles discard pending signals and preserve independent pins', () => {
  const domain = D.graph({ nodes: ['source', 'receiver'], edges: [{ from: 'source', to: 'receiver', delay: 3 }] });
  const build = seed => I.domain(D.create({ domain, seed, states: 9,
    rule: ({ id, inputs }) => id === 'source' ? 0 : inputs[0]?.state ?? 0 }));
  const run = I.create({ build, marks: [
    { id: 'hold', tick: 0, kind: 'pin', cells: ['source'], value: 7 },
    { id: 'block', tick: 1, kind: 'obstacle', cells: ['source'] },
    { id: 'open', tick: 2, kind: 'obstacle', cells: ['source'], enabled: false },
    { id: 'fire', tick: 4, kind: 'inject', cells: ['source'], value: 5 },
    { id: 'unpin', tick: 5, kind: 'pin', cells: ['source'], enabled: false }
  ] });
  const origin = run.frame();
  const stopped = run.step();
  assert(stopped.isBlocked('source'));
  assert(stopped.isLocked('source'));
  assert.equal(stopped.get('source', 1), 0);
  assert.equal(origin.get('source'), 7);
  const saved = json(run.checkpoint()), resumed = I.open(saved, { build });
  assert.deepEqual(resumed.checkpoint(), saved);
  assert.equal(resumed.seek(3).get('receiver'), 0);
  assert(!resumed.frame().isBlocked('source'));
  assert(resumed.frame().isLocked('source'));
  assert.equal(resumed.seek(7).get('receiver'), 5);
  assert.deepEqual(resumed.frame().data(), run.seek(7).data());
  assert.equal(resumed.seek(0).get('source'), 7);
});

test('brushes use native XYZ distances and can write any subset of named state', () => {
  const domain = D.volume({ width: 3, height: 1, depth: 2, spacing: [2, 1, 1] });
  const build = seed => I.domain(D.create({ domain, seed, channels: ['age', 'heat'], dt: .1,
    initial: { age: 4, heat: 0 }, rule: ({ state }) => state }));
  const run = I.create({ build, marks: [
    { id: 'ink', tick: 0, kind: 'brush', stroke: { points: [[3, .5, .5]], radius: 2, falloff: 'smooth' }, value: { heat: 2 } }
  ] });
  const frame = run.seekTime(.3);
  assert.equal(frame.tick, 3);
  assert.deepEqual(frame.get([1, 0, 0]), { age: 4, heat: 2 });
  assert.deepEqual(frame.get([1, 0, 1]), { age: 4, heat: 1 });
  assert.deepEqual(frame.get([0, 0, 0]), { age: 4, heat: 0 });
  assert.deepEqual(I.open(json(run.record()), { build }).seekTime(.3).data(), frame.data());
  assert.throws(() => run.seekTime('1'), /finite nonnegative/);
});

test('continuous pins hold state and brushes respect fractional coverage and obstacles', () => {
  const build = () => I.continuous(K.cellular.continuous.create({ width: 4, height: 1, dt: .2, channels: ['paint', 'heat'],
    mask: [1, 1, .5, 0], initial: { heat: .5 }, rule: () => ({ paint: 0, heat: 0 }) }));
  const run = I.create({ build, marks: [
    { id: 'ink', tick: 0, kind: 'brush', cells: [[0, 0], [2, 0], [3, 0]], value: { paint: 1 } },
    { id: 'hold', tick: 0, kind: 'pin', cells: [[0, 0]] },
    { id: 'wall', tick: 0, kind: 'obstacle', cells: [[1, 0]] },
    { id: 'ink-wall', tick: 1, kind: 'inject', cells: [[1, 0]], value: { paint: .8 } },
    { id: 'open', tick: 2, kind: 'obstacle', cells: [[1, 0]], enabled: false },
    { id: 'ink-open', tick: 2, kind: 'inject', cells: [[1, 0]], value: { paint: .75 } }
  ] });
  assert.deepEqual([...run.frame().data('paint')], [1, 0, .5, 0]);
  assert(run.frame().isLocked(0, 0));
  assert(run.frame().isBlocked(3, 0));
  assert.equal(run.step().data('paint')[1], 0);
  const saved = I.open(json(run.checkpoint()), { build });
  assert.deepEqual([...run.step().data('paint')], [1, .75, .125, 0]);
  assert.deepEqual(saved.step().data('paint'), run.frame().data('paint'));
  assert.equal(run.frame().get(0, 0).heat, .5);
});

test('changing authored history replays atomically and failed edits preserve pending marks', () => {
  const domain = D.image({ width: 3, height: 1 });
  const build = seed => I.domain(D.create({ domain, seed, states: 5, rule: ({ tick, state }) => {
    if (state === 3 && tick === 2) throw Error('failed rule');
    return state;
  } }));
  const run = I.create({ seed: 9, build, marks: [{ id: 'pending', tick: 4, kind: 'inject', cells: [[1, 0]], value: 2 }] });
  run.seek(2);
  const before = run.checkpoint();
  assert.throws(() => run.put({ id: 'bad', tick: 1, kind: 'brush', cells: [[0, 0]], value: 3 }), /failed rule/);
  assert.deepEqual(run.checkpoint(), before);
  assert.throws(() => run.put({ id: 'bad-scope', tick: 6, kind: 'pin', cells: [[0, 0], '0,0'] }), /same cell/);
  assert.throws(() => run.put({ id: 'bad-stroke', kind: 'brush', value: 1,
    stroke: { radius: 1, falloff: 'smooth', points: [[0, 0, 0]] } }), /flat stroke/);
  assert.deepEqual(run.checkpoint(), before);
  run.put({ id: 'valid', tick: 1, kind: 'brush', cells: [[0, 0]], value: 2 });
  assert.deepEqual([...run.seek(4).data()], [2, 2, 0]);
  run.remove('valid');
  assert.deepEqual([...run.frame().data()], [0, 2, 0]);
});

test('scene export packs editable input tracks and re-imports them with the authored seed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-simulation-inputs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(__dirname, '../cli/ink-studio.js'), scene = path.join(__dirname, '../examples/editable-simulation-inputs.js');
  const execute = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const dimensions = ['--w', '120', '--h', '75', '--px', '1'];
  execute('export-scene', scene, ...dimensions, '--seed', '175', '--formats', 'replay,embed',
    '--from', '2', '--to', '2.2', '--fps', '10', '--out', dir);
  const manifest = read(path.join(dir, 'export.json')), sidecar = path.join(dir, manifest.simulationInputs);
  const input = read(sidecar), replayFile = path.join(dir, manifest.replay);
  const replay = read(replayFile), embed = fs.readFileSync(path.join(dir, manifest.embed), 'utf8');
  assert.equal(input.seed, 175);
  assert.equal(input.simulationInputs.channel.seed, 175);
  assert(input.simulationInputs.channel.marks.some(row => row.kind === 'obstacle' && row.tick === 0));
  assert(input.simulationInputs.channel.marks.some(row => row.kind === 'inject' && row.tick > 20));
  assert.deepEqual(replay.simulationInputs, input.simulationInputs);
  assert.deepEqual(JSON.parse(embed.match(/<script id="ink-scene-recording" type="application\/json">(.*?)<\/script>/)[1]).simulationInputs,
    input.simulationInputs);

  for (const inputs of [sidecar, replayFile]) {
    const image = path.join(dir, 'rerender.png');
    execute('render', scene, ...dimensions, '--authoring', inputs, '--t', '2.1', '--out', image);
    assert.deepEqual(fs.readFileSync(image), Buffer.from(replay.frames[1], 'base64'));
  }
});
