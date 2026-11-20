const assert = require('node:assert/strict');
const { test } = require('node:test');
const studio = require('..');
const { KIT: K, PixelLook, SurfaceLook, RenderStages, makeBuilder, makeSculpt } = studio.load();

const sample = { position: [0,0,.06], worldPosition: [0,0,.06], normal: [0,0,1], view: [0,0,1] };
const pal = [0x151a22, 0x242832, 0x365d7c, 0x73cad4, 0xf7edb8, 0x442332, 0xb8463c, 0xffa468, 0xffe6ac];
const named = { steel: [1,2,3,4], ember: [5,6,7,8], shadow: [0] };
const aliases = role => Object.fromEntries(['shadow','body','rim','emission'].map((name, i) => [name, role + '.' + i]));
const unpack = packed => [packed >> 16, packed >> 8 & 255, packed & 255].map(channel => channel / 255);
const packed = color => color.reduce((value, n) => value * 256 + Math.round(n * 255), 0);

test('one finish can resolve local aliases, scene roles and a named ramp stop', () => {
  const layer = { type:'tint', color:'body' };
  const compiled = role => SurfaceLook.prepare({ paletteRoles:aliases(role), layers:{ surface:layer } }, pal,
    undefined, undefined, { paletteRoles:named });
  for (const [role, expected] of [['steel', pal[2]], ['ember', pal[6]]]) {
    const finish = compiled(role);
    assert.equal(packed(SurfaceLook.shade(finish, sample, [0,0,0]).slice(0,3)), expected);
  }
  const finish = SurfaceLook.prepare({
    paletteRoles: { coating:'ember', body:'steel.1' },
    signals:{ light:{ type:'time', range:[0,1] } },
    layers:{
      dye:{ type:'tint', color:'coating.shadow', drive:{ color:{ signal:'light',to:'coating.highlight' } } },
      sheen:{ type:'sheen', color:'body', lightingRamp:{ stops:[[0,'shadow'],[1,'coating.highlight']] } }
    }
  }, pal, undefined, undefined, { paletteRoles:named });
  assert.deepEqual(finish.layers[0].color, unpack(pal[5]));
  assert.deepEqual(finish.layers[0].drive[0].to, unpack(pal[8]));
  assert.deepEqual(finish.layers[1].color, unpack(pal[2]));
  assert.deepEqual(named.shadow, [0]);
  assert.throws(() => compiled('missing'), /Unknown or empty palette role/);
  assert.throws(() => SurfaceLook.prepare({ layers:{ surface:{ ...layer, color:'steel' } } }, pal,
    undefined, undefined, { paletteRoles:named }), /specific stop/);
  assert.throws(() => PixelLook.bindRoles(pal,named,{ a: 'steel.99' }), /Unknown palette ramp stop/);
});

test('indexed surface art renders the same slots through different recipe roles', () => {
  const builder = makeBuilder(42, pal);
  const s = K.sculpt(makeSculpt(builder));
  const raster = { width:4,height:4,slots:[0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3],
    size:[1,1],palette:['shadow','body','rim','emission'] };
  for (const [x,role] of [[-.8,'steel'],[.8,'ember']]) {
    const material = K.surface.material({ r:[0], em:true, materialId:role }, {
      paletteRoles:aliases(role),
      layers:{ emblem:{ type:'projected',pattern:'indexed',raster,
        projection:{ origin:[x-.5,-.5,.13], along:[1,0,0], across:[0,1,0] } } }
    });
    s.box([x,0,0],[.5,.5,.125],material,{res:.05});
  }
  s.bake();
  const world = builder.finish({ look:{splatCoverage:'continuous'},paletteRoles:named,
    cam:{ target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0 },dither:0 });
  for (const raw of [false,true]) {
    const frame=studio.render(world,{ w:104,h:70,px:1,ortho:true,raw,passes:['materialId'] });
    for (const role of ['steel','ember']) {
      const id=frame.passes.materials.indexOf(role), found=new Set();
      frame.passes.materialId.forEach((material,pixel)=>{
        if (id===material) {
          const [r,g,b]=frame.rgb.subarray(pixel*3,pixel*3+3);
          found.add(r*65536+g*256+b);
        }
      });
      assert(named[role].map(index=>pal[index]).every(color=>found.has(color)));
    }
  }
});

test('scoped stages and palette policies can use the material aliases', () => {
  const b=makeBuilder(1,pal), s=makeSculpt(b);
  const row=K.surface.material({ r:[0], em:true, materialId:'test' }, {
    paletteRoles:aliases('ember'),
    paletteConstraint:{ palette:['rim'], reserved:['emission'] },
    renderStages:[{ stage:'palette', palette:{ palette:['body'],reserved:['emission'] } }]
  });
  s.box([0,0,0],[.6,.6,.1],row,{res:.07});
  s.bake();
  const world=b.finish({ paletteRoles:named, cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0} });
  const pixel = (options = {}) => studio.render(world,{w:64,h:64,px:1,ortho:true,...options}).rgb.slice((32*64+32)*3,(32*64+32)*3+3);
  assert.deepEqual([...pixel()],[0xb8,0x46,0x3c]);
  assert.deepEqual([...pixel({renderStages:false})],[0xff,0xa4,0x68]);
  const stage=RenderStages.prepare([{stage:'lit',stack:{ name:'Role curve', steps:[{type:'curves',
    curves:{ramp:{stops:[[0,'steel.1'],[1,'steel.1']]}}}] } }],{ palette:pal,roles:named })[0];
  assert.equal(packed(RenderStages.apply([stage],[.23,.27,.31])),pal[2]);
});

test('indexed remaps accept named destination stops and preserve protected source entries', () => {
  const remap = { rules:[{ from:'steel', to:'ember.highlight' }], protect:['steel.0'] };
  const graded = PixelLook.gradePalette(PixelLook.prepareRemap(remap,pal,named).grade());
  assert.equal(graded[1], pal[1]);
  assert.deepEqual(graded.slice(2,5), [pal[8],pal[8],pal[8]]);
  assert.throws(() => PixelLook.prepareRemap({ rules:[{ from:0,to:'ember' }] },pal,named),/specific stop/);
  assert.doesNotThrow(() => PixelLook.prepareRemap(remap,[],{},undefined,{deferTargets:true}));
  const dependencies=K.world.lookReport.standalone({stack:{name:'Role swap',steps:[{type:'paletteRemap',
    remap}]}},undefined,'headless').dependencies;
  assert(dependencies.some(dep=>dep.type==='swatch' && dep.id==='ember.highlight'));
});
