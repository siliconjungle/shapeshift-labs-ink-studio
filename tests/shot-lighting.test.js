const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const ink = require('..');

const { KIT: K, makeBuilder, makeSculpt } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const key = {
  at: [0, .7, 1.5], normal: [0, 0, -1], size: [.4, .6], color: '#ffc594',
  intensity: 6, radius: 4, sampleGrid: 2, shadows: false,
  receive: { include: [{ surface: 'face' }] }
};
const fill = { ...key, at: [-1.15, .15, 1.5], color: '#8cacff', intensity: 2 };
const rim = { ...key, at: [-1.75, .7, .75], color: '#6abaff', intensity: 6 };
const negativeFill = { at: [.85, .65, 1.5], radius: 4, strength: .85, receive: { include: [{ object: 'wall' }] } };

function plates(makeBuilder, makeSculpt, K) {
  const B = makeBuilder(6, [0x172235, 0x647584, 0x977464, 0xd5b999]);
  const S = K.sculpt(makeSculpt(B));
  S.box([-.72, .45, 0], [.48, .47, .17], { r: [2] }, { res: .075, objectId: 'courier', surfaceId: 'face' });
  S.box([.72, .45, 0], [.48, .47, .17], { r: [1] }, { res: .075, objectId: 'wall' });
  S.bake();
  return B.finish({ cam: { target: [0, .45, 0], yaw: 0, pitch: 0, dist: 4, ortho: true },
    radius: 4, dither: 0, look: { splatCoverage: 'continuous' } });
}

function scope(before, after, object, channel) {
  const { objectId, objects } = before.passes, id = objects.indexOf(object);
  assert(id > 0);
  const changes = [];
  for (let p = 0; p < objectId.length; p++)
    if (objectId[p] === id) changes.push(after.rgb[p * 3 + channel] - before.rgb[p * 3 + channel]);
  return changes;
}

test('the four roles can be soloed and named receivers leave nearby surfaces untouched', () => {
  const world = plates(makeBuilder, makeSculpt, K);
  const view = { w: 104, h: 70, px: 1, raw: true, passes: ['objectId', 'depth'] };
  const draw = shotLighting => ink.render(world, { ...view, shotLighting });
  const base = draw(false);
  for (const [role, light] of Object.entries({ key, fill, rim })) {
    const lit = draw({ [role]: light });
    const face = scope(base, lit, 'courier', role === 'key' ? 0 : 2);
    assert(face.filter(n => n > 5).length > 20, role + ' failed to light the face');
    assert(scope(base, lit, 'wall', 0).every(n => n === 0));
    assert.deepEqual(lit.passes.depth, base.passes.depth);
  }
  const dark = draw({ negativeFill });
  assert(scope(base, dark, 'wall', 1).filter(n => n < -5).length > 20);
  assert(scope(base, dark, 'courier', 0).every(n => n === 0));
  const mixed = draw({ key, fill, rim, negativeFill });
  assert.deepEqual(scope(base, mixed, 'wall', 1), scope(base, dark, 'wall', 1));
  assert.deepEqual(draw({ key: false, fill: false, rim: false, negativeFill: false }).rgb, base.rgb);
});

test('the shaped key can exclude a retained static caster without changing its receiver mask', () => {
  const B = makeBuilder(2, [0x273744, 0x685955]);
  const S = K.sculpt(makeSculpt(B));
  S.keepRenderSdf = true;
  S.box([0, 0, .85], [.4, .4, .13], { r: [1] }, { res: .08, objectId: 'flag' });
  S.bake();
  const world = B.finish();
  const area = { at: [0, 0, 1.65], normal: [0, 0, -1], size: [.22, .25], shape: 'disk',
    intensity: 5, radius: 4, sampleGrid: 3, shadowSteps: 3 };
  const sample = override => {
    const rig = K.shotLighting.prepare({ key: { ...area, ...override } });
    const active = K.shotLighting.bind(rig, world), out = [0, 0, 0];
    assert.equal(active.sample(-1, [0, 0, 0], [0, 0, 1], out), 1);
    return out[0];
  };
  assert.equal(sample({}), 0);
  assert(sample({ cast: { exclude: [{ object: 'flag' }] } }) > 1);
  assert.equal(sample({ cast: { include: [{ object: 'flag' }] } }), 0);
});

test('dioramas retain shadow casters and a file override is recorded for shot replay', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-shot-light-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = { id: 'light-check', style: 'slate', camera: { target: [0, .25, 0], yaw: 0, pitch: .06, dist: 4 },
    solids: [{ id: 'wall', kind: 'box', at: [0, .25, 0], half: [1, .4, .1], mat: 'stone' }] };
  const rig = { format: 'ink-studio/shot-lighting', version: 1, key: { ...key, shadows: true, receive: { include: [{ object: 'wall' }] } } };
  const world = K.diorama.build({ ...spec, finish: { shotLighting: rig } });
  assert(world.renderSdfs.length > 0);
  assert.throws(() => K.diorama.build({ ...spec, finish: { shotLighting: { negativeFill: { at: [0, 0, 1], strength: 2 } } } }), /finish\.shotLighting/);
  assert.throws(() => K.shotLighting.prepare({ ...rig, version: 2 }), /version 1/);
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify(spec));
  fs.writeFileSync(path.join(dir, 'rig.json'), JSON.stringify(rig));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  run('render', 'scene.json', '--w', '56', '--h', '40', '--px', '1', '--raw',
    '--shot-lighting', 'rig.json', '--recipe', 'shot.json', '--out', 'lit.png');
  run('render', 'scene.json', '--w', '56', '--h', '40', '--px', '1', '--raw',
    '--shot-lighting', 'off', '--out', 'off.png');
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'shot.json'), 'utf8'));
  assert.equal(receipt.options['shot-lighting'], 'rig.json');
  run('shot', 'replay', 'shot.json', '--out', 'replay.png');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'lit.png')), fs.readFileSync(path.join(dir, 'replay.png')));
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'lit.png')), fs.readFileSync(path.join(dir, 'off.png')));
});

test('WebGL applies the receiver masks and restores the baked frame with the rig off', { skip: !process.env.INK_TEST_CHROME }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-shot-light-gl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = path.join(dir, 'check.html');
  fs.writeFileSync(path.join(dir, 'bundle.js'), ink.bundle());
  const module = pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href;
  fs.writeFileSync(page, `<!doctype html><canvas width="104" height="70"></canvas><pre id="result">PENDING</pre>
<script src="bundle.js"></script><script type="module">
import { createRenderer } from ${JSON.stringify(module)};
const result = document.querySelector('#result');
try {
  const canvas = document.querySelector('canvas'), renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2'), make = ${plates.toString()};
  const world = make(makeBuilder, makeSculpt, KIT);
  function draw(shotLighting) {
    renderer.render(world, { width: 104, height: 70, raw: true, dither: 0, outline: false, shotLighting, changedRows: [] });
    const pixels = new Uint8Array(104 * 70 * 4);
    gl.readPixels(0, 0, 104, 70, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError()) throw Error('Error in WebGL shot light rendering');
    return pixels;
  }
  const base = draw(false), lit = draw({ key: ${JSON.stringify(key)} }), dark = draw({ negativeFill: ${JSON.stringify(negativeFill)} });
  const changes = (a, b, side) => {
    let count = 0;
    for (let y = 18; y < 52; y++) for (let x = side ? 56 : 9; x < (side ? 95 : 48); x++) {
      const i = (y * 104 + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
    }
    return count;
  };
  if (changes(base, lit, 0) < 20 || changes(base, lit, 1)) throw Error('Key spilled outside face');
  const wall = changes(base, dark, 1), face = changes(base, dark, 0);
  if (wall < 20 || face) throw Error('Negative fill changed ' + wall + ' wall pixels and ' + face + ' face pixels');
  if (String(draw(false)) !== String(base)) throw Error('Disabling the rig left a light active');
  renderer.dispose();
  result.textContent = 'PASS';
} catch (error) { result.textContent = error.stack; }
</script>`);
  const html = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
    '--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--user-data-dir=' + path.join(dir, 'profile'), '--dump-dom', pathToFileURL(page).href],
  { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(html, /<pre id="result">PASS<\/pre>/, html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1] || html);
});
