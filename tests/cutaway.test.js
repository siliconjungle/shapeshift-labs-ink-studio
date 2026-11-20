const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load(), cutaway = kit.KIT.cutaway;
const width = 96, height = 72;
const blue = [55,150,240], red = [224,57,103], background = [16,24,32];
const top = { planes:[{normal:[3,0,0],point:[.22,0,0]}], edge:{color:'#ffc000',width:.26} };
const reversed = { planes:[{normal:[1,0,0],keep:'negative'}] };
const band = { depth:[6.3,7.5] };
const boxes = { depth:[6.3,null], regions:{
  include:[{type:'sphere',center:[-.72,0,-1],radius:.45},{type:'sphere',center:[.8,0,-1],radius:.5}],
  exclude:[{type:'box',min:[.6,-.2,-1.4],max:[.98,.2,-.6]}]
} };

function fixture({makeBuilder}, {perspective=false,surface=false}={}) {
  const b=makeBuilder(1,[0x101820,0x3796f0,0xe03967,0xffc000]);
  for(const [z,color,id] of [[-1,[224,57,103],'rear'],[1,[55,150,240],'front']]){
    b.dab(0,0,z,[0,0,1],[1,0,0],1.4,.86,.025,color,3);
    b.describeSplats(b.count()-1,b.count(),{object:id});
  }
  const w=b.finish({cam:{target:[0,0,0],dist:6,yaw:0,pitch:0,projection:perspective?'perspective':'orthographic'},
    radius:4,dither:0});
  if(surface)w.spriteSurfaces={
    width:1,height:1,pixels:Uint8Array.of(90,206,106,255),vertices:Float32Array.of(
      -1,-.8,1.7,0,0, 1,-.8,1.7,0,0, 1,.8,1.7,0,0,
      -1,-.8,1.7,0,0, 1,.8,1.7,0,0, -1,.8,1.7,0,0
    )
  };
  return w;
}

function frame(world,definition) {
  return studio.render(world,{w:width,h:height,raw:true,px:1,cutaway:definition});
}
function pixel(frame,x,y=36) {
  const at=(y*frame.w+x)*3;
  return Array.from(frame.rgb.subarray(at,at+3));
}
const close=(a,b,limit=4)=>a.every((value,i)=>Math.abs(value-b[i])<=limit);

test('cutaway definitions normalize movable planes, intersect the kept depth, and combine region masks',()=>{
  const settings=cutaway.prepare({ planes:[{normal:[0,0,5],offset:.25,keep:'negative'}], ...boxes });
  assert.equal(cutaway.prepare(settings),settings);
  assert(Object.isFrozen(settings));
  assert(cutaway.margin(settings,-.7,0,-1,7)>0);
  assert(cutaway.margin(settings,.8,0,-1,7)<0);
  assert(cutaway.margin(settings,0,0,-1,7)<0);
  assert(cutaway.margin(settings,-.7,0,-1,5)<0);
  assert(cutaway.margin(settings,-.7,0,1,7)<0);
  assert.equal(cutaway.prepare({depth:[null,null]}),null);
  assert.throws(()=>cutaway.prepare({planes:[{normal:[0,0,0]}]}),/plane position/);
  assert.throws(()=>cutaway.prepare({depth:[3,2]}),/increasing/);
  assert.throws(()=>cutaway.prepare({regions:{include:[{type:'sphere',center:[0,0,0],radius:0}]}}),/positive radius/);
});

test('a moving plane cuts through the footprint of a splat and inks just the retained edge',()=>{
  const w=fixture(kit), original=w.data.slice();
  const base=frame(w), high=frame(w,top), low=frame(w,reversed);
  assert(close(pixel(base,43),blue));
  assert(close(pixel(high,43),background));
  assert(close(pixel(high,49),background));
  assert(pixel(high,52)[0]>190 && pixel(high,52)[2]<60);
  assert(close(pixel(high,62),blue));
  assert(close(pixel(low,41),blue) && close(pixel(low,55),background));
  assert.deepEqual(w.data,original);
  w.look={cutaway:top};
  assert.deepEqual(frame(w).rgb,high.rgb);
  assert.deepEqual(frame(w,false).rgb,base.rgb);
});

test('depth and world-space mask cuts reveal the surface under the removed fragments',()=>{
  const w=fixture(kit);
  const section=frame(w,band);
  assert(close(pixel(section,48),red));
  const regions=frame(w,boxes);
  assert(close(pixel(regions,35),red));
  assert(close(pixel(regions,61),background));
  assert(close(pixel(regions,48),background));
  assert(close(pixel(frame(fixture(kit,{perspective:true}),band),48),red));
});

test('native picks use the cutaway and the camera depth without rebuilding the picker',()=>{
  const w=fixture(kit), picker=studio.createSplatPicker(w);
  const ray={origin:[0,0,12],direction:[0,0,-1],camera:{eye:[0,0,16],back:[0,0,1],setback:10}};
  assert.equal(picker.ray(ray).dominant.target.object,'front');
  assert.equal(picker.ray({...ray,cutaway:band}).dominant.target.object,'rear');
  assert.equal(picker.ray({...ray,cutaway:top}).dominant,null);
  assert.equal(picker.ray({...ray,origin:[.8,0,12],cutaway:top}).dominant.target.object,'front');
});

test('the CLI accepts authored cutaways and a frame override',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-cutaway-'));
  try {
    const spec={id:'cutaway-test',
      camera:{target:[0,0,0],dist:6,yaw:0,pitch:0},solids:[{kind:'ball',at:[0,0,0],r:1,mat:'stone',res:.09}],
      finish:{look:{cutaway:top}}};
    const scene=path.join(dir,'scene.json'), settings=path.join(dir,'section.json'), image=path.join(dir,'frame.png');
    fs.writeFileSync(scene,JSON.stringify(spec));
    fs.writeFileSync(settings,JSON.stringify(reversed));
    const render=(...args)=>{
      execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'render',scene,
        '--raw','--w','96','--h','72','--out',image,...args],{stdio:'pipe'});
      return fs.readFileSync(image);
    };
    const authored=render(), other=render('--cutaway',settings), full=render('--cutaway','off');
    assert(!authored.equals(other) && !other.equals(full) && !authored.equals(full));
    const bad={ ...spec,finish:{look:{cutaway:{depth:[4,1]}}} };
    assert.throws(()=>kit.KIT.diorama.build(bad),/invalid|Cutaway/i);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('CPU and WebGL agree as section controls move, including native cutout surfaces', {skip:!process.env.INK_TEST_CHROME},()=>{
  function render(kit,build,open,{width,height,definitions,points}){
    const draw=open(width,height,{raw:true}), world=build(kit), surfaced=build(kit,{surface:true});
    try {
      const colors=definitions.map(cutaway=>{
        draw.draw(world,{cutaway});
        return draw.sample(points);
      });
      draw.draw(surfaced,{cutaway:definitions[1]});
      const triangle=draw.sample(points);
      const ray={origin:[0,0,12],direction:[0,0,-1]};
      const pick=draw.pick(world,ray,{cutaway:definitions[3]}).dominant.target.object;
      return {colors,triangle,pick};
    } finally { draw.close(); }
  }
  const definitions=[false,top,reversed,band,boxes];
  const points={left:[35,36],before:[49,36],edge:[52,36],right:[61,36]};
  const actual=runWebGL({},fixture,render,{width,height,definitions,points});
  for(const [i,definition] of definitions.entries()){
    const cpu=frame(fixture(kit),definition);
    for(const [name,[x,y]] of Object.entries(points))
      assert(close(pixel(cpu,x,y),actual.colors[i][name]),i+' '+name+' '+pixel(cpu,x,y)+' '+actual.colors[i][name]);
  }
  const cpu=frame(fixture(kit,{surface:true}),top);
  assert(close(pixel(cpu,52,36),actual.triangle.edge));
  assert(close(actual.triangle.right,[90,206,106]));
  assert.equal(actual.pick,'rear');
});
