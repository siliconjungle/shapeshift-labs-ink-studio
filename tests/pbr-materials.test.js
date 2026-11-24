const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT, makeBuilder, SpriteSurface, bakeObjectTexels, editObjectTexels }, caster) {
  const B = makeBuilder(3, [0x111923, 0xc98044, 0x84949b, 0xf5d28a, 0x296565]);
  const quad = x => ({
    points:[x-.48,-.48,0,x+.48,-.48,0,x+.48,.48,0,x-.48,.48,0],
    triangles:[0,1,2,0,2,3]
  });
  const plate = quad(-2.15);
  const mesh = KIT.sceneMeshes.create({
    id:'plate', positions:plate.points, indices:plate.triangles, uvs:[0,1,1,1,1,0,0,0],
    materials:[{ id:'alloy', color:0xc98044 }]
  });
  const texels = bakeObjectTexels(quad(-1.05), {
    resolution:8, origin:[-1.05,0,-.3],
    material:()=>({pigment:0xc98044,roughness:.46,metalness:1}),
    fallback:()=>({pigment:0xc98044,roughness:.46,metalness:1})
  });
  const baked = KIT.sceneMeshes.fromObjectTexels(texels, { id:'texels', materialId:'texel' });
  const sign = SpriteSurface.make(8);
  sign.face([-.48,-.48,0],[.96,0,0],[0,.96,0],4,4,()=>0xc98044,
    { id:'sign', materialId:'alloy', projection:{mapping:'affine'} });
  let first = B.count();
  B.disc(1.05,0,0,[0,0,1],.39,.02,B.P[2],1);
  B.describeAlbedo(first,B.count(),'#c98044');
  B.describeSplats(first,B.count(),{ material:'alloy' });
  const movableStart = first;
  first = B.count();
  KIT.curveSplats.draw(B,[[1.74,0,0],[2.64,0,0]],{
    color:'#c98044', width:.62, edge:'hard', caps:'rounded'
  });
  B.describeSplats(first,B.count(),{ material:'alloy' });
  const movableEnd = B.count();
  const definition = {
    materials:{ alloy:{roughness:.46,metalness:1}, texel:{} },
    bindings:[{ select:{material:'alloy'}, material:'alloy' },{ select:{material:'texel'}, material:'texel' }],
    lights:[{ direction:[0,0,1], intensity:2.3 }],
    environment:{ intensity:.28 },
    projections:[{ material:'alloy', origin:[-2.7,.11,.18],u:[5.6,0,0],v:[0,.35,0],
      reach:.5,feather:0,channels:{baseColor:'#30acac',metalness:0,roughness:.8} }]
  };
  const blockerPoints=[-3,.27,.9,3,.27,.9,3,1.07,.9,-3,1.07,.9];
  const blocker = caster==='mesh' && KIT.sceneMeshes.create({
    id:'blocker',positions:blockerPoints,indices:[0,1,2,0,2,3],uvs:[0,1,1,1,1,0,0,0],
    materials:[{id:'blocker',color:0x162430}]
  });
  if(caster==='cutout'||caster==='shell')sign.face([-3,.27,.9],[6,0,0],[0,.8,0],8,2,(x)=>x===0?null:0x162430,
    {id:'cutout',castsShadow:true,...(caster==='shell'&&{shadowShell:.19})});
  if(caster==='curve'||caster==='transmitting')KIT.curveSplats.draw(B,[[-3,.63,.9],[3,.63,.9]],
    {width:.8,edge:'hard',color:'#162430',shadow:{cast:true,...(caster==='transmitting'&&{transmittance:.55})}});
  if(caster==='splat')B.disc(0,.63,.9,[0,0,1],3.4,.018,B.P[0],1);
  const world = B.finish({
    meshes:blocker?[mesh,baked,blocker]:[mesh,baked],spriteSurfaces:sign.finish(),radius:4,
    paletteRoles:{sea:[0,4,2,3]},
    look:{pbrMaterials:definition},cam:{target:[0,0,0],dist:5,fov:.72,yaw:0,pitch:0,ortho:true},
    fog:{start:1,max:0},dither:0
  });
  const edit = () => KIT.sceneMeshes.updateObjectTexels(baked, editObjectTexels(texels,
    texels.cells.filter(Boolean).map(({id}) => ({ id, metalness:0 }))));
  const moveBlocker = height => KIT.sceneMeshes.pose(blocker,blockerPoints.map((n,k)=>n+(k%3===1?height:0)));
  const moveReceivers = () => {
    const lift = .8;
    KIT.sceneMeshes.pose(mesh,plate.points.map((n,k)=>n+(k%3===1?lift:0)));
    world.rest=world.data;
    world.data=world.rest.slice();
    for(let i=movableStart;i<movableEnd;i++) world.data[i*16+1]+=lift;
  };
  return { world, definition, edit, moveBlocker, moveReceivers };
}
function shadowSettings(definition) {
  const material={roughness:.56,metalness:1,
    lightingRamp:{stops:[[0,'#264065'],[.2,'#579884'],[.68,'#c59456']],interpolation:'step'},
    highlight:{color:'#fff3ce',threshold:.01}
  };
  const pbrMaterials={...definition,materials:{alloy:material,texel:material},projections:[],
    environment:{intensity:0},lights:[{direction:[0,.7,1],intensity:2.3,shadows:true,mapSize:128,filter:0}]};
  const shadowArt={cast:{include:[{object:'blocker'}]}};
  const fill={direction:[0,-.15,1],intensity:.38,shadows:true,mapSize:128,filter:0};
  return {pbrMaterials,shadowArt,fill};
}
function rampFrames(definition) {
  const material = {
    ...definition.materials.alloy, wrap:.16,
    lightingRamp:{role:'sea',positions:[0,.26,.68,1],interpolation:'step',weights:[1,.92,.96,1]},
    highlight:{strength:.6,lightingRamp:{
      stops:[[0,'#154630'],[.27,'#56ba9a'],[1,'#d8ffcc']],interpolation:'smooth',
      weights:[0,.5,1]
    }}
  };
  const pbrMaterials = {...definition,materials:{
    alloy:material,texel:{...material,roughness:undefined,metalness:undefined}
  }};
  const surfaceLightRamps = {alloy:{diffuse:{stops:[[0,'#9b0939'],[1,'#ec475e']],interpolation:'linear'}}};
  const wide = {...pbrMaterials,materials:{...pbrMaterials.materials,alloy:{...material,
    lightingRamp:{stops:Array.from({length:256},(_,i)=>[i/255,[i/255,.35,1-i/255]])}
  }}};
  return { ramp:{pbrMaterials}, rampSide:{pbrMaterials,pbrLights:[{direction:[1,.5,.15],intensity:1}]},
    override:{pbrMaterials,surfaceLightRamps}, wide:{pbrMaterials:wide} };
}
function bandFrames(definition) {
  const material = {
    roughness:.48,metalness:1,
    lightingRamp:{stops:[[0,'#253742'],[.55,'#b97652'],[.85,'#f5cc8b']],interpolation:'step'},
    shadowBand:{strokes:[{points:[[-3,0,.15],[3,0,.15]],radius:.27,bias:.72,softness:.1}]}
  };
  const pbrMaterials = {...definition,materials:{alloy:material,texel:material},projections:[]};
  return { band:{pbrMaterials}, bandOff:{pbrMaterials,shadowBandPaint:false} };
}
const view = { w:144,h:80,px:1,raw:true,outline:false,edges:false };
const samples = { mesh:[26,40], texel:[50,40], decal:[72,40], gaussian:[94,40], strand:[119,40],
  projected:[72,34], background:[2,2] };
const light = [{ direction:[1,.5,.15], color:'#a8ceff', intensity:2.3 }];
const movedSamples = {mesh:[26,23],gaussian:[94,23],strand:[119,23]};
const inputs = { view, samples, light, movedSamples };

function read(frame, probes=samples) {
  return Object.fromEntries(Object.entries(probes).map(([name, [x,y]]) => {
    const at = (y * frame.w + x) * 3;
    return [name, Array.from(frame.rgb.subarray(at,at + 3))];
  }));
}

async function headless() {
  const { bakeObjectTexels, editObjectTexels } = await import('../webgl.mjs');
  const { world, definition, edit, moveReceivers } = fixture({ ...ink.load(), bakeObjectTexels, editObjectTexels });
  const render = (options,probes) => read(ink.render(world, { ...view, ...options }),probes);
  const lit = render(), sidelit = render({ pbrLights:light }), off = render({ pbrMaterials:false });
  const ramps = Object.fromEntries(Object.entries(rampFrames(definition)).map(([name,settings])=>[name,render(settings)]));
  const footprint = render({pbrSpecularSampling:true});
  const bands = bandFrames(definition), band = render(bands.band), bandOff = render(bands.bandOff);
  edit();
  const edited=render();
  moveReceivers();
  return { lit,sidelit,off,...ramps,footprint,edited,band,bandOff,
    bandMoved:render(bands.band,movedSamples),bandMovedOff:render(bands.bandOff,movedSamples) };
}

test('shared materials relight five carriers and preserve named projections on the art grid',async () => {
  const { lit,sidelit,off,edited,ramp,rampSide,override,wide,band,bandOff,bandMoved,bandMovedOff } = await headless();
  for (const name of ['mesh','texel','decal','gaussian','strand']) {
    assert.notDeepEqual(lit[name],lit.background,name);
    assert(lit[name][0] >= sidelit[name][0] + 24,JSON.stringify({name,lit,sidelit}));
    assert.notDeepEqual(sidelit[name],off[name],name);
    assert.notDeepEqual(ramp[name],rampSide[name],name);
    assert.notDeepEqual(band[name],bandOff[name],name);
  }
  assert.deepEqual(lit.background,off.background);
  assert.deepEqual(band.background,bandOff.background);
  for(const name of Object.keys(movedSamples)) {
    assert.deepEqual(bandMoved[name],band[name],name);
    assert.notDeepEqual(bandMoved[name],bandMovedOff[name],name);
  }
  assert(lit.gaussian[0] > lit.gaussian[2] + 25);
  assert(off.gaussian[0] < off.gaussian[2]);
  assert(lit.projected[1] > lit.projected[0] + 30, JSON.stringify(lit));
  assert.notDeepEqual(edited.texel,lit.texel);
  assert.deepEqual(edited.mesh,lit.mesh);
  assert.deepEqual(override.texel,ramp.texel);
  assert.notDeepEqual(override.mesh,ramp.mesh);
  assert.notDeepEqual(wide.mesh,ramp.mesh);
});

test('native WebGL matches headless material, projection and live texel edits', {skip:!process.env.INK_TEST_CHROME}, async () => {
  const expected = await headless();
  const actual = runWebGL({},fixture,(kit,build,backend,{view,samples,light,rampSource,bandSource,movedSamples}) => {
    const {world,definition,edit,moveReceivers}=build(kit), painter = backend(view.w,view.h,view);
    try {
      const sample = (options,probes=samples) => {
        painter.draw(world,{...options,changedRows:[]});
        return painter.sample(probes);
      };
      const lit = sample(), sidelit = sample({pbrLights:light}), off = sample({pbrMaterials:false});
      const ramps = Object.fromEntries(Object.entries(new Function('return ('+rampSource+')')()(definition))
        .map(([name,settings])=>[name,sample(settings)]));
      const footprint = sample({pbrSpecularSampling:true});
      const bands=new Function('return ('+bandSource+')')()(definition);
      const band=sample(bands.band), bandOff=sample(bands.bandOff);
      edit();
      const edited=sample();
      moveReceivers();
      return {lit,sidelit,off,...ramps,footprint,edited,band,bandOff,
        bandMoved:sample(bands.band,movedSamples),bandMovedOff:sample(bands.bandOff,movedSamples)};
    } finally { painter.close(); }
  },{...inputs,rampSource:rampFrames.toString(),bandSource:bandFrames.toString()});
  for (const [mode, colors] of Object.entries(expected)) {
    for (const [name, rgb] of Object.entries(colors)) {
      assert(rgb.every((n,k) => Math.abs(actual[mode][name][k]-n) <= 4),
        JSON.stringify({mode,name,expected:rgb,actual:actual[mode][name]}));
    }
  }
});

test('the copper wire sweep reduces the area affected by split highlights on the art grid', () => {
  const {sweep} = require('../examples/pbr-materials/specular-sweep.cjs');
  const [center,coverage] = sweep();
  assert(coverage.clusterPixels < center.clusterPixels / 2);
  assert(coverage.splits <= center.splits);
  assert.equal(coverage.flicker,0);
});

test('PBR lighting ramps reuse strict surface ramp validation', () => {
  const pbr = ink.load().KIT.pbr;
  const definition = rampFrames({materials:{alloy:{}}}).ramp.pbrMaterials;
  const options = {palette:[0x15262f,0x3b6a68,0x72a99b,0xc6e4cf,0x24454e],paletteRoles:{sea:[0,4,2,3]}};
  assert.throws(()=>pbr.prepare(definition),/palette role/);
  assert.equal(pbr.prepare(definition,[],options).materials[0].diffuseRamp.interpolation,'step');
  definition.materials.alloy.paletteRoles = {cool:'sea'};
  definition.materials.alloy.lightingRamp = {...definition.materials.alloy.lightingRamp,role:'cool'};
  assert.deepEqual(pbr.prepare(definition,[],options).materials[0].diffuseRamp.tint(1),
    [0xc6,0xe4,0xcf].map(n=>n/255));
  definition.materials.alloy.highlight.lightingRamp.weights = [.1,.5,1];
  assert.throws(()=>pbr.prepare(definition,[],options),/zero weight to an inactive highlight/);
});

test('per-light shadows follow posed blockers, use shadow swatches and leave the fill intact in both renderers',
  {skip:!process.env.INK_TEST_CHROME},async ()=>{
    const api=await import('../webgl.mjs');
    const kit={...ink.load(),...api}, {world,definition,moveBlocker}=fixture(kit,'mesh');
    const {pbrMaterials,shadowArt,fill}=shadowSettings(definition);
    const frame={pbrMaterials,shadowArt};
    const render=options=>read(ink.render(world,{...view,...frame,...options}));
    const blocked=render();
    const bypass=render({pbrShadows:false});
    const mask=render({shadowArt:{...shadowArt,receive:{exclude:[{object:'plate'}]}}});
    const filled=render({pbrLights:[...pbrMaterials.lights,fill]});
    const fillOnly=render({pbrLights:[fill]});
    moveBlocker(1.2);
    const moved=render();
    const strandBlocker=fixture(kit,'transmitting').world;
    const strandLook={...pbrMaterials,materials:Object.fromEntries(Object.entries(pbrMaterials.materials)
      .map(([id,finish])=>[id,{...finish,highlight:false}]))};
    const transmitting=read(ink.render(strandBlocker,{...view,pbrMaterials:strandLook}));
    assert.deepEqual(transmitting.mesh,[0x57,0x98,0x84]);
    for(const name of ['mesh','texel','decal','gaussian','strand']){
      assert([0x26,0x40,0x65].every((n,k)=>Math.abs(blocked[name][k]-n)<=2),name);
      assert.deepEqual(filled[name],fillOnly[name],name);
      assert.deepEqual(moved[name],bypass[name],name);
      assert.notDeepEqual(blocked[name],bypass[name],name);
    }
    assert.deepEqual(mask.mesh,bypass.mesh);
    assert.deepEqual(mask.texel,blocked.texel);
    const actual=runWebGL({},fixture,(kit,build,backend,{view,samples,shadowSource})=>{
      const {world,definition,moveBlocker}=build(kit,'mesh');
      const {pbrMaterials,shadowArt,fill}=new Function('return ('+shadowSource+')')()(definition);
      const painter=backend(view.w,view.h,view);
      try{
        function render(options){
          painter.draw(world,{pbrMaterials,shadowArt,changedRows:[],...options});
          return painter.sample(samples);
        }
        const blocked=render(),bypass=render({pbrShadows:false});
        const mask=render({shadowArt:{...shadowArt,receive:{exclude:[{object:'plate'}]}}});
        const filled=render({pbrLights:[...pbrMaterials.lights,fill]}),fillOnly=render({pbrLights:[fill]});
        moveBlocker(1.2);
        const moved=render(),strandBlocker=build(kit,'transmitting').world;
        const strandLook={...pbrMaterials,materials:Object.fromEntries(Object.entries(pbrMaterials.materials)
          .map(([id,finish])=>[id,{...finish,highlight:false}]))};
        painter.draw(strandBlocker,{pbrMaterials:strandLook});
        return {blocked,bypass,mask,filled,fillOnly,moved,transmitting:painter.sample(samples)};
      }finally{painter.close();}
    },{view,samples,shadowSource:shadowSettings.toString()});
    for(const [stage,colors] of Object.entries({blocked,bypass,mask,filled,fillOnly,moved})){
      for(const name of ['mesh','texel','decal','gaussian','strand']){
        const expected=colors[name], seen=actual[stage][name];
        assert(expected.every((n,k)=>Math.abs(seen[k]-n)<=4),JSON.stringify({stage,name,expected,seen}));
      }
    }
    assert.deepEqual(actual.transmitting.mesh,transmitting.mesh);
});

test('painted cutouts, shadow shells, opaque splats and finite curves cast on PBR materials',async ()=>{
  const kit={...ink.load(),...await import('../webgl.mjs')};
  for(const caster of ['cutout','shell','curve','splat']){
    const {world,definition}=fixture(kit,caster);
    const {pbrMaterials}=shadowSettings(definition);
    const painted=read(ink.render(world,{...view,pbrMaterials}));
    const clear=read(ink.render(world,{...view,pbrMaterials,pbrShadows:false}));
    assert.notDeepEqual(painted.mesh,clear.mesh,caster);
  }
});

test('portable bindings validate and a swatch is driven by the highlight response', () => {
  const K = ink.load().KIT, pbr = K.pbr;
  const definition = {
    materials:{ cobalt:{baseColor:'#263247',roughness:.35,
      highlight:{color:'#60d7ce',threshold:.1}} },
    default:'cobalt', environment:{intensity:0},
    lights:[{direction:[0,0,1],intensity:2}]
  };
  const plan = pbr.prepare(definition);
  const sample = { color:[1,1,1], normal:[0,0,1], view:[0,0,1], position:[0,0,0] };
  const lit = pbr.shade(plan,plan.resolve(),sample);
  const footprintPlan = pbr.prepare({...definition,specularSampling:true,materials:{
    cobalt:{...definition.materials.cobalt,lightingRamp:{stops:[[0,'#000000'],[1,'#000000']]}}
  }});
  const tap = {...sample,coverage:1};
  const shade = highlightSamples => pbr.shade(footprintPlan,footprintPlan.resolve(),{...sample,highlightSamples});
  const full = shade([tap,tap,tap,tap]);
  const partial = shade([tap,null,null,null]);
  const missed = shade([null,null,null,null]);
  assert.deepEqual(full,lit);
  assert(partial.every((channel,i)=>channel>missed[i] && channel<full[i]));
  assert.equal(pbr.prepare({...definition,specularSampling:true},[],{specularSampling:false}).specularSampling,false);
  assert.throws(()=>pbr.prepare({...definition,specularSampling:'on'}),/specularSampling needs a boolean/);
  assert.deepEqual(lit.map(n=>Math.round(n*255)),[96,215,206]);
  const sideways = pbr.prepare(definition,[{direction:[1,0,0]}]);
  assert.deepEqual(pbr.shade(sideways,sideways.resolve(),sample),[0,0,0]);
  assert.throws(()=>pbr.prepare({...definition,default:'unknown'}),/Unknown PBR material/);
  const scene = { id:'portable-material',solids:[],finish:{look:{ pbrMaterials:definition }} };
  assert.deepEqual(K.diorama.build(scene).look.pbrMaterials,definition);
  scene.finish.look.pbrMaterials = {...definition,default:'unknown'};
  assert(K.diorama.check(scene).some(issue=>issue.path==='finish.look.pbrMaterials' && issue.level==='error'));
});

test('PBR band strokes move diffuse thresholds, preserve full occlusion and survive editor history', () => {
  const pbr = ink.load().KIT.pbr;
  const lightingRamp = {stops:[[0,'#253742'],[.55,'#b97652'],[.85,'#f5cc8b']],interpolation:'step'};
  const pbrMaterials = {materials:{alloy:{lightingRamp}},default:'alloy',
    lights:[{direction:[.8,0,.6]}],environment:{intensity:0}};
  const scene = {id:'band-test',solids:[],finish:{look:{pbrMaterials}}};
  const editor = ink.createSceneEditor(scene), target = {pbrMaterial:'alloy'};
  const positive = {points:[[-1,0,0]],radius:.5,bias:.3,softness:0};
  const negative = {points:[[1,0,0]],radius:.5,bias:-.3,softness:0};
  assert.throws(()=>editor.paintShadowBand(positive,{pbrMaterial:'missing'}),/Unknown PBR material/);
  assert.equal(editor.paintShadowBand(positive,target),true);
  assert.equal(editor.paintShadowBand(negative,target),true);
  const recipe = () => JSON.parse(editor.serialize()).finish.look.pbrMaterials;
  assert.deepEqual(recipe().materials.alloy.shadowBand.strokes,[positive,negative]);
  editor.undo();
  assert.deepEqual(recipe().materials.alloy.shadowBand.strokes,[positive]);
  editor.redo();
  assert.deepEqual(recipe().materials.alloy.shadowBand.strokes,[positive,negative]);
  const band = recipe().materials.alloy.shadowBand;
  assert.throws(()=>pbr.prepare({materials:{alloy:{shadowBand:band}}}),/diffuse lighting ramp/);
  const plan = pbr.prepare(recipe()), bypass = pbr.prepare(recipe(),[],{paintShadowBands:false});
  assert.equal(bypass.hasBands,false);
  const swatch = (x,visibility=1) => {
    plan.shadows={visibility:()=>visibility};
    return pbr.shade(plan,plan.resolve(),{
      color:[1,1,1],normal:[0,0,1],view:[0,0,1],position:[4,0,0],restPosition:[x,0,0]
    }).map(n=>Math.round(n*255));
  };
  assert.deepEqual(swatch(-1),[37,55,66]);
  assert.deepEqual(swatch(0),[185,118,82]);
  assert.deepEqual(swatch(1),[245,204,139]);
  assert.deepEqual(swatch(1,0),swatch(-1));
});
