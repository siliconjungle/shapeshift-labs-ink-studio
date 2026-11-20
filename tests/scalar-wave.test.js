const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const make = K.procedural.motion.scalarWave;
const near = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const sum = values => values.reduce((a, b) => a + b, 0);

function impulse(x, speed, center = 2) {
  const d = (x - center) / .31, pressure = Math.exp(-d * d);
  return { pressure, velocity: 2 * d * speed * pressure / .31 };
}

test('CFL step accounts for rectangular spacing and local wave speeds', () => {
  const grid = make({ width: 20, height: 13, cell: [.075, .12], speed: x => 2 + (x > .5 ? 1 : 0), maxDt: 2, cfl: .81,
    initial: () => ({ pressure: .7, velocity: 0 }) });
  near(grid.dt, .81 / (3 * Math.hypot(1 / .075, 1 / .12)));
  grid.step(75);
  for (const pressure of grid.frame().data('pressure')) near(pressure, .7);
  assert(grid.frame().data('energy').every(n => n === 0));
});

test('the first step and retained half-tick velocity match a centered discrete oscillator', () => {
  const grid = make({ width: 1, height: 1, cell: 1, speed: 1, boundary: { xMin: 'fixed', xMax: 'fixed' }, maxDt: .1,
    initial: () => 1 });
  const first = grid.frame();
  near(first.data('velocity')[0], .2);
  grid.step();
  near(grid.frame().data('pressure')[0], .98);
  near(grid.frame().data('velocity')[0], -.2);
  near(first.data('pressure')[0], 1);
});

test('mask obstacles and face barriers seal a room, while a doorway sends a wave off axis', () => {
  const width = 64, height = 45, cell = .1, opening = z => Math.abs(z - 2.25) < .33;
  const config = { width, height, cell, speed: 2, boundary: 'absorb', sponge: { cells: 7 },
    initial: (x, z) => Math.hypot(x - 1.65, z - 2.25) < .20 ? 1 : 0 };
  const blocked = make({ ...config, mask: x => Math.abs(x - 3.2) > .061 });
  const thin = make({ ...config, barrier: (a, b) => a[0] < 3.2 && b[0] > 3.2 });
  const door = make({ ...config, mask: (x, z) => Math.abs(x - 3.2) > .061 || opening(z) });
  for (const wave of [blocked, thin, door]) wave.step(Math.round(1.49 / wave.dt));
  for (const sealed of [blocked, thin]) {
    const pressure = sealed.frame().data('pressure');
    assert(pressure.every((n, i) => i % width < 32 || n === 0));
    assert.equal(sealed.frame().sample('pressure', 3.201, 2.25), 0);
  }
  const field = door.frame();
  assert(field.sample('energy', 4.23, 2.93) > .001);
  assert(field.mask().some(n => !n));
});

test('the sponge attenuates a pulse that returns from the hard edge', () => {
  const speed = 2.5;
  const config = { width: 120, height: 9, cell: .08, speed, initial: x => impulse(x, speed), sponge: { cells: 18 } };
  const reflecting = make(config), absorbing = make({ ...config, boundary: { xMax: 'absorb' } });
  const steps = Math.round(4.91 / reflecting.dt);
  reflecting.step(steps);
  absorbing.step(steps);
  const r = sum(reflecting.frame().data('energy')), a = sum(absorbing.frame().data('energy'));
  assert(r > 10);
  assert(a < r * .12, `absorbing energy ${a}, reflecting energy ${r}`);
});

test('checkpoints replay forcing, and a failing source aborts a batch and protects prior frames', () => {
  const config = { width: 29, height: 18, origin: [-1, -2], cell: .1, speed: 1.8, damping: .45, boundary: 'absorb', sponge: { cells: 5 } };
  const a = make(config), b = make(config);
  assert(a.kick({ at: [.2, -1.2], radius: .25, amount: .8 }) > 0);
  a.step(17);
  b.restore(JSON.parse(JSON.stringify(a.checkpoint())));
  const source = (x, z, t) => Math.sin(t * 27) * Math.exp(-60 * (x * x + (z + 1) ** 2));
  for (const wave of [a, b]) wave.step(12, { source });
  assert.deepEqual(a.checkpoint(), b.checkpoint());
  const saved = b.frame();
  assert.throws(() => b.step(2, { source: (_x, _z, time) => time > saved.time ? NaN : 1 }), /source acceleration/);
  assert.throws(() => b.step(1, { source: () => b.kick({ at: [0, 0], radius: 1, amount: 1 }) }), /cannot edit/);
  assert.equal(b.frame(), saved);
  b.reset();
  assert.equal(b.tick, 0);
  assert(saved.data('pressure').some(Boolean));
  assert.throws(() => make({ ...config, damping: .1 }).restore(a.checkpoint()), /incompatible/);
});

test('a retained wave frame projects to material fields and world contours', () => {
  const grid = make({ width: 19, height: 17, cell: .12, mask: (x, z) => x + z < 3 });
  grid.kick({ at: [1, .84], radius: .5, amount: 1, channel: 'pressure' });
  const frame = grid.frame(), field = frame.source('pressure');
  assert(field.sample(1, 0, .84) > .8);
  assert.equal(field.sample(2, 0, 1.7), null);
  const { paths } = K.fieldViews.contours(field, { levels: [.3], cell: .045 });
  assert(paths.some(row => row.closed));
  const ctx = K.splatEffects.context({ fields: { pressure: grid } });
  const prepared = SurfaceLook.prepare({ layers: {
    active: { type: 'projected', field: 'pressure', maskChannel: 'pressure', color: '#ffcc88', projection: ([x, , z]) => [x, z] }
  } }, [], [0, 1, 0], ctx);
  const lit = SurfaceLook.shade(prepared, { position: [1, 0, .84], normal: [0, 1, 0], view: [0, 1, 0] }, [0, 0, 0]);
  assert(lit[0] > .8);
});
