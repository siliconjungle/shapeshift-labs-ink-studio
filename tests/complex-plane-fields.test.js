const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { procedural: { complexPlane: { compile }, contours } } } = require('..').load();

test('quadratic fields distinguish iteration limits from escape and keep smooth escape time separate', () => {
  const m = compile({ escapeRadius: 4, iterations: 24 });
  assert.deepEqual(m.sample(-1, 0), { status: 'limit', iterations: 24, escapeTime: null, basinId: null, trap: {} });
  assert.equal(m.field('escapeTime')(0, 0), null);
  const escape = m.sample(2, 0);
  assert.equal(escape.status, 'escaped');
  assert.equal(escape.iterations, 2);
  assert.equal(escape.escapeTime, 2 - Math.log2(Math.log(6) / Math.log(4)));
  assert.equal(m.field('escapeTime')(-.15, .85), m.field('escapeTime')(-.15, -.85));

  const j = compile({ family: 'julia', constant: [0, 0], escapeRadius: 2, iterations: 2 });
  assert.equal(j.sample(3, 0).iterations, 0);
  assert.equal(j.sample(1, 0).status, 'limit');
  assert.equal(j.sample(1.4, 0).status, 'escaped');
  assert.equal(j.field('basinId')(1.4, 0), null);
});

test('Newton identifies authored root IDs including convergence on the last step and handles poles', () => {
  const roots = [[-1, 0], [1, 0]], n = compile({ family: 'newton', roots, iterations: 1 });
  roots[1][0] = 10;
  assert.equal(n.sample(-1, 0).basinId, 0);
  assert.deepEqual(n.sample(1.0001, 0), { status: 'converged', iterations: 1, escapeTime: null, basinId: 1, trap: {} });
  assert.equal(n.sample(0, 0).status, 'singular');
  assert.equal(n.field('basinId')(0, 0), null);
  assert.equal(n.sample(100, 0).status, 'limit');

  const standard = compile({ family: 'newton' });
  assert.equal(standard.field('basinId')(-.5, .6), 1);
  assert.equal(standard.field('basinId')(-.5, -.6), 2);
});

test('named traps share an orbit and return the closest distance before termination', () => {
  const j = compile({ family: 'julia', constant: [0, 0], iterations: 2, traps: [
    { id: 'point' },
    { id: 'ring', type: 'circle', radius: .25 },
    { id: 'line', type: 'line', center: [0, .4] },
    { id: 'cross', type: 'cross', center: [0, .4] },
    { id: 'custom', type: 'custom', distance: x => x <= .1 ? -.06 : null },
    { id: '__proto__', type: 'custom', distance: () => null }
  ] });
  const trap = j.sample(.5, 0).trap;
  assert.deepEqual(trap, { point: .0625, ring: 0, line: .4, cross: .0625, custom: .06, ['__proto__']: null });
  assert.equal(j.field('trap', 'point')(.5, 0), .0625);
  assert.equal(j.field('trap', '__proto__')(.5, 0), null);

  const m = compile({ traps: [{ id: 'origin' }], iterations: 1 });
  assert.equal(m.field('trap', 'origin')(.5, 0), .5);
  assert.equal(compile({ traps: [{ id: 'origin' }], includeInitial: true }).field('trap', 'origin')(.5, 0), 0);
});

test('analytic domain colors are independent of iteration and expose phase and magnitude', () => {
  const n = compile({ family: 'newton', roots: [[-1, 0], [1, 0]], iterations: 1 });
  const j = compile({ family: 'julia', constant: [0, 0], iterations: 1 });
  assert.deepEqual(n.domain(1, 0), { value: [0, 0], phase: null, logMagnitude: null, rgb: 0 });
  assert.deepEqual(j.domain(2, 1).value, [3, 4]);
  assert.equal(j.field('logMagnitude')(2, 1), Math.log2(5));
  assert.equal(j.field('phase')(2, 1), Math.atan2(4, 3));
  assert.deepEqual(compile().domain(2, 1).value, [5, 5]);
  assert.notEqual(j.domain(1, 0).rgb, j.domain(0, 1).rgb);
  assert.equal(j.domain(0, 1).rgb, j.domain(0, -1).rgb);
  assert.deepEqual(compile({ family: 'julia', constant: [0, 0], iterations: 99 }).domain(2, 1), j.domain(2, 1));
});

test('an orbit-trap channel composes directly with marching contours', () => {
  const j = compile({ family: 'julia', constant: [0, 0], iterations: 1, traps: [{}] });
  const rings = contours.march(j.field('trap', '0'), {
    bounds: { min: [-.75, -.75], max: [.75, .75] }, iso: .25, cell: .04
  });
  assert.equal(rings.length, 1);
  assert.equal(rings[0].closed, true);
  assert.ok(rings[0].points.every(p => Math.abs(Math.hypot(...p) - .5) < .002));
});

test('complex fields reject invalid configuration, coordinates, channels, and custom distances', () => {
  assert.throws(() => compile({ family: 'unknown' }), /complex family/);
  assert.throws(() => compile({ iterations: 1025 }), /iterations/);
  assert.throws(() => compile({ family: 'julia', constant: [-6, 0], escapeRadius: 2 }), /escape bound/);
  assert.throws(() => compile({ family: 'newton', roots: [[1, 0], [1, 0]] }), /separated/);
  assert.throws(() => compile({ family: 'newton', roots: new Array(2) }), /complex pair/);
  assert.throws(() => compile({ traps: [{ id: 'same' }, { id: 'same' }] }), /unique/);
  assert.throws(() => compile({ traps: [{ type: 'circle', radius: -1 }] }), /orbit trap/);
  assert.throws(() => compile().sample(Infinity, 0), /finite/);
  assert.throws(() => compile().field('trap', 'missing'), /Unknown/);
  assert.throws(() => compile({ traps: [{ type: 'custom', distance: () => NaN }] }).sample(1, 0), /distance/);
});
