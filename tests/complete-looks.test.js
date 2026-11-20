const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT: K, ArtDirection } = ink.load();
const studioLooks = require('../examples/copperwind-looks.json');

const scene = {
  id: 'look-review',
  camera: { target: [0, .18, 0], dist: 5, yaw: .22, pitch: .1, sway: 0 },
  finish: { look: { pixel: true, splatCoverage: 'continuous' }, dither: 0 },
  solids: [
    { id: 'stone', kind: 'ball', at: [0, .25, 0], r: .72, res: .12, mat: { role: 'stone', surface: {
      id: 'stone', layers: { daylight: { type: 'diffuse', lightingRamp: { role: 'stone' } } }
    } } },
    { id: 'sill', kind: 'box', at: [0, -.65, 0], half: [1.3, .15, .8], res: .15, mat: 'moss' }
  ]
};

test('complete looks round-trip and bind through the existing asset-pack revision and override rules', () => {
  const A = K.authoring;
  const bundle = A.assetPacks.bundle([studioLooks], ['copperwind']);
  const catalog = A.assetPacks.create({ packs: JSON.parse(JSON.stringify(bundle)).packs });
  const look = A.environments.bind({ asset: 'copperwind/storybook', revision: 1 }, catalog);
  assert.equal(look.settings.look.surfaceLightRamps.stone.daylight.interpolation, 'step');
  assert.equal(look.settings.liveSun.filter, 0);
  const settings = ArtDirection.prepare(look.settings.look.artDirection);
  assert.equal(ArtDirection.time(settings, 1.11), 1);
  const override = A.environments.bind({ asset: look.id, overrides: { aerialPerspective: { density: .2 },
    look: { ink: false, artDirection: { cadence: { scene: 10 } } } } }, catalog);
  assert.equal(override.settings.look.ink, false);
  assert.equal(override.settings.look.artDirection.cadence.environment, settings.cadence.environment);
  assert.equal(override.settings.aerialPerspective.density, .2);
  assert.equal(override.settings.aerialPerspective.start, look.settings.aerialPerspective.start);
  assert.throws(() => A.environments.bind({ asset: look.id, revision: 2 }, catalog), /requires pack revision 2/);
  assert.throws(() => A.environments.bind({ asset: look.id, overrides: { look: { surfaceLightRamps: {
    stone: { daylight: { stops: [[0, 1], [1, 2]] } }
  } } } }, catalog), /explicit hex or RGB light ramp stops/);
});

test('the software renderer applies ramps to named finishes without editing scene materials', () => {
  const world = K.diorama.build({ ...scene, assetPacks: [studioLooks], environmentPreset: 'copperwind/painterly' });
  const stone = world.surfaces.find(({ settings }) => settings.id === 'stone');
  const baked = world.data.slice();
  const settings = { w: 72, h: 57, px: 1, passes: ['coverage'], t: 1 };
  const withRamp = ink.render(world, settings);
  const withoutRamp = ink.render(world, { ...settings, surfaceLightRamps: false });
  assert.notDeepEqual(withRamp.rgb, withoutRamp.rgb);
  assert.deepEqual(withRamp.passes.coverage, withoutRamp.passes.coverage);
  assert.equal(stone.settings.layers.daylight.lightingRamp.role, 'stone');
  assert.deepEqual(world.data, baked);
});

test('the CLI can swap two packaged looks on one JSON diorama', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-complete-look-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'diorama.json');
  fs.writeFileSync(file, JSON.stringify(scene));
  const raster = name => {
    const out = path.join(dir, name + '.png');
    execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'render', file,
      '--asset-pack', path.join(__dirname, '../examples/copperwind-looks.json'),
      '--environment-preset', 'copperwind/' + name, '--t', '1', '--px', '1', '--w', '72', '--h', '57', '--out', out]);
    return require('../cli/png.js').raster(out).data;
  };
  assert.notDeepEqual(raster('storybook'), raster('atmospheric'));
});
