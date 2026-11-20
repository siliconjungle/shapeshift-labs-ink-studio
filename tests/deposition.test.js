const test = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const { KIT: K, SurfaceLook } = studio.load();

const chart = options => K.deposition.create({
  bounds: { min: [-2.1, -2.1], max: [2.1, 2.1] },
  counts: [21, 21], channels: { trace: { decay: Math.log(2) } }, ...options
});
const close = (a, b, margin = 1e-5) => assert.ok(Math.abs(a - b) <= margin, a + ' != ' + b);

test('deposits add over visits, decay by age, and preserve previous snapshots', () => {
  const field = chart();
  const at = [0, 0], stamp = { at, sigma: .22, values: { trace: 1 } };
  field.stamp(stamp);
  const before = field.frame(1);
  at[0] = 1;
  field.stamp({ ...stamp, at: [0, 0], time: 1 });
  const twice = field.frame(1);
  assert.equal(field.dimensions, 2);
  close(before.sample('trace', 0, 0), .5);
  close(twice.sample('trace', 0, 0), 1.5);
  close(field.frame(2).sample('trace', 0, 0), .75);
  assert.deepEqual(field.frame(1).data('trace'), twice.data('trace'));
  assert.equal(field.frame(-.01).sample('trace', 0, 0), 0);
  assert.equal(twice.sample('trace', 3, 0), 0);
  const copy = twice.data('trace');
  copy.fill(99);
  close(twice.sample('trace', 0, 0), 1.5);
  const source = twice.source('trace', {
    bounds: { min: [-2.1, -2.1, .4], max: [2.1, 2.1, .4] },
    project: ([x, y]) => [x, y]
  });
  assert.equal(source.sample(0, 0, .5), null);
  assert.ok(K.fieldViews.contours(source, { plane: { axis: 'z', at: .4 }, levels: [.3], cell: .09 }).paths.length);
});

test('a stroke deposits by duration along its path and validates the full edit before writing', () => {
  const still = chart({ channels: { trace: {} } });
  still.stroke({ keys: [[0, 0, 0], [.85, 0, 0], [2, 0, 0]], interval: .4, sigma: .2, values: { trace: 2.5 } });
  close(still.frame(2).sample('trace', 0, 0), 5);
  const moving = chart({ maxDeposits: 22 });
  moving.stroke({ keys: [[0, -1, 0], [1, 1, 0]], interval: .3, sigma: .15, values: { trace: 4 } });
  const early = moving.frame(.3), late = moving.frame(1);
  assert.ok(early.sample('trace', -.6, 0) > .3);
  assert.equal(early.sample('trace', .8, 0), 0);
  assert.ok(late.sample('trace', .7, 0) > .35);
  const revision = moving.revision;
  assert.throws(() => moving.stroke({ keys: [[1, 0, 0], [2, 1, 0]], interval: .001,
    values: { trace: 1 } }), /budget/);
  assert.throws(() => moving.stamp({ at: [0, 0, 0], values: { trace: 1 } }), /coordinates/);
  assert.equal(moving.revision, revision);
  assert.equal(moving.frame(1), late);
});

test('diffusion widens a volume in all axes while conserving the deposit away from boundaries', () => {
  const diffusion = .065, sigma = .3;
  const field = K.deposition.create({
    bounds: { min: [-2.8, -2.8, -2.8], max: [2.8, 2.8, 2.8] },
    counts: [21, 21, 21], channels: { spread: { diffusion }, fixed: {} }
  });
  field.stamp({ at: [0, 0, 0], sigma, values: { spread: 1, fixed: 1 } });
  const start = field.frame(0), end = field.frame(1);
  const widened = Math.sqrt(sigma * sigma + 2 * diffusion);
  close(end.sample('spread', 0, 0, 0), (sigma / widened) ** 3);
  close(end.sample('fixed', 0, 0, 0), 1);
  const x = 2.8 * 4 / 10.5;
  for (const at of [[x, 0, 0], [0, x, 0], [0, 0, x]]) {
    assert.ok(end.sample('spread', ...at) > 3 * end.sample('fixed', ...at));
  }
  const sum = values => values.reduce((total, n) => total + n, 0);
  close(sum(end.data('spread')) / sum(start.data('spread')), 1, .002);
  assert.deepEqual(end.pick('spread', () => .5, { threshold: .02 }).at, [0, 0, 0]);
  assert.equal(end.pick('spread', () => .5, { threshold: .99 }), null);
  assert.ok(end.source('spread').sample(0, 0, 0) > .2);
  assert.equal(end.source('spread').sample(0, 0, 4), null);
});

test('finite retention can prune expired deposits while preserving valid frames', () => {
  const field = chart();
  field.stamp({ at: [0, 0], sigma: .3, time: -.5, lifetime: 1, values: { trace: 1 } });
  field.stamp({ at: [0, 0], sigma: .3, time: .5, values: { trace: 2 } });
  const expected = field.frame(.5).data('trace');
  assert.equal(field.prune(.5), 1);
  assert.equal(field.depositCount, 1);
  assert.deepEqual(field.frame(.5).data('trace'), expected);
  assert.throws(() => field.frame(.49), /unavailable/);
  assert.throws(() => field.stamp({ at: [0, 0], time: .49, values: { trace: 1 } }), /available time/);
  field.clear();
  assert.equal(field.frame(.49).sample('trace', 0, 0), 0);

  const bounded = chart({ maxWork: 1 });
  bounded.stamp({ at: [0, 0], sigma: .3, values: { trace: 1 } });
  assert.throws(() => bounded.frame(0), /work budget/);
  assert.equal(bounded.frame(-1).sample('trace', 0, 0), 0);
});

test('an XYZ field reads world or rest positions and refreshes projected layers at a paused time', () => {
  const volume = K.deposition.create({
    bounds: { min: [-2, -2, -2], max: [2, 2, 2] },
    counts: [17, 17, 17], channels: { trace: {} }
  });
  const sample = { position: [0, 0, -1], worldPosition: [0, 0, 1], normal: [0, 0, 1], view: [0, 0, 1], time: 1 };
  const make = space => SurfaceLook.prepare({ layers: {
    volume: { type: 'projected', space, pattern: 'solid', field: 'volume', maskChannel: 'trace', color: '#ffffff' }
  } }, [], undefined, K.splatEffects.context({ fields: { volume } }));
  const world = make('world'), rest = make('rest');
  const red = settings => SurfaceLook.shade(settings, sample, [0, 0, 0])[0];
  assert.equal(red(world), 0);
  volume.stamp({ at: sample.worldPosition, time: 1, sigma: .23, values: { trace: 2 } });
  assert.equal(red(world), 1);
  assert.equal(red(rest), 0);
});

test('a declared deposition field drives projected material in a rendered diorama', () => {
  const spec = {
    id: 'deposition-test', camera: { target: [0, 0, 0], dist: 4, yaw: .2, pitch: 1.1 },
    finish: { surfaceEffects: { fields: {
      chart: {
        type: 'deposition', bounds: { min: [-1, -1], max: [1, 1] }, counts: [21, 21],
        channels: { trace: { diffusion: .01 } },
        stamps: [{ at: [0, 0], time: .5, sigma: .32, values: { trace: 1 } }]
      }
    } } },
    solids: [{ kind: 'ball', at: [0, 0, 0], r: [.67, .17, .54], res: .06, mat: {
      role: 'dark', surface: { layers: {
        pigment: { type: 'projected', pattern: 'solid', field: 'chart', maskChannel: 'trace',
          range: [.1, .5], color: '#55ff98', outputPalette: ['#55ff98'], ink: true }
      } }
    } }]
  };
  assert.deepEqual(K.diorama.check(spec).filter(problem => problem.level === 'error'), []);
  const world = K.diorama.build(spec);
  const view = { w: 120, h: 100, px: 1 };
  const before = studio.render(world, { ...view, t: .4 });
  const after = studio.render(world, { ...view, t: 1 });
  assert.notDeepEqual(after.rgb, before.rgb);
  const slot = after.palette.indexOf(0x55ff98);
  assert.ok(slot >= 0 && after.use[slot] > 40);
});
