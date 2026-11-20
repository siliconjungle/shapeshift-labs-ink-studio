const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder, KIT }, kind = 'pipeline') {
  const B = makeBuilder(1, [0x102030, 0xff0000, 0x00ff00]);
  if (kind === 'scope') {
    B.disc(-0.7, 0, 0, [0, 0, 1], .45, .04, B.P[1], 3);
    B.describeSplats(0, 1, { object: 'panel', material: 'ink' });
    B.disc(0.7, 0, 0, [0, 0, 1], .45, .04, B.P[2], 3);
    B.describeSplats(1, 2, { object: 'marker', material: 'ink' });
  }
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 3,
    look: kind === 'scope' ? { composite: { world: { resolution: [18, 12] } } } : {} });
  const blue = { name: 'Swap red and blue', steps: [{ type: 'channelMix', matrix: [[0, 0, 1], [0, 1, 0], [1, 0, 0]] }] };
  const paint = { id: 'paint', type: 'composite', layer: {
    resolution: [4, 3], draw: [{ type: 'rect', rect: [0, 0, 4, 4], color: '#ff0000' }]
  } };
  const grade = { id: 'grade', type: 'grade', stack: blue };
  const passes = kind === 'scope' ? [
    { id: 'ink', type: 'mask', select: { material: 'ink' } },
    { id: 'visible-panel', type: 'mask', select: { object: 'panel' }, mask: 'ink' },
    { ...grade, mask: 'visible-panel' }
  ] : kind === 'edit' ? [paint, grade] : [
    paint,
    { id: 'right', type: 'mask', rect: [4, 0, 4, 6] },
    { id: 'reflect', type: 'reflection', axis: 'x', mask: 'right', source: 'paint' },
    { id: 'lower', type: 'mask', rect: [4, 4, 4, 2], mask: 'right' },
    { id: 'shift', type: 'distortion', offset: [0, -2], mask: 'lower' },
    { ...grade, mask: 'lower' }
  ];
  return { world, editor: KIT.renderGraph.create({ passes }) };
}

const kit = ink.load();
const pixel = (frame, x, y) => Array.from(frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3));
const view = { w: 8, h: 6, px: 1, raw: true };
const red = [255, 0, 0], blue = [0, 0, 255];

test('render graph reflects and distorts a named image within masks before grading it', () => {
  const { world, editor } = fixture(kit);
  const frame = ink.render(world, { ...view, renderGraph: editor });
  assert.deepEqual(pixel(frame, 0, 0), red);
  assert.deepEqual(pixel(frame, 7, 1), red);
  assert.deepEqual(pixel(frame, 7, 5), blue);
  assert.deepEqual(pixel(frame, 2, 5), [16, 32, 48]);
  const snapshot = editor.snapshot();
  assert.throws(() => editor.move('right', 4), /earlier mask output/);
  assert.throws(() => editor.remove('paint'), /earlier image output/);
  assert.equal(editor.snapshot(), snapshot);
  editor.update('lower', { enabled: false });
  assert.deepEqual(pixel(ink.render(world, { ...view, renderGraph: editor }), 7, 5), [16, 32, 48]);
});

test('live graph edits change ordering without rebuilding the world', () => {
  const { world, editor } = fixture(kit, 'edit');
  world.look.renderGraph = editor;
  assert.deepEqual(pixel(ink.render(world, view), 0, 0), blue);
  const sample = ink.render(world, { ...view, samples: true });
  assert.deepEqual(Array.from(sample.color.subarray(0, 3)), [16, 32, 48]);
  editor.move('grade', 0);
  assert.deepEqual(pixel(ink.render(world, view), 0, 0), red);
  editor.update('paint', { enabled: false });
  assert.deepEqual(pixel(ink.render(world, view), 0, 0), [48, 32, 16]);
  editor.insert({ id: 'mix', type: 'composite', source: 'scene', opacity: .5, blend: 'add' });
  assert.deepEqual(pixel(ink.render(world, view), 0, 0), [56, 48, 40]);
  editor.replace({ ...editor.snapshot(), output: 'scene' });
  assert.deepEqual(pixel(ink.render(world, view), 0, 0), [16, 32, 48]);
});

test('selectors stay aligned through mixed resolution and preserve requested diagnostics', () => {
  const { world, editor } = fixture(kit, 'scope');
  const options = { w: 36, h: 24, raw: true, outline: false };
  const before = ink.render(world, options);
  const after = ink.render(world, { ...options, renderGraph: editor, passes: ['depth'] });
  const panel = pixel(before, 11, 12);
  assert(panel[0] > 245 && panel[2] < 10);
  assert.deepEqual(pixel(after, 11, 12), [panel[2], panel[1], panel[0]]);
  assert.deepEqual(pixel(after, 24, 12), pixel(before, 24, 12));
  assert.deepEqual(after.worldSize, [18, 12]);
  assert(after.passes.depth);
  assert.equal(after.passes.splatId, undefined);
});

test('WebGL executes the same graph with live edits and native world ownership', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, fixture, backend) => {
    const pipeline = fixture(kit), scope = fixture(kit, 'scope'), edit = fixture(kit, 'edit');
    const draw = backend(8, 6, { raw: true, offscreen: true });
    const drawScope = backend(36, 24, { raw: true });
    try {
      const points = { first: [0, 0], reflected: [7, 1], distorted: [7, 5], untouched: [2, 5] };
      draw.draw(pipeline.world, { renderGraph: pipeline.editor });
      const output = draw.sample(points);
      draw.draw(edit.world, { renderGraph: edit.editor });
      const first = draw.sample(points).first;
      edit.editor.move('grade', 0);
      draw.draw(edit.world, { renderGraph: edit.editor });
      const moved = draw.sample(points).first;
      draw.draw(edit.world, { renderGraph: false });
      const original = draw.sample(points).first;
      drawScope.draw(scope.world, { renderGraph: scope.editor });
      return { output, first, moved, original, owners: drawScope.sample({ panel: [11, 12], marker: [24, 12] }) };
    } finally {
      draw.close();
      drawScope.close();
    }
  });
  assert.deepEqual(result.output, { first: red, reflected: red, distorted: blue, untouched: [16, 32, 48] });
  assert.deepEqual(result.first, blue);
  assert.deepEqual(result.moved, red);
  assert.deepEqual(result.original, [16, 32, 48]);
  assert(result.owners.panel[2] > 245 && result.owners.panel[0] < 10, JSON.stringify(result));
  assert(result.owners.marker[1] > 245 && result.owners.marker[2] < 10, JSON.stringify(result));
});

function scanlines({ makeBuilder, KIT }, kind) {
  const B = makeBuilder(1, [0x102030, 0xdd3322, 0x448855]);
  const cam = { target:[0,0,0], dist:4, yaw:0, pitch:0, ortho:true };
  if (kind === 'depth') {
    B.disc(-.58,0,-1,[0,0,1],.41,.02,B.P[2],3);
    B.disc(.58,0,1,[0,0,1],.41,.02,B.P[1],3);
    const world = B.finish({ cam, radius:3,
      look:{splatCoverage:'continuous',composite:{world:{resolution:[40,24]}}} });
    const distortion = {id:'shift',type:'distortion',offset:[28,0]};
    const open = { passes:[distortion] }, guarded = { passes:[{...distortion,depthThreshold:.45}] };
    return { world, open, guarded };
  }
  const world = B.finish({cam,radius:3});
  const stripe = (x,color) => ({type:'rect',rect:[x,0,2,6],color});
  const editor = KIT.renderGraph.create({passes:[
    {id:'unused',type:'composite',layer:{draw:[stripe(0,'#ffffff')]}},
    {id:'paint',type:'composite',isolated:true,
      layer:{draw:[stripe(0,'#a01e19'),stripe(2,'#0f8241'),stripe(6,'#192dbe')]}},
    {id:'band',type:'mask',rect:[0,1,8,4]},
    {id:'raster',type:'distortion',input:'scene',source:'paint',mask:'band',blend:'over',wrap:true,rows:[
      {at:0}, {at:1,offset:[4,0],scale:[.5,1],tint:[50,-25,0]}
    ]}
  ]});
  return {world,editor};
}

const scanPoints = {above:[0,0],scaled:[0,2],hole:[3,2],wrapped:[7,2]};
const scanExpected = {above:[16,32,48],scaled:[35,120,65],hole:[16,32,48],wrapped:[180,20,25]};

test('scanlines interpolate offset, scale and signed tint on an isolated graph source', () => {
  const {world,editor} = scanlines(kit);
  const base = ink.render(world, {...view,renderGraph:editor});
  const sampled = Object.fromEntries(Object.entries(scanPoints).map(([name,[x,y]])=>[name,pixel(base,x,y)]));
  assert.deepEqual(sampled,scanExpected);
  assert(!kit.KIT.renderGraph.prepare(editor).passes.some(node=>node.id==='unused'));
  const snapshot = editor.snapshot();
  assert.throws(()=>editor.update('raster',{rows:[{at:.5},{at:.2}]}),/increasing/);
  assert.throws(()=>editor.update('raster',{rows:[{at:0,tint:[0,256,0]}]}),/RGB tint/);
  assert.throws(()=>editor.update('raster',{depthThreshold:-1}),/depth threshold/);
  assert.equal(editor.snapshot(),snapshot);
  const rows = [];
  editor.update('raster',{rows:({y,width,height,time})=>{
    rows.push([y,width,height,time]);
    return {offset:[time,0]};
  }});
  assert.deepEqual(pixel(ink.render(world,{...view,t:2,renderGraph:editor}),0,2),[15,130,65]);
  assert.deepEqual(rows,Array.from({length:6},(_,y)=>[y,8,6,2]));
});

test('distortion can reject a displaced sample from across a native depth edge', () => {
  const {world,open,guarded} = scanlines(kit,'depth');
  const options={w:80,h:48,raw:true,outline:false};
  const original=ink.render(world,options), shifted=ink.render(world,{...options,renderGraph:open});
  const clipped=ink.render(world,{...options,renderGraph:guarded});
  assert(clipped.passes === undefined);
  let blocked = 0, retained = 0;
  for (let y=0;y<48;y++) for (let x=0;x<52;x++) {
    const [r,g] = pixel(original,x,y), [rr,gg] = pixel(shifted,x,y), [a,b] = pixel(clipped,x,y);
    if (g>90 && r<100 && rr>180 && gg<90 && a===r && b===g) blocked++;
    if (r===rr && g===gg && a===r && b===g) retained++;
  }
  assert(blocked>20);
  assert(retained>20);
  assert.deepEqual(clipped.worldSize,[40,24]);
});

test('WebGL scanlines match isolated CPU color and reject depth edges with a mixed world grid', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scanlines, (kit, fixture, backend, points) => {
    const {world,editor} = fixture(kit);
    const draw=backend(8,6,{raw:true,offscreen:true});
    const depth=backend(80,48,{raw:true,outline:false});
    try {
      draw.draw(world,{renderGraph:editor});
      const colors=draw.sample(points), scene=fixture(kit,'depth');
      const read = renderGraph => {
        depth.draw(scene.world,{renderGraph});
        return atob(depth.image());
      };
      const original=read(false), open=read(scene.open), guarded=read(scene.guarded);
      let blocked=0;
      for (let i=0;i<original.length;i+=3) {
        if (original.charCodeAt(i)<100 && original.charCodeAt(i+1)>90 &&
            open.charCodeAt(i)>180 && open.charCodeAt(i+1)<90 &&
            guarded.slice(i,i+3)===original.slice(i,i+3)) blocked++;
      }
      return {colors,blocked};
    } finally {
      draw.close();
      depth.close();
    }
  }, scanPoints);
  assert.deepEqual(result.colors,scanExpected);
  assert(result.blocked>20,JSON.stringify(result));
});
