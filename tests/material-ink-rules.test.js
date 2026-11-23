const assert = require('node:assert/strict');
const { test } = require('node:test');
const studio = require('..');
const ArtInk = require('../src/art-ink.js');

const palette = [0, 0x808080, 0xffffff];
const settings = {
  light:[0,0,1], silhouette:false, crease:false, boundary:false,
  materials:{ metal:{ shadowEdge:{color:'#ffffff',threshold:.5,minLightDelta:.25} } }
};

function row({ normal = [0,0,1], depth = [5,5,5,5,5], material = [1,1,1,1,1],
  shadow = [0,0,1,0,0], position = [-.4,-.2,0,.2,.4], object = [1,1,1,1,1] } = {}) {
  const frame = {w:5,h:1,rgb:new Uint8Array(15).fill(128)};
  const passes = {
    depth:Float32Array.from(depth), normal:Float32Array.from(Array(5).fill(normal).flat()),
    objectPosition:Float32Array.from(position.flatMap(x => [x,0,0])),
    emission:new Float32Array(15), objectId:Uint32Array.from(object), materialId:Uint32Array.from(material),
    splatId:new Uint32Array(5).fill(1), inkShadow:Float32Array.from(shadow),
    objects:[null,'chassis','teeth'], materials:[null,'metal','skin']
  };
  return { frame, passes };
}

test('shadow ink stays on the dark side of continuous geometry, even within one splat', () => {
  const code = ArtInk.labels.indexOf('shadowEdge');
  const draw = options => {
    const { frame, passes } = row(options);
    return Array.from(ArtInk.apply(frame,passes,ArtInk.prepare(settings,palette),palette).inkMask);
  };
  assert.deepEqual(draw(),[0,0,code,0,0]);
  assert.deepEqual(draw({shadow:[0,0,.51,.4,0],object:[2,2,1,1,1]}),[0,0,0,0,0],
    'low-contrast lighting and object boundaries each suppress false shadow edges');
  assert.deepEqual(draw({depth:[5,5,6,5,5]}),[0,0,0,0,0]);
  assert.deepEqual(draw({material:[2,2,1,2,2]}),[0,0,0,0,0]);
  assert.throws(()=>ArtInk.prepare({...settings,shadowEdge:{threshold:0}},palette), /threshold/);
});

test('rest-space hatch survives a posed change and fades below native resolution', () => {
  const definition = {...settings, materials:{metal:{
    hatch:{direction:[1,0,0],spacing:1,width:.3,lightRange:[.25,.5],color:'#000000'}
  }}};
  const code = ArtInk.labels.indexOf('hatch');
  const draw = (position,depth,worldOffset) => {
    const {frame,passes}=row({ position,depth,normal:[0,1,0] });
    passes.position = Float32Array.from(passes.objectPosition, (n,i) => i%3===0 ? n+worldOffset : n);
    return ArtInk.apply(frame,passes,ArtInk.prepare(definition,palette),palette).inkMask;
  };
  assert.deepEqual(Array.from(draw(undefined,undefined,0)),[0,code,code,code,0]);
  assert.deepEqual(draw(undefined,[6,6,6,6,6],.56),draw(undefined,undefined,0));
  assert.deepEqual(Array.from(draw([-2,-1,0,1,2],undefined,0)),[0,0,0,0,0]);
  assert.throws(()=>ArtInk.prepare({...definition,hatch:{direction:[0,0,0]}},palette), /direction/);
});

test('shot styles layer over scene targets and preserve mixed mesh and splat ownership', () => {
  const demo = require('../examples/material-ink-rules.js')(studio.load());
  const override = require('../examples/material-ink-shot.json');
  const world = demo.build(demo.seed), t = 2.25;
  world.anim.update(0,t);
  const options = {w:224,h:118,px:1,t,colored:true,passes:['inkMask','materialId','objectId','depth','surfaceKind']};
  const hatch = ArtInk.labels.indexOf('hatch');
  const baseline = studio.render(world,options);
  const shot = studio.render(world,{...options,inkShot:override});
  const disabled = studio.render(world,{...options,ink:false,inkShot:override});
  const { materialId, materials, depth, objectId, surfaceKind } = baseline.passes;
  assert.deepEqual(shot.passes.depth,depth);
  assert.deepEqual(shot.passes.objectId,objectId);
  assert.deepEqual(shot.passes.surfaceKind,surfaceKind);
  assert.deepEqual(shot.passes.inkMask,shot.inkMask);
  assert.ok(disabled.passes.inkMask.every(n=>!n));
  const changed = new Set(), hatched = new Set();
  for (let p=0;p<materialId.length;p++) {
    const material = materials[materialId[p]], q = p*3;
    if (baseline.inkMask[p] === hatch) hatched.add(material);
    if (baseline.rgb[q] !== shot.rgb[q] || baseline.rgb[q+1] !== shot.rgb[q+1] || baseline.rgb[q+2] !== shot.rgb[q+2])
      changed.add(material);
  }
  assert.deepEqual([...changed].sort(),['metal','skin']);
  assert.ok(hatched.has('metal') && hatched.has('cloth'));
  const q = 2;
  const { frame, passes } = row({depth:[5,5,5,5,Infinity], object:[1,1,1,1,0]});
  const authored = {...settings, targets:[{select:{object:'chassis'},shadowEdge:{color:'#000000'}}]};
  const resolved = ArtInk.prepare(authored,palette,{
    materials:{metal:{shadowEdge:{color:'#ff0000'}}},
    targets:[{select:{object:'teeth'},shadowEdge:false}]
  });
  ArtInk.apply(frame,passes,resolved,palette);
  assert.deepEqual(Array.from(frame.rgb.subarray(q*3,q*3+3)),[255,0,0]);
});
