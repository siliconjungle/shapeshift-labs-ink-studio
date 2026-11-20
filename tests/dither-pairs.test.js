const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, render } = require('..');
const { KIT, PixelLook, ColorSpace, makeBuilder, makeSculpt } = load();

const palette = ['#263747', '#536b84', '#b35b35', '#f6a74b', '#472974'];
const range = [.38, .44];
const pair = { colors: palette.slice(0, 2), lightness: range };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const slate = rgb('#384c60'), amber = rgb('#ce7a3e');
const policy = pairs => ({ palette, dither: { pattern: 'checker', strength: 1, pairs } });
const both = (plan, color) => [plan.index(color, 0, 0), plan.index(color, 1, 0)];

test('authorized dithering keeps the closest solid and selects an eligible alternate', () => {
  const unrestricted = PixelLook.preparePalette(policy());
  assert.deepEqual(both(unrestricted, slate), [4, 0]);
  assert.deepEqual(both(unrestricted, amber), [3, 2]);
  const restricted = PixelLook.preparePalette(policy([pair]));
  assert.deepEqual(both(restricted, slate), [1, 0]);
  assert.deepEqual(both(restricted, amber), [2, 2]);
  assert.equal(restricted.index(slate, 0, 0, false), 0);
  assert.deepEqual(both(PixelLook.preparePalette(policy([])), slate), [0, 0]);
});

test('pair lightness is inclusive and multiple ranges allow either endpoint to be the closest solid', () => {
  const lightness = ColorSpace.toOKLab(slate)[0];
  const colors = pair.colors.slice().reverse();
  const ranges = [{ colors, lightness: [.08, .16] }, { colors, lightness: [lightness, lightness] }];
  assert.deepEqual(both(PixelLook.preparePalette(policy(ranges)), slate), [1, 0]);
  assert.deepEqual(both(PixelLook.preparePalette(policy(ranges.slice(0, 1))), slate), [0, 0]);
  const fromBlueGray = rgb('#455c73');
  const perceptual = PixelLook.preparePalette({ ...policy([{ colors }]), match: 'perceptual' });
  assert.deepEqual(both(perceptual, fromBlueGray), [0, 1]);
});

test('pairs resolve named role stops and reject ambiguous, reserved or missing endpoints', () => {
  const options = { palette: [0x263747, 0x536b84], roles: { slate: [0, 1] } };
  const named = { colors: ['slate.shadow', 1] };
  const plan = PixelLook.preparePalette({ ...policy([named]), reserved: ['#f6a74b'] }, options);
  assert.deepEqual(both(plan, slate), [1, 0]);
  assert.equal(plan.packed[plan.index(rgb('#f6a74b'))], 0xf6a74b);
  for (const colors of [['slate', 1], ['#abcdef', 1], ['#f6a74b', 1]])
    assert.throws(() => PixelLook.preparePalette({ ...policy([{ colors }]), reserved: ['#f6a74b'] }, options),
      /single unreserved palette candidates/);
  assert.throws(() => PixelLook.preparePalette(policy([{ colors: ['slate.shadow', 0] }]), options), /distinct/);
  assert.throws(() => PixelLook.preparePalette(policy([{ ...named, lightness: [.8, .7] }]), options), /ordered range/);

  const unnamed = { palette: { dither: policy([named]).dither } };
  assert.deepEqual(KIT.world.lookReport.standalone(unnamed).dependencies,
    [{ type: 'scene-palette' }, { type: 'swatch', id: 'slate.shadow' }, { type: 'swatch', id: 1 }]);
  assert.throws(() => KIT.world.lookReport.standalone({
    palette: { dither: policy([{ ...named, lightness: [-1, .7] }]).dither }
  }), /ordered range/);
});

test('material and stage policies carry pairs from versioned look data to rendered pixels', () => {
  const definition = policy([pair]);
  const pack = { format: 'ink-studio/asset-pack', version: 1, revision: 1, id: 'signal', title: 'Signal',
    looks: [{ id: 'signal/slate', label: 'Slate', palette: definition }] };
  const catalog = KIT.authoring.assetPacks.create({ packs: [pack] });
  const binding = KIT.authoring.looks.bind('signal/slate', catalog);
  assert.deepEqual(binding.palette.dither.pairs, definition.dither.pairs);
  const view = { w: 64, h: 64, px: 1, ortho: true };
  for (const staged of [false, true]) {
    const b = makeBuilder(1, [0x18222c, 0x384c60]);
    const sculpt = makeSculpt(b);
    const base = { r: [1], em: true, materialId: 'slate' };
    const material = staged ? base : KIT.surface.material(base, { paletteConstraint: binding.palette });
    sculpt.box([0, 0, 0], [.65, .65, .20], material, { res: .075 });
    sculpt.bake();
    const look = staged ? KIT.authoring.looks.scene({ renderStages: [
      { stage: 'palette', select: { material: 'slate' }, palette: binding.palette }
    ] }) : undefined;
    const frame = render(b.finish({ look, cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5, sway: 0 } }), view);
    const swatches = [31, 32].map(x => Buffer.from(frame.rgb.slice((32 * 64 + x) * 3, (32 * 64 + x) * 3 + 3))
      .toString('hex')).sort();
    assert.deepEqual(swatches, ['263747', '536b84']);
  }
});

test('WebGL applies pair eligibility in native and coverage-aware output', { skip: !process.env.INK_TEST_CHROME }, () => {
  const run = require('../cli/look-webgl.js');
  const cases = [
    { color: '#384c60', pairs: [pair], match: 'perceptual', expected: [0, 1] },
    { color: '#384c60', pairs: [{ ...pair, lightness: [.60, .70] }], expected: [0, 0] },
    { color: '#ce7a3e', pairs: [pair], expected: [2, 2] },
    { color: '#ce7a3e', expected: [2, 3] }
  ];
  const { outputs } = run({}, ({ makeBuilder }, color) => {
    const b = makeBuilder(3, [0x151c26, parseInt(color.slice(1), 16)]);
    b.disc(0, 0, 0, [0, 0, 1], .8, .045, b.P[1], 3);
    b.describeSplats(0, b.count(), { material: 'fixture' });
    return b.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, sway: 0 }, dither: 0 });
  }, (kit, fixture, backend, { palette, cases }) => {
    const draw = backend(48, 48, { ortho: true, dither: 0, outline: false });
    try {
      return { outputs: cases.map(({ color, pairs, match }) => {
        const world = fixture(kit, color);
        const paletteConstraints = { targets: [{ material: 'fixture', palette, match,
          dither: { pattern: 'checker', strength: 1, pairs } }] };
        return [false, true].map(coverageAware => {
          draw.draw(world, { coverageAware, paletteConstraints });
          return Object.values(draw.sample({ a: [23, 23], b: [24, 23] })).sort();
        });
      }) };
    } finally { draw.close(); }
  }, { palette, cases });
  outputs.forEach(([native, coverage], i) => {
    const expected = cases[i].expected.map(slot => rgb(palette[slot]).map(n => Math.round(n * 255))).sort();
    assert.deepEqual(native, expected);
    assert(coverage.every((swatch, j) => swatch.every((value, channel) =>
      Math.abs(value - expected[j][channel]) <= 3)), JSON.stringify({ coverage, expected }));
  });
});
