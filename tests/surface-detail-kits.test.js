const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT:K, SurfaceLook, SurfaceDetailKits } = ink.load();
const base=[.60,.57,.50];
const layer=(recipe,pattern={})=>({type:'detailKit',shadow:false,pattern:{recipe,...pattern}});
const sample={position:[0,.2,0],normal:[0,0,1],view:[0,0,1],artFootprint:.015};
function shade(layers, point={}, options={}) {
  return SurfaceLook.shade(SurfaceLook.prepare({layers},[],undefined,undefined,options),{...sample,...point},base);
}

test('the six registered kits use their rest frames, and narrow marks disappear below an art pixel',()=>{
  assert.deepEqual(SurfaceDetailKits.recipes,['stone-joints','exposed-brick','chipped-plaster','roof-seams','cloth-stitching','crevice-moss']);
  const stone={mortar:layer('stone-joints',{variation:0})};
  const near=shade(stone);
  assert(near[0]<base[0]-.2);
  assert.deepEqual(shade(stone,{artFootprint:.45}).slice(0,3),base);
  assert.deepEqual(shade({mortar:layer('stone-joints',{variation:0,origin:[.3,0,0]})}).slice(0,3),base);
  const stitch={hem:layer('cloth-stitching')};
  assert.notDeepEqual(shade(stitch,{position:[.08,0,0]}).slice(0,3),base);
  assert.deepEqual(shade(stitch,{position:[0,0,0]}).slice(0,3),base);
  const roof={ tiles:layer('roof-seams',{axes:['x',[0,.6,.8]],normal:{axis:[0,.8,-.6],range:[.5,.9]}}) };
  assert.notDeepEqual(shade(roof,{normal:[0,.8,-.6],view:[0,.8,-.6]}).slice(0,3),base);
  assert.deepEqual(shade(roof).slice(0,3),base);
  const brick=layer('exposed-brick'), plaster=layer('chipped-plaster',{coverage:.52,seed:13});
  const points=Array.from({length:16},(_,i)=>({position:[i*.23,.46,0]}));
  const mixed=points.map(p=>shade({brick,plaster},p));
  assert(mixed.some((rgb,i)=>rgb[0]!==shade({brick},points[i])[0]));
  assert(mixed.some((rgb,i)=>rgb[0]===shade({brick},points[i])[0]));
  assert(mixed.every(rgb=>rgb[3]===1));
});

test('moss uses retained concavity or earlier mortar and responds to authored exposure',()=>{
  const options={variation:0,coverage:1,exposure:{channel:'rain',range:[.2,.8],invert:true}};
  const moss=layer('crevice-moss',{...options,crevices:'geometry'});
  const point={position:[0,0,.028],normal:[0,1,0],view:[0,1,0],exposure:()=>.1};
  assert.deepEqual(shade({moss},{...point,bevelDistance:(_x,y)=>y}).slice(0,3),base);
  const recess=(_x,y,z)=>Math.min(y,z);
  assert.notDeepEqual(shade({moss},{...point,bevelDistance:recess}).slice(0,3),base);
  assert.deepEqual(shade({moss},{...point,bevelDistance:recess,exposure:()=>1}).slice(0,3),base);
  const joints=layer('stone-joints',{variation:0}), jointMoss=layer('crevice-moss',{...options,crevices:'joints'});
  assert.notDeepEqual(shade({joints,jointMoss},{exposure:()=>0}),shade({joints},{exposure:()=>0}));
  assert.deepEqual(shade({joints,jointMoss},{exposure:()=>1}),shade({joints},{exposure:()=>1}));
});

test('JSON build retains the sculpt for moss and layers render without changing coverage',()=>{
  const spec={id:'kit-wall',camera:{target:[0,.12,0],dist:4.1,yaw:.12,pitch:.18,sway:0},
    finish:{look:{pixel:true,splatCoverage:'continuous'}},solids:[
      {kind:'box',at:[0,.2,-.21],half:[1.4,.63,.13],res:.11,mat:{role:'stone',surface:{layers:{
        joints:layer('stone-joints',{width:.10}), moss:layer('crevice-moss')
      }}}},
      {kind:'box',at:[0,-.39,.15],half:[1.45,.15,.6],res:.16,mat:'stone'}
    ]};
  const world=K.diorama.build(spec);
  assert(world.surfaces.some(row=>typeof row.bevelDistance==='function'));
  for (const ortho of [false,true]) {
    const view={w:84,h:66,px:1,ortho,passes:['coverage']};
    const placed=ink.render(world,view), plain=ink.render(world,{...view,surfaceDetailKits:false});
    assert.notDeepEqual(placed.rgb,plain.rgb);
    assert.deepEqual(placed.passes.coverage,plain.passes.coverage);
  }
  spec.solids[0].mat.surface.layers.joints.pattern.axes=['x','x'];
  assert(K.diorama.check(spec).some(row=>row.path==='solids[0].mat.surface' && /perpendicular/.test(row.problem)));
});
