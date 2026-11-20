const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { KIT: K, PixelLook } = require('..').load();

const dark = '#202020', accent = '#b0b0b0';
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const policy = (reserve, pairs) => ({
  palette: [dark], reserved: [reserve], dither: { pattern: 'checker', strength: 1, ...(pairs && { pairs }) }
});
const phase = (plan, color) => [0, 1].map(x => plan.packed[plan.index(rgb(color), x, 0)]);
const both = [{ colors: [dark, accent] }];
const exact = 0xb0b0b0, base = 0x202020;

test('exact reservation, nearest matching and mixing are independent', () => {
  const modes = [accent, { color: accent, match: true }, { color: accent, dither: true },
    { color: accent, match: true, dither: true }];
  for (const [i, reserve] of modes.entries()) {
    const plan = PixelLook.preparePalette(policy(reserve));
    assert.deepEqual(phase(plan, accent), [exact, exact]);
    assert.deepEqual(phase(plan, '#4c4c4c'), [i >= 2 ? exact : base, base]);
    assert.equal(plan.packed[plan.index(rgb('#a0a0a0'), 1, 0, false)], i % 2 ? exact : base);
  }
  const matchOnly = PixelLook.preparePalette({ ...policy(modes[1]), palette: [dark, '#d0d0d0'] });
  assert.deepEqual(phase(matchOnly, '#bcbcbc'), [exact, exact]);
  const protectedOnly = PixelLook.preparePalette({ palette: [accent], reserved: [modes[1]] });
  assert.deepEqual(phase(protectedOnly, '#000000'), [exact, exact]);
});

test('allowed pairs and lightness limits still govern reserved endpoints', () => {
  const reserve = { color: 'signal.highlight', dither: true };
  const context = { palette: [0x707070, exact], roles: { signal: [0, 1] } };
  const pair = { colors: [dark, 'signal.highlight'] };
  assert.deepEqual(phase(PixelLook.preparePalette(policy(reserve, [pair]), context), '#4c4c4c'), [exact, base]);
  assert.deepEqual(phase(PixelLook.preparePalette(policy(reserve, []), context), '#4c4c4c'), [base, base]);
  assert.deepEqual(phase(PixelLook.preparePalette(policy(reserve, [{ ...pair, lightness: [.7, .9] }]), context),
    '#4c4c4c'), [base, base]);
  assert.throws(() => PixelLook.preparePalette(policy({ color: accent, match: true }, both)), /dithering enabled/);
  assert.throws(() => PixelLook.preparePalette({ ...policy(accent), reserved: [accent, { color: accent, dither: true }] }),
    /conflicting/);
  const look = { palette: policy(reserve, [pair]) };
  assert(K.world.lookReport.standalone(look, undefined, 'headless').dependencies
    .some(dep => dep.type === 'swatch' && dep.id === 'signal.highlight'));
  assert.throws(() => K.world.lookReport.standalone({ palette: policy({ ...reserve, match: 1 }) }), /booleans/);
});

test('fitting and graded palette resolve keep the exact swatch lock', () => {
  const reserve = { color: accent, dither: true };
  const fit = target => K.palette.fitDither({ target, policy: policy(reserve, both), size: [4, 4] }).report;
  assert.deepEqual(fit(accent).fit.colors, [accent]);
  assert.deepEqual(fit('#838383').fit.colors, [dark, accent]);
  const match = K.palette.fitDither({ target: '#a0a0a0', policy: policy({ color: accent, match: true }, []) }).report;
  assert.equal(match.solid.color, accent);
  const graded = PixelLook.preparePalette({ ...policy(reserve, both), source: 'graded' });
  const resolve = (color, adjusted) => graded.packed[PixelLook.paletteIndex(graded, rgb(color), 0, 0,
    { scene: [rgb(color)], grade: rgb(adjusted) })];
  assert.equal(resolve(accent, dark), exact);
  assert.equal(resolve('#808080', accent), exact);
});

test('the native CLI accepts reservation objects and external export keeps their colors', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ink-protected-swatches-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'signal.json'), external = join(dir, 'signal.gpl');
  writeFileSync(source, JSON.stringify(policy({ color: accent, match: true, dither: true }, both)));
  const run = (...args) => execFileSync(process.execPath, [join(__dirname, '../cli/ink-studio.js'), ...args], { encoding: 'utf8' });
  const inspection = JSON.parse(run('look', 'inspect', source));
  assert.deepEqual(inspection.rules[0].palette.reserved, [{ color: accent, match: true, dither: true }]);
  const pack = join(dir, 'pack.json');
  run('look', 'import', source, '--out', pack);
  const imported = JSON.parse(readFileSync(pack, 'utf8'));
  assert.deepEqual(imported.looks[0].palette.reserved, inspection.rules[0].palette.reserved);
  run('look', 'export', pack, '--format', 'gpl', '--out', external);
  assert.match(readFileSync(external, 'utf8'), /176\s+176\s+176/);
});

test('WebGL honors exact, solid-only and alternate-only reserved swatches', { skip: !process.env.INK_TEST_CHROME }, () => {
  const run = require('../cli/look-webgl.js');
  const settings = [
    { input: 0x4c4c4c, policy: policy({ color: accent, dither: true }, both), expected: [0x20, 0xb0] },
    { input: 0xa0a0a0, policy: policy({ color: accent, match: true }), expected: [0xb0, 0xb0] },
    { input: exact, policy: policy(accent), expected: [0xb0, 0xb0] },
    { input: 0x4c4c4c, policy: policy(accent), expected: [0x20, 0x20] },
    { input: 0x4c4c4c, policy: { ...policy({ color: accent, dither: true }),
      reserved: [...Array.from({ length: 25 }, (_, i) => '#0000' + (i + 1).toString(16).padStart(2, '0')),
        { color: accent, dither: true }] }, expected: [0x20, 0xb0] }
  ];
  const { outputs } = run({}, ({ makeBuilder }, color) => {
    const b = makeBuilder(3, [0x151c26, color]);
    b.disc(0, 0, 0, [0, 0, 1], .8, .045, b.P[1], 3);
    b.describeSplats(0, b.count(), { material: 'signal' });
    return b.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, sway: 0 }, dither: 0,
      look: { splatCoverage: 'continuous' } });
  }, (kit, fixture, backend, settings) => {
    const draw = backend(48, 48, { ortho: true, dither: 0, outline: false });
    try {
      return { outputs: settings.map(({ input, policy }) => {
        const world = fixture(kit, input);
        return [false, true].map(coverageAware => {
          draw.draw(world, { coverageAware, paletteConstraints: { targets: [{ material: 'signal', ...policy }] } });
          return Object.values(draw.sample({ a: [23, 23], b: [24, 23] })).map(rgb => rgb[0]).sort((a, b) => a - b);
        });
      }) };
    } finally { draw.close(); }
  }, settings);
  outputs.forEach(([native, coverage], i) => {
    assert.deepEqual(native, settings[i].expected, JSON.stringify({ i, outputs }));
    assert(coverage.every((v, slot) => Math.abs(v - settings[i].expected[slot]) <= 3), JSON.stringify(coverage));
  });
});
