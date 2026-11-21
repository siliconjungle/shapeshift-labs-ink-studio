const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load();
const { sceneGraph: A, graph } = kit.KIT.procedural;
const chrome = process.env.INK_TEST_CHROME;

function fixture() {
  const points = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [1.75, 0, .25], [2.75, 0, .25], [1.75, 1, .25], [2.75, 1, .25], [0, 2, 0]
  ];
  return {
    points,
    faces: [[0, 1, 2], [2, 1, 3], [4, 5, 6], [6, 5, 7]],
    uvs: points.flatMap(([x, y]) => [x / 3, y / 2]), normals: points.flatMap(() => [0, 0, 1]),
    vcol: points.flatMap(() => [.1, .2, .3]), tmat: [0, 1, 1, 0],
    mats: [{ name: 'left', rgb: [1, .3, .2] }, { name: 'right', rgb: [.4, .8, .6] }]
  };
}
const bridge = { maxDisplacement: 1, edits: [{ face: 0, corner: 1, vertex: 4 }] };

test('an authored redirect changes exactly one index and keeps all vertex channels and face materials', () => {
  const source = fixture(), native = A.mesh(source);
  const { value, changes, report } = A.scrambleIndices(native, bridge);
  assert.deepEqual([...value.tri], [0, 4, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  assert.deepEqual([...native.tri], source.faces.flat());
  for (const channel of ['pos', 'uvs', 'normals', 'vcol', 'tmat', 'mats']) {
    assert.deepEqual(value[channel], native[channel]);
    assert.notEqual(value[channel], native[channel]);
  }
  assert.deepEqual(changes, [{ face: 0, corner: 1, from: 1, to: 4, displacement: Math.hypot(.75, .25) }]);
  assert.deepEqual(report, { eligibleFaces: 4, attemptedFaces: 1, changedFaces: 1, largestDisplacement: changes[0].displacement });
});

test('seeded redirects honor the face and donor sets, spatial box, distance interval and face cap', () => {
  const source = fixture(), bounds = { min: [-.1, -.1, -.01], max: [2, 1.05, .5] };
  const options = { bounds, faces: [0, 1, 2], donors: [4, 6], minDisplacement: .7, maxDisplacement: 1.1, amount: 1, seed: 26 };
  const result = A.scrambleIndices(source, options);
  const capped = A.scrambleIndices(source, { ...options, maxFaces: 1 });
  assert.equal(result.report.eligibleFaces, 2);
  assert.equal(result.report.changedFaces, 2);
  assert.equal(capped.report.changedFaces, 1);
  assert(result.changes.some(change => change.face === capped.changes[0].face && change.to === capped.changes[0].to));
  for (const { face, from, to, displacement } of result.changes) {
    assert([0, 1].includes(face) && [4, 6].includes(to));
    assert(displacement >= .7 && displacement <= 1.1);
    assert.equal(displacement, Math.hypot(...source.points[to].map((n, axis) => n - source.points[from][axis])));
  }
  assert.deepEqual(result, A.scrambleIndices(source, { ...options, faces: [2, 0, 1], donors: [6, 4] }));
  assert.deepEqual(A.scrambleIndices(source, { ...options, maxDisplacement: .74 }).changes, []);
  assert.deepEqual([...A.scrambleIndices(source, { ...options, amount: 0 }).value.tri], source.faces.flat());
});

test('invalid or degenerate authored redirects are rejected before any index is changed', () => {
  const source = A.mesh(fixture());
  const edits = (vertex, corner = 1) => [{ face: 0, corner, vertex }];
  assert.throws(() => A.scrambleIndices(source), /maximum displacement/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, maxDisplacement: .5 }), /displacement limits/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, maxDisplacement: 3, edits: edits(8) }), /degenerates/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, edits: edits(0) }), /degenerates/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, faces: [2] }), /Invalid mesh corner/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, donors: [6] }), /Invalid mesh corner/);
  assert.throws(() => A.scrambleIndices(source, { ...bridge, edits: [...edits(4), ...edits(6, 2)] }), /multiple edits/);
  assert.deepEqual([...source.tri], fixture().faces.flat());
});

function pipeline(kit, source) {
  const { makeBuilder, KIT } = kit, { graph, sceneGraph } = KIT.procedural;
  const program = graph.create({
    inputs: { mesh: 'mesh', settings: 'record' },
    nodes: {
      fault: { op: 'geo.scrambleIndices', inputs: { source: { input: 'mesh' }, options: { input: 'settings' } } },
      texture: { op: 'raster.canvas', inputs: { width: { value: 2 }, height: { value: 2 }, color: { value: [105, 210, 182, 255] } } },
      surface: { op: 'warp.surface', inputs: { source: { node: 'texture' }, mesh: { node: 'fault' } } }
    },
    outputs: {
      atlas: { node: 'surface' }, changes: { node: 'fault', port: 'changes' }, report: { node: 'fault', port: 'report' }
    }
  });
  const at = settings => program.evaluate({ mesh: sceneGraph.mesh(source), settings }).outputs;
  const world = makeBuilder(10, [0x14243a]).finish({
    cam: { target: [1.375, .5, 0], dist: 4, fov: .8, yaw: 0, pitch: 0 },
    spriteSurfaces: at({ maxDisplacement: 1, amount: 0 }).atlas
  });
  return { world, at };
}

const view = { w: 64, h: 48, px: 1, raw: true };
const gap = [30, 28];
test('the stock graph node creates a visible bridge through warp.surface', () => {
  const { world, at } = pipeline(kit, fixture());
  const pixel = () => {
    const { rgb } = studio.render(world, view);
    const p = (gap[1] * view.w + gap[0]) * 3;
    return [...rgb.subarray(p, p + 3)];
  };
  assert.deepEqual(pixel(), [20, 36, 58]);
  const output = at(bridge);
  assert.equal(output.report.changedFaces, 1);
  assert.deepEqual(output.changes, A.scrambleIndices(fixture(), bridge).changes);
  world.spriteSurfaces = output.atlas;
  assert.deepEqual(pixel(), [105, 210, 182]);
});

test('native WebGL renders the same indexed bridge as software', { skip: !chrome }, () => {
  const result = runWebGL({ chrome }, pipeline, (kit, build, backend, inputs) => {
    const { world, at } = build(kit, inputs.source);
    const draw = backend(inputs.view.w, inputs.view.h, { raw: true, offscreen: true });
    draw.draw(world);
    const original = draw.sample({ gap: inputs.gap }).gap;
    world.spriteSurfaces = at(inputs.bridge).atlas;
    draw.draw(world);
    const changed = draw.sample({ gap: inputs.gap }).gap;
    draw.close();
    return { original, changed };
  }, { source: fixture(), bridge, view, gap });
  assert.deepEqual(result.original, [20, 36, 58]);
  assert.deepEqual(result.changed, [105, 210, 182]);
});
