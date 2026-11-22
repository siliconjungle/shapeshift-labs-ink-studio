const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const studio = require('..');
const { build } = require('../scripts/build.js');
const PNG = require('../cli/png.js');

const root = path.resolve(__dirname, '..');

function bakeFixture({ KIT, makeBuilder, makeSculpt }) {
  const builder = makeBuilder(7, [0x11171f, 0x5b4533, 0xa98652, 0xffd698]);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  const rig = KIT.rig(builder, sculpt);
  const capture = KIT.light.capture(builder, sculpt);
  sculpt.pixel = true;
  sculpt.box([-0.45, 0, 0], [.8, .62, .1], { r: [1, 2, 3], pat: KIT.pixel.masonry({ r: [1, 2, 3] }) }, { res: .11 });
  sculpt.box([0.56, 0, .18], [.36, .52, .1], { r: [1, 2, 3] }, { tag: 'door', res: .1 });
  sculpt.bake();
  const world = builder.finish({ look: { pixel: true }, radius: 3,
    cam: { target: [0, 0, 0], yaw: .16, pitch: .13, dist: 5 } });
  const stage = KIT.stage(world);
  rig.bind(stage);
  const sun = { dir: [0, 1, 0], amb: .1, sky: .2, k: .6, parts: ['door'], keep: Infinity };
  const packed = KIT.light.pack(stage, capture, { sun });
  const codec = KIT.procedural.splatCodec;
  const bytes = codec.encode(world.data, world.count, { maxPositionError: 0, maxCovarianceError: 0 });
  return { world: { ...world, ...codec.decode(bytes, { expectedCount: world.count }) }, packed, bytes };
}

test('the compact bake profile preserves native and pixel rows, rig lighting and row delivery', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bake-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const [{ file, gzipBytes }] = build('bake', directory);
  const classic = fs.readFileSync(file, 'utf8');
  assert.deepEqual(fs.readdirSync(directory), ['ink-studio.bake.js']);
  assert.equal(classic, studio.bundle({ profile: 'bake' }));
  assert(gzipBytes < gzipSync(studio.bundle(), { level: 9 }).length / 3);

  const moduleFile = path.join(directory, 'ink-studio.bake.mjs');
  fs.writeFileSync(moduleFile, studio.bundle({ profile: 'bake', format: 'module' }));
  const esm = await import(pathToFileURL(moduleFile).href);
  const commonjs = studio.bundle({ profile: 'bake', format: 'commonjs' });
  const fromCommonJS = vm.runInNewContext(commonjs + `\n(${bakeFixture})(module.exports);`, { module: { exports: {} } });
  const fromClassic = vm.runInNewContext(classic + `\n(${bakeFixture})({ KIT, makeBuilder, makeSculpt });`);
  const expected = bakeFixture(studio.load());
  assert(expected.world.count > 0);
  assert(expected.world.pix.some(Boolean));
  assert(expected.packed.baked.some(value => value >= 0));
  for (const actual of [fromClassic, bakeFixture(esm), fromCommonJS]) {
    assert.equal(actual.world.count, expected.world.count);
    assert.deepEqual(Array.from(actual.world.data), Array.from(expected.world.data));
    assert.deepEqual(Array.from(actual.world.pix), Array.from(expected.world.pix));
    assert.deepEqual(Array.from(actual.packed.rigRamp), Array.from(expected.packed.rigRamp));
    assert.deepEqual(Array.from(actual.packed.baked), Array.from(expected.packed.baked));
    assert.deepEqual(Array.from(actual.bytes), Array.from(expected.bytes));
  }
});

test('the compact browser script and the full toolkit draw the same patterned and toned WebGL frames', {
  skip: !process.env.INK_TEST_CHROME
}, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bake-webgl-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  build('bake', directory);
  const fullModule = path.join(directory, 'full.mjs');
  fs.writeFileSync(fullModule, studio.bundle({ format: 'module' }));
  const page = path.join(directory, 'index.html');
  const rendererUrl = pathToFileURL(path.join(root, 'src/webgl/renderer.mjs')).href;
  fs.writeFileSync(page, `<!doctype html><pre id="result">PENDING</pre>
<script src="ink-studio.bake.js"></script><script type="module">
import * as full from './full.mjs';
import { createRenderer } from ${JSON.stringify(rendererUrl)};
const result = document.querySelector('#result');
try {
  const bake = ${bakeFixture};
  function draw(toolkit) {
    const { world } = bake(toolkit);
    const canvas = new OffscreenCanvas(64, 48);
    const renderer = createRenderer(canvas, { toolkit });
    const gl = canvas.getContext('webgl2');
    try {
      return [false, 'stipple'].map(tone => {
        renderer.render(world, { width: 64, height: 48, time: 0, tone });
        const pixels = new Uint8Array(64 * 48 * 4);
        gl.readPixels(0, 0, 64, 48, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (gl.getError()) throw Error('WebGL readback failed');
        return pixels;
      });
    } finally { renderer.dispose(); }
  }
  const compact = draw({ KIT, PixelLook, makeBuilder, makeSculpt });
  const expected = draw(full);
  if (compact[0].every((value, i) => value === compact[1][i])) throw Error('Tone did not change the patterned frame');
  for (const [i, frame] of compact.entries())
    if (!frame.every((value, j) => value === expected[i][j])) throw Error('Compact frame differs from full frame ' + i);
  result.textContent = 'PASS';
} catch (error) { result.textContent = error.stack; }
</script>`);
  const chrome = spawnSync(process.env.INK_TEST_CHROME, [
    '--headless', '--no-first-run', '--disable-background-networking', '--allow-file-access-from-files',
    '--user-data-dir=' + path.join(directory, 'chrome'), '--dump-dom', pathToFileURL(page).href
  ], { timeout: 90000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (chrome.error) throw chrome.error;
  const result = chrome.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
  assert.equal(result, 'PASS', result || 'Chrome exited before reporting the fixture result');
});

test('the compact baked player samples published frames and can be mounted and disposed on its own', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-player-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const [{ file, rawBytes, gzipBytes }] = build('playback', directory);
  assert(rawBytes < 10_000 && gzipBytes < 4000);
  assert.deepEqual(fs.readdirSync(directory), ['ink-studio.player.mjs']);
  const source = studio.bundle({ profile: 'playback', format: 'module' });
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  const { mountSceneReplay, sampleReplayFrame, validateSceneReplay } = await import(pathToFileURL(file).href);
  const frames = [0, 80, 160].map(value => PNG.encode(2, 1, Uint8Array.of(value, 0, 0, 0, value, 0)).toString('base64'));
  const recording = { format: 'ink-studio/scene-replay', version: 1, title: 'Baked relay', width: 2, height: 1,
    start: 1.25, fps: 24000 / 1001, frameRate: { numerator: 24000, denominator: 1001 }, frames };
  const framePeriod = 1001 / 24000;
  assert.deepEqual(sampleReplayFrame(recording, framePeriod), { index: 1, time: 1.25 + framePeriod, width: 2,
    height: 1, src: 'data:image/png;base64,' + frames[1] });
  assert.equal(sampleReplayFrame(recording, 3 * framePeriod, { loop: true }).index, 0);
  assert.throws(() => validateSceneReplay({ ...recording, width: 3 }), /dimensions/);
  assert.throws(() => validateSceneReplay({ ...recording, version: 2 }), /Invalid Ink Studio/);

  const image = {}, slider = new EventTarget();
  slider.setAttribute = (key, value) => { slider[key] = value; };
  const player = mountSceneReplay({ querySelector: key => ({ img: image, input: slider })[key] }, recording);
  assert.equal(image.src, 'data:image/png;base64,' + frames[0]);
  assert.deepEqual([image.width, image.height, slider.max], [2, 1, 2]);
  slider.value = '2';
  slider.dispatchEvent(new Event('input'));
  assert.equal(player.currentTime, 2 * framePeriod);
  assert.equal(image.src, 'data:image/png;base64,' + frames[2]);
  player.dispose();
  slider.dispatchEvent(new Event('input'));
  player.seek(0);
  assert.equal(image.src, 'data:image/png;base64,' + frames[2]);
});

test('the prebuilt Node entry renders from a read-only package with its authoring bundle sources absent', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-node-build-'));
  const dist = path.join(directory, 'dist');
  t.after(() => {
    fs.chmodSync(directory, 0o755);
    if (fs.existsSync(dist)) fs.chmodSync(dist, 0o755);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const name of ['index.js', 'package.json', 'src', 'cli', 'scripts', 'examples']) {
    fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true,
      filter: file => file !== path.join(root, 'src', 'kit') });
  }
  const [{ file }] = build('node', dist);
  fs.chmodSync(dist, 0o555);
  fs.chmodSync(directory, 0o555);
  const probe = `
    const assert = require('node:assert/strict');
    const studio = require('./index.js');
    const kit = studio.load();
    assert.equal(kit, require('./dist/ink-studio.node.cjs'));
    assert.ok(kit.SCENES.length > 0);
    const story = studio.readStoryDocument('examples/story-documents/burned-mill.json');
    assert.equal(story.stories['mill-fire'].triggers['survey-report'].event.kind, 'discovery');
    const builder = kit.makeBuilder(1, [0x141823, 0xdeac7b]);
    builder.disc(0, 0, 0, [0, 0, 1], .35, .03, builder.P[1], 3);
    const world = builder.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
    const frame = studio.render(world, { w: 24, h: 24, px: 1 });
    assert.equal(frame.rgb.length, 24 * 24 * 3);
    assert.ok(frame.drawn > 0);
  `;
  execFileSync(process.execPath, ['-e', probe], { cwd: directory,
    env: { ...process.env, INK_STUDIO_DEVELOPMENT: '0' } });
  assert.deepEqual(fs.readdirSync(dist), [path.basename(file)]);
});
