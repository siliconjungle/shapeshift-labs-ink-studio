const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ink = require('..');

function checkPalette({ createRenderer, createSplatPipeline }) {
  const palette = Array.from({ length: 64 }, (_, i) => (i << 16) | (i << 8) | (i + 8));
  palette[47] = 0x7444b6;
  palette[48] = 0xc285f8;
  palette[62] = 0x168b83;
  palette[63] = 0xffba4e;
  const width = 96, height = 72, canvas = new OffscreenCanvas(width, height);
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2');
  const view = { target: [0, 0, 0], dist: 7, yaw: 0, pitch: 0 };
  const settings = { cam: view, radius: 7, dither: 1 };
  function draw(world, frame = {}) {
    renderer.render(world, { width, height, dither: 0, clean: false, edges: false, outline: false, time: 0, ...frame });
    const rgba = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const error = gl.getError();
    if (error) throw Error('WebGL error ' + error);
    return Uint32Array.from({ length: width * height }, (_, i) =>
      (rgba[4 * i] << 16) | (rgba[4 * i + 1] << 8) | rgba[4 * i + 2]);
  }
  const equal = (a, b) => a.every((color, i) => color === b[i]);
  const count = (pixels, swatch) => pixels.reduce((n, color) => n + Number(color === swatch), 0);
  const visible = (pixels, swatch, label) => {
    if (count(pixels, swatch) < 10) throw Error('Missing swatch #' + swatch.toString(16) + ' in ' + label);
  };
  function plates(patterned, carried = false) {
    const b = makeBuilder(7, palette), s = makeSculpt(b);
    Object.assign(s, { amb: carried ? .15 : .5, sky: 0, sunK: 0, aoK: 0, pixel: patterned });
    const capture = carried && KIT.light.capture(b, s);
    s.box([-1.05, 0, 0], [.65, .63, .22], { r: carried || patterned ? [47, 48] : [48],
      ...(patterned && { pixelStyle: { dither: 'checker' } }) }, { res: .16 });
    s.box([1.05, 0, 0], [.65, .63, .22], { r: carried || patterned ? [62, 63] : [63],
      ...(patterned && { pixelStyle: { dither: 'checker' } }) }, { res: .16 });
    s.bake();
    const world = b.finish({ ...settings, look: { pixel: patterned || carried } });
    if (!carried) return world;
    const lamp = { p: [0, 0, 12], r: 6, s: 1.8 };
    const stage = KIT.stage(world);
    const light = stage.add(KIT.light.system(stage, capture, [lamp]));
    return { world, lamp, light };
  }

  const world = plates(false);
  for (const colored of [undefined, false]) {
    const picture = draw(world, { colored });
    visible(picture, palette[48], 'scene palette resolve');
    visible(picture, palette[63], 'scene palette resolve');
    const graded = draw(world, { colored, paletteRemap: { rules: [{ from: 48, to: '#209aff' }, { from: 63, to: '#fc4152' }] } });
    visible(graded, 0x209aff, 'graded scene palette');
    visible(graded, 0xfc4152, 'graded scene palette');
  }
  world.look = { ...world.look, tone: 'stipple', clean: { keep: 1 } };
  const plainTone = draw(world, { colored: false, clean: undefined });
  for (const flags of [{}, { colored: true }, { colored: true, dither: 1 }])
    if (!equal(draw(world, { clean: undefined, ...flags }), plainTone))
      throw Error('The authored tone changed with colored contours or scene palette dither');
  if (equal(plainTone, draw(world, { tone: false })) ||
      equal(plainTone, draw(world, { raw: true })))
    throw Error('Tone was bypassed or could not be turned off');
  const tonePalette = PixelLook.prepareTone('stipple', KIT.procedural.materials.blueNoise).palette;
  if (new Set(plainTone).size < 2 || plainTone.some(color => !tonePalette.includes(color)))
    throw Error('The resolved frame did not use the tone ramp');

  const toneStops = Array.from({ length: 48 }, (_, i) =>
    [i === 47 ? 1 : i / 125, '#' + (i * 0x010103).toString(16).padStart(6, '0')]);
  const fineTone = draw(world, { tone: { cutoff: 0, stops: toneStops, amount: 0 }, colored: true });
  visible(fineTone, parseInt(toneStops.at(-1)[1].slice(1), 16), 'last of 48 tone stops');

  const local = Array.from({ length: 46 }, (_, i) => '#' + palette[i].toString(16).padStart(6, '0'));
  local.push('#c285f8', '#ffba4e');
  for (const coverageAware of [false, true]) {
    const constrained = draw(world, { tone: false, coverageAware, paletteConstraints: { default: { palette: local } } });
    visible(constrained, palette[48], '47th local swatch');
    visible(constrained, palette[63], '48th local swatch');
  }
  const textured = plates(true);
  const pixels = draw(textured, { damp: false });
  for (const slot of [47, 48, 62, 63]) visible(pixels, palette[slot], 'patterned material ramp');
  const tonedMaterial = draw(textured, { tone: 'stipple', colored: true });
  if (tonedMaterial.some(color => !tonePalette.includes(color)))
    throw Error('Patterned materials escaped the tone ramp');

  const { world: lit, lamp, light } = plates(false, true);
  lit.anim.update(0);
  draw(lit, { colored: false });
  const before = draw(lit, { colored: false });
  visible(before, palette[47], 'lamp at rest');
  visible(before, palette[62], 'lamp at rest');
  lamp.p = [0, 0, 2];
  light.touch();
  lit.anim.update(.05);
  const held = draw(lit, { colored: false, time: .05 });
  const next = draw(lit, { colored: false, time: .05, damp: false });
  visible(held, palette[62], 'damped carried light');
  visible(next, palette[48], 'carried light');
  visible(next, palette[63], 'carried light');
  if (count(next, palette[63]) <= count(held, palette[63]))
    throw Error('History did not hold the preceding sampled swatch');
  draw(lit, { colored: false, time: .05 });
  draw(lit, { time: .05, tone: 'stipple' });
  if (!equal(draw(lit, { colored: false, time: .05 }), next))
    throw Error('Stipple left stale swatches in palette history');

  // These adjacent output colors must receive distinct history IDs.
  const b = makeBuilder(1, palette);
  b.disc(0, 0, 0, [0, 0, 1], .55, .03, b.P[62], 3);
  const adjacent = b.finish({ ...settings, look: { pixel: true } });
  const grade = KIT.stage(adjacent);
  grade.grade = PixelLook.prepareRemap({ rules: [{ from: 62, to: '#306080' }, { from: 63, to: '#316080' }] }, palette).grade();
  const previous = draw(adjacent, { colored: false });
  visible(previous, 0x306080, 'previous adjacent grade');
  const shade = palette[63];
  adjacent.data[7] = (shade >> 16) | (shade & 0xff00) | ((shade & 255) << 16);
  const history = draw(adjacent, { colored: false });
  const undamped = draw(adjacent, { colored: false, damp: false });
  visible(undamped, 0x316080, 'next adjacent grade');
  if (count(history, 0x316080) >= count(undamped, 0x316080))
    throw Error('History merged two neighboring graded colors');
  draw(adjacent, { colored: false });
  grade.grade = PixelLook.prepareRemap({ rules: [{ from: 63, to: '#62e180' }] }, palette).grade();
  visible(draw(adjacent, { colored: false }), 0x62e180, 'changed animation grade');

  const large = [...palette, ...Array(205).fill(0x112233), 0x06ff44];
  const over = makeBuilder(7, large);
  over.disc(0, 0, 0, [0, 0, 1], .55, .03, over.P[269], 3);
  const oversized = over.finish(settings);
  const warnings = [], warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const raw = draw(oversized, { raw: true });
    if (!raw.some(color => color >> 16 < 32 && (color >> 8 & 255) > 220 && (color & 255) >= 48))
      throw Error('Raw output lost the baked high-palette color');
    if (warnings.length) throw Error('Raw output emitted a palette warning');
    for (let i = 0; i < 2; i++) {
      const limited = draw(oversized, { colored: false, paletteRemap: { rules: [{ from: 63, to: '#ffdc90' }] } });
      if (limited.includes(large[269])) throw Error('Resolve exceeded the declared scene palette limit');
    }
    if (warnings.length !== 1 || !warnings[0].includes('64 of 270'))
      throw Error('Expected one oversized-palette warning, got ' + warnings);
    let rejected = false;
    try { draw(oversized, { strictContract: true }); } catch (error) { rejected = /palette-limit/.test(error.message); }
    if (!rejected) throw Error('Strict rendering accepted a 270-swatch scene palette');
  } finally {
    console.warn = warn;
    renderer.dispose();
  }

  // The lower-level splat pipeline accepts its own carried-lamp uniforms.
  const low = new OffscreenCanvas(32, 32);
  const context = low.getContext('webgl2'), pipeline = createSplatPipeline(context);
  const shader = pipeline.programFor();
  const builder = makeBuilder(1, palette);
  builder.disc(0, 0, -.5, [0, 0, 1], .2, .04, builder.P[48], 3);
  const geometry = builder.finish();
  const texture = context.createTexture();
  context.bindTexture(context.TEXTURE_2D, texture);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
  context.texImage2D(context.TEXTURE_2D, 0, context.RGBA32F, 4, 1, 0, context.RGBA, context.FLOAT, geometry.data.slice(0, 16));
  const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const colors = Float32Array.from(palette.flatMap(c => [c >> 16, c >> 8 & 255, c & 255].map(n => n / 255)));
  const lift = Int32Array.from(palette, (_, i) => i === 48 ? 63 : i);
  context.viewport(0, 0, 32, 32);
  context.useProgram(shader.p);
  shader.set({ u_viewport: [32, 32], u_focal: 16, u_dilate: .15, u_data: 0, u_view: identity, u_proj: identity, u_scale: 1, u_ortho: 1, u_near: .1, u_crisp: 1, u_hard: 1,
    u_bones: 1, u_fine: 2, u_fogp: [1, 0, .1, 8], u_born: [0, 1, .5, 0],
    u_lamp: [0, 0, 1, 8], u_lamps: [1.5], u_lampGain: 4, u_lpal: colors, u_lup: lift });
  pipeline.setOrder(Int32Array.of(0));
  const rgba = new Uint8Array(4);
  for (const [lamps, slot] of [[0, 48], [1, 63]]) {
    shader.set({ u_lampN: lamps });
    pipeline.draw();
    context.readPixels(16, 16, 1, 1, context.RGBA, context.UNSIGNED_BYTE, rgba);
    const swatch = (rgba[0] << 16) | (rgba[1] << 8) | rgba[2];
    const error = context.getError();
    if (error || swatch !== palette[slot])
      throw Error('Carried-lamp shader expected slot ' + slot + ', got #' + swatch.toString(16) + ' (GL ' + error + ')');
  }
  pipeline.dispose();
  context.deleteTexture(texture);
}

function checkResolveModes({ createRenderer, pixelShaderSources }) {
  const toolkit = { KIT, PixelLook }, width = 64, height = 48;
  const full = pixelShaderSources(PixelLook, { packedTone: true });
  const camera = { target: [0, 0, 0], dist: 7, yaw: 0, pitch: 0 };
  const b = makeBuilder(7, [0, 0x2468cc, 0xf2bd41]);
  const s = makeSculpt(b);
  s.pixel = true;
  s.box([0, 0, 0], [1.3, 1, .35], { r: [1, 2] }, { res: .18 });
  s.bake();
  const world = b.finish({ cam: camera, radius: 7, look: { pixel: false } });
  const frame = { width, height, time: 0, dither: 0 };

  function setup(options, blockFull = false) {
    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    const resolveShaders = [];
    const shaderSource = gl.shaderSource.bind(gl);
    gl.shaderSource = (shader, source) => {
      if (source.includes('vec3 lookAt(ivec2 p)')) {
        const kind = source === full.POST_FS ? 'full' : /u_toneOn > 0\.5/.test(source) ? 'advanced' : 'simple';
        resolveShaders.push(kind);
        if (blockFull && kind !== 'simple') throw Error('Attempted to compile a full resolve shader');
      }
      shaderSource(shader, source);
    };
    const renderer = createRenderer(canvas, { toolkit, ...options });
    const draw = (scene = world, options) => {
      renderer.render(scene, { ...frame, ...options });
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error) throw Error('WebGL readback failed with error ' + error);
      return pixels;
    };
    return { draw, resolveShaders, dispose: () => renderer.dispose() };
  }

  const simple = setup({ resolve: 'simple', specialize: false }, true);
  const auto = setup({});
  const forcedFull = setup({ specialize: false });
  try {
    if (String(simple.resolveShaders) !== 'simple' || auto.resolveShaders.length || forcedFull.resolveShaders.length)
      throw Error('Resolve programs were built at the wrong time during startup');
    const plain = simple.draw();
    if (!plain.some((value, i) => i % 4 !== 3 && value > 0)) throw Error('Simple resolve drew an empty frame');
    if (!auto.draw().every((value, i) => value === plain[i])) throw Error('Simple and auto plain frames differ');
    if (!forcedFull.draw().every((value, i) => value === plain[i])) throw Error('Full and simple plain frames differ');
    if (String(auto.resolveShaders) !== 'simple' || String(forcedFull.resolveShaders) !== 'full')
      throw Error('Auto mode selected the wrong shader for a plain frame');

    const tone = auto.draw(world, { tone: 'stipple' });
    if (tone.every((value, i) => value === plain[i])) throw Error('Auto mode ignored the tone');
    auto.draw(world, { tone: 'stipple' });
    auto.draw();
    if (String(auto.resolveShaders) !== 'simple,full') throw Error('Auto mode rebuilt a cached resolve shader');

    for (const [feature, scene, options] of [
      ['tone mapping', world, { tone: 'stipple' }],
      ['palette grading', world, { paletteRemap: { rules: [{ from: 1, to: '#ddeeff' }] } }],
      ['ambient occlusion', { ...world, ao: {} }],
      ['glass beams', { ...world, glass: {} }],
      ['per-pixel materials', { ...world, look: { pixel: true } }],
      ['palette constraints', world, { paletteConstraints: { default: { palette: ['#2468cc', '#f2bd41'] } } }],
      ['coverage-aware resolve', world, { coverageAware: true }],
      ['water', { ...world, water: { count: 1 } }]
    ]) {
      let failure;
      try { simple.draw(scene, options); } catch (error) { failure = error; }
      if (!failure?.message.includes('simple resolve does not support ' + feature))
        throw Error('Expected a simple resolve diagnostic for ' + feature + ', got ' + failure);
    }
    if (!simple.draw({ ...world, look: { tone: 'stipple' } }, { tone: false }).every((value, i) => value === plain[i]))
      throw Error('Simple resolve failed after disabling an authored tone');
    simple.draw({ ...world, ao: {} }, { raw: true });
    if (String(simple.resolveShaders) !== 'simple') throw Error('Simple mode rebuilt or replaced its resolve shader');
  } finally {
    for (const fixture of [simple, auto, forcedFull]) fixture.dispose();
  }
}

function checkContourProjection({ createRenderer }) {
  const width = 159, height = 93;
  const canvas = new OffscreenCanvas(width, height);
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2');
  const palette = [0x111927, 0x27739c, 0xf2bd41, 0xf8e0a0];
  const builder = makeBuilder(7, palette);
  builder.disc(-.9, 0, 0, [0, 0, 1], .65, .05, builder.P[1], 3);
  builder.disc(0, 0, -.1, [0, 0, 1], .58, .05, builder.P[2], 3);
  builder.disc(.9, .15, 0, [.2, 0, 1], .65, .05, builder.P[3], 3);
  builder.disc(.2, -.43, .2, [0, 0, 1], .19, .05, builder.P[1], 3);
  const world = builder.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: .16, pitch: .13 }, radius: 5 });
  // A twinkling splat snaps only on the native grid. A transparent slot is
  // retained by the full-order control and omitted by the automatic sorter.
  world.data.set([1, .3, 1.5], 11);
  world.data[3 * 16 + 3] = 0;
  const fullOrder = Int32Array.of(1, 0, 2, 3);
  let projections = [], splatDraws = [];
  const drawArrays = gl.drawArrays.bind(gl), drawInstances = gl.drawArraysInstanced.bind(gl);
  gl.drawArrays = (mode, first, count) => {
    if (mode === gl.POINTS) projections.push(count);
    drawArrays(mode, first, count);
  };
  gl.drawArraysInstanced = (mode, first, count, instances) => {
    if (mode === gl.TRIANGLE_STRIP && count === 4) splatDraws.push(instances);
    drawInstances(mode, first, count, instances);
  };
  function draw(frame) {
    projections = [];
    splatDraws = [];
    renderer.render(world, { width, height, clean: false, damp: false, dither: 0, colored: true, ...frame });
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error) throw Error('WebGL readback failed with error ' + error);
    return { pixels, projections, splatDraws };
  }
  for (const frame of [{ time: .1 }, { time: 1.2, ortho: true }, { time: 2.4, yaw: -.23 }]) {
    const control = draw({ ...frame, sharedContourProjection: false });
    const shared = draw({ ...frame, sharedContourProjection: true });
    if (String(control.splatDraws) !== '3,3' || String(shared.projections) !== '3' || String(shared.splatDraws) !== '3,3')
      throw Error('Expected one projection and two raster passes, got ' + JSON.stringify([control.splatDraws, shared.projections, shared.splatDraws]));
    if (!control.pixels.every((value, i) => value === shared.pixels[i])) throw Error('Shared contour pixels differ');
  }
  const auto = draw({ raw: true, sharedContourProjection: false, ortho: true, yaw: 0, pitch: 0 });
  // Larger Z has greater view depth in the orthographic camera facing +Z.
  const uncropped = draw({ raw: true, order: fullOrder, ortho: true, yaw: 0, pitch: 0 });
  if (String(auto.splatDraws) !== '3' || String(uncropped.splatDraws) !== '4')
    throw Error('Zero-opacity splat was not omitted from the automatic draw');
  if (!auto.pixels.every((value, i) => value === uncropped.pixels[i])) throw Error('Removing zero-opacity splats changed the frame');
  renderer.dispose();
}

function runChromeFixture(t, fixture) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-webgl-tone-palette-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const entry = pathToFileURL(path.join(__dirname, '../webgl.mjs')).href;
  const page = path.join(temp, 'index.html');
  fs.writeFileSync(path.join(temp, 'bundle.js'), ink.bundle());
  fs.writeFileSync(page, `<!doctype html><pre id="result">PENDING</pre>
<script src="bundle.js"></script><script type="module">
import * as api from ${JSON.stringify(entry)};
const result = document.querySelector('#result');
try {
  (${fixture.toString()})(api);
  result.textContent = 'PASS';
} catch (error) {
  result.textContent = error.stack;
}
</script>`);
  const software = process.platform === 'darwin' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  const chrome = spawnSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
    '--allow-file-access-from-files', ...software,
    '--user-data-dir=' + path.join(temp, 'chrome'), '--dump-dom', pathToFileURL(page).href],
  { timeout: 90000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (chrome.error) throw chrome.error;
  const result = chrome.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
  assert.equal(result, 'PASS', result || 'Chrome exited before reporting fixture results (' + chrome.status + ')');
}

const browser = { skip: !process.env.INK_TEST_CHROME };
test('WebGL resolves tones and high palette entries across materials, lamps, grading and history', browser, t => {
  runChromeFixture(t, checkPalette);
});
test('WebGL simple mode avoids the full resolve and auto mode loads it on demand', browser, t => {
  runChromeFixture(t, checkResolveModes);
});
test('WebGL Colored Contours shares projection and preserves the two-grid pixels', browser, t => {
  runChromeFixture(t, checkContourProjection);
});
