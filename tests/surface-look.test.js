const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const Surface = require('../src/surface-look.js');
const studio = require('..').load();
const { render } = require('../cli/render.js');
const gallery = require('../examples/surface-gallery.js');

const { KIT, makeBuilder, makeSculpt } = studio;
const base = [0.13, 0.17, 0.21];
const front = { position: [0.5, 0.5, 0.5], normal: [0, 0, 1], view: [0, 0, 1] };
const neutralSun = [0, 0, 1];
const prepare = settings => Surface.prepare(settings, [], neutralSun);

test('directional roughness turns the reflection when the tangent rotates', () => {
  const finish = direction => prepare({ direction, layers: { brush: { type: 'specular', roughness: [0.11, 0.58] } } });
  const x = { ...front, view: [0.48, 0, 0.877] };
  const y = { ...front, view: [0, 0.48, 0.877] };
  const alongX = finish('x'), alongY = finish('y');
  assert(Surface.shade(alongX, x, base)[0] + 0.5 < Surface.shade(alongX, y, base)[0]);
  assert(Surface.shade(alongY, y, base)[0] + 0.5 < Surface.shade(alongY, x, base)[0]);
  assert.deepEqual(Surface.shade(alongX, { ...x, visibility: 0 }, base).slice(0, 3), base);
});

test('grazing reflection, coverage and thin-film colour respond independently to the view', () => {
  const grazing = { ...front, view: [0.96, 0, 0.28] };
  const reflection = prepare({
    opacity: { facing: 0.15, grazing: 1, power: 2 },
    layers: { reflect: { type: 'reflection', f0: 0 } }
  });
  const a = Surface.shade(reflection, front, base), b = Surface.shade(reflection, grazing, base);
  assert.equal(a[3], 0.15);
  assert(b[3] > a[3] + 0.4);
  assert(b[2] > a[2]);
  const film = prepare({ layers: { tint: { type: 'film', thickness: 580, f0: 1 } } });
  assert.notDeepEqual(Surface.shade(film, front, base).slice(0, 3), Surface.shade(film, grazing, base).slice(0, 3));
});

test('ripple fronts move from fixed sources and only affect samples they pass', () => {
  const water = Surface.prepare({
    direction: 'x',
    normal: { type: 'rings', amplitude: 0.55, speed: 1, scale: 0.45, width: 0.6, drops: [{ at: [0, 0, 0], start: 0.5 }] },
    layers: { highlight: { type: 'specular', roughness: 0.12 } }
  }, [], [0, 1, 0]);
  const sample = { position: [1.0, 0, 0], normal: [0, 1, 0], view: [0, 1, 0] };
  const still = Surface.shade(water, { ...sample, time: 0.3 }, base);
  assert.deepEqual(Surface.shade(water, { ...sample, time: 0.7 }, base), still);
  assert.notDeepEqual(Surface.shade(water, { ...sample, time: 1.40 }, base), still);
  assert.deepEqual(Surface.shade(water, { ...sample, time: 2.4 }, base), still);
});

test('glints stay anchored, respond to the angle, and fade once they are subpixel', () => {
  const shader = prepare({
    seed: 7, layers: { flakes: { type: 'glints', scale: 1, density: 1, tilt: 0, roughness: 0.08 } }
  });
  const on = Surface.shade(shader, front, base);
  assert(on[4] > 0.9);
  assert.deepEqual(on, Surface.shade(shader, front, base));
  assert(Surface.shade(shader, { ...front, view: [0.5, 0.3, 0.8] }, base)[4] < 0.01);
  assert(Surface.shade(shader, { ...front, position: [0.01, 0.01, 0.01] }, base)[4] === 0);
  assert(Surface.shade(shader, { ...front, footprint: 4 }, base)[4] < 0.08);
});

test('all 40 presets compile and have a usable response across a surface-angle sweep', () => {
  const names = gallery.groups.flatMap(group => group.swatches.map(([name]) => name));
  assert.equal(new Set(names).size, 40);
  assert.deepEqual(KIT.surface.presets.slice().sort(), names.slice().sort());
  for (const name of names) {
    const mat = KIT.surface.preset(name, { r: [1, 2] });
    const shader = prepare(mat.surface);
    let effect = 0;
    for (let row = 0; row < 9; row++) for (let col = 0; col < 14; col++) {
      const a = col * 0.49, e = row * 0.17;
      const sample = {
        ...front,
        position: [0.09 + row * 0.117, 0.24 + col * 0.129, 0.61 - row * 0.065],
        view: [Math.cos(a) * Math.sin(e), Math.sin(a) * Math.sin(e), Math.cos(e)]
      };
      const result = Surface.shade(shader, sample, base);
      assert(result.every(value => Number.isFinite(value) && value >= 0 && value <= 1), name);
      effect = Math.max(effect, ...base.map((value, i) => Math.abs(value - result[i])));
    }
    assert(effect > 0.06, name + ' should visibly shade at least one sample');
  }
});

test('presets extend an existing material, disable named layers, and isolate overrides', () => {
  const existing = KIT.surface.material({ r: [2, 3], a: 0.8 }, { layers: { polish: { type: 'sheen', strength: 0.2 } } });
  const custom = KIT.surface.preset('brushed-steel', existing, { direction: 'z', layers: { brush: { roughness: [0.22, 0.37] }, polish: false } });
  assert.equal(custom.a, 0.8);
  assert.deepEqual(custom.r, [2, 3]);
  assert.equal(custom.surface.layers.brush.type, 'specular');
  assert.equal(custom.surface.layers.polish, false);
  assert.equal(prepare(custom.surface).layers.length, 1);
  assert.equal(existing.surface.layers.polish.strength, 0.2);
  assert.deepEqual(KIT.surface.preset('brushed-steel').surface.layers.brush.roughness, [0.09, 0.58]);
  assert.throws(() => KIT.surface.preset('missing'), RangeError);
});

function makeWorld(coloredBase, addCoat) {
  const B = makeBuilder(17, [0x0c0f1a, 0x2d2633, 0x6a3845, 0xb46768, 0x7fbbe3, 0xeff9fc]);
  const S = KIT.sculpt(makeSculpt(B));
  S.pixel = true;
  S.sun = [0.06, 0.41, 0.91];
  if (coloredBase) {
    S.ball([0, 0, 0], 0.9, KIT.surface.preset('brushed-steel', { r: [1, 2, 3] }, {
      layers: { brush: { color: 5, roughness: [0.18, 0.66] } }
    }));
  } else {
    S.box([0, 0, -0.41], [1, 1, 0.08], { r: [2, 3] }, { res: 0.09 });
  }
  if (addCoat) {
    const layer = KIT.surface.material({ r: [1], a: 0.42 }, {
      layers: { clear: { type: 'reflection', f0: 1, sky: 4, ground: 4, horizon: 4 } }
    });
    S.box([0, 0, 0.36], [0.75, 0.75, 0.012], layer, { res: 0.11 });
  }
  S.bake();
  return B.finish({
    cam: { target: [0, 0, 0], dist: 4.5, yaw: 0, pitch: 0.19 },
    detail: 20, radius: 3, dither: 0, look: { pixel: true }
  });
}

test('the normal render path shades splats after bake, with an opt-out and the scene palette', () => {
  const plain = makeWorld(false, false), world = makeWorld(true, false);
  assert.equal(plain.surfaceData, undefined);
  assert.equal(world.surfaceData.length, Surface.STRIDE * world.count);
  assert.equal(world.surfaces.length, 1);
  const view = { w: 96, h: 80 };
  const a = render(world, view);
  const b = render(world, { ...view, surface: false });
  const c = render(world, { ...view, yaw: 0.65 });
  assert.notDeepEqual(a.rgb, b.rgb);
  assert.notDeepEqual(a.rgb, c.rgb);
  const palette = new Set(world.pal);
  for (let i = 0; i < a.rgb.length; i += 3) {
    const color = (a.rgb[i] << 16) | (a.rgb[i + 1] << 8) | a.rgb[i + 2];
    assert(palette.has(color));
  }
});

test('a translucent finish composites over existing per-pixel materials', () => {
  const world = makeWorld(false, true), view = { w: 100, h: 92, ortho: true };
  const mixed = render(world, view), unshaded = render(world, { ...view, surface: false });
  const center = ((mixed.h >> 1) * mixed.w + (mixed.w >> 1)) * 3;
  assert(mixed.rgb[center + 2] > unshaded.rgb[center + 2] + 40);
  assert.notDeepEqual(mixed.rgb, render(makeWorld(false, false), view).rgb);
});

test('JSON scenes resolve preset IDs and report a bad layer at its material path', () => {
  const spec = {
    id: 'test-surface', finish: { look: { pixel: true } },
    solids: [{ kind: 'ball', at: [0, 1, 0], r: 0.7, mat: { role: 'metal', surface: 'brushed-steel' } }]
  };
  const world = KIT.diorama.build(spec);
  assert(world.pix.length > 0);
  assert.equal(world.surfaces[0].settings.layers.brush.type, 'specular');
  spec.solids[0].mat.surface = {
    preset: 'brushed-steel', layers: { brush: { roughness: [0.14, 0.47] }, rim: { type: 'sheen', color: '#eceade' } }
  };
  assert.equal(KIT.diorama.build(spec).surfaces[0].settings.layers.brush.roughness[0], 0.14);
  spec.solids[0].mat.surface.layers.rim.mask = { type: 'missing' };
  const issue = KIT.diorama.check(spec).find(item => item.level === 'error' && item.path === 'solids[0].mat.surface');
  assert.match(issue.problem, /Unknown surface mask/);
});

test('the plain script bundle exposes the same sampler and presets to hosts', () => {
  const script = require('..').bundle() + `
    const mat = KIT.surface.preset('brushed-steel', [1, 2]);
    const prepared = SurfaceLook.prepare(mat.surface, [], [0, 0, 1]);
    SurfaceLook.shade(prepared, { position: [0, 0, 0], normal: [0, 0, 1], view: [0, 0, 1] }, [0, 0, 0])[0];
  `;
  assert(vm.runInNewContext(script) > 0.8);
});

test('diffuse lighting ramps use palette roles, authored stop positions and direct-light visibility', () => {
  const shader = Surface.prepare({
    layers: {
      cloth: { type: 'diffuse', lightingRamp: {
        role: 'cloth', positions: [0, 0.25, 0.8], interpolation: 'step'
      } }
    }
  }, [0x112233, 0x456789, 0xf1cbda], neutralSun, {}, { paletteRoles: { cloth: [0, 1, 2] } });
  const rgb = sample => Surface.shade(shader, { ...front, ...sample }, [0, 0, 0]).slice(0, 3);
  assert.deepEqual(rgb({ visibility: 0 }), [0x11, 0x22, 0x33].map(n => n / 255));
  assert.deepEqual(rgb({ visibility: 0.25 }), [0x45, 0x67, 0x89].map(n => n / 255));
  assert.deepEqual(rgb({ normal: [0, 0, -1] }), rgb({ visibility: 0 }));
  assert.deepEqual(rgb({ visibility: 0.5 }), rgb({ visibility: 0.25 }));
  assert.deepEqual(rgb({ visibility: 1 }), [0xf1, 0xcb, 0xda].map(n => n / 255));
});

test('ramped highlights preserve roughness, respect shadow, and can shape tint and blend', () => {
  const finish = roughness => prepare({ layers: { glint: { type: 'specular', roughness, lightingRamp: {
    stops: [[0, '#785950'], [0.5, '#bab5c2'], [1, '#ffffff']],
    weights: [0, 0.3, 0.8]
  } } } });
  const offAngle = { ...front, view: [0.48, 0, 0.877] };
  const narrow = finish(0.11), wide = finish(0.55);
  assert(Surface.shade(wide, offAngle, base)[0] - Surface.shade(narrow, offAngle, base)[0] > 0.45);
  assert(Math.abs(Surface.shade(narrow, front, base)[0] - (base[0] * 0.2 + 0.8)) < 1e-10);
  assert.deepEqual(Surface.shade(wide, { ...front, visibility: 0 }, base).slice(0, 3), base);
  const { surface } = Surface.material({ surface: { layers: { glint: {
    type: 'specular', lightingRamp: { role: 'iron' }
  } } } }, { layers: { glint: { lightingRamp: { stops: [[0, 0], [1, 1]] } } } });
  assert.deepEqual(surface.layers.glint.lightingRamp, { stops: [[0, 0], [1, 1]] });
});

test('ramp validation rejects missing roles, conflicting inputs and invalid response points', () => {
  const finish = (lightingRamp, type = 'diffuse') => Surface.prepare(
    { layers: { light: { type, lightingRamp } } }, [0x000000, 0xffffff], neutralSun, {},
    { paletteRoles: { cloth: [0, 1] } }
  );
  assert.throws(() => finish(), /diffuse layer needs a lightingRamp/);
  assert.throws(() => finish({ role: 'missing' }), /palette role/);
  assert.throws(() => finish({ role: 'cloth', stops: [[0, 0], [1, 1]] }), /either role/);
  assert.throws(() => finish({ role: 'cloth', positions: [0.2, 0.1] }), /strictly increasing/);
  assert.throws(() => finish({ role: 'cloth', positions: [-0.1, 1] }), /in \[0, 1\]/);
  assert.throws(() => finish({ role: 'cloth', weights: [1, 1] }, 'specular'), /inactive highlight/);
  assert.throws(() => finish({ role: 'cloth' }, 'reflection'), /unavailable for reflection/);
});

test('JSON material ramps render with animated light, remain palette-resolved and can be disabled by name', () => {
  const spec = {
    id: 'light-ramp', palette: [...Array(30).fill(0x0b1020), 0x181d32, 0x365b94, 0x93beea, 0xfcfcff],
    roles: { cloth: [30, 31, 32], plain: [31, 32, 33] },
    light: { surfaceDirection: [[0, 0, 0, 1], [1, 0, 0, -1]] },
    finish: { look: { pixel: true }, dither: 0, cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } },
    solids: [{ kind: 'ball', at: [0, 0, 0], r: 0.85, mat: { role: 'plain', surface: { layers: {
      cloth: { type: 'diffuse', shadow: false, lightingRamp: { role: 'cloth', positions: [0, 0.25, 0.7] } }
    } } } }]
  };
  const world = KIT.diorama.build(spec), view = { w: 72, h: 72, ortho: true };
  const lit = render(world, { ...view, t: 0 }), dark = render(world, { ...view, t: 1 });
  const center = ((lit.h >> 1) * lit.w + (lit.w >> 1)) * 3;
  assert.deepEqual(Array.from(lit.rgb.slice(center, center + 3)), [0x93, 0xbe, 0xea]);
  assert.deepEqual(Array.from(dark.rgb.slice(center, center + 3)), [0x18, 0x1d, 0x32]);
  const layer = spec.solids[0].mat.surface.layers.cloth;
  layer.lightingRamp.role = 'missing';
  assert(KIT.diorama.check(spec).some(item => item.path === 'solids[0].mat.surface' && /palette role/.test(item.problem)));
  spec.solids[0].mat.surface.layers.cloth = false;
  assert.deepEqual(render(KIT.diorama.build(spec), view).rgb, render(world, { ...view, surface: false }).rgb);
});

test('bevel reach follows art pixels, detects convex rims and concave folds, and respects light', () => {
  // A slab meets a perpendicular wall at x = 0. Test from the front face.
  const corner = (x, y, z) => Math.max(x, z);
  const fold = (x, y, z) => Math.min(-x, z);
  const layer = (width, edge) => prepare({ layers: { edge: { type: 'bevel', width, edge, color: '#ffffff' } } });
  const shade = (shader, bevelDistance, x, artFootprint, overrides = {}) =>
    Surface.shade(shader, { ...front, position: [x, 0, 0], bevelDistance, artFootprint, ...overrides }, base)[0];
  const narrow = layer(1), wide = layer(3), concave = layer(3, 'concave'), both = layer(3, 'both');
  assert.equal(shade(narrow, corner, -0.02, 0.01), base[0]);
  assert(shade(wide, corner, -0.02, 0.01) > base[0] + 0.15);
  assert.equal(shade(wide, corner, -0.02, 0.01), shade(wide, corner, -0.04, 0.02));
  assert.equal(shade(wide, (x, y, z) => z, -0.02, 0.01), base[0]);
  assert.equal(shade(wide, fold, -0.02, 0.01), base[0]);
  assert.equal(shade(concave, fold, -0.02, 0.01), shade(both, corner, -0.02, 0.01));
  assert(shade(concave, fold, -0.02, 0.01) > base[0] + 0.15);
  assert.equal(shade(wide, corner, -0.02, 0.01, { visibility: 0 }), base[0]);
  assert.equal(shade(wide, corner, -0.02, 0.01, { lightDirection: [0, 0, -1] }), base[0]);
  assert.equal(shade(wide, undefined, -0.02, 0.01), base[0]);
  assert.throws(() => layer(0), /width in 0.25–8 art pixels/);
  assert.throws(() => layer(2, 'inside'), /valid edge/);
});

test('authored bevels affect sculpt corners at export size and preserve flat faces and coverage', () => {
  const spec = {
    id: 'bevel-export',
    light: { surfaceDirection: [[0, 0, 0, 1]] },
    finish: { cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4, ortho: true }, look: { pixel: true }, dither: 0 },
    solids: [
      { kind: 'box', at: [0, 0, 0], half: [0.95, 0.8, 0.24], mat: { role: 'stone', surface: { layers: {
        rim: { type: 'bevel', lightingRamp: { role: 'pale' }, width: 4, strength: 1 }
      } } } },
      { kind: 'box', at: [0, 0, -1.2], half: [3, 2, 0.1], mat: 'dark' }
    ]
  };
  const world = KIT.diorama.build(spec);
  assert.equal(typeof world.surfaces[0].bevelDistance, 'function');
  for (const ortho of [true, false]) for (const raw of [true, false]) {
    const view = { w: 112, h: 88, px: 1, ortho, raw, captureCoverage: true };
    const on = render(world, view), off = render(world, { ...view, surface: false });
    const center = ((on.h >> 1) * on.w + (on.w >> 1)) * 3;
    assert.deepEqual(on.rgb.slice(center, center + 3), off.rgb.slice(center, center + 3));
    assert.notDeepEqual(on.rgb, off.rgb);
    assert.deepEqual(on.coverage, off.coverage);
  }
  delete spec.solids[0].mat.surface.layers.rim;
  const off = KIT.diorama.build(spec);
  assert(off.surfaces.every(binding => !binding.bevelDistance));
});

test('shared surface signals darken the diffuse color, narrow a highlight and gate reflections', () => {
  const shader = prepare({
    signals: {
      film: { type: 'weather', channel: 'wetness' },
      pools: { type: 'weather', channel: 'standingWater', range: [0, 0.2] }
    },
    layers: {
      absorption: { type: 'tint', color: [0.45, 0.6, 0.75], blend: 'multiply', strength: 0,
        drive: { strength: { signal: 'film', to: 1 } } },
      polish: { type: 'specular', roughness: 0.5, strength: 0.22,
        drive: { roughness: { signal: 'film', to: [0.08, 0.12] }, strength: { signal: 'film', to: 0.8 } } },
      pool: { type: 'reflection', source: 'scene', f0: 1, strength: 0, mask: (x, y) => y < 0.4 ? 1 : 0,
        drive: { strength: { signal: 'pools', to: 0.9 } } }
    }
  });
  const weatherAt = (wetness, standingWater = 0) => (x, z) => {
    assert.deepEqual([x, z], [4, 8]);
    samples++;
    return { wetness, standingWater };
  };
  const view = [0.51, 0, Math.sqrt(1 - 0.51 ** 2)];
  const sample = { ...front, worldPosition: [4, 2, 8], sky: (ray, color) => {
    color[0] = 0.2; color[1] = 0.4; color[2] = 1;
  } };
  let samples = 0;
  const dark = Surface.shade(shader, { ...sample, visibility: 0, weather: weatherAt(1) }, base);
  const expected = base.map((value, i) => value * [0.45, 0.6, 0.75][i]);
  assert(dark.slice(0, 3).every((value, i) => Math.abs(value - expected[i]) < 1e-10));
  assert.equal(samples, 1);
  const dry = Surface.shade(shader, { ...sample, view, weather: weatherAt(0) }, base);
  const damp = Surface.shade(shader, { ...sample, view, weather: weatherAt(1) }, base);
  assert(damp[0] < dry[0]);
  assert.equal(samples, 3);
  const peak = Surface.shade(shader, { ...sample, weather: weatherAt(1) }, base);
  assert(peak[0] > damp[0] + 0.6);
  const reflected = [0, 0, 0];
  const pool = Surface.shade(shader, { ...sample, view, weather: weatherAt(1, 0.2), position: [0.5, 0.3, 0.5] },
    base, undefined, undefined, undefined, undefined, reflected);
  assert(pool[2] > damp[2] + 0.7);
  assert(reflected[2] > 0.85);
  assert.deepEqual(Surface.shade(shader, { ...sample, view, weather: weatherAt(1, 0.2) }, base), damp);
  assert.deepEqual(Surface.shade(shader, { ...sample, view }, base), dry);
});

test('finish properties can be driven by temperature, time and a spatial field', () => {
  const settings = {
    signals: {
      heat: { type: 'weather', channel: 'temperature', range: [-10, 10], interpolation: 'linear' },
      beat: { type: 'time', range: [1, 3], interpolation: 'step' },
      region: { type: 'axis', axis: 'x', range: [0, 1], space: 'world' }
    },
    layers: {
      clay: { type: 'tint', color: '#0000ff',
        drive: { color: { signal: 'heat', to: '#ff0000' }, strength: { signal: 'region', to: 0 } } },
      flash: { type: 'planarReflection', plane: 'seam', strength: 1, f0: 0,
        drive: { f0: { signal: 'beat', to: 1 } } }
    }
  };
  const shader = prepare(settings);
  const sample = { ...front, worldPosition: [0, 0, 0], weather: () => ({ temperature: 0 }),
    reflection: layer => ({ rgb: [0.2, 0.8, 0.6], coverage: Number(layer.plane === 'seam') }) };
  assert.deepEqual(Surface.shade(shader, { ...sample, time: 2 }, base).slice(0, 3), [0.5, 0, 0.5]);
  assert.deepEqual(Surface.shade(shader, { ...sample, time: 0, worldPosition: [1, 0, 0] }, base).slice(0, 3), base);
  assert(Surface.shade(shader, { ...sample, time: 3 }, base)[1] > 0.75);
  const bad = drive => prepare({ ...settings, layers: { clay: { ...settings.layers.clay, drive } } });
  assert.throws(() => bad({ color: { signal: 'missing', to: '#ffffff' } }), /named signal/);
  assert.throws(() => bad({ strength: { signal: 'heat', to: 3 } }), /target must be in/);
  assert.throws(() => bad({ roughness: { signal: 'heat', to: 3 } }), /cannot control/);
});
