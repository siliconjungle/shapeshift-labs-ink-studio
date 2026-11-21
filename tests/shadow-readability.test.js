const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..'), kit = ink.load();
const { measure } = require('../cli/shadow-readability');

const profile = { darks:[
  { select:{ material:'coat' }, colors:['#39263e'], range:[0,.4] },
  { select:{ material:'iron' }, colors:['#182730'], range:[0,.4] }
] };
const RGB = value => [value>>16,value>>8&255,value&255];

function scene() {
  const B = kit.makeBuilder(7,[0x111821,0x202733,0xc19d7e,0xffdc96]);
  function disk(x,y,z,material,color,em=false) {
    const i=B.count();
    B.disc(x,y,z,[0,0,1],.4,.03,B.P[color],3,em ? {em:true} : undefined);
    B.describeSplats(i,i+1,{object:material+'-'+color,material});
  }
  disk(-.43,-.23,.13,'coat',1);
  disk(.38,-.23,0,'iron',1);
  disk(-.57,.89,.17,'coat',2);
  disk(.78,.87,.21,'lamp',3,true);
  return B.finish({cam:{target:[0,.15,0],dist:5,yaw:0,pitch:0,ortho:true},radius:7,dither:0,
    look:{effectPalettes:profile,splatCoverage:'continuous'}});
}

test('darks measure each visible contact once and ignore bright and transparent samples',()=>{
  const frame={w:2,h:3,rgb:Uint8Array.from([0x181b21,0x181b21,0x181b21,0x181b21,0xeeb699,0xeeb699].flatMap(RGB)),
    alpha:Uint8Array.of(255,255,255,0,255,255),
    passes:{materialId:Uint8Array.of(1,2,1,2,1,2), materials:[null,'coat','wall'],depth:Float32Array.of(4,8,4,8,4,8)}};
  const result=measure(frame,null,'material',{color:.06,lightness:.035,weakShare:.25},.4);
  const row=result.contacts[0];
  assert.equal(row.contacts,2);
  assert.equal(row.samples,1);
  assert.equal(row.sameSwatchShare,1);
  assert.deepEqual(row.worstColor.a,{x:0,y:0,swatch:'#181b21',lightness:row.worstColor.b.lightness});
  assert.deepEqual(row.flags,['same-swatch','weak-color','weak-lightness']);
  assert.deepEqual(Array.from(result.marked.rgb.slice(0,6)),[255,119,127,255,119,127]);
});

test('dark ramps choose separate material swatches and keep bright areas and other targets intact',()=>{
  const world=scene(), view={w:80,h:64,px:1,passes:['materialId','depth','paletteOwner']};
  const before=ink.render(world,{...view,effectPalettes:false}), after=ink.render(world,{...view,captureEffectPalettes:true});
  const seen=new Set(), {materialId,materials,paletteOwner,paletteOwners}=after.passes;
  let bright=0;
  for (let p=0;p<materialId.length;p++) {
    const color=Array.from(after.rgb.subarray(p*3,p*3+3)), input=Array.from(before.rgb.subarray(p*3,p*3+3));
    if (!after.effectPaletteMask[p]) {
      if (materials[materialId[p]]==='coat' && input[0]>120) bright++;
      assert.deepEqual(color,input);
      continue;
    }
    assert.equal(after.effectPaletteMask[p],7);
    const rule=profile.darks.find(row=>row.select.material===materials[materialId[p]]);
    assert(rule);
    assert.deepEqual(color,RGB(parseInt(rule.colors[0].slice(1),16)));
    assert.deepEqual(paletteOwners[paletteOwner[p]].select,rule.select);
    seen.add(rule.select.material);
  }
  assert(bright>10);
  assert.deepEqual([...seen].sort(),['coat','iron']);
  assert.deepEqual(after.passes.depth,before.passes.depth);
  const usage=ink.paletteUsage(world,{...view,select:{effect:'darks',material:'coat'}});
  assert(usage.swatches.some(row=>row.swatch==='#39263e' && row.declared && row.pixels>0));
  assert(!usage.swatches.some(row=>row.swatch==='#182730'));
  const pixel=after.effectPaletteMask.findIndex((flag,p)=>flag===7 && materials[materialId[p]]==='coat');
  const inspection=ink.inspectPalettePixel(world,{w:80,h:64,px:1,at:[pixel%80,Math.floor(pixel/80)]});
  assert.equal(inspection.winner.rule.effect,'darks');
  assert.deepEqual(inspection.winner.rule.select,{material:'coat'});
  assert.equal(inspection.winner.method,'oklab-lightness');
});

test('an already reserved material swatch keeps priority over its dark ramp',()=>{
  const world=scene(), settings={w:80,h:64,px:1,passes:['materialId'],captureEffectPalettes:true,
    paletteConstraints:{targets:[{select:{material:'coat'},palette:[2],reserved:[1]}]}};
  const before=ink.render(world,{...settings,effectPalettes:false}), after=ink.render(world,settings);
  const {materialId,materials}=after.passes, coat=materials.indexOf('coat');
  const protectedPixels=materialId.reduce((sum,id,p)=>{
    if (id!==coat || before.rgb[p*3]!==0x20) return sum;
    assert.equal(after.effectPaletteMask[p],0);
    assert.deepEqual(after.rgb.subarray(p*3,p*3+3),before.rgb.subarray(p*3,p*3+3));
    return sum+1;
  },0);
  assert(protectedPixels>10);
});

test('a matched review detects the shared shadow swatch and verifies authored separation',()=>{
  const {report,image}=ink.reviewShadowReadability(scene(),{width:80,height:64,view:{px:1},columns:2,plan:{
    subjects:[{id:'Coat',select:{material:'coat'}},{id:'Iron',select:{material:'iron'}}],
    states:[{id:'Shared',look:{effectPalettes:false}},{id:'Separated'}]
  }});
  assert(image.rgb instanceof Uint8Array);
  const [baseline,authored]=report.samples.map(frame=>frame.contacts[0]);
  assert(baseline.samples>10);
  assert.equal(baseline.samples,authored.samples);
  assert(baseline.sameSwatchShare>.9);
  assert.equal(authored.sameSwatch,0);
  assert.deepEqual(authored.flags,[]);
  assert.deepEqual(report.samples[0].camera,report.samples[1].camera);
});
