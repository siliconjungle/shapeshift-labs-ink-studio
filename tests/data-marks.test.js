const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT, W = K.world;
const direction = [0, 0, -1];

function diorama() {
  return {
    id: 'sensor-marks', camera: { target: [0,0,0], yaw: 0, pitch: 0, dist: 5 },
    dataInputs: { stations: { kind: 'table', key: 'name',
      columns: {
        name: { type: 'string' }, x: { type: 'number', units: 'cm' }, level: { type: 'number', units: '1' },
        band: { type: 'string' }, alpha: { type: 'number', units: '1' },
        velocity: { type: 'vec3', units: 'world/s' }, note: { type: 'string' }
      },
      data: [
        { name: 'A', x: -100, level: .5, band: 'warm', alpha: .75, velocity: [1,0,0], note: 'primary sensor' },
        { name: 'B', x: 150, level: 1, band: 'cold', alpha: .4, velocity: [0,0,0], note: 'secondary sensor' },
        { name: 'C', x: 0, level: .2, band: 'unread', alpha: 1, velocity: [0,0,0], note: 'missing category' }
      ] } },
    dataMarks: { sensors: { source: { dataset: 'stations' }, channels: {
      position: [{ column: 'x', units: 'm' }, 0, 0], motion: { column: 'velocity' },
      size: { column: 'level', scale: { domain: [0,1], range: [.1,.5] } },
      color: { column: 'level', scale: { domain: [0,1], range: ['#0000ff','#ff00ff'] } },
      opacity: { column: 'alpha' }, shape: { column: 'band', map: { warm: 'cross', cold: 'bar' } }
    } } }
  };
}

test('all channels drive native marks and picker snapshots retain the matching raw row', () => {
  const world = studio.createSceneEditor(diorama()).build();
  world.anim.update(0, 0);
  const a = world.dataMarks.get('sensors/string/"A"');
  assert.deepEqual(a.channels, { position: [-1,0,0], size: .3, color: [127.5,0,255], opacity: .75,
    shape: 'cross', motion: [1,0,0] });
  assert.equal(a.source.record.x, -100);
  assert.equal(a.source.record.note, 'primary sensor');
  assert.equal(a.source.row, 0);
  assert(Object.isFrozen(a.source.record));
  const before = studio.createSplatPicker(world);
  const selection = W.query.fromScene(world).select({ markLayer: 'sensors' });
  assert.equal(selection.length, 3);
  assert.equal(world.dataMarks.get('sensors/string/"C"').channel, 'shape');
  world.anim.rows.fill(0);
  world.anim.update(.05, 1);
  assert(world.anim.rows[0]);
  const later = studio.createSplatPicker(world);
  const hit = later.ray({ origin: [0,0,3], direction }).dominant;
  assert.equal(hit.target.mark, a.id);
  assert.equal(hit.dataMark.source.record.note, 'primary sensor');
  assert.deepEqual(hit.dataMark.channels.position, [0,0,0]);
  assert(later.ray({ origin: [-1,0,3], direction }).dominant === null);
  assert.deepEqual(before.ray({ origin: [-1,0,3], direction }).dominant.dataMark.channels.position, [-1,0,0]);
  assert.equal(W.query.fromScene(world, 1).probe('world/data-mark', {}, { id: a.id }).value.id, a.id);
});

test('mark layers default to projected point positions and series retain both interpolation records', () => {
  const source = { id: 'samples', dataInputs: {
    points: { kind: 'spatial', key: 'code', columns: { code: { type: 'string' }, u: { type: 'number', units: 'm' },
      v: { type: 'number', units: 'm' } }, coordinates: { crs: 'cartesian', axes: 'xz', units: 'm', columns: ['u','v'] },
      data: [{ code: 'P', u: 2, v: -3 }] },
    track: { kind: 'series', columns: { t: { type: 'number', units: 's' }, xyz: { type: 'vec3', units: 'world' },
      form: { type: 'string' } }, time: { column: 't' }, data: [
      { t: 1, xyz: [0,0,0], form: 'point' }, { t: 2, xyz: [1,0,0], form: 'cross' }
    ] }
  }, dataMarks: {
    points: { source: { dataset: 'points' }, channels: {} },
    center: { source: { dataset: 'track', sample: 'time' }, channels: {
      position: { column: 'xyz' }, shape: { column: 'form' }
    } }
  } };
  const world = K.diorama.build(source);
  assert.deepEqual(world.dataMarks.get('points/string/"P"').channels.position, [2,0,-3]);
  const id = 'center/time';
  assert.equal(world.dataMarks.get(id).status, 'missing');
  world.anim.update(0, 0);
  world.anim.update(.05, 1.5);
  const mark = world.dataMarks.get(id);
  assert.deepEqual(mark.channels.position, [.5,0,0]);
  assert.equal(mark.channels.shape, 'point');
  assert.equal(mark.source.record.t, 1);
  assert.equal(mark.source.next.record.t, 2);
  assert.equal(mark.source.weight, .5);
  world.anim.update(.05, 2);
  assert.equal(world.dataMarks.get(id).channels.shape, 'cross');
  const owned = rowsForLayer(world, 'center');
  assert.equal(owned.length, 2);
  assert(owned.every(index => world.data[index*16+3] > 0));
  world.anim.update(.05, 3);
  assert(owned.every(index => world.data[index*16+3] === 0));
});

function rowsForLayer(world, layer) {
  const { targetIds, targets } = world.renderMetadata;
  return Array.from(targetIds).flatMap((id, i) => targets[id]?.markLayer === layer ? [i] : []);
}

test('world snapshots encode fields and keyed record collections with source provenance', () => {
  const recorder = () => ({
    initial: () => ({ items: { beacon: { position: [0,1,0], category: 'sample' } } }),
    step: (state, { time }) => ({ items: { beacon: { ...state.items.beacon, position: [time,1,0] } } }),
    fields: { records: { type: 'record', read: ({ state }) => ({ status: 'ok', value: state }) } }
  });
  const source = {
    id: 'field-marks', dt: .25, systems: { detector: { kind: 'recorder' }, pressure: { kind: 'fields', config: {
      fields: { level: { units: 'kPa', default: .01, regions: [{ bounds: { min: [.4,-1,-1], max: [1,2,1] }, value: .08 }] } }
    } } },
    prefabs: { marker: { entities: { rest: { position: [0,0,0] } } } },
    dataInputs: diorama().dataInputs,
    visual: { dataMarks: {
      ...diorama().dataMarks,
      field: { source: { field: 'detector/records', path: '/items' }, channels: {
        position: { column: 'position' },
        size: { field: 'pressure/level', units: 'Pa', scale: { domain: [0,100], range: [0,1] } },
        color: { column: 'category', map: { sample: '#44aaff' } },
        opacity: { field: 'pressure/level', units: 'Pa', scale: { domain: [0,100], range: [0,1] } }
      } }
    } }
  };
  const options = { implementations: { recorder } };
  const run = W.runtime.create(source, options);
  const first = run.query().probe('world/data-mark', {}, { layer: 'field' }).value.marks[0];
  assert.equal(first.id, 'field/string/"beacon"');
  assert.equal(first.channels.size, .1);
  run.advance(2);
  const saved = JSON.parse(JSON.stringify(run.checkpoint()));
  const restored = W.runtime.create(saved.world, { ...options, checkpoint: saved });
  const id = first.id, probe = restored.query().probe('world/data-mark', {}, { id });
  assert.equal(probe.value.channels.size, .8);
  assert.equal(probe.value.channels.opacity, .8);
  assert.deepEqual(probe.value.source, { field: 'detector/records', row: 0, key: 'beacon',
    record: { position: [.5,1,0], category: 'sample' } });
  const baked = W.visual(kit, restored.view(), restored.query());
  assert.deepEqual(baked.dataMarks.get(id), probe.value);
  assert.deepEqual(studio.createSplatPicker(baked).ray({ origin: [.5,1,4], direction }).dominant.dataMark, probe.value);
});

test('local brush bakes preserve mark metadata and update the joined splats', () => {
  const source = diorama();
  source.solids = [{ id: 'floor', kind: 'box', at: [0,-.4,0], half: [2,.2,2], mat: 'stone', res: .2 }];
  source.brushRegion = { bounds: { min: [-2,-1,-2], max: [2,2,2] }, solids: ['floor'], cell: .2, chunkCells: 5 };
  source.dataMarks.sensors.channels.position[1] = 1;
  const world = studio.createSceneEditor(source).build();
  assert(world.brushRegion.chunks.size > 0);
  world.anim.update(0, 0);
  world.anim.update(.05, 1);
  const hit = studio.createSplatPicker(world).ray({ origin: [0,1,4], direction }).dominant;
  assert.equal(hit.dataMark.source.record.name, 'A');
  assert.deepEqual(hit.dataMark.channels.position, [0,1,0]);
});

test('missing policies, unknown columns and incompatible scales are checked', () => {
  const source = diorama(), layer = source.dataMarks.sensors;
  layer.channels.shape.fallback = 'point';
  assert.equal(K.diorama.build(source).dataMarks.get('sensors/string/"C"').channels.shape, 'point');
  delete layer.channels.shape.fallback;
  layer.missing = 'error';
  assert.throws(() => K.diorama.build(source), /missing a valid shape/);
  layer.channels.size.column = 'invalid';
  assert(K.diorama.check(source).some(result => result.path === 'dataMarks' && /unknown column/.test(result.problem)));
  layer.channels.size.column = 'level';
  layer.channels.size.scale.domain = [2,1];
  assert(K.diorama.check(source).some(result => result.path === 'dataMarks' && /invalid numeric scale/.test(result.problem)));
});

test('the render and trace CLI commands use the same mapped rows at the selected time', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-marks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), file = path.join(dir, 'scene.json');
  const png = path.join(dir, 'view.png');
  fs.writeFileSync(file, JSON.stringify(diorama()));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' });
  const draw = time => {
    call('render', file, '--t', String(time), '--w', '96', '--h', '72', '--out', png);
    return fs.readFileSync(png);
  };
  assert(!draw(0).equals(draw(1)));
  const picked = JSON.parse(call('trace', file, 'world/contributions', '--t', '1', '--at', '0,0,4',
    '--args', JSON.stringify({ direction }))).value.dominant;
  assert.equal(picked.dataMark.source.record.note, 'primary sensor');
  assert.deepEqual(picked.dataMark.channels.position, [0,0,0]);
});

test('WebGL draws changing marks and reports the source row through its ordinary picker', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, diorama, (kit, source, backend) => {
    const w = kit.KIT.diorama.build(source()), draw = backend(96, 72, { raw: true });
    try {
      w.anim.update(0, 0);
      draw.draw(w, { time: 0 });
      const first = draw.image();
      w.anim.rows.fill(0);
      w.anim.update(.05, 1);
      const changedRows = Array.from(w.anim.rows).flatMap((value, i) => value ? [i] : []);
      draw.draw(w, { time: 1, changedRows });
      const hit = draw.pick(w, { origin: [0,0,4], direction: [0,0,-1] }, { time: 1 }).dominant;
      const changed = first !== draw.image();
      const clock = kit.KIT.diorama.build({ id: 'provenance-clock', dataInputs: {
        readings: { kind: 'series', columns: { t: { type: 'number', units: 's' }, label: { type: 'string' } },
          time: { column: 't' }, data: [{ t: 0, label: 'first' }, { t: 1, label: 'second' }] }
      }, dataMarks: { reading: { source: { dataset: 'readings', sample: 'time' }, channels: { position: [0,0,0] } } } });
      const ray = { origin: [0,0,4], direction: [0,0,-1] };
      clock.anim.update(0, 0);
      const initial = draw.pick(clock, ray, { time: 0 }).dominant.dataMark.source.record.label;
      clock.anim.rows.fill(0);
      clock.anim.update(.05, 1);
      const latest = draw.pick(clock, ray, { time: 1 }).dominant.dataMark.source.record.label;
      return { changed, note: hit.dataMark.source.record.note, mark: hit.target.mark, initial, latest,
        geometryChanged: clock.anim.rows.some(Boolean) };
    } finally {
      draw.close();
    }
  });
  assert(result.changed);
  assert.equal(result.note, 'primary sensor');
  assert.equal(result.mark, 'sensors/string/"A"');
  assert.equal(result.initial, 'first');
  assert.equal(result.latest, 'second');
  assert.equal(result.geometryChanged, false);
});
