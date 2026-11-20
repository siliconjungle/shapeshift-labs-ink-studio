const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder, makeSculpt, EmissiveFinishes: E } = ink.load();

const look = {
  id:'lantern', select:{object:'luminous'},
  core:{color:'#ffbf74',strength:2},
  spill:{color:'#ff733b',at:[0,.06,.34],normal:[0,0,-1],radius:2.6,intensity:6,shadows:false},
  glow:{color:'#ef7938',strength:.85,radius:4,small:{belowPixels:65,radius:1,strength:.7}}
};

function scene({ former = false, occlude = false } = {}) {
  const B=makeBuilder(61,[0x131a22,0x27384a,0x446073,0x765451,0xaa7661,0xee8e45,0xffc17a,0xffe6a5]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{pixel:true,sun:[0,0,1],amb:.48,sky:.15,sunK:.28,wob:0});
  S.box([0,0,-.48],[1.82,1.21,.09],{r:[1,2]},{res:.065});
  S.box([0,0,.11],[.18,.24,.042],{r:[4],em:true},{res:.034,ghost:true,objectId:'luminous'});
  if (occlude) S.box([0,0,.54],[.33,.41,.075],{r:[2]},{res:.049});
  S.bake();
  return B.finish({
    cam:{target:[0,0,0],dist:4.9,yaw:0,pitch:0,sway:0},detail:23,dither:0,radius:3.5,
    look:{pixel:true,splatCoverage:'continuous',...(former && { effects:{ glow:{radius:3, colors:['#f000c0'],threshold:.1} } })},
    emissiveFinishes:[look]
  });
}

test('an emissive profile preserves core shape and its spill follows the posed source by default', () => {
  const profiles=E.prepare([{...look,spill:{...look.spill,at:undefined,offset:[.2,0,0]}}]);
  const world=scene(), binding=E.bind(profiles,world);
  const pose = offset => ({
    x:Array.from({length:world.count},(_,i)=>world.data[i*16]+offset),
    y:Array.from({length:world.count},(_,i)=>world.data[i*16+1]),
    z:Array.from({length:world.count},(_,i)=>world.data[i*16+2]),
    alpha:Array.from({length:world.count},(_,i)=>world.data[i*16+3])
  });
  const a=E.spillLights(binding,pose(0)), b=E.spillLights(binding,pose(3));
  assert.equal(a.length,1);
  assert(Math.abs(b[0].at[0]-a[0].at[0]-3)<1e-10);
  assert(Math.abs(b[0].points[0][0]-a[0].points[0][0]-3)<1e-10);
  const dark=E.coreRgb(profiles[0].core,.15,.25,.30), bright=E.coreRgb(profiles[0].core,.35,.5,.6);
  assert(bright[0]>dark[0] && bright[0]>bright[2]);
  assert.throws(()=>E.prepare([{...look,spill:{...look.spill,offset:[1,0,0]}}]),/either at or offset/);
  assert.throws(()=>E.prepare([{...look,glow:{radius:9}}]),/Glow radius/);
});

test('the screen halo preserves the core, respects depth, and tightens on small art grids', () => {
  const layer=E.prepare([look]);
  function frame(w,h) {
    const size=w*h, p=((h>>1)*w+(w>>1));
    const rgb=new Uint8Array(size*3), alpha=new Uint8Array(size);
    rgb.set([255,235,170],p*3);
    alpha[p]=255;
    const depth=new Float32Array(size).fill(Infinity), emissionDepth=depth.slice();
    const slots=new Uint8Array(size), coverage=new Float32Array(size);
    emissionDepth[p]=4;
    slots[p]=1;
    coverage[p]=1;
    depth[p+1]=2;
    return { frame:{w,h,rgb,alpha},pass:{depth,emissionDepth,scopedEmission:{slots,coverage}},p };
  }
  const a=frame(80,75), b=frame(42,38);
  E.applyGlow(a.frame,a.pass,layer);
  E.applyGlow(b.frame,b.pass,layer);
  for (const {frame,p} of [a,b]) {
    assert.deepEqual(Array.from(frame.rgb.slice(p*3,p*3+3)),[255,235,170]);
    assert.equal(frame.alpha[p+1],0);
    assert(frame.alpha[p-1]>0);
  }
  assert(a.frame.alpha[a.p-3]>0);
  assert.equal(b.frame.alpha[b.p-3],0);
});

function view(world, profile, extra={}) {
  return ink.render(world,{w:98,h:78,px:1,ortho:true,emissiveFinishes:profile,passes:['emission','coverage'],...extra});
}
test('core, spill and glow can be authored independently through normal headless renders', () => {
  const world=scene();
  const off=view(world,false);
  const bright=view(world,[{...look,spill:false,glow:false}]);
  const lit=view(world,[{...look,core:false,glow:false}]);
  const halo=view(world,[{...look,core:false,spill:false}]);
  const unlitCore={...look,core:{strength:0},spill:false};
  const darkHalo=view(world,[unlitCore]), darkPlain=view(world,[{...unlitCore,glow:false}]);
  const center=((off.h>>1)*off.w+(off.w>>1))*3;
  const color=frame=>Array.from(frame.rgb.slice(center,center+3));
  assert.notDeepEqual(color(bright),color(off));
  assert.deepEqual(color(lit),color(off));
  assert.deepEqual(color(halo),color(off));
  assert.deepEqual(color(darkHalo),color(darkPlain));
  assert.notDeepEqual(darkHalo.rgb,darkPlain.rgb);
  assert.notDeepEqual(bright.passes.emission,off.passes.emission);
  for (const frame of [lit,halo]) {
    assert.notDeepEqual(frame.rgb,off.rgb);
    assert.deepEqual(frame.passes.coverage,off.passes.coverage);
    assert.deepEqual(frame.passes.emission,off.passes.emission);
  }
  assert.deepEqual(view(world,[{...look,core:false,glow:false}],{areaLights:false}).rgb,off.rgb);
  const high=view(world,[{...look,core:false,spill:false}],{colored:true});
  assert.notDeepEqual(high.rgb,view(world,false,{colored:true}).rgb);
  assert.deepEqual(view(scene({occlude:true}),[{...look,spill:false,core:false}]).rgb,view(scene({occlude:true}),false).rgb);
});

test('a scoped glow toggle also overrides the legacy halo for its source', () => {
  const world=scene({former:true});
  const legacy=view(world,false);
  const controlled=view(world,[{...look,core:false,spill:false,glow:false}]);
  const plain=view(world,false,{artEffects:false});
  assert.notDeepEqual(legacy.rgb,plain.rgb);
  assert.deepEqual(controlled.rgb,plain.rgb);
});

test('diorama profiles bind named luminous materials and retain the spill shadow geometry', () => {
  const profile={...look,select:{material:'lamp-glass'},spill:{...look.spill,shadows:true}};
  const spec={id:'emissive-diorama',finish:{emissiveFinishes:[profile]},solids:[
    {kind:'box',at:[0,0,.1],half:[.18,.25,.04],mat:{role:'pale',materialId:'lamp-glass',glow:true}},
    {kind:'box',at:[0,-.4,0],half:[1,.08,1],mat:'stone'}
  ]};
  const world=K.diorama.build(spec);
  assert.deepEqual(world.emissiveFinishes,[profile]);
  assert(E.bind(E.prepare(world.emissiveFinishes,world.pal),world).slots.some(Boolean));
  assert(world.renderSdfs.length);
  profile.glow={radius:9};
  assert(K.diorama.check(spec).some(issue=>issue.path==='finish.emissiveFinishes' && /Glow radius/.test(issue.problem)));
});
