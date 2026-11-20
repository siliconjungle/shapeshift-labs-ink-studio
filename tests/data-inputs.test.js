const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT, W = K.world;
const prepare = spec => K.dataInputs.prepare({ input: spec }).get('input');
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a-b) <= tolerance, `${a} differs from ${b}`);

test('quoted CSV and TSV produce immutable typed rows, named keys, conversions and explicit missing values', () => {
  const source = {
    kind: 'table', format: 'csv', key: 'name',
    columns: {
      name: { type: 'string' }, distance: { type: 'number', units: 'km', source: 'Distance (km)', missing: { mode: 'null', tokens: [-999] } },
      count: { type: 'integer', units: '1', missing: { mode: 'default', value: 3 } },
      ready: { type: 'boolean' }, direction: { type: 'vec2', units: 'm/s' }
    },
    data: '\ufeffname,Distance (km),count,ready,direction,ignored\r\n"north, ""high""\r\npeak",1.2,,true,"[3,4]",x\r\nvalley,-999,2,false,"[0,1]",y\r\n'
  };
  const input = prepare(source);
  assert.deepEqual(input.rows[0], { name: 'north, "high"\r\npeak', distance: 1.2, count: 3, ready: true, direction: [3,4] });
  assert(Object.isFrozen(input.rows[0].direction));
  assert.deepEqual(input.sample({ key: input.rows[0].name, column: 'distance', units: 'm' }),
    { status: 'ok', value: 1200, row: 0, units: 'm' });
  input.sample({ row: 0, column: 'direction', units: 'km/h' }).value.forEach((value, i) => near(value, [10.8, 14.4][i]));
  assert.equal(input.sample({ key: 'valley', column: 'distance' }).status, 'missing');
  assert.equal(input.sample({ key: 'absent', column: 'distance' }).status, 'missing');
  assert.throws(() => input.sample({ row: 0, column: 'distance', units: 's' }), /Incompatible units/);
  assert.throws(() => input.sample({ row: 0, column: 'ready', units: 's' }), /has no units/);
  const tsv = prepare({ kind: 'table', format: 'tsv', columns: { label: { type: 'string' } }, data: 'label\n"a\tb"\n' });
  assert.deepEqual(tsv.rows, [{ label: 'a\tb' }]);
  source.columns.distance.units = 'm';
  assert.equal(input.description.columns.distance.units, 'km');
});

test('invalid types and malformed datasets fail with dataset, row or column context', () => {
  const base = { kind: 'table', columns: { score: { type: 'integer', units: '1' } } };
  assert.throws(() => prepare({ ...base, data: [{ score: '1' }] }), /Data input input: Expected integer in column score at row 1/);
  assert.throws(() => prepare({ ...base, data: [{}] }), /Missing column score at row 1/);
  assert.throws(() => prepare({ ...base, key: 'score', data: [{ score: 1 }, { score: 1 }] }), /duplicate row key/);
  assert.throws(() => prepare({ ...base, format: 'csv', data: 'score,score\n1,1' }), /headers must be unique/);
  assert.throws(() => prepare({ ...base, format: 'csv', data: 'score\n"123' }), /Unterminated quoted field/);
  assert.throws(() => prepare({ ...base, format: 'csv', data: 'score\n1,2' }), /Wrong number of fields/);
  assert.throws(() => prepare({ ...base, columns: { score: { type: 'integer' } }, data: [] }), /type or units/);
  assert.throws(() => prepare({ ...base, file: 'source.json' }), /Resolve the dataset file/);
  assert.throws(() => K.dataInputs.embed({ input: { ...base, file: 'source.json', data: [] } }, () => ''),
    /single data file or inline data/);
});

test('series use scene seconds, interpolate continuous columns and preserve gaps', () => {
  const source = {
    kind: 'series',
    columns: {
      clock: { type: 'integer', units: 'ms' }, degrees: { type: 'number', units: 'degC', missing: { mode: 'null' } },
      count: { type: 'integer', units: '1' }, label: { type: 'string' }
    },
    time: { column: 'clock', origin: 1000 },
    data: [
      { clock: 1000, degrees: 0, count: 1, label: 'low' },
      { clock: 2000, degrees: 20, count: 5, label: 'high' },
      { clock: 3000, degrees: null, count: 6, label: 'missing' }
    ]
  };
  const input = prepare(source);
  near(input.sample({ column: 'degrees', units: 'degF' }, .5).value, 50);
  assert.equal(input.sample({ column: 'count', time: .5 }).value, 1);
  assert.equal(input.sample({ column: 'label', time: 1 }).value, 'high');
  assert.equal(input.sample({ column: 'degrees', time: 1 }).value, 20);
  assert.equal(input.sample({ column: 'degrees', time: 1.5 }).status, 'missing');
  assert.equal(input.sample({ column: 'degrees', time: -1 }).status, 'outside');
  assert.equal(prepare({ ...source, time: { ...source.time, outside: 'clamp' } })
    .sample({ column: 'label', time: 5 }).value, 'missing');
  assert.throws(() => prepare({ ...source, data: [...source.data].reverse() }), /strictly increasing/);
  assert.throws(() => prepare({ ...source, time: { column: 'clock', origin: 'zero' } }), /Invalid time series origin/);
  assert.deepEqual(input.description.time.range, [0,2]);
});

test('UTC timestamps align subsecond recordings without a local timezone', () => {
  const source = {
    kind: 'series', columns: { time: { type: 'timestamp' }, value: { type: 'number', units: '1' } },
    time: { column: 'time' },
    data: [{ time: '2024-02-29T12:30:00Z', value: 10 }, { time: '2024-02-29T12:30:00.500Z', value: 20 }]
  };
  assert.equal(prepare(source).sample({ column: 'value' }, .25).value, 15);
  assert.equal(prepare({ ...source, time: { column: 'time', origin: '2024-02-29T12:29:59Z' } })
    .sample({ column: 'value', time: 1.25 }).value, 15);
  source.data[0].time = '2023-02-29T12:30:00Z';
  assert.throws(() => prepare(source), /Expected timestamp/);
});

test('typed Cartesian points respect axis order, coordinate units, origin and nearest range', () => {
  const source = {
    kind: 'spatial', columns: { altitude: { type: 'number', units: 'm' }, east: { type: 'number', units: 'ft' },
      code: { type: 'string' } },
    key: 'code',
    coordinates: { crs: 'cartesian', axes: 'yx', units: 'm', columns: ['altitude', 'east'], origin: [10,20,30],
      worldUnitsPerMeter: 2 },
    data: [{ altitude: 5, east: 0, code: 'zero' }, { altitude: 5, east: 100, code: 'east' }]
  };
  const input = prepare(source);
  assert.deepEqual(input.features[0].geometry.coordinates, [10,30,30]);
  const p = input.sample({ column: '$position', key: 'east' }).value;
  p.forEach((v, i) => near(v, [70.96,30,30][i]));
  assert.equal(input.sample({ column: 'code', at: [71,30,30], maxDistance: .1 }).value, 'east');
  assert.equal(input.sample({ column: 'code', at: [71,30,30], maxDistance: .01 }).status, 'outside');
  const repeated = prepare({ ...source, data: [source.data[0], { ...source.data[0], code: 'another' }] });
  assert.equal(repeated.sample({ column: 'code', at: [10,30,30] }).value, 'zero');
  source.coordinates.columns[0] = 'code';
  assert.throws(() => prepare(source), /numeric coordinate columns/);
});

test('geographic coordinates project to a local Y-up frame while retaining feature geometry', () => {
  const source = {
    kind: 'spatial', format: 'geojson', columns: { label: { type: 'string' } },
    coordinates: { crs: 'OGC:CRS84', origin: [0,0,0] },
    data: { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 42, properties: { label: 'station' }, geometry: { type: 'Point', coordinates: [.001,0,12] } },
      { type: 'Feature', id: 'area', properties: { label: 'area' }, geometry: { type: 'GeometryCollection', geometries: [
        { type: 'Polygon', coordinates: [[[0,0], [.001,0], [0,.001], [0,0]]] }
      ] } }
    ] }
  };
  const input = prepare(source);
  const position = input.sample({ key: 42, column: '$position' }).value;
  near(position[0], 111.32, .01);
  near(position[1], 12, .01);
  near(position[2], 0);
  assert.equal(input.sample({ key: 'area', column: 'label' }).value, 'area');
  assert.equal(input.sample({ key: 'area', column: '$position' }).status, 'missing');
  const ring = input.features[1].geometry.geometries[0].coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert(ring[2][2] > 110);
  source.data.features[1].geometry.geometries[0].coordinates[0][3] = [0,.0001];
  assert.throws(() => prepare(source), /rings must close/);

  const table = { kind: 'spatial',
    columns: { a: { type: 'number', units: 'm' }, b: { type: 'number', units: 'm' } },
    coordinates: { crs: 'EPSG:3857', origin: [0,0], columns: ['a','b'] },
    data: [{ a: 111.319490793, b: 0 }] };
  near(prepare(table).sample({ row: 0, column: '$position' }).value[0], 111.31949, .001);
  const edge = prepare({ ...table, coordinates: { ...table.coordinates, origin: [180,0] },
    data: [{ a: Math.PI * 6378137, b: 0 }] });
  edge.features[0].geometry.coordinates.forEach(value => near(value, 0));
  table.coordinates.crs = 'EPSG:4326';
  table.columns.a.units = table.columns.b.units = 'deg';
  table.data[0].a = .001;
  const north = prepare(table).sample({ row: 0, column: '$position' }).value;
  near(north[0], 0);
  near(north[2], 110.5743, .001);
});

function scene() {
  return {
    id: 'data-lamp',
    camera: { target: [0,0,0], yaw: 0, pitch: 0, dist: 4 },
    light: { amb: .12 },
    solids: [{ id: 'block', kind: 'box', at: [0,0,0], half: [.5,.5,.5], res: .08, mat: 'stone' }],
    effects: [{ do: 'lamp', at: [0,0,2], strength: 0, r: 4 }],
    dataInputs: { sensor: { kind: 'series', format: 'csv',
      columns: { t: { type: 'integer', units: 'ms' }, strength: { type: 'number', units: '%', missing: { mode: 'null' } } },
      time: { column: 't' }, data: 't,strength\n0,0\n1000,100\n2000,\n' } },
    parameterBindings: { values: { signal: { source: 'data', dataset: 'sensor', column: 'strength', units: '1', fallback: .2 } },
      bindings: [{ path: '/effects/0/strength', parameter: 'signal' }] }
  };
}

test('typed values drive authored dioramas and simulation visuals and remain queryable after restore', () => {
  const source = scene();
  const world = studio.createSceneEditor(source).build();
  world.anim.update(0, 0);
  world.anim.update(.5, .5);
  assert.equal(world.parameters.values().signal, .5);
  assert.equal(world.lab.lit.lights[0].s, .5);
  assert.equal(W.query.fromScene(world, .5).probe('world/data', undefined, { dataset: 'sensor', column: 'strength' }).value, 50);
  world.anim.update(.6, 1.1);
  assert.equal(world.lab.lit.lights[0].s, .2);
  assert.equal(source.effects[0].strength, 0);
  const sim = { dt: .1, dataInputs: source.dataInputs, visual: { atmosphere: { density: .1 }, parameterBindings: {
    values: source.parameterBindings.values, bindings: [{ path: '/visual/atmosphere/density', parameter: 'signal' }] } } };
  const run = W.runtime.create(sim);
  run.advance(5);
  const checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
  const resumed = W.runtime.create(checkpoint.world, { checkpoint });
  assert.equal(resumed.query().probe('world/data', undefined, { dataset: 'sensor', column: 'strength', units: '1' }).value, .5);
  const baked = W.visual(kit, resumed.view(), resumed.query());
  assert.equal(baked.atmosphere.density, .5);
  assert.equal(baked.dataInputs.get('sensor').description.time.units, 's');
});

test('normal CLI entry points resolve relative files, inspect typed data and embed checkpoint and recipe inputs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-data-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), doc = path.join(dir, 'scene.json');
  const csv = path.join(dir, 'sensors.csv'), recipe = path.join(dir, 'shot.json'), image = path.join(dir, 'frame.png');
  const manifest = path.join(dir, 'world.json'), checkpoint = path.join(dir, 'checkpoint.json');
  const source = scene(), { data, ...spec } = source.dataInputs.sensor;
  source.dataInputs.sensor = { ...spec, file: 'sensors.csv' };
  fs.writeFileSync(csv, data);
  fs.writeFileSync(doc, JSON.stringify(source));
  fs.writeFileSync(manifest, JSON.stringify(W.manifest({ id: 'sensors', dt: .1, dataInputs: source.dataInputs })));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe', cwd: dir });
  assert.equal(studio.readDataInputs(doc).get('sensor').rows.length, 3);
  const report = JSON.parse(call('data-inputs', 'scene.json', 'sensor', '--t', '.5',
    '--sample', '{"column":"strength","units":"1"}'));
  assert.equal(report.sample.value, .5);
  call('render', 'scene.json', '--t', '.5', '--w', '84', '--h', '64', '--recipe', recipe, '--out', image);
  assert(JSON.parse(fs.readFileSync(recipe)).inputs.some(input => input.file === 'sensors.csv'));
  call('sim', 'run', 'world.json', '--ticks', '5', '--checkpoint', checkpoint);
  const saved = JSON.parse(fs.readFileSync(checkpoint));
  assert.equal(saved.world.dataInputs.sensor.data, data);
  fs.unlinkSync(csv);
  const sample = JSON.parse(call('probe', 'checkpoint.json', '--field', 'world/data',
    '--args', '{"dataset":"sensor","column":"strength","units":"1"}'));
  assert.equal(sample.value, .5);
});

test('the browser toolkit samples authored source data during a normal WebGL draw', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, scene, (kit, fixture, backend) => {
    const world = kit.KIT.diorama.build(fixture()), draw = backend(84, 64, { raw: true });
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const before = draw.image();
      world.anim.update(1, 1);
      const changedRows = Array.from(world.anim.rows).flatMap((dirty, row) => dirty ? [row] : []);
      draw.draw(world, { time: 1, changedRows });
      return { strength: world.parameters.values().signal, changed: draw.image() !== before };
    } finally {
      draw.close();
    }
  });
  assert.equal(result.strength, 1);
  assert(result.changed);
});
