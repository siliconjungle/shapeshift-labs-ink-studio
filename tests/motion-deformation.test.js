const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('..').load();
const K = kit.KIT, { graph, motionDeformation: D, sceneGraph } = K.procedural;
const approx = (a, b, tolerance = 1e-5) =>
  Array.from(a).forEach((n, i) => assert.ok(Math.abs(n - b[i]) < tolerance, 'Expected ' + n + ' near ' + b[i]));

test('tracked silhouette rays reach the outer contour and use timing, confidence, and rest fallback', () => {
  const ring = r => ({ points: [[-r, -r], [r, -r], [r, r], [-r, r]], closed: true });
  const feature = r => ({ id: 'patch', center: [0, 0], contours: [ring(1), ring(r)], confidence: 1 });
  const frames = [{ time: 0, regions: [feature(3)] }, { time: .25, regions: [feature(5)] },
    { time: .5, regions: [] }, { time: .9, regions: [feature(6)] }];
  const bindings = [{ id: 'rim', rest: [3, 0], track: 'patch', silhouetteDirection: [2, 0], lag: .1, hold: .2 },
    { id: 'center', rest: [0, 0], track: 'patch' }, { id: 'pin', rest: [-4, 0] }];
  const { sample } = D.track(frames, bindings);
  const mid = sample(.225);
  approx(mid.value.to[0], [4, 0]);
  const held = sample(.7);
  assert.deepEqual(held.landmarks.map(row => row.status), ['held', 'hidden', 'pinned']);
  assert.deepEqual(held.value.to, [[5, 0], [0, 0], [-4, 0]]);
  assert.deepEqual(sample(.8).value.to[0], [3, 0]);
  assert.deepEqual(sample(1).value.to[0], [6, 0]);
  assert.deepEqual(sample(.225), mid);
  assert.throws(() => D.track(frames, [...bindings, { id: 'duplicate', rest: [3, 0] }]), /distinct rest/);
  assert.throws(() => D.track(frames, [{ ...bindings[0], silhouetteDirection: [0, 0] }]), /position/);
});

test('native motion map interpolates exact controls and its chart Jacobian agrees with finite differences', () => {
  const control = { from: [[0, 0], [4, 0], [1, 4]], to: [[-1, 0], [5, -2], [0, 3]] };
  const map = D.map2D(control);
  control.from.forEach((point, i) => assert.deepEqual(map(point), control.to[i]));
  const origin = [2, 3, 4], u = [.5, 0, 0], v = [.25, 0, 1], normal = [0, -1, 0];
  const world = ([s, t], h) => K.V.add(origin, K.V.add(K.V.add(K.V.mul(u, s), K.V.mul(v, t)), K.V.mul(normal, h)));
  const deform = K.deform.motion(control, { chart: { origin, u, v } });
  approx(deform(world([4, 0], 2)), world([5, -2], 2));
  const point = world([2, 1], 3);
  approx(K.deform.jac(deform, point), K.deform.jac(p => deform(p), point, 1e-5));
  assert.ok(K.deform.jac(deform, world([4 + 1e-9, 0], 2)).every(Number.isFinite));
  assert.throws(() => K.deform.motion(control, { chart: { u, v: u } }), /independent/);
});

test('mesh deformation retains topology, UVs, vertex colors, and materials, and carries authored normals', () => {
  const source = {
    points: [[0, 0, .5], [4, 0, .5], [2, 1, 1]], faces: [[0, 1, 2]],
    uvs: [0, 0, 1, 0, .5, 1], vcol: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], tmat: [1],
    mats: [{ name: 'blank', rgb: [0, 0, 0] }, { name: 'ink', rgb: [1, 1, 1] }]
  };
  const control = { from: [[0, 0], [4, 0]], to: [[0, 0], [5, 3]] };
  const baseline = sceneGraph.mesh(source), moved = D.mesh(source, control);
  for (const channel of ['tri', 'uvs', 'vcol', 'tmat', 'mats']) assert.deepEqual(moved[channel], baseline[channel]);
  approx(moved.pos.slice(3, 6), [5, 3, .5]);
  assert.notDeepEqual(moved.normals.slice(6), baseline.normals.slice(6));
  assert.deepEqual(source.points[1], [4, 0, .5]);
});

test('one graph drives sprite art from measured regions and replays from the same authored pixels', () => {
  const width = 12, height = 10, pixel = (x, y) => y * width + x;
  const frame = (x, y) => ({ width, height, channels: 1,
    data: Uint8Array.from({ length: width * height }, (_, p) => p === pixel(x, y) ? 255 : 0) });
  const source = { width, height, channels: 4, data: new Uint8Array(width * height * 4) };
  source.data.set([213, 95, 38, 255], pixel(3, 4) * 4);
  const frames = [frame(4, 4), frame(7, 6), frame(-100, 0)];
  const link = (node, port = 'value') => ({ node, port });
  const runner = graph.create({
    inputs: { source: 'raster', frames: 'array<raster>' },
    nodes: {
      observations: { op: 'fx.regionObservations', inputs: { frames: { input: 'frames' },
        options: { fps: 4, contours: true } } },
      controls: { op: 'motion.landmarks', inputs: { observations: link('observations'),
        bindings: [{ id: 'mark', track: 1, rest: [5, 4.5], silhouetteDirection: [1, 0] }] } },
      bind: { op: 'rig.bindSprite', inputs: { source: { input: 'source' },
        bones: [{ id: 'root', pivot: [4, 4], tip: [8, 4] }], options: { segments: [2, 2] } } },
      posed: { op: 'rig.skinSprite', inputs: { source: { input: 'source' }, bind: link('bind'), motion: link('controls') } }
    },
    outputs: { art: link('posed'), joints: link('posed', 'joints'), controls: link('controls', 'landmarks') }
  });
  const at = time => runner.evaluate({ source, frames }, { time }).outputs;
  const start = at(0), moved = at(.25), hidden = at(.5);
  assert.deepEqual(start.controls[0].position, [5, 4.5]);
  assert.deepEqual(moved.joints.root, { pivot: [7, 6], tip: [11, 6] });
  assert.deepEqual(moved.art.data.slice(pixel(6, 6) * 4, pixel(6, 6) * 4 + 4), Uint8Array.of(213, 95, 38, 255));
  assert.deepEqual(hidden.art, start.art);
  runner.clear();
  assert.deepEqual(at(.25), moved);
  assert.deepEqual(at(0), start);
});

test('selected splats carry covariance and authored footprint frames without altering input or other rows', () => {
  const builder = kit.makeBuilder(5, [0x000000, 0xfdad55]);
  for (const x of [2, 4]) {
    const frame = K.surfaceBrush.direction({ direction: 'axis', axis: [1, 0, 0], length: 2, width: 1 },
      [x, 1, 0], [0, 0, 1]);
    K.surfaceBrush.stamp(builder, frame, builder.P[1], { style: 'ink', direction: 'axis' });
  }
  const world = builder.finish(), data = world.data.slice(), frames = world.splatFootprints.frames.slice();
  const control = { from: [[0, 0], [4, 0]], to: [[0, 0], [5, 3]] };
  const warped = D.splats(world, [0], control), native = K.deform.motion(control);
  const original = data.slice(0, 3), expected = new Float32Array(6);
  kit.SplatFootprints.carryFrame(expected, 0, frames, 0, native.jacobian(original));
  approx(warped.data.slice(0, 3), native(original));
  assert.notDeepEqual(warped.data.slice(4, 11), data.slice(4, 11));
  assert.deepEqual(warped.data.slice(16), data.slice(16));
  assert.equal(warped.data[3], data[3]);
  assert.deepEqual(warped.splatFootprints.indices, world.splatFootprints.indices);
  assert.deepEqual(warped.splatFootprints.frames.slice(0, 6), expected);
  assert.deepEqual(warped.splatFootprints.frames.slice(6), frames.slice(6));
  assert.deepEqual(world.data, data);
  assert.deepEqual(world.splatFootprints.frames, frames);
  assert.deepEqual(D.splats(world, [0], control).data, warped.data);
});
