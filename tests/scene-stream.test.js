const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: K } = studio.load();
const { createSceneStream } = K.procedural.chunks;
const tick = () => new Promise(resolve => setImmediate(resolve));
const camera = { eye: [0, 1, 8], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1], tangent: .45, aspect: 1.6 };
const opening = K.world.portals.doorway({ from: { origin: [0, 1, 0] }, to: { origin: [0, 1, 0], normal: [0, 0, -1] },
  halfWidth: 1.25, halfHeight: 1.3 });
const portal = { id: 'arch', from: { place: 'garden' }, to: { place: 'vault' }, opening };
function chunk(id, x, z, subjects, revision = 1) {
  return { id, subjects, bounds: { min: [x - .4, .3, z - .4], max: [x + .4, 1.7, z + .4] },
    levels: [{ id: 'base', bytes: 60, splats: 60, revision },
      { id: 'detail', bytes: 120, splats: 120, revision, maxDistance: 7 }] };
}
const drawn = stream => stream.snapshot().views.map(view => [view.id, view.entries.map(row => row.chunk + '/' + row.level)]);

test('visibility gives a base to a live portal and allocates detail to nearby or selected chunks', async () => {
  const catalog = {
    garden: [chunk('near', 1.6, 3), chunk('far', -2, -8, ['subject']), chunk('offscreen', 50, 0)],
    vault: [chunk('arrival', 0, -2), chunk('outside-window', 5, -2), chunk('behind-portal', 0, 2)]
  };
  const calls = [], loads = [];
  const stream = createSceneStream({ budgetBytes: 300, maxSplats: 240, startsPerFrame: 1,
    query: view => { calls.push(view.place); return catalog[view.place]; },
    load: row => { loads.push(row.chunk); return { count: row.splats }; } });
  try {
    const input = { place: 'garden', camera, portals: [portal] };
    assert.equal(stream.advance(input).budget.plannedSplats, 240);
    await tick();
    assert.deepEqual(loads, ['near']);
    stream.advance(input);
    await tick();
    assert.deepEqual(loads, ['near', 'arrival']);
    stream.advance(input);
    await stream.ready();
    assert.deepEqual(drawn(stream), [['main', ['near/detail', 'far/base']], ['portal/arch', ['arrival/base']]]);
    assert.deepEqual(loads, ['near', 'arrival', 'far']);

    stream.advance({ ...input, selected: ['subject'] });
    await tick();
    stream.advance({ ...input, selected: ['subject'] });
    await stream.ready();
    assert.deepEqual(drawn(stream), [['main', ['far/detail', 'near/base']], ['portal/arch', ['arrival/base']]]);
    assert.equal(stream.snapshot().budget.drawSplats, 240);
    assert(stream.stats().bytes + stream.stats().reservedBytes <= 300);

    calls.length = 0;
    const away = { ...camera, right: [-1, 0, 0], back: [0, 0, -1] };
    stream.advance({ ...input, camera: away, selected: ['subject'] });
    await tick();
    assert.deepEqual(calls, ['garden']);
    assert.deepEqual(drawn(stream), [['main', []]]);
    assert.equal(stream.stats().bytes, 0);
  } finally {
    stream.dispose();
  }
});

test('resident coarse chunks bridge detail loads and revisions supersede pending work', async () => {
  let revision = 1;
  const jobs = [], released = [];
  const stream = createSceneStream({ budgetBytes: 180, maxSplats: 120, startsPerFrame: 1,
    query: () => [chunk('subject', 0, 2, [], revision)],
    load: (row, { signal }) => row.level === 'base' ? { count: row.splats } :
      new Promise(resolve => jobs.push({ row, signal, resolve })),
    release: value => released.push(value) });
  try {
    const far = { place: 'garden', camera: { ...camera, observer: [0, 1, 20] } };
    stream.advance(far);
    await stream.ready();
    const near = { place: 'garden', camera };
    assert.equal(stream.advance(near).budget.fallback, 1);
    await tick();
    assert.equal(stream.stats().bytes + stream.stats().reservedBytes, 180);
    assert.deepEqual(drawn(stream), [['main', ['subject/base']]]);
    revision++;
    stream.advance(near);
    await tick();
    assert(jobs[0].signal.aborted);
    assert.deepEqual(drawn(stream), [['main', []]]);
    const stale = { count: 120 };
    jobs[0].resolve(stale);
    await tick();
    assert(released.includes(stale));
    assert.equal(jobs[1].row.revision, 2);
    const oversize = { count: 121 };
    jobs[1].resolve(oversize);
    await assert.rejects(stream.ready(), /splat reservation/);
    assert(released.includes(oversize));
    assert.deepEqual(drawn(stream), [['main', []]]);
    stream.retry();
    stream.advance(near);
    await tick();
    jobs[2].resolve({ count: 120 });
    await stream.ready();
    assert.deepEqual(drawn(stream), [['main', ['subject/detail']]]);
  } finally {
    stream.dispose();
  }
});

test('two views of one place share residency and each draw charges the frame budget', async () => {
  let loaded = 0;
  const row = chunk('visible-in-both', 0, -2);
  const stream = createSceneStream({ budgetBytes: 300, maxSplats: 180,
    query: () => [row], load: descriptor => { loaded++; return { count: descriptor.splats }; } });
  try {
    const samePlace = { ...portal, to: { place: 'garden' } };
    stream.advance({ place: 'garden', camera, portals: [samePlace], selected: [row.id] });
    await stream.ready();
    const result = stream.snapshot();
    assert.deepEqual(drawn(stream), [['main', ['visible-in-both/base']], ['portal/arch', ['visible-in-both/base']]]);
    assert.equal(loaded, 1);
    assert.equal(stream.stats().bytes, 60);
    assert.equal(result.budget.drawSplats, 120);
  } finally {
    stream.dispose();
  }
});

test('world sessions expose walk-through previews only for currently permitted links', async () => {
  const a = { origin: [0, 1, 0] }, b = { origin: [0, 1, 0], normal: [0, 0, -1] };
  const from = { place: 'garden', anchor: 'gate' }, to = { place: 'vault', anchor: 'gate' };
  let prepared = 0;
  const session = K.world.portals.create({
    places: [a, b].map((gate, i) => ({ id: i ? 'vault' : 'garden', anchors: { gate },
      prepare() { prepared++; return {}; } })),
    links: [
      { id: 'locked', from, to, aperture: { halfWidth: 1, halfHeight: 1 }, open: ({ actor }) => actor?.key },
      { id: 'fade', from, to, mode: 'fade' }
    ]
  });
  try {
    await session.enter('garden');
    assert.deepEqual(session.previewLinks({}), []);
    assert.deepEqual(session.previewLinks({ key: true }).map(row => row.id), ['locked']);
    assert.equal(prepared, 1);
  } finally {
    session.dispose();
  }
});

async function browserFixture(createRenderer) {
  const canvas = document.querySelector('canvas'), K = KIT;
  const paint = [0x132540, 0x4cb6db, 0xf8b669];
  const toolkit = { KIT, PixelLook, makeBuilder, makeSculpt, ContributionRules, RenderStages };
  const renderer = createRenderer(canvas, { toolkit, contextAttributes: { preserveDrawingBuffer: true } });
  const gl = canvas.getContext('webgl2');
  const place = 'court', cameraWorld = makeBuilder(1, paint).finish({ cam: { target: [0, 1, 0], dist: 7, yaw: 0, pitch: 0 } });
  const opening = K.world.portals.doorway({ from: { origin: [0, 1, 0] },
    to: { origin: [0, 1, 0], normal: [0, 0, -1] }, halfWidth: 1, halfHeight: 1 });
  const portals = [{ id: 'arch', to: { place: 'gallery' }, opening }];
  const row = (id, x, z, color) => ({ id, bounds: { min: [x - .6, .4, z - .6], max: [x + .6, 1.6, z + .6] },
    levels: [{ id: 'base', bytes: 128, splats: 1, revision: 1, input: [x, 1, z, color] }] });
  const stream = K.procedural.chunks.createSceneStream({ budgetBytes: 256, maxSplats: 2,
    query: view => view.place === place ? [row('court', -1.8, 0, 2)] : [row('gallery', 0, -2, 1)],
    load: ({ input: [x, y, z, color] }) => {
      const b = makeBuilder(1, paint);
      b.iso(x, y, z, .64, b.P[color], 1);
      return b.finish();
    } });
  const assemble = (_, entries) => SplatProvenance.join(entries.map(row => row.value), cameraWorld);
  function centre() {
    const rgb = new Uint8Array(4);
    gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgb);
    return Array.from(rgb.slice(0, 3));
  }
  try {
    const input = { place, portals, assemble, raw: true };
    renderer.renderStream(stream, cameraWorld, input);
    await stream.ready();
    const live = renderer.renderStream(stream, cameraWorld, input);
    const again = renderer.renderStream(stream, cameraWorld, input);
    const through = centre();
    const closed = renderer.renderStream(stream, cameraWorld, { ...input, portals: [] });
    const covered = centre();
    return { through, covered, sameWorld: live.world === again.world,
      sameDestination: live.portal.destination === again.portal.destination,
      splats: live.scene.budget.drawSplats, shut: !closed.portal };
  } finally {
    stream.dispose();
    renderer.dispose();
  }
}

test('WebGL renders resident source and mapped portal geometry through the scene stream', {
  skip: !process.env.INK_TEST_CHROME
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-stream-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = path.join(dir, 'stream.html');
  const renderer = pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href;
  fs.writeFileSync(path.join(dir, 'bundle.js'), studio.bundle());
  fs.writeFileSync(page, `<!doctype html><canvas width="120" height="90"></canvas><pre id="result">pending</pre>
<script src="bundle.js"></script><script type="module">
import { createRenderer } from ${JSON.stringify(renderer)};
const result = document.querySelector('#result');
try { result.textContent = encodeURIComponent(JSON.stringify(await (${browserFixture})(createRenderer))); }
catch (error) { result.textContent = encodeURIComponent(JSON.stringify({error:error.stack})); }
</script>`);
  const html = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
    '--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--virtual-time-budget=3000',
    '--user-data-dir=' + path.join(dir, 'profile'), '--dump-dom', pathToFileURL(page).href],
  { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const result = JSON.parse(decodeURIComponent(/<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1] ?? 'null'));
  assert(result && !result.error, result?.error);
  assert(result.through[2] > result.covered[2] + 45, JSON.stringify(result));
  assert(result.sameWorld && result.sameDestination && result.shut);
  assert.equal(result.splats, 2);
});
