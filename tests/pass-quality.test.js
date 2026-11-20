const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT;

function scene(kit) {
  const B = kit.makeBuilder(1, [0x17202e, 0x67849b, 0xf7a92f, 0x6fdbc9, 0xeba5ec, 0xcdeb76]);
  const add = (object, first, target) => B.describeSplats(first, B.count(), { object, target });
  const first = B.count();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++)
    B.iso(-2.1 + x * .115, .4 + y * .115, -.2, .065, B.P[1], 3);
  add('backdrop', first, { tags: ['reduce'] });
  const hero = B.count();
  B.disc(0, .9, .1, [0, 0, 1], .40, .03, B.P[2], 3);
  B.disc(0, .91, .2, [0, 0, 1], .16, .03, B.P[0], 3);
  add('hero', hero, { tags: ['reduce'] });
  const mark = B.count();
  B.disc(1.22, .94, .1, [0, 0, 1], .19, .03, B.P[3], 3);
  add('station', mark, { mark: 'station-12', markLayer: 'stations', tags: ['reduce'] });
  const label = B.count();
  B.iso(1.92, .94, .1, .11, B.P[5], 3);
  add('legend', label, { tags: ['reduce'] });
  const particles = B.count();
  for (let i = 0; i < 16; i++)
    B.iso(-2.63 + (i % 8) * .16, .15 + Math.floor(i / 8) * .15, -.15, .038, B.P[4], 3, { nd: true, em: true });
  const profile = { background: { select: [{ tag: 'reduce' }], retain: .36 },
    particles: { retain: 0, select: [{ markLayer: 'stations' }] }, preserve: [{ object: 'legend' }] };
  const world = B.finish({ cam: { target: [0, .81, 0], dist: 5.9, pitch: 0, yaw: 0 }, fog: { c: 0, start: 1, max: 0 },
    look: { passQuality: profile, silhouetteProtection: { targets: [{ select: { object: 'hero' } }] } },
    qualityParticleRanges: [{ first: particles, count: 16 }], dither: 0, radius: 6, detail: 16 });
  return { world, first, hero, mark, label, particles, profile };
}

test('row selection is deterministic and preserves silhouettes, mark IDs, and explicit targets', () => {
  const { world, first, hero, mark, label, particles, profile } = scene(kit);
  const settings = K.passQuality.prepare(profile), rows = K.passQuality.planRows(world, settings);
  assert(rows.backgroundSkipped > 20 && rows.backgroundSkipped < hero - first);
  assert.equal(rows.particlesSkipped, 16);
  assert.deepEqual(rows.keep.subarray(hero, particles), Uint8Array.of(1, 1, 1, 1));
  assert.deepEqual(rows.keep, K.passQuality.planRows(world, settings).keep);
  const original = world.data.slice();
  const opts = { w: 132, h: 88, px: 1, t: 0, raw: true, renderStats: true, passes: ['splatId'],
    captureSilhouetteProtection: true };
  const full = studio.render(world, { ...opts, passQuality: false });
  const scaled = studio.render(world, opts);
  assert.equal(full.renderStats.splatRows, world.count);
  assert.equal(scaled.renderStats.splatRows, rows.submitted);
  assert.equal(scaled.renderStats.omittedBackgroundRows, rows.backgroundSkipped);
  assert.equal(scaled.renderStats.omittedParticleRows, rows.particlesSkipped);
  assert(full.silhouetteMask.some(Boolean));
  assert.deepEqual(full.silhouetteMask, scaled.silhouetteMask);
  for (const id of [hero + 1, mark + 1, label + 1]) {
    let pixels = 0;
    for (let i = 0; i < full.passes.splatId.length; i++) if (full.passes.splatId[i] === id) {
      assert.equal(scaled.passes.splatId[i], id);
      assert.deepEqual(scaled.rgb.slice(i * 3, i * 3 + 3), full.rgb.slice(i * 3, i * 3 + 3));
      pixels++;
    }
    assert(pixels > 0);
  }
  assert.deepEqual(world.data, original);
  assert.throws(() => K.passQuality.prepare({ background: { retain: .5 } }), /target selectors/);
  assert.throws(() => K.passQuality.prepare({ reflections: { primary: ['lake', 'lake'] } }), /unique/);
});

test('headless planar capture scaling preserves the primary pixels and skips unbudgeted captures', () => {
  const B = kit.makeBuilder(3, [0, 0xff0000, 0x00ff00]);
  B.disc(-1.46, .89, -1.8, [0, 0, 1], .51, .01, B.P[1], 1);
  B.disc(1.46, .89, -1.8, [0, 0, 1], .51, .01, B.P[2], 1);
  const water = K.procedural.waterBodies, optics = { tint: [0, 0, 0], extinction: [0, 0, 0], surfaceColor: [1, 1, 1],
    surface: 1, refraction: 0, foam: 0, caustics: 0 };
  const pools = [-1.46, 1.46].map((x, i) => water.create({ id: 'pool' + i, bounds: { min: [x - 1.1, -3], max: [x + 1.1, 1.6] },
    sample: () => ({ bed: -.8, surface: 0 }), optics: { ...optics, reflection: { plane: 'plane' + i, distortion: 0 } } }));
  const world = B.finish({ water: water.scene(pools), radius: 8,
    cam: { target: [0, 0, 0], dist: 6.6, pitch: .47, yaw: 0 },
    reflections: [0, 1].map(i => K.reflection.plane({ id: 'plane' + i })) });
  const opts = { w: 128, h: 96, px: 1, samples: true, colored: false, edges: false, renderStats: true };
  const full = studio.render(world, opts);
  const reduced = studio.render(world, { ...opts, passQuality: { reflections: { primary: ['plane0'], secondaryScale: .5 } } });
  const primary = studio.render(world, { ...opts, passQuality: { reflections: { primary: ['plane0'], maxSecondary: 0 } } });
  assert.equal(full.renderStats.planarCaptures, 2);
  assert.equal(reduced.renderStats.planarCaptures, 2);
  assert.equal(reduced.renderStats.planarPixels, 128 * 96 + 64 * 48);
  assert.equal(primary.renderStats.planarCaptures, 1);
  assert.equal(primary.renderStats.planarPixels, 128 * 96);
  let red = 0, green = 0, primaryMatches = 0;
  for (let i = 0; i < full.color.length; i += 3) {
    if (full.color[i] > 35 && full.color[i + 1] < 5) {
      assert.equal(reduced.color[i], full.color[i]);
      assert.equal(primary.color[i], full.color[i]);
      red++;
    }
    if (full.color[i + 1] > 35 && full.color[i] < 5) {
      if (reduced.color[i + 1] > 30) green++;
      if (primary.color[i + 1] === full.color[i + 1]) primaryMatches++;
    }
  }
  assert(red > 20 && green > 20 && green > primaryMatches);
});

test('authored profiles validate and the CLI accepts an override or off', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-pass-quality-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sceneFile = path.join(dir, 'scene.json'), profileFile = path.join(dir, 'quality.json');
  const profile = { background: { select: [{ entity: 'far' }], retain: .23 } };
  const spec = { id: 'pass-quality', camera: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4 },
    solids: [{ id: 'far', kind: 'box', at: [0, 0, 0], half: [1.1, .65, .24], res: .075 }],
    finish: { look: { passQuality: profile } } };
  fs.writeFileSync(sceneFile, JSON.stringify(spec));
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  assert(!K.diorama.check(spec).some(row => row.level === 'error'));
  assert(K.diorama.check({ ...spec, finish: { look: { passQuality: { particles: { retain: 2 } } } } })
    .some(row => row.path === 'finish.look.passQuality' && row.level === 'error'));
  function render(name, flags) {
    const out = path.join(dir, name + '.png');
    execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'render',
      sceneFile, '--raw', '--w', '100', '--h', '72', '--px1', '--out', out, ...flags], { stdio: 'pipe' });
    return fs.readFileSync(out);
  }
  const authored = render('authored', []);
  assert.deepEqual(render('override', ['--pass-quality', profileFile]), authored);
  assert.notDeepEqual(render('full', ['--pass-quality', 'off']), authored);
});

test('WebGL reduces submitted instances while the protected feature pixels stay identical', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scene, (kit, build, backend) => {
    const { world, profile } = build(kit);
    const view = backend(132, 88, { raw: true, offscreen: true });
    const gl = WebGL2RenderingContext.prototype, draw = gl.drawArraysInstanced, calls = [];
    gl.drawArraysInstanced = function(...args) { calls.push(args[3]); return draw.apply(this, args); };
    try {
      const focusPixels = image => {
        const pixels = atob(image), found = [[], []];
        for (let i = 0; i < pixels.length; i += 3) {
          const r = pixels.charCodeAt(i), g = pixels.charCodeAt(i + 1), b = pixels.charCodeAt(i + 2);
          if (r > 125 && r > g * 1.28 && g > b * 1.35) found[0].push(i);
          if (g > 125 && g > r * 1.38 && b > r * 1.34) found[1].push(i);
        }
        return found;
      };
      const order = Int32Array.from({ length: world.count }, (_, i) => i).sort((a, b) => world.data[a * 16 + 2] - world.data[b * 16 + 2]);
      view.draw(world, { passQuality: false, order });
      const full = view.image(), fullPixels = focusPixels(full), counts = calls.splice(0);
      view.draw(world, { passQuality: profile, order });
      const scaled = view.image(), scaledPixels = focusPixels(scaled), reduced = calls.splice(0);
      view.draw(world, { passQuality: false, order });
      return { counts, reduced, expected: kit.KIT.passQuality.planRows(world, kit.KIT.passQuality.prepare(profile)).submitted,
        fullPixels, scaledPixels, change: full !== scaled, restored: view.image() === full };
    } finally {
      gl.drawArraysInstanced = draw;
      view.close();
    }
  });
  assert(result.reduced.includes(result.expected));
  assert(result.counts.some(count => count > result.expected));
  assert.deepEqual(result.scaledPixels, result.fullPixels);
  assert(result.fullPixels.every(feature => feature.length > 12));
  assert(result.change && result.restored);
});
