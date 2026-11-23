const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');

function scene({ makeBuilder }, calls = []) {
  const B = makeBuilder(1, [0x102030, 0x4868c8]);
  B.disc(0, 0, 0, [0, 0, 1], 0.45, 0.06, B.P[1], 3);
  return B.finish({ radius: 2, cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4 },
    look: { composite: { world: { resolution: [9, 7] }, layers: [
      { resolution: [36, 14], draw: [{ type: 'path', points: [[1.5, 25], [14.5, 25]], width: 2, color: '#11ee33' }] },
      { resolution: [72, 56], filter: 'linear', draw: [{ type: 'text', text: 'I', at: [6.5, 7.5], size: 7, color: '#fff014' }] },
      { resolution: [3, 2], blend: 'add', opacity: .5, source({ w, h, time, outputWidth, outputHeight }) {
        calls.push([w, h, time, outputWidth, outputHeight]);
        const rgba = new Uint8Array(w * h * 4);
        if (time === 2) rgba.set([160, 40, 0, 128], (w - 1) * 4);
        return { w, h, rgba };
      } }
    ] } }
  });
}

const view = { w: 36, h: 28, raw: true, t: 2 };
const native = { w: 9, h: 7, px: 1, raw: true, composite: false };
const pixel = (frame, x, y) => Array.from(frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3));

test('native world, text, vector overlays and animated effects retain separate grids', () => {
  const calls = [], world = scene(studio.load(), calls);
  const base = studio.render(world, native), mixed = studio.render(world, { ...view, passes: ['depth'] });
  assert.deepEqual([mixed.w, mixed.h, mixed.px], [36, 28, 1]);
  assert.deepEqual(mixed.worldSize, [9, 7]);
  assert.deepEqual([mixed.passes.w, mixed.passes.h], [9, 7]);
  assert.deepEqual(calls, [[3, 2, 2, 36, 28]]);
  assert(studio.render(world, { ...view, renderStats: true }).renderStats.frameMs > 0);
  assert.deepEqual(pixel(mixed, 17, 15), pixel(base, 4, 3));
  assert.deepEqual(pixel(mixed, 18, 16), pixel(base, 4, 4));
  assert.deepEqual(pixel(mixed, 24, 2), [56, 42, 48]);
  assert.deepEqual(pixel(mixed, 14, 25), [17, 238, 51]);
  const lettering = pixel(mixed, 6, 7);
  assert(lettering[0] > 200 && lettering[1] > 190 && lettering[2] < 50);
  assert.deepEqual(pixel(studio.render(world, { ...view, t: 1 }), 24, 2), [16, 32, 48]);
});

test('linear resampling preserves transparent raster edges and layer order', () => {
  const { makeBuilder } = studio.load(), world = makeBuilder(1, [0]).finish({
    radius: 2, cam: { target: [0, 0, 0], pitch: 0, yaw: 0, dist: 4 }
  });
  const dot = { resolution: [2, 1], filter: 'linear', source: { w: 2, h: 1, rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0) } };
  const rect = { draw: [{ type: 'rect', rect: [0, 0, 1, 1], color: '#00ff00' }] };
  const options = { w: 3, h: 1, raw: true, transparent: true };
  const frame = studio.render(world, { ...options, composite: { layers: [dot, rect] } });
  assert.deepEqual(Array.from(frame.alpha), [255, 128, 0]);
  assert.deepEqual(pixel(frame, 0, 0), [0, 255, 0]);
  assert.deepEqual(pixel(frame, 1, 0), [255, 0, 0]);
  const reverse = studio.render(world, { ...options, composite: { layers: [rect, dot] } });
  assert.deepEqual(pixel(reverse, 0, 0), [255, 0, 0]);
  assert.throws(() => studio.render(world, { ...options, composite: { layers: [{ ...dot, resolution: [3, 1] }] } }),
    /must match the layer resolution/);
});

test('the CLI can apply a serialized composite and writes the output grid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ink-composite-'));
  try {
    const input = join(directory, 'art.json'), settings = join(directory, 'composite.json'), output = join(directory, 'frame.png');
    writeFileSync(input, JSON.stringify({ id: 'composite-test', solids: [{ kind: 'ball', at: [0, 0, 0], r: 0.5, mat: 'stone', res: .25 }] }));
    writeFileSync(settings, JSON.stringify({ world: { resolution: [12, 8] },
      layers: [{ resolution: 1, draw: [{ type: 'rect', rect: [2, 3, 1, 1], color: '#ff0088' }] }] }));
    execFileSync(process.execPath, [join(__dirname, '../cli/ink-studio.js'), 'render', input, '--composite', settings,
      '--w', '48', '--h', '32', '--out', output], { stdio: 'pipe' });
    const png = readFileSync(output);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [48, 32]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('WebGL composites all four grids and alternates with normal frames cleanly', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scene, (kit, fixture, backend) => {
    const calls = [], world = fixture(kit, calls);
    const draw = backend(36, 28, { raw: true, dither: 0 });
    const target = backend(36, 28, { raw: true, dither: 0, offscreen: true });
    const points = { world: [17, 15], effect: [24, 2], overlay: [14, 25], lettering: [6, 7],
      top: [31, 1], bottom: [31, 27] };
    try {
      draw.draw(world, { time: 2 });
      const mixed = draw.sample(points);
      draw.draw(world, { time: 1, composite: false });
      const normal = draw.sample(points);
      draw.draw(world, { time: 1 });
      const still = draw.sample(points);
      target.draw(fixture(kit), { time: 2 });
      const offscreen = target.sample(points);
      return { mixed, normal, still, calls, offscreen };
    } finally {
      draw.close();
      target.close();
    }
  });
  const expected = studio.render(scene(studio.load()), view);
  const points = { overlay: [14, 25], lettering: [6, 7], top: [31, 1], bottom: [31, 27] };
  for (const [name, [x, y]] of Object.entries(points))
    assert(result.mixed[name].every((value, c) => Math.abs(value - pixel(expected, x, y)[c]) <= 1), name + ': ' + JSON.stringify(result));
  assert.deepEqual(result.calls, [[3, 2, 2, 36, 28], [3, 2, 1, 36, 28]]);
  assert.deepEqual(result.offscreen, result.mixed);
  assert.notDeepEqual(result.normal.lettering, result.mixed.lettering);
  assert.deepEqual(result.mixed.effect.map((value, i) => value - result.still.effect[i]), [40, 10, 0]);
  assert.deepEqual(result.still.top, result.normal.top);
  assert.deepEqual(result.still.world, result.mixed.world);
});

function depthFixture({makeBuilder}) {
  const B=makeBuilder(42,[0x102030,0x78d0a1]);
  B.disc(0,0,0,[0,0,1],.62,.03,B.P[1],3);
  const world=B.finish({radius:2,cam:{target:[0,0,0],yaw:0,pitch:0,dist:4},dither:0});
  const source={w:3,h:2,rgba:new Uint8Array([
    0,0,240,255, 250,0,0,255, 250,0,0,255,
    0,220,0,255, 250,0,0,255, 250,0,0,255
  ]),depth:new Float32Array([3,6,6,3,6,6])};
  return {world,layer:{source,filter:'linear',depthTest:{bias:0}}};
}

test('each raster tap uses its own depth before filtering and late lettering stays native', () => {
  const {world,layer}=depthFixture(studio.load());
  const options={w:35,h:21,px:1,raw:true};
  const label={ draw:[{type:'rect',rect:[18,10,1,1],color:'#fff0fd'}] };
  const base=studio.render(world,{...options,passes:['depth']});
  const flat=studio.render(world,{...options,composite:{layers:[{...layer,depthTest:false}]}});
  const guided=studio.render(world,{...options,composite:{layers:[layer,label]}});
  assert.equal(guided.passes,undefined);
  assert.deepEqual(pixel(guided,17,10),pixel(base,17,10));
  assert.notDeepEqual(pixel(flat,17,10),pixel(base,17,10));
  assert.deepEqual(pixel(guided,18,10),[255,240,253]);
  assert.deepEqual(pixel(guided,34,10),pixel(flat,34,10));
  assert(pixel(guided,13,10)[0] < pixel(flat,13,10)[0]);
  assert(pixel(guided,2,1)[2] > pixel(guided,2,19)[2]);
  const preset={...layer,depthTest:{depth:6}};
  const graph=studio.render(world,{...options,renderGraph:{passes:[{id:'depth-layer',type:'composite',layer:preset}]}});
  assert.deepEqual(graph.rgb,studio.render(world,{...options,composite:{layers:[preset]}}).rgb);
  assert.throws(()=>studio.render(world,{...options,composite:{layers:[{...layer,source:{...layer.source,depth:undefined}}]}}),
    /Float32Array matching/);
});

test('match mode keeps background transfer and falls through on unmatched native surfaces', () => {
  const {world,layer}=depthFixture(studio.load());
  const source={...layer.source,depth:new Float32Array([Infinity,Infinity,Infinity,Infinity,Infinity,Infinity])};
  const mode={source,filter:'linear',depthTest:{mode:'match',bias:.17}};
  const options={w:33,h:21,px:1,raw:true,composite:{world:{resolution:[33,21]},layers:[mode]}};
  const frame=studio.render(world,options), base=studio.render(world,{...options,composite:false});
  assert.deepEqual(pixel(frame,16,10),pixel(base,16,10));
  assert.notDeepEqual(pixel(frame,2,2),pixel(base,2,2));
});

test('WebGL depth-tested coarse rasters agree with the CPU and compose through graphs', {
  skip: !process.env.INK_TEST_CHROME
},()=>{
  const result=runWebGL({},depthFixture,(kit,fixture,backend)=>{
    const {world,layer}=fixture(kit);
    const draw=backend(35,21,{raw:true,dither:0,offscreen:true});
    const points={center:[17,10],edge:[13,10],outer:[34,10],top:[2,1],bottom:[2,19]};
    try {
      draw.draw(world,{composite:{layers:[layer]}});
      const direct=draw.sample(points);
      const bound={...layer,source:{slot:'plate'}};
      const slot={width:layer.source.w,height:layer.source.h,data:layer.source.rgba,channels:4,depth:layer.source.depth};
      draw.draw(world,{renderGraph:{passes:[{type:'composite',id:'layer',layer:bound}]},renderGraphInputs:{plate:slot}});
      const graph=draw.sample(points);
      const match={...layer,source:{...layer.source,depth:new Float32Array(6).fill(Infinity)},depthTest:{mode:'match'}};
      draw.draw(world,{composite:{layers:[match]}});
      const matching=draw.sample(points);
      draw.draw(world,{composite:{layers:[{...layer,depthTest:false}]}});
      const disabled=draw.sample(points);
      draw.draw(world,{});
      return {direct,graph,matching,disabled,plain:draw.sample(points),points};
    } finally { draw.close(); }
  });
  const {world,layer}=depthFixture(studio.load());
  const cpu=studio.render(world,{w:35,h:21,px:1,raw:true,composite:{layers:[layer]}});
  assert.deepEqual(result.direct.center,result.plain.center);
  assert.notDeepEqual(result.disabled.center,result.plain.center);
  assert.deepEqual(result.matching.center,result.plain.center);
  assert.deepEqual(result.matching.outer,result.direct.outer);
  for(const [key,[x,y]] of Object.entries(result.points)){
    const expected=pixel(cpu,x,y);
    for(const samples of [result.direct,result.graph])
      assert(samples[key].every((n,i)=>Math.abs(n-expected[i])<=1), key+': '+JSON.stringify(result));
  }
});
