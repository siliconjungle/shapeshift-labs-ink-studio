const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ink = require('..');
const fixture = require('../examples/hybrid-depth-review.js');
const png = require('../cli/png.js');

test('headless reflected depth uses the same top-down grid and retains mesh IDs behind glass', () => {
  const { world, view } = fixture(ink.load());
  const options = { w: view.width, h: view.height, px: 1, colored: false, edges: false };
  const depth = [];
  const image = ink.render(world, { ...options, hybridDepthFrame: value => depth.push(value) });
  assert.deepEqual(image.rgb, ink.render(world, options).rgb);
  assert.deepEqual(depth.map(view => view.view), ['reflection', 'camera']);
  assert(depth.every(({ depth, width, height }) =>
    depth.length === width * height && depth.some(Number.isFinite) && depth.some(z => z === Infinity)));
  assert.deepEqual(depth[1].depth, ink.render(world, { ...options, passes: ['depth'] }).passes.depth);
  const deep = ink.render(world, { ...options, deepComposite: { layers: 8, reflections: ['station-mirror'] } });
  const layer = ink.graphDeepLayer(deep, { view:'reflection', plane:'station-mirror', object:'source-frame' });
  assert(layer.mask.data.some(Boolean));
});

test('WebGL keeps proxy and transparent contributions in the matched camera and reflected portal captures',
  { skip: !process.env.INK_TEST_CHROME }, t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ink-hybrid-depth-review-'));
    t.after(() => rmSync(directory, { recursive:true, force:true }));
    const { run } = require('../cli/hybrid-depth-review.js');
    const { width, height, backends } = run(directory);
    const webgl = backends.webgl;
    const combined = webgl.combined.views;
    assert.deepEqual(combined.map(view => [view.view, view.reflection]), [
      ['portal', undefined], ['portal', 'station-mirror'], ['reflection', 'station-mirror'], ['camera', undefined]
    ]);
    assert(combined.every(view => view.hits > 150 && view.width === width && view.height === height));
    for (const view of combined) {
      const bytes = readFileSync(path.join(directory, view.depth));
      assert.equal(bytes.length, width * height * 4);
      assert.equal(png.read(path.join(directory, view.image)).w, width);
    }

    const proxy = webgl['no-proxy'].difference;
    assert(proxy.changed > 300);
    assert(proxy.depthViews.every(({ filled, moved }) => filled + moved > 10));
    const reflection = webgl['no-reflection'].difference;
    assert.deepEqual(reflection.depthViews.filter(view => view.missing).map(view => view.id),
      ['reflection-station-mirror-portal-1', 'reflection-station-mirror']);

    // Effects and fog can change the picture without writing opaque depth.
    for (const variant of ['no-effects', 'no-glass', 'no-fog']) {
      assert(webgl[variant].difference.changed > 150);
      assert(webgl[variant].difference.depthViews.every(({ filled, cleared, moved }) => filled + cleared + moved === 0));
      const heat = png.read(path.join(directory, webgl[variant].difference.image));
      const changed = (left, top, right, bottom) => {
        let count = 0;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++)
          if (heat.rgb[(y * width + x) * 3]) count++;
        return count;
      };
      assert(changed(63, 32, 104, 69) > 40, variant + ' must change the portal aperture');
      assert(changed(63, 81, 104, 110) > 25, variant + ' must change the reflected portal');
    }
  });

test('WebGL uses the entry and aperture depths for source fog and soft splats over a doorway',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const run = require('../cli/look-webgl.js');
    const result = run({}, function build({ KIT, makeBuilder }, mode) {
      const source = makeBuilder(1,[0x161c2e,0xff3020]);
      if (mode === 'front' || mode === 'rear') source.disc(0,0,mode === 'front' ? 1 : -.8,
        [0,0,1],.6,.01,source.P[1],.48,{ nd:true });
      const mist = KIT.atmosphere.box({ min:[-1,-1,.1],max:[1,1,1.8],density:.4,color:'#ff3020' });
      const from = { origin:[0,0,0], normal:[0,0,1] };
      const to = { origin:[0,0,0], normal:[0,0,-1] };
      const opening = KIT.world.portals.doorway({ from, to, halfWidth:1, halfHeight:1 });
      const world = source.finish({ cam:{ target:[0,0,0],dist:4,ortho:true },
        atmosphere: mode === 'source-fog' ? [mist] : [] });
      const destination = makeBuilder(1,[0x2060ff]).finish({
        atmosphere: mode === 'pre-arrival-fog' ? [mist] : [] });
      return { world, portal:{ source:world, destination, opening } };
    }, (kit, make, backend) => {
      const painter = backend(65, 65, { width:65, height:65, raw:true });
      try {
        return Object.fromEntries(['base','front','rear','source-fog','pre-arrival-fog'].map(mode => {
          const { world, portal } = make(kit, mode);
          painter.draw(world, { portal });
          return [mode, painter.sample({ center:[32,32] }).center];
        }));
      } finally { painter.close(); }
    });
    assert.deepEqual(result.base, [32,96,255]);
    assert.deepEqual(result.rear, result.base);
    assert.deepEqual(result['pre-arrival-fog'], result.base);
    for (const mode of ['front', 'source-fog']) {
      const [red,,blue] = result[mode];
      assert(red > result.base[0] + 30 && blue < 240 && blue > 55, JSON.stringify(result));
    }
  });
