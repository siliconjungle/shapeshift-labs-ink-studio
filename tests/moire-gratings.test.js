const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const { gratings, tangent, triplanar } = K.procedural.materials;
const near = (value, target, tolerance = 1e-10) => assert(Math.abs(value - target) <= tolerance, `${value} differs from ${target}`);
const beam = cycles => (.5 + .5 * Math.cos(2 * Math.PI * cycles));

test('the line and dot profiles and ink/product weights match point composition', () => {
  const u = .18, v = -.24, t = 1.4;
  const line = { frequency: 3, phase: .12, rate: -.15, sharpness: 3, opacity: .7 };
  const dot = { kind: 'dot', frequency: [5, 6], phase: [.1, -.2], drift: [.02, .04], opacity: .6 };
  const a = beam(3 * u + .12 - t * .15) ** 3;
  const b = beam(5 * (u - .02 * t) + .1) * beam(6 * (v - .04 * t) - .2);
  near(gratings({ layers: [line, dot] }).sample(u, v, { time: t }), 1 - (1 - .7 * a) * (1 - .6 * b));
  near(gratings({ layers: [line, dot], mode: 'product' }).sample(u, v, { time: t }), (.3 + .7 * a) * (.4 + .6 * b));
  near(gratings({ layers: [{ opacity: 0 }] }).sample(0, 0), 0);
});

test('filtering the composite preserves difference bands after its carriers blur out', () => {
  const pattern = gratings({ layers: [{ frequency: 80 }, { frequency: 81 }], mode: 'product' });
  const footprint = [.125, .08], attenuation = Math.exp(-.5 * (.4 * 2 * Math.PI * footprint[0]) ** 2);
  near(pattern.sample(0, 0, { footprint }), .25 + .125 * attenuation);
  near(pattern.sample(.5, 0, { footprint }), .25 - .125 * attenuation);
  near(pattern.sample(0, 0, { footprint, detail: .3 }), .7 * (.25 + .125 * attenuation) + .3);
  assert.equal(pattern.sample(0, 0, { footprint, detail: 1 }), 1);
});

test('oriented pixels filter along the grating normal and material adapters pass chart footprints', () => {
  const frame = gratings({ layers: [{ frequency: 30, angle: Math.PI / 4 }] }).frame();
  const aligned = [[.24, .24], [.002, -.002]], transverse = [[.24, -.24], [.002, .002]];
  near(frame.sample(0, 0, { footprint: aligned }), .5);
  assert(frame.sample(0, 0, { footprint: transverse }) > .97);
  const chart = tangent(frame.sample, { scale: [2, 1] });
  near(chart(0, 0, 0, { footprint: .18 }), frame.sample(0, 0, { footprint: [.09, .18] }));
  const tri = triplanar(frame.sample, { scale: [2, 1, 4] });
  near(tri(0, 0, 0, { normal: [0, 1, 0], footprint: .24 }), frame.sample(0, 0, { footprint: [.12, .06] }));
});

test('polar rings and spokes meet at the angular seam and filter near the center', () => {
  const frame = gratings({ layers: [{ kind: 'polar', frequency: 2, spokes: 7, phase: .23 }] }).frame();
  near(frame.sample(-1, 1e-10), frame.sample(-1, -1e-10), 1e-8);
  near(frame.sample(1, 0), beam(2.23));
  const spokes = gratings({ layers: [{ kind: 'polar', spokes: 9 }] }).frame();
  for (const u of [0, Number.MIN_VALUE, .015]) {
    const value = spokes.sample(u, 0, { footprint: .12 });
    assert(value > .33 && value < .67, String(value));
  }
  near(spokes.sample(1, 0), 1);
});

test('frame seeks are deterministic and layer and harmonic budgets are validated', () => {
  const spec = { kind: 'dot', frequency: [9, 11], angle: .43, spin: .37, phase: [.05, .21], rate: [-.3, .2] };
  const pattern = gratings({ layers: [spec] }), saved = pattern.frame(1.35), options = { footprint: .03 };
  const sample = saved.sample(.72, -.9, options);
  assert.notEqual(pattern.sample(.72, -.9, { ...options, time: 1.41 }), sample);
  spec.frequency[0] = 90;
  assert.equal(pattern.frame(1.35).sample(.72, -.9, options), sample);
  assert.equal(saved.sample(.72, -.9, options), sample);
  assert.throws(() => gratings({ layers: [{ kind: 'polar', spokes: 2.5 }] }), /invalid layer/);
  assert.throws(() => gratings({ layers: Array(3).fill({ kind: 'dot', sharpness: 4 }) }), /harmonic budget/);
  assert.throws(() => saved.sample(0, 0, { footprint: [-.5, .5] }), /footprint/);
});
