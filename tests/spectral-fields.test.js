const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const F = K.procedural.fields.spectral;
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

function verifyGradient(frame, name, point, tolerance = 1e-6) {
  const g = frame.gradient(name, ...point);
  for (let i = 0; i < point.length; i++) {
    const up = point.slice(), down = point.slice();
    up[i] += 1e-5; down[i] -= 1e-5;
    near(g[i], (frame.sample(name, ...up) - frame.sample(name, ...down)) / 2e-5, tolerance);
  }
}

test('Fourier fields return signed and quadrature values, phase, and cancellation', () => {
  const field = F.fourier({ terms: [{ id: 'fundamental', cycles: [1, 0], amplitude: 2, frequency: 1 }] });
  const frame = field.frame(.25);
  const x = frame.details(0, .5);
  near(x.signed, 0); near(x.quadrature, 2); near(x.magnitude, 2); near(x.phase, Math.PI / 2); near(x.energy, 4);
  near(frame.sample('signed', .25, .5), -2);
  assert.equal(frame.sample('phase', 2, .5), null);
  const altered = field.frame(.25, { drive: { fundamental: { gain: .5, phase: Math.PI / 2 } } });
  near(altered.sample('signed', 0, .5), -1);
  near(field.frame(.25).sample('magnitude', 0, .5), 2);
  assert.throws(() => field.frame(0, { drive: { unknown: 1 } }), /known mode IDs/);
  const silent = F.fourier({ terms: [{ cycles: [1, 0] }, { cycles: [1, 0], amplitude: -1 }] }).frame();
  assert.deepEqual(silent.details(.23, .59), { signed: 0, quadrature: 0, magnitude: 0, phase: 0, phaseDefined: false, energy: 0 });
  assert.deepEqual(silent.nodalLines(), []);
});

test('rectangular membranes honor fixed and free edges and physical frequencies', () => {
  const bounds = { min: [0, 0], max: [2, 1] };
  const fixed = F.membrane({ bounds, speed: 2, modes: [{ m: 2, n: 1 }] });
  near(fixed.modes[0].naturalFrequency, Math.sqrt(2));
  assert.equal(fixed.frame().sample('signed', 2, .5), 0);
  assert.equal(fixed.frame().sample('signed', .5, 0), 0);
  const paths = fixed.frame().nodalLines({ cell: .031 });
  assert.equal(paths.length, 1);
  assert(paths[0].points.every(([x]) => Math.abs(x - 1) < 1e-8));
  const quarter = fixed.frame(1 / (4 * fixed.modes[0].frequency));
  assert.deepEqual(quarter.nodalLines(), []);
  assert.equal(quarter.nodalLines({ channel: 'quadrature', cell: .04 }).length, 1);
  const free = F.membrane({ bounds, edge: 'free', modes: [{ m: 0, n: 2 }] });
  near(free.frame().gradient('signed', .4, 1)[1], 0);
  near(free.frame().sample('signed', .4, 1), 1);
});

test('disk modes use Bessel roots, honor the rim and expose analytic gradients', () => {
  const axial = F.membrane({ shape: 'disk', center: [0, 0], radius: 2, modes: [{ m: 0, n: 2 }] });
  near(axial.modes[0].root, 5.520078110286311, 1e-10);
  const frame = axial.frame();
  near(frame.sample('signed', 0, 0), 1); near(frame.sample('signed', 2, 0), 0);
  assert.equal(frame.sample('signed', 1.7, 1.7), null);
  assert.equal(frame.nodalLines({ cell: .04 }).length, 1);
  const nodal = frame.nodalLines({ cell: .04 })[0];
  assert(nodal.closed);
  nodal.points.forEach(p => near(Math.hypot(...p), 2.40482555769577 * 2 / axial.modes[0].root, .001));
  const angular = F.membrane({ shape: 'disk', modes: [{ m: 1, n: 1, angle: Math.PI / 2 }] });
  const y = angular.frame();
  near(y.sample('signed', .5, 0), 0);
  near(y.gradient('signed', 0, 0)[1], angular.modes[0].root / 2);
  verifyGradient(y, 'signed', [.29, .31]);
});

test('gradients, node attraction, and 3D sources compose with field views', () => {
  const field = F.fourier({ bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, terms: [
    { cycles: [2, 1, 1], frequency: .125 }, { cycles: [1, -1, 1], kind: 'standing', amplitude: .27 }
  ] });
  const frame = field.frame(.4), p = [.172, .19, .289];
  for (const name of ['signed', 'quadrature', 'phase', 'magnitude', 'energy']) verifyGradient(frame, name, p, 3e-6);
  const move = frame.towardNodes(p, { limit: .02 });
  assert(Math.hypot(...move) < .020001);
  assert(Math.abs(frame.sample('signed', ...p.map((x, i) => x + move[i]))) < Math.abs(frame.sample('signed', ...p)));
  const source = frame.source('signed');
  near(source.sample(...p), frame.sample('signed', ...p));
  assert(K.fieldViews.contours(source, { plane: { axis: 'z', at: .289 }, cell: .055 }).paths.length > 0);
  const sheet = F.membrane({ modes: [{ m: 1, n: 1, frequency: 1 }] });
  const context = K.splatEffects.context({ fields: { wave: sheet } });
  const prepared = SurfaceLook.prepare({ layers: {
    color: { type: 'projected', field: 'wave', maskChannel: 'signed', color: '#77eebb', projection: ([u, v]) => [u, v] }
  } }, [], [0, 1, 0], context);
  const sample = { position: [.5, .5, 0], normal: [0, 0, 1], view: [0, 0, 1] };
  near(SurfaceLook.shade(prepared, sample, [0, 0, 0])[1], 238 / 255);
  assert.equal(SurfaceLook.shade(prepared, { ...sample, time: .5 }, [0, 0, 0])[1], 0);
});

test('real PCM analysis gives normalized amplitudes and phase, including DC and Nyquist', () => {
  const x = Float64Array.from({ length: 512 }, (_, i) => .18 + .45 * Math.cos(i * 2 * Math.PI * 19 / 512 + .31) + .11 * (-1) ** i);
  for (const window of ['hann', 'rect']) {
    const [dc, tone, nyquist] = F.analyze(x, { frequencies: [0, 19, 256], sampleRate: 512, window });
    near(dc.amplitude, .18); near(tone.amplitude, .45); near(tone.phase, .31); near(nyquist.amplitude, .11);
  }
  assert.throws(() => F.analyze([0, 1], { frequencies: [257], sampleRate: 512 }), /invalid PCM/);
});
