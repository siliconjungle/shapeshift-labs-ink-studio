const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT:K, EffectPalettes, makeBuilder, makeSculpt } = ink.load();
const demo = require('../examples/palette-composition.js')(ink.load());

const packed = (rgb,p) => (rgb[p*3]<<16)|(rgb[p*3+1]<<8)|rgb[p*3+2];
const center = (frame,x,y) => y*frame.w+x;
const paletteAt = (frame,p) => frame.passes.paletteOwners[frame.passes.paletteOwner[p]];
const options = {w:120,h:70,px:1,ortho:true,passes:['paletteOwner','materialId']};

function panels(coverageAware) {
  const palette = [0x101820,0x843f2f,0xd06a48,0x35495a,0x60778f,0x9dacb4,0xf6d078];
  const b = makeBuilder(7,palette), s = K.sculpt(makeSculpt(b));
  const tint = (name,r,policy) => K.surface.material({r:[r],materialId:name,em:true}, {paletteConstraint:policy});
  s.box([-1.02,0,0],[.80,.72,.10],tint('fabric',2,{palette:['cloth']}),{res:.078,rd:.048});
  s.box([1.02,0,0],[.80,.72,.10],tint('stone',3,{palette:['rock']}),{res:.078,rd:.048});
  s.box([-.88,.03,.14],[.128,.11,.028],tint('badge',6,{palette:['cloth'],reserved:['gold']}),{res:.025,rd:.015});
  s.bake();
  return b.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},dither:0,
    paletteRoles:{cloth:[1,2],rock:[3,4],mist:[4,5],gold:[6]},
    look:{coverageAware,splatCoverage:'continuous',effectPalettes:{
      fog:{colors:['mist.highlight'],combine:'material',threshold:.35}
    }},
    atmosphere:[K.atmosphere.fog({density:.62,far:4,color:'#9dacb4'})]});
}

test('named shared swatches preserve scene role ordering and validate at bind time', () => {
  const pal=[0x162436,0x52414b,0xa6a2a2], roles={mist:[1,2]};
  const config={fog:{colors:['mist'],combine:'material'}};
  assert.deepEqual(EffectPalettes.prepare(config,pal,roles).ramps.get('fog').packed,pal.slice(1));
  assert.throws(()=>EffectPalettes.prepare(config,pal),/Unknown or empty palette role/);
  assert.throws(()=>EffectPalettes.prepare({fog:{colors:['#112233'],combine:'replace'}},pal),/combine/);
});

test('native, coverage-aware and coverage-resolved frames report scoped fog palettes', () => {
  for (const frameOptions of [{coverageAware:false},{coverageAware:true},{coverageAware:false,colored:true}]) {
    const world=panels(frameOptions.coverageAware);
    const settings={...options,...frameOptions};
    const clear=ink.render(world,{...settings,atmosphere:false});
    const mist=ink.render(world,settings);
    for (const name of ['fabric','stone']) {
      const material=mist.passes.materials.indexOf(name), p=mist.passes.materialId.indexOf(material);
      assert(p>=0);
      assert.equal(paletteAt(clear,p).material,name);
      const governed=Array.from(mist.passes.materialId.keys()).filter(p=>mist.passes.materialId[p]===material &&
        paletteAt(mist,p)?.domain==='combined');
      assert(governed.length>50);
      const shared=governed.find(p=>paletteAt(mist,p).winner==='shared');
      assert(shared!==undefined);
      assert.equal(packed(mist.rgb,shared),0x9dacb4);
      assert.equal(paletteAt(mist,shared).effect,'fog');
      assert.deepEqual(paletteAt(mist,shared).sharedColors,[0x9dacb4]);
      assert(paletteAt(mist,shared).colors.includes(name==='stone' ? 0x35495a : 0x843f2f));
    }
    assert.equal(mist.use.reduce((a,b)=>a+b,0),mist.w*mist.h);
    assert.deepEqual(ink.render(world,{...settings,passes:false}).rgb,mist.rgb);
  }
});

test('exact reserved material colours survive a shared lighting rule', () => {
  const fake={
    w:1,h:1,rgb:Uint8Array.of(246,208,120),
    passes:{ materialId:Uint32Array.of(1),materials:[null,'badge'], coverage:Float32Array.of(1),depth:Float32Array.of(3) }
  };
  const palette=[0x843f2f,0xf6d078], { PixelLook }=ink.load();
  const policy=PixelLook.preparePalette({palette:[0],reserved:[1]},{palette});
  policy.scope='surface';
  const composition=require('../cli/palette-composition.js').capture(1,1,[policy.swatches],[policy],[],null,{diagnostic:true});
  composition.claim(0,1);
  const owner=composition.view(fake,fake.passes,{base:palette});
  const rules=EffectPalettes.prepare({fog:{colors:['#9dacb4'],combine:'material'}},palette);
  EffectPalettes.apply(fake,fake.passes,{rules,media:Float32Array.of(.9,0,.1)},Uint8Array.of(157,172,180),
    palette,true,undefined,owner);
  owner.finish();
  assert.equal(packed(fake.rgb,0),0xf6d078);
  assert.equal(paletteAt(fake,0).domain,'material');
  assert.equal(fake.effectPaletteMask[0],0);
});

test('bounce and shadow claims follow the scene lights and explicit palette stages still take precedence', () => {
  const world=demo.build(demo.seed);
  const settings={...options,ortho:false};
  const frame=ink.render(world,settings);
  const active=kind=>frame.passes.paletteOwners.some(row=>row?.effect===kind && row.domain==='combined');
  assert(active('bounce'));
  assert(active('shadow'));
  const unlit=ink.render(world,{...settings,liveSun:false});
  assert(!unlit.passes.paletteOwners.some(row=>row?.effect==='bounce'||row?.effect==='shadow'));

  world.look={...world.look,renderStages:[{ stage:'palette', select:{material:'fabric'}, palette:{palette:['#99483b']} }]};
  const staged=ink.render(world,settings);
  const material=staged.passes.materials.indexOf('fabric');
  const p=staged.passes.materialId.indexOf(material);
  assert(p>=0);
  assert.equal(paletteAt(staged,p).domain,'stage');
  assert.equal(packed(staged.rgb,p),0x99483b);
  assert.equal(staged.use.reduce((a,b)=>a+b,0),staged.w*staged.h);
});
