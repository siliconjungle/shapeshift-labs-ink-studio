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

test('WebGL resolves tones and high palette entries across materials, lamps, grading and history', {
  skip: !process.env.INK_TEST_CHROME
}, t => {
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
  (${checkPalette.toString()})(api);
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
});
