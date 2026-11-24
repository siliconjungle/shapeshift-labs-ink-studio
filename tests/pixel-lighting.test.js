'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ink = require('..');
const { withChrome } = require('../cli/canvas-grid-chrome.js');
const example = require('../examples/pixel-lighting/scene.cjs');
const { KIT, makeBuilder } = ink.load();
const lighting = KIT.pixelLighting;

function tiny() {
  return {
    format: lighting.format, version: 1, width: 10, height: 6, tileSize: 2,
    ramps: [['#110520','#61397c','#ca9aff'], ['#122b2a','#348d75','#d8ffe9']],
    assets: {
      tile: { width:2, height:2, slots:[0,0,0,0] },
      pillar: { width:1, height:2, slots:[1,null], heightMap:[4,42] },
      normal: { width:2, height:1, slots:[1,1], normalMap:[1,128,128,255,128,128] },
      bevel: { width:3, height:1, slots:[1,1,1], heightMap:[0,1,0] }
    },
    tiles: Array.from({ length: 14 }, (_, i) => ({ asset:'tile', at:[i % 5, Math.floor(i / 5)] })),
    sprites: [
      { asset:'pillar', at:[4,2] },
      { asset:'normal', at:[6,0], castsShadow:false },
      { asset:'bevel', at:[5,4], castsShadow:false }
    ],
    ambient:0,
    lights:[{ at:[.5,2.5,3], radius:14, strength:4 }]
  };
}
function pixel(frame, x, y) {
  const i = (y * frame.w + x) * 4;
  return Array.from(frame.rgba.subarray(i, i + 4));
}
function rgba(frame) {
  return Uint8Array.from({ length:frame.w * frame.h * 4 }, (_, i) =>
    i % 4 === 3 ? frame.alpha?.[i >> 2] ?? 255 : frame.rgb[(i >> 2) * 3 + (i % 4)]);
}
function makeWorld(make) {
  const b = make(2, [0x27323c]);
  b.iso(0, 0, 0, .1, b.P[0], 1);
  return b.finish({ bg:[.06,.08,.12], dither:0 });
}
function graph(layer) {
  return { passes:[{ id:'lit', type:'composite', layer }] };
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-pixel-lighting-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return dir;
}

test('art slots remain exact while opaque height, holes, normals and light overrides change which bands receive light', () => {
  const scene = tiny();
  const prepared = lighting.prepare(JSON.parse(JSON.stringify(scene)));
  const baseline = lighting.render(prepared);
  const unshadowed = lighting.render(prepared, { shadows:false });
  assert.deepEqual(pixel(baseline, 6, 2), [17,5,32,255]);
  assert.deepEqual(pixel(unshadowed, 6, 2), [202,154,255,255]);
  const hole = [{ at:[.5,3.5,3], radius:14, strength:4 }];
  assert.deepEqual(pixel(lighting.render(prepared, { lights:hole }), 6, 3),
    pixel(lighting.render(prepared, { lights:hole, shadows:false }), 6, 3));
  assert.deepEqual(pixel(baseline, 8, 5), [0,0,0,0]);
  assert.deepEqual(pixel(unshadowed, 6, 0), [216,255,233,255]);
  assert.deepEqual(pixel(unshadowed, 7, 0), [18,43,42,255]);
  assert(pixel(unshadowed, 5, 4)[0] > pixel(unshadowed, 7, 4)[0]);
  const swatches = new Set(scene.ramps.flat().map(hex => Number.parseInt(hex.slice(1), 16)));
  for (let i = 0; i < unshadowed.rgba.length; i += 4) {
    const [r,g,b,a] = unshadowed.rgba.subarray(i, i+4);
    if (a) assert(swatches.has(r * 65536 + g * 256 + b));
  }
  assert.throws(() => lighting.prepare({ ...scene, tileSize:3 }), /match tileSize/);
  assert.throws(() => lighting.render(prepared, { lights:Array(9).fill(scene.lights[0]) }), /up to 8/);
  assert.throws(() => lighting.render({ ...scene, assets:{ ...scene.assets, normal:{ ...scene.assets.normal, normalMap:[128] } } }), /three RGB bytes/);
  assert.throws(() => KIT.frameComposite.prepare({layers:[{lighting2d:scene,filter:'linear'}]},10,6), /native art grid/);
});

test('standalone PNG and regular headless compositing use the same prepared scene', t => {
  const dir = temp(t), input = path.join(dir, 'scene.json'), frame = path.join(dir, 'frame.json'), out = path.join(dir, 'frame.png');
  const scene = example(), options = { shadows:false, ambient:.35 };
  fs.writeFileSync(input, JSON.stringify(scene));
  fs.writeFileSync(frame, JSON.stringify(options));
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'pixel-lighting',input,'--frame',frame,'--out',out]);
  const expected = lighting.render(scene, options);
  const png = require('../cli/png.js').read(out);
  assert.deepEqual(rgba(png), expected.rgba);
  const world = makeWorld(makeBuilder), { w,h } = expected;
  const layer = { lighting2d:lighting.prepare(scene), lightFrame:({sceneTime}) => {
    assert.equal(sceneTime, 2);
    return options;
  } };
  const settings = { w,h,t:2,px:1,raw:true };
  const mixed = ink.render(world, { ...settings, composite:{ layers:[layer] } });
  const graphed = ink.render(world, { ...settings, renderGraph:KIT.renderGraph.create(graph(layer)) });
  assert.deepEqual(rgba(mixed), expected.rgba);
  assert.deepEqual(rgba(graphed), expected.rgba);
});

test('WebGL native readback matches headless across light motion, cutouts and regular renderer layers',
  { skip:!process.env.INK_TEST_CHROME }, async t => {
    const dir = temp(t);
    const page = path.join(dir, 'index.html');
    const modulePath = pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href;
    const small = tiny(), large = example();
    const variation = { lights:[{at:[5.5,.5,4.0625],radius:18.25,strength:1.8},
      {at:[13.375,5.0625,5.0625],radius:20.1875,strength:1.35,castsShadow:false}], ambient:.18 };
    fs.writeFileSync(path.join(dir,'kit.js'),ink.bundle());
    fs.writeFileSync(page,`<!doctype html><script src="kit.js"></script><script type="module">
      import { createRenderer, createPixelLightingPass } from ${JSON.stringify(modulePath)};
      const scene = ${JSON.stringify(small)}, large = ${JSON.stringify(large)}, variation = ${JSON.stringify(variation)};
      const api = KIT.pixelLighting, prepared = api.prepare(scene), canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias:false, preserveDrawingBuffer:true });
      const pass = createPixelLightingPass(gl, api);
      function read(gl, w, h) {
        const raw = new Uint8Array(w*h*4), topDown = [];
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,raw);
        if (gl.getError()) throw new Error('WebGL pixel lighting read failed');
        for (let y=h-1;y>=0;y--) topDown.push(...raw.subarray(y*w*4,(y+1)*w*4));
        return topDown;
      }
      function native(spec, options) {
        const { w,h } = pass.draw(spec,options);
        return read(gl,w,h);
      }
      try {
        const first = native(prepared), varied = native(prepared,variation),
          noshadow = native(prepared,{ shadows:false }), resized = native(large), repeat = native(prepared);
        pass.dispose();
        const display = document.createElement('canvas');
        const renderer = createRenderer(display, { toolkit:{KIT, PixelLook, RenderStages}, contextAttributes:{preserveDrawingBuffer:true} });
        const context = display.getContext('webgl2'), world = (${makeWorld.toString()})(makeBuilder);
        const layer = { lighting2d:large };
        const w = large.width, h = large.height, settings = { width:w,height:h,time:0,dither:0 };
        renderer.render(world,{ ...settings, composite:{layers:[layer,{ lighting2d:scene, rect:[0,0,10,6], opacity:0.5 }]} });
        const mixed = read(context,w,h);
        renderer.render(world,{ ...settings, renderGraph:(${graph.toString()})(layer) });
        const graphed = read(context,w,h);
        renderer.dispose();
        window.result = { first,varied,noshadow,resized,repeat,mixed,graphed };
      } catch (error) { window.result = { error:error.stack }; }
    </script>`);
    const result = await withChrome(dir, { hardware:false }, async ({ send,evaluate }) => {
      await send('Page.navigate', { url:pathToFileURL(page).href });
      return evaluate("new Promise((resolve,reject) => { let attempts=0; const timer=setInterval(() => { if (window.result || ++attempts > 400) { clearInterval(timer); if (window.result) resolve(window.result); else reject(Error('Pixel lighting fixture timed out')); } },25); })");
    });
    assert.equal(result.error, undefined);
    for (const [name, spec, options] of [['first',small],['varied',small,variation],['noshadow',small,{shadows:false}],
      ['resized',large],['repeat',small],['graphed',large]])
      assert.deepEqual(Uint8Array.from(result[name]), lighting.render(spec,options).rgba,name);
    const world = makeWorld(makeBuilder);
    const expected = ink.render(world,{ w:large.width,h:large.height,px:1,raw:true,
      composite:{ layers:[{ lighting2d:large },{ lighting2d:small,rect:[0,0,10,6],opacity:.5 }] } });
    const mixed = Uint8Array.from(result.mixed), expectedRGBA = rgba(expected);
    assert.deepEqual(mixed.subarray(6*large.width*4),expectedRGBA.subarray(6*large.width*4));
    assert(mixed.slice(0,6*large.width*4).every((value,i) => Math.abs(value-expectedRGBA[i]) <= 1));
  });
