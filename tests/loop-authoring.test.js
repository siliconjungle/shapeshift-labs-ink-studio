const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT: K } = ink.load(), L = K.loopAuthoring;
const PNG = require('../cli/png.js');

const mix = (a, b, f) => a + (b - a) * f;
function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-loop-authoring-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const equal = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, a + ' != ' + b);

test('cycle detection compares typed states exactly and finds the transient and confirmed period', () => {
  const scratch = new Uint8Array(2);
  const result = L.detect({ from: 10, maxTicks: 14, stateAt(tick) {
    scratch[0] = tick < 12 ? tick : (tick - 12) % 3;
    scratch[1] = tick % 3;
    return tick % 2 ? { cells: scratch, flags: [false] } : { flags: [false], cells: scratch };
  } });
  assert.deepEqual(result, { found: true, startTick: 12, endTick: 15, periodTicks: 3,
    confirmedThrough: 18, examined: 9 });
  assert.equal(L.detect({ from: 0, maxTicks: 3, confirm: 0, stateAt: t => t ? 0 : -0 }).periodTicks, 1);
  assert.equal(L.detect({ from: 0, maxTicks: 3, confirm: 0, stateAt: t => t ? 0 : -0 }).startTick, 1);
});

test('confirmation drops an accidental match and reports bounded searches', () => {
  assert.deepEqual(L.detect({ stateAt: i => [7, 7, 5, 6, 5, 6, 5][i], maxTicks: 6 }),
    { found: true, startTick: 2, endTick: 4, periodTicks: 2, confirmedThrough: 6, examined: 7 });
  assert.deepEqual(L.detect({ stateAt: n => n, maxTicks: 4 }), { found: false, reason: 'tick-budget', examined: 5 });
  assert.deepEqual(L.detect({ stateAt: n => n ? 'oversized' : 0, maxTicks: 4, maxStateChars: 2 }),
    { found: false, reason: 'state-budget', examined: 1 });
  assert.throws(() => L.detect({ stateAt: () => ({ value: Infinity }) }), /cycle state must contain finite/);
  const circle = []; circle.push(circle);
  assert.throws(() => L.detect({ stateAt: () => circle }), /circular/);
});

test('discrete cycle keys can include the phase of alternating neighborhood rules', () => {
  const grid = K.cellular.create({ width: 4, height: 4, boundary: 'wrap',
    initial: ({ x, y }) => +(x === 0 && y === 0), rule: K.cellular.rules.blockRotate() });
  const result = L.detect({ stateAt(tick) {
    if (tick > 0) grid.step();
    return { partition: tick % 2, cells: grid.snapshot().cells };
  }, maxTicks: 64 });
  assert(result.found);
  assert.equal(result.periodTicks % 2, 0);
  assert.equal(result.startTick, 0);
});

test('multiple periodic tracks share a bit-exact join with offset and reverse motion', () => {
  const from = 1e10, period = 6.4;
  const clock = L.phaseLock({ from, period, tracks: {
    drift: { period: 2.2, phase: .17 }, counter: { period: 3.05, phase: -.125, turns: -2 }
  } });
  assert.equal(clock.tracks.drift.turns, 3);
  assert.equal(clock.tracks.counter.rate, -2 * 3.05 / 6.4);
  for (const name of ['drift', 'counter']) {
    assert.deepEqual(clock.sample(name, from + period), clock.sample(name, from));
    assert.deepEqual(clock.sample(name, from - period), clock.sample(name, from));
  }
  equal(clock.sample('counter', from + period / 4).phase, .375, 2e-6);
  assert.equal(clock.phaseAt(from + period), 0);
  assert.throws(() => clock.sample('absent', from), /unknown periodic track/);
  assert.throws(() => L.phaseLock({ period: 2, tracks: { bad: { period: 1, turns: .5 } } }), /integer turns/);
});

test('checkpoint overlap joins a forward-moving tail to itself and leaves the input checkpoint intact', () => {
  const saved = Object.freeze({ tick: 42, snapshot: 7 }), reads = [];
  const tape = L.fromCheckpoint(saved, { periodTicks: 12, overlapTicks: 4, dt: .25, from: .1,
    open: checkpoint => ({ ...checkpoint, step() { this.tick++; this.snapshot += 2; } }),
    read(solver, tick) { reads.push(tick); return solver.snapshot; }, blend: mix });
  assert.deepEqual(reads, Array.from({ length: 17 }, (_, index) => 42 + index));
  assert.deepEqual(tape.join, { from: .1, end: 3.1, sourceTick: 54 });
  assert.equal(tape.sample(.1), 31);
  assert.equal(tape.sample(3.1), 31);
  assert.equal(tape.sample(.6), 23);
  assert.equal(tape.sample(1.1), 15);
  assert.deepEqual(tape.describe(.6), { phase: 1 / 6, headTick: 44, tailTick: 56, headWeight: .5 });
  assert.equal(tape.describe(1.1).tailTick, null);
  const e = .00001, slopeIn = (tape.sample(3.1) - tape.sample(3.1 - e)) / e;
  const slopeOut = (tape.sample(.1 + e) - tape.sample(.1)) / e;
  equal(slopeIn, slopeOut, .001);
  assert.deepEqual(saved, { tick: 42, snapshot: 7 });
});

test('checkpoint replay opens retained input records including future marks', () => {
  const I = K.simulationInputs, D = K.cellular.domain, domain = D.image({ width: 2, height: 1 });
  const build = seed => I.domain(D.create({ domain, seed, dt: .5, channels: ['wear'],
    rule: ({ state }) => ({ wear: state.wear + 1 }) }));
  const live = I.create({ seed: 41, build, marks: [{ id: 'weather', tick: 6, kind: 'inject', cells: [[1, 0]], value: { wear: 9 } }] });
  live.seek(2);
  const checkpoint = JSON.parse(JSON.stringify(live.checkpoint()));
  const tape = L.fromCheckpoint(checkpoint, { periodTicks: 4, overlapTicks: 1,
    open: data => I.open(data, { build }), read: playback => playback.frame().get([1, 0]).wear, blend: mix,
    interpolate: false });
  assert.equal(tape.sample(0), 15);
  assert.equal(tape.sample(2), 15);
  assert.equal(tape.sample(1.25), 4);
  assert.equal(live.tick, 2);
});

test('publishing compares the encoded join and separately renders the excluded endpoint', t => {
  const out = folder(t), samples = [];
  const { manifest } = ink.exportScene(({ width: w, height: h }) => {
    const rgb = new Uint8Array(w * h * 3).fill(90), alpha = new Uint8Array(w * h);
    return { scene: 'ring', sample(time) {
      samples.push(time);
      alpha.fill(250);
      if (time === 1.5) alpha[0] = 230;
      return { w, h, rgb, alpha };
    } };
  }, { out, formats: ['loop', 'replay'], width: 16, height: 10, from: 1, to: 1.75, fps: 4, loopJoin: true });
  const { report: file, image } = manifest.loopJoin, report = read(path.join(out, file));
  assert.deepEqual(samples, [1, 1.25, 1.5, 1.75]);
  assert.equal(manifest.sequence.frameCount, 3);
  assert.equal(read(path.join(out, manifest.replay)).frames.length, 3);
  assert.deepEqual(report.join.from, { index: 2, time: 1.5 });
  assert.deepEqual(report.join.to, { index: 0, time: 1 });
  assert.equal(report.join.changedPixels, 1);
  assert.equal(report.join.maxChannelDelta, 20);
  assert.equal(report.preceding.changedPixels, 1);
  assert.deepEqual(report.closure.endpoint, { time: 1.75, included: false });
  assert.equal(report.closure.exact, true);
  assert(PNG.raster(path.join(out, image)).w > 100);
});

test('clip join verification and sidecars survive shot recipe replay', t => {
  const out = folder(t), scene = path.join(out, 'scene.js');
  fs.writeFileSync(scene, `module.exports = ({ KIT: K, makeBuilder }) => ({
    id: 'loop-join-fixture', seed: 41, build(seed) {
      const B = makeBuilder(seed, [0x111522, 0xf8c879]);
      const lock = K.loopAuthoring.phaseLock({ period: 1, tracks: { rotor: { period: .9, turns: 1 } } });
      const points = K.frameSplats(B, 1, (draw, _, t) => {
        const x = Math.cos(Math.PI * 2 * lock.sample('rotor', t).phase);
        draw.point([x, 0, 0], { width: .18, density: 2, color: 1 });
      });
      const world = B.finish({ cam: { target: [0,0,0], dist: 5, yaw: 0, pitch: 0, sway: 0 }, dither: 0 });
      const stage = K.stage(world); stage.stateful = false; stage.add(points); stage.update(0, 0);
      return world;
    }
  });`);
  const cli = path.join(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: out });
  run('clip', scene, '--to', '1', '--fps', '4', '--w', '68', '--h', '48', '--px', '1', '--loop-join',
    '--out', 'clip.png', '--recipe', 'clip.json');
  const actual = read(path.join(out, 'clip-join.json'));
  assert.equal(actual.frameCount, 4);
  assert.equal(actual.closure.exact, true);
  assert(actual.join.changedPixels > 0);
  run('shot', 'replay', 'clip.json', '--out', 'replay.png');
  for (const suffix of ['.png', '-join.json', '-join.png'])
    assert.deepEqual(fs.readFileSync(path.join(out, 'clip' + suffix)), fs.readFileSync(path.join(out, 'replay' + suffix)));
});
