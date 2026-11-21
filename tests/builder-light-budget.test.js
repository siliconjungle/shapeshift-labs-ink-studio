const assert = require('node:assert/strict');
const { test } = require('node:test');
const { KIT, makeBuilder, makeSculpt } = require('..').load();

test('axial splats normalize their axis and reject invalid inputs before adding a row', () => {
  const build = makeBuilder(9), color = build.P[1];
  for (const method of ['axial', 'disc', 'stick']) {
    const add = axis => build[method](0, 0, 0, axis, .4, .07, color, 3);
    const before = build.count();
    for (const axis of [[0, 0, 0], [NaN, 0, 1], [Infinity, 0, 0], ['1', 0, 0], [1, 0], null])
      assert.throws(() => add(axis), /Splat axis/);
    assert.equal(build.count(), before);
    add([.6, .8, 0]);
    add([3, 4, 0]);
    add([1, 0, 0]);
    add([Number.MIN_VALUE, 0, 0]);
    add([Number.MAX_VALUE, 0, 0]);
  }
  const world = build.finish();
  const covariance = i => world.data.subarray(i * 16 + 4, i * 16 + 11);
  for (let start = 0; start < world.count; start += 5) {
    assert.deepEqual(covariance(start), covariance(start + 1));
    assert.deepEqual(covariance(start + 2), covariance(start + 3));
    assert.deepEqual(covariance(start + 2), covariance(start + 4));
    const [xx, xy, xz, , yy, yz, zz] = covariance(start + 1);
    assert(xx > 0 && xx * yy - xy * xy > 0);
    assert(xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz) > 0);
  }
  assert.deepEqual(world.renderMetadata.normals.slice(5 * 3, 7 * 3), Float32Array.of(.6, .8, 0, .6, .8, 0));
  assert.deepEqual(world.renderMetadata.normals.slice(7 * 3, 10 * 3), Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0));
});

test('live sun setup resolves bound rig names without adding parts on a miss', () => {
  const b = makeBuilder(2);
  b.iso(0, 0, 0, .12, b.P[1], 3);
  const stage = KIT.stage(b.finish()), rig = KIT.rig(b, {});
  rig.assign('lantern', [0]);
  rig.bind(stage);
  const names = rig.names.slice(), matrices = rig.M.slice();
  const capture = { ramp: [1], n: [[0, 1, 0]], t: [.5], ramps: [[1, 2]] };
  const sun = { dir: [0, 1, 0], amb: .1, sky: 0, k: .7, parts: ['lantern'] };
  const options = { sun };
  assert.equal(KIT.light.pack(stage, capture, options).rigRamp[2], 1);
  assert.equal(KIT.light.system(stage, capture, [], options).count, 1);
  const typo = { sun: { ...sun, parts: ['lantern', 'lantren'] } };
  assert.throws(() => KIT.light.pack(stage, capture, typo), /Unknown bound rig part.*lantren/);
  assert.throws(() => KIT.light.system(stage, capture, [], typo), /Unknown bound rig part.*lantren/);
  assert.deepEqual(rig.names, names);
  assert.deepEqual(rig.M, matrices);
  assert.equal(rig.has('lantren'), false);
});

const packColor = color => (color >>> 16) | (color & 0xff00) | ((color & 255) << 16);
function deckColors(world) {
  const shadow = [], open = [];
  for (let i = 0; i < world.count * 16; i += 16) {
    const [x, y, z] = world.data.subarray(i, i + 3);
    if (Math.abs(x) > .9 || y < -.03 || Math.abs(z) > 3.3) continue;
    if (Math.abs(z) < .7) shadow.push(world.data[i + 7]);
    if (Math.abs(z) > 2.9) open.push(world.data[i + 7]);
  }
  assert(shadow.length > 10 && open.length > 10);
  return { shadow, open };
}

test('authored steps and directional distance independently limit a baked shadow cast 26 units away', () => {
  const spec = { id: 'distant-rim', seed: 29,
    style: { sun: [1, .42, 0], amb: .16, sky: 0,
      palette: [0x181e35, 0x4b3c68, 0x8e789c, 0xe8ba95, 0xffebc2], roles: { stone: [1, 2, 3, 4] } },
    finish: { look: { shadowArt: { ramp: [0, 1] } } },
    solids: [
      { id: 'deck', kind: 'box', at: [0, -.22, 0], half: [2, .22, 3.9], mat: 'stone', res: .24 },
      { id: 'rim', kind: 'box', at: [26, 7, 0], half: [.45, 7, 1.25], mat: 'stone', res: .7 }
    ] };
  const bake = shadowMarch => KIT.diorama.build({ ...spec, finish: { ...spec.finish, shadowMarch } });
  const legacy = bake(undefined);
  assert.deepEqual(legacy.data, bake({ steps: 20, distance: 16 }).data);
  for (const settings of [{ distance: 42 }, { steps: 128, distance: 18 }])
    assert.deepEqual(deckColors(legacy), deckColors(bake(settings)));
  const extended = bake({ steps: 128, distance: 42 });
  const colors = deckColors(extended);
  assert.equal(extended.count, legacy.count);
  assert.deepEqual(colors.open, deckColors(legacy).open);
  assert(deckColors(legacy).shadow.every(color => color === packColor(legacy.pal[2])));
  assert(colors.shadow.every(color => color === packColor(extended.pal[1])));
  for (const shadowMarch of [{ steps: -1 }, { steps: 20.5 }, { steps: 4097 }, { distance: -1 }, { dist: 20 }]) {
    const errors = KIT.diorama.check({ ...spec, finish: { shadowMarch } });
    assert(errors.some(error => error.path === 'finish.shadowMarch' && error.level === 'error'));
  }
});

test('the sculpt API budgets baked point-light rays', () => {
  const bake = steps => {
    const b = makeBuilder(1, [0, 0x2b3558, 0x8dacbe, 0xfce8b0]), s = makeSculpt(b);
    Object.assign(s, { shSteps: steps, amb: .13, sunK: 0, sky: 0, aoK: 0, wob: 0,
      lights: [{ p: [4, 4, 0], r: 16, s: 4, sh: true }] });
    const material = { r: [1, 2, 3] };
    s.box([0, -.22, 0], [2, .22, 4], material, { res: .24 });
    s.box([2, 1.35, 0], [.17, 1.35, .95], material, { res: .26 });
    s.bake();
    return b.finish();
  };
  const off = bake(0), on = bake(20);
  assert(deckColors(off).shadow.every(color => color === packColor(off.pal[3])));
  assert(deckColors(on).shadow.every(color => color === packColor(on.pal[1])));
  assert.deepEqual(deckColors(off).open, deckColors(on).open);
  assert.throws(() => bake(Infinity), /Shadow march steps/);
});
