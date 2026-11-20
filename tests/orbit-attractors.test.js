const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const { attractors: { trace } } = K.procedural;

const close = (actual, expected, tolerance = 1e-11) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);
const point = (actual, expected, tolerance) => actual.forEach((v, i) => close(v, expected[i], tolerance));

test('Lorenz follows a fixed RK4 clock and reports derivative speed after burn-in', () => {
  const first = trace({ steps: 1, burnIn: 0 });
  assert.deepEqual(first.points[0], [1, 1, 1]);
  point(first.points[1], [1.0125671910736112, 1.2599177989452743, .9848909717916053]);
  close(first.speeds[0], Math.hypot(26, -5 / 3));
  assert.deepEqual(first.times, [0, .01]);
  assert.equal(first.kind, 'flow');

  const full = trace({ steps: 10, burnIn: 0 });
  const short = trace({ steps: 5, burnIn: 2, stride: 2 });
  assert.equal(short.warmed, 2);
  assert.equal(short.completed, 5);
  assert.deepEqual(short.points, [full.points[2], full.points[4], full.points[6], full.points[7]]);
  assert.deepEqual(short.times, [0, .02, .04, .05]);
  assert.deepEqual(short.points, trace({ steps: 5, burnIn: 2, stride: 2 }).points);
  assert(Object.isFrozen(short.points[0]));
});

test('Rössler integrates the analytic oscillator when its free coefficients are zero', () => {
  const orbit = trace({ family: 'rossler', parameters: { a: 0, b: 0, c: 0 }, start: [1, 0, 0],
    steps: 50, dt: .04, burnIn: 0 });
  point(orbit.points.at(-1), [Math.cos(2), Math.sin(2), 0], 7e-8);
  close(orbit.speeds.at(-1), 1, 1e-8);
  const half = orbit.at(.02);
  point(half.p, [(1 + orbit.points[1][0]) / 2, orbit.points[1][1] / 2, 0]);
  close(Math.hypot(...half.tan), 1);
  close(half.distance, orbit.distances[1] / 2);
  assert.deepEqual(orbit.at(-1).p, orbit.points[0]);
  point(orbit.at(3).p, orbit.points.at(-1));
});

test('Clifford and de Jong use their discrete maps and one-step speed regardless of stride', () => {
  const start = [.29, .81], [x, y] = start, parameters = { a: 1.34, b: -.29, c: .61, d: -1.55 },
    { a, b, c, d } = parameters;
  const models = [
    ['clifford', [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y), 0]],
    ['deJong', [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y), 0]]
  ];
  for (const [family, next] of models) {
    const settings = { family, start, parameters, burnIn: 0, steps: 3 };
    const orbit = trace(settings), skipped = trace({ ...settings, stride: 2 });
    assert.equal(orbit.kind, 'map');
    assert.equal(orbit.dimension, 2);
    assert.deepEqual(orbit.points[1], next);
    close(orbit.speeds[0], Math.hypot(next[0] - x, next[1] - y));
    assert.equal(skipped.speeds[1], orbit.speeds[2]);
  }
});

test('placed paths preserve captured bends and can drive an arc-length camera rail', () => {
  const orbit = trace({ family: 'lorenz', steps: 20, burnIn: 0, stride: 3 });
  const elbow = orbit.path({ from: .025, to: .035 });
  assert.equal(elbow.points.length, 3);
  assert.deepEqual(elbow.points[1], orbit.points[1]);
  const path = orbit.path({ from: .025, to: .173, maxPoints: 3 });
  assert.equal(path.points.length, 3);
  assert.equal(path.closed, false);
  assert.deepEqual(path.points[0], orbit.at(.025).p);
  assert.deepEqual(path.points.at(-1), orbit.at(.173).p);
  close(path.length, K.V.dist(path.points[0], path.points[1]) + K.V.dist(path.points[1], path.points[2]));
  const rig = K.cameraRig.compile({ rails: { orbit: { points: path.points, curve: 0 } },
    shots: { live: { rail: 'orbit', progress: 0, target: [0, 0, 0] } } });
  const camera = rig.sample(0, { base: { target: [0, 0, 0], yaw: 0, pitch: .1, dist: 9, fov: .52 } }).camera;
  assert(camera.dist > 0);
});

test('pose changes speeds in world units and density carries a mass-weighted speed channel', () => {
  const orbit = trace({ family: 'clifford', parameters: { a: 0, b: 0, c: .5, d: .5 }, start: [0, 0],
    steps: 2, burnIn: 0, pose: { scale: [2, 4, 1], rotation: [Math.PI / 2, 0, 0] } });
  const speed = Math.sqrt(5);
  point(orbit.points[1], [1, 0, 2]);
  close(orbit.speeds[0], speed);
  assert.equal(orbit.speeds[1], 0);
  const view = orbit.density({ projection: 'xz', bounds: { min: [-.5, -1], max: [1.5, 3] },
    resolution: [2, 2], exposure: 0 });
  assert.equal(view.deposited, 3);
  assert.deepEqual(view.bin(0, 0), { mass: 1, density: .5, speed });
  assert.deepEqual(view.bin(1, 1), { mass: 2, density: 1, speed: 0 });
  close(view.at(.5, 1).speed, speed / 3);
  const clipped = orbit.density({ projection: 'xz', bounds: { min: [.1, .1], max: [1, 2] }, resolution: 1 });
  assert.equal(clipped.deposited, 2);
  assert.equal(clipped.clipped, 1);
  assert.equal(view.sample(3, 1), 0);

  const volume = orbit.density({ projection: 'xyz', resolution: 6 });
  assert.equal(volume.deposited, 3);
  assert.equal(K.atmosphere.field({ field: volume }).field, volume);
});

test('equilibria and escaped orbits remain safe to query', () => {
  const equilibrium = trace({ start: [0, 0, 0], steps: 3, burnIn: 0 });
  assert.equal(equilibrium.status, 'complete');
  assert.equal(equilibrium.path(), null);
  assert.equal(equilibrium.at(.01).speed, 0);
  assert.deepEqual(equilibrium.at(.01).tan, [0, 0, 0]);
  assert.equal(equilibrium.density({ resolution: 3 }).peak, 4);

  const settings = { family: 'deJong', start: [0, 0], escape: .5, steps: 12 };
  const early = trace({ ...settings, burnIn: 2 });
  assert.equal(early.status, 'escaped');
  assert.equal(early.bounds, null);
  assert.equal(early.at(0), null);
  assert.equal(early.path(), null);
  assert.equal(early.density({ bounds: { min: [-1, -1], max: [1, 1] } }).peak, 0);
  const measured = trace({ ...settings, burnIn: 0 });
  assert.equal(measured.status, 'escaped');
  assert.equal(measured.completed, 0);
  assert.deepEqual(measured.at(40).p, [0, 0, 0]);
});

test('unknown systems, coefficients, time controls, and projections fail before work begins', () => {
  assert.throws(() => trace({ family: 'constructor' }), /family/);
  assert.throws(() => trace({ parameters: { delta: 42 } }), /coefficients/);
  assert.throws(() => trace({ dt: 0 }), /step/);
  assert.throws(() => trace({ family: 'clifford', dt: .1 }), /step/);
  assert.throws(() => trace({ steps: 4, stride: 5 }), /stride/);
  assert.throws(() => trace({ start: new Array(3) }), /start/);
  const orbit = trace({ steps: 4, burnIn: 0 });
  assert.throws(() => orbit.path({ to: .05 }), /range/);
  assert.throws(() => orbit.at(Infinity), /finite/);
  assert.throws(() => orbit.density({ projection: 'zy' }), /projection/);
});
