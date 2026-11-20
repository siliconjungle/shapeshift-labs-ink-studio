const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, makeBuilder, SpriteSurface, SceneOptics, SurfaceLook } = require('..').load();
const outputs = K.fieldOutputs;
const box2 = { min: [0, 0], max: [1, 1] };
const box3 = { min: [-1, -1, -1], max: [1, 1, 1] };
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, actual + ' vs ' + expected);

test('named output metadata and combined reads retain types, units, zeroes, and missing values', () => {
  const original = { min: [0, 0], max: [1, 1] }, range = [0, 2], reused = [1, 2];
  let reads = 0;
  const field = outputs.create({ bounds: original, channels: {
    age: { units: 's', range }, species: { type: 'category' }, finish: { type: 'rgb' }, drift: { type: 'vec2' }, spare: {}
  }, sample(x, y) {
    reads++;
    return x >= .75 ? null : { age: 2 * y, species: x ? 'copper' : 0, finish: 0x0000ff, drift: reused };
  } });
  original.max[0] = range[1] = 3;
  const row = field.read(0, 0);
  assert.equal(reads, 1);
  assert.deepEqual(row, { age: 0, species: 0, finish: [0, 0, 1], drift: [1, 2], spare: null });
  reused[0] = 10;
  assert.deepEqual(row.drift, [1, 2]);
  assert(Object.isFrozen(row.drift) && Object.isFrozen(row));
  assert.deepEqual(field.info('age'), { type: 'number', units: 's', range: [0, 2] });
  assert.equal(field.read(2, 0), null);
  assert.equal(reads, 1);
  assert.equal(field.sample('age', .9, .2), null);
  assert.equal(field.read(.9, .2), null);
  assert.throws(() => field.sample('oops', 0, 0), /unknown channel/);
  assert.throws(() => field.sample('age', 0, NaN), /finite 2D/);
});

test('numeric ramps, categorical swatches and RGB pigment paint a textured relief', () => {
  const field = outputs.create({ bounds: box2, channels: {
    phase: { range: [-1, 1] }, species: { type: 'category' }, finish: { type: 'rgb' }
  }, sampleChannel(name, x, y) {
    if (name === 'phase') return x + y - 1;
    if (name === 'species') return x < .5 ? 'copper' : y > .6 ? 'unpainted' : 'teal';
    return '#2288ff';
  } });
  const ramp = field.pigment('phase', { ramp: { stops: [[-1, 0x000000], [1, '#ffffff']] } });
  assert.equal(ramp(.5, .5), 0x808080);
  assert.equal(ramp(2, 0), null);
  assert.equal(field.pigment('finish')(0, 0), 0x2288ff);
  const paint = field.pigment('species', { colors: { copper: '#ffaa77', teal: [0, 1, .5] } });
  assert.equal(paint(1, 0), 0x00ff80);
  assert.equal(paint(1, 1), null);

  const carrier = { sample: ([u, v]) => ({ p: [u, v, 3], n: [0, 0, 2] }) };
  const relief = field.relief('phase', { carrier, segments: [1, 1], scale: .25, offset: .1 });
  close(relief.sample(0, 0).point[2], 2.85, 1e-6);
  close(relief.sample(1, 1).point[2], 3.35, 1e-6);
  const atlas = SpriteSurface.make(4);
  atlas.mesh(relief, 2, 1, i => paint(i, 0));
  assert.deepEqual(Array.from(atlas.finish().pixels.slice(0, 8)), [255, 170, 119, 255, 0, 255, 128, 255]);
  const mapped = field.relief('species', { carrier, segments: [1, 1], map: value => value === 'copper' ? 1 : 0,
    project: ({ uv, position }) => position[2] === 3 && uv[1] === 0 ? uv : null, missing: -.5 });
  close(mapped.sample(0, 0).point[2], 4);
  close(mapped.sample(0, 1).point[2], 2.5);
});

test('one signed channel routes to contours, native splats, geometry and volume optics', () => {
  const field = outputs.create({ bounds: box3, channels: { signal: { units: 'sample' }, velocity: { type: 'vec2' } },
    sample: (x, y, z) => ({ signal: .75 - Math.hypot(x, y, z), velocity: [x, z] }) });
  const contours = field.view('signal', { kind: 'contours', options: { levels: [0, .2], cell: .08 } });
  assert.deepEqual(contours.paths.map(path => path.closed), [true, true]);
  assert.equal(contours.units, 'sample');
  const geometry = field.view('signal', { kind: 'isosurface', options: { resolution: .15, edgeRefinements: 6 } }).mesh;
  assert(geometry.positions.length > 100);
  close(geometry.bounds.max[2], .75, .003);
  assert.deepEqual(field.source('velocity').sample(.5, 0, -.5), [.5, 0, -.5]);

  const builder = makeBuilder(39, [0, 0xffffff]);
  assert.throws(() => field.splats(builder, 'signal', { kind: 'contours', maxSplats: 1 }), /splat budget/);
  assert.equal(builder.count(), 0);
  const report = field.splats(builder, 'signal', { kind: 'contours', id: 'signal-line', options: { cell: .15 } });
  assert(report.count > 1);
  assert.equal(report.count, builder.count());
  assert.equal(report.units, 'sample');

  const density = field.density('signal', { scale: 2 });
  assert.equal(density.sample(0, 0, 0), 1.5);
  assert.equal(density.sample(1, 0, 0), 0);
  assert.equal(density.sample(3, 0, 0), 0);
  const volume = K.atmosphere.field({ field: density, step: .05, color: '#ffa744' });
  const result = SceneOptics.trace(SceneOptics.prepareVolumes([volume]), [0, 0, 2], [0, 0, -1], 5);
  assert(result[3] > 0 && result[3] < 1);
});

test('projectors control native addresses and missing values across geometry and materials', () => {
  const field = outputs.create({ bounds: box2, channels: { heat: { units: 'K' }, species: { type: 'category' } },
    sample: (u, v) => u < .1 ? null : { heat: u + v, species: 'cyan' } });
  assert.equal(field.source('heat').sample(.5, 0, .75), 1.25);
  assert.equal(field.source('heat').sample(.5, .1, .75), null);
  const src = { bounds: { min: [0, 0, 4], max: [1, 1, 4] },
    project: ([x, y]) => y > .9 ? null : new Float64Array([x, y]) };
  const slice = field.view('heat', { source: src, options: { plane: { axis: 'z' }, counts: [2, 2] } });
  assert.deepEqual(slice.values, [.5, 1, 1, 1.5]);
  assert.equal(field.source('heat', src).sample(.5, .95, 4), null);
  assert.equal(field.source('species', { ...src, map: value => value === 'cyan' ? 1 : 0 }).sample(.5, .5, 4), 1);
  assert.throws(() => field.source('species'), /number or vector/);
  assert.throws(() => field.source('heat', { project: ([x, y]) => [x, y] }), /XYZ bounds/);
  assert.throws(() => field.source('heat', { ...src, project: () => [0, 0, 0] }).sample(.5, 0, 4), /native coordinates/);
  assert.equal(field.scalar('heat', { map: () => null, missing: 3 })(.5, .5), 3);
  assert.throws(() => field.scalar('heat', { map: () => NaN })(.5, .5), /finite number/);

  const registered = field.projected();
  assert.deepEqual(registered.channels, ['heat']);
  const context = K.splatEffects.context({ fields: { thermal: registered } });
  const effect = SurfaceLook.prepare({ layers: { color: { type: 'projected', pattern: 'bands',
    field: 'thermal', bandChannel: 'heat', bands: { stops: [{ at: .5, color: '#00ffff' }] }
  } } }, [], undefined, context);
  const paint = SurfaceLook.shade(effect, { position: [.4, 0, .25], normal: [0, 1, 0], view: [0, 1, 0], time: 0 }, [0, 0, 0]);
  assert.deepEqual(paint.slice(0, 3), [0, 1, 1]);
});

test('built-in complex orbits expose named traps, basin IDs, phase and native domain color', () => {
  let visits = 0;
  const orbit = K.procedural.complexPlane.compile({ family: 'newton',
    traps: [{ id: 'counted', type: 'custom', distance: x => { visits++; return x; } }] });
  const field = orbit.outputs();
  assert.equal(field.pigment('rgb')(.6, .7), orbit.domain(.6, .7).rgb);
  assert.equal(visits, 0);
  assert.equal(field.sample('basinId', 1, 0), 0);
  assert.equal(field.sample('trap:counted', 1, 0), 1);
  assert.equal(field.read(0, 0).basinId, null);
  assert.equal(field.info('phase').units, 'rad');
  assert.equal(field.pigment('basinId', { colors: { 0: '#842266' } })(1, 0), 0x842266);
  assert.equal(field.read(3, 0), null);
});

test('retained spectral, growth and phase generators expose the captured revision', () => {
  const P = K.procedural;
  const wave = P.fields.spectral.fourier({ terms: [{ cycles: [1, 0], frequency: 1 }] });
  const phase = wave.frame(0).outputs();
  assert.equal(phase.info('phase').units, 'rad');
  close(phase.sample('signed', .1, .4), wave.frame(0).sample('signed', .1, .4));
  assert.notEqual(phase.sample('signed', .1, .4), wave.frame(.25).outputs().sample('signed', .1, .4));

  const fronts = P.growth.competitive({ width: 4, height: 1, cell: 1,
    materials: [{ id: 'jade' }], seeds: [{ at: [.5, .5], material: 'jade' }] });
  const start = fronts.frame(0).outputs(), end = fronts.frame().outputs();
  assert.equal(start.sample('material', 2.5, .5), null);
  assert.equal(end.sample('material', 2.5, .5), 0);
  assert.equal(end.sample('age', .5, .5), 3);

  const drying = P.motion.phaseChange({ width: 2, height: 1, cell: 1, dt: .2,
    channels: { wet: { initial: 1 }, dry: {} }, rules: [{ id: 'evaporate', consume: { wet: 1 }, produce: { dry: 1 }, rate: 1 }],
    finish: ({ fields }) => ({ color: [1, fields.dry, 0], roughness: .5, relief: fields.dry }) });
  const early = drying.frame().outputs();
  const late = drying.step().outputs();
  assert.deepEqual(early.sample('color', .5, .5), [1, 0, 0]);
  assert.equal(late.pigment('color')(.5, .5), 0xff3300);
  close(late.sample('relief', .5, .5), .2);
  assert.equal(early.sample('relief', .5, .5), 0);
  const bright = P.motion.phaseChange({ width: 8, height: 8, cell: .3, channels: { active: {} },
    rules: [{ id: 'source', produce: { active: 1 }, rate: 0 }],
    finish: () => ({ color: [1, 1, 1], roughness: 1, relief: 0 }) }).frame().outputs();
  assert.equal(bright.pigment('color')(.16872, 1.10496), 0xffffff);
});
