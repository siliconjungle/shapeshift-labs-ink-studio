const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const root = path.resolve(__dirname,'..');
const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
  { cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'] });
const translation = (x,y,z)=>[1,0,0,x,0,1,0,y,0,0,1,z];

function setup(t,scene,object,part,grid,selection,registration,views) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-part-map-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name), save = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  if (typeof scene === 'function') scene = scene(file,dir);
  const [width,height] = grid;
  const binding = { id:'part',scene,object,part,frame:'draw',...(registration && {mapping:registration}) };
  const design = { format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],
    palette:{ copper:'#ba6a53' },layers:[{id:'ink'}],frames:[{id:'draw',durationMs:100,cels:{}}],
    selections:[{id:'mark',frame:'draw',pixels:selection}],sceneBindings:[binding] };
  save('design.json',design);
  save('views.json',{version:1,samples:views});
  const track = (...extra)=>JSON.parse(cli('track',file('design.json'),'--binding','part','--selection','mark','--views',file('views.json'),...extra));
  return { binding,design,track,save,file };
}

function switchingScene(file) {
  fs.writeFileSync(file('scene.js'),`
const {spriteAtlas} = require(${JSON.stringify(path.join(root,'cli/sprite-atlas.js'))});
module.exports = ({KIT:K, makeBuilder, makeSculpt}) => ({id:'registered-part',name:'Registered part',build() {
  const B = makeBuilder(6,[0x142332,0x7cc4be,0xd48760,0xe2b88e]);
  const S = makeSculpt(B);
  S.keepRenderSdf = true;
  S.box([0,0,0],[.8,.6,.18],{r:[1,2,3]},{res:.105,objectId:'beacon',target:{part:'panel'}});
  S.bake();
  const cam = { target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0,ortho:true };
  const panel = (id,object,part,z,half) => K.sceneMeshes.create({id,objectId:object,partId:part,
    positions:[-half,.6,z, half,.6,z,-half,-.6,z,half,-.6,z],uvs:[0,0,1,0,0,1,1,1],
    indices:[0,1,2,2,1,3],materials:[{id:'enamel',color:0xd48760}]});
  const mesh = panel('front-panel','beacon','panel',.18,.80), cover = panel('cover','housing','lid',.9,.65);
  const cardWorld = makeBuilder(8,[0x142332]).finish({cam,meshes:[mesh],radius:4});
  const baked = spriteAtlas(cardWorld,{pivot:[0,0,0],width:64,height:48,directions:1,maps:['depth'],view:{raw:true}});
  const placement = {at:[0,0,0],mode:'card',lighting:false,objectId:'beacon',partId:'panel'};
  const makeCard=atlas=>K.sprite.placeAtlas({...placement,atlas});
  const cards = [makeCard(baked),makeCard({...baked,images:{color:baked.images.color}})];
  const world = B.finish({cam,radius:4,meshes:[mesh],dither:0,look:{splatCoverage:'continuous'}});
  const rest = world.data.slice();
  K.stage(world).add({pre(_dt,t) {
    const beat = Math.round(t);
    world.meshes = beat === 0 ? [mesh] : beat === 4 ? [cover] : [];
    world.spriteAtlases = beat >= 3 ? [cards[Number(beat === 5)]] : [];
    world.look.sdfAssist = beat === 1;
    for (let q=3; q<world.count*16; q+=16) world.data[q] = beat === 1 || beat === 2 ? rest[q] : 0;
  }});
  return world;
}});
`);
  return file('scene.js');
}

test('one authored point maps to traced SDF, splat, and a baked card with coverage and depth evidence',t=>{
  const mapping = { version:1,id:'panel-space',tolerance:.15,sources:{mesh:true,sdf:true,splat:true,sprite:true} };
  const views = ['mesh','sdf','splats','card','covered','color-only','mesh-again']
    .map((id,i)=>({id,time:i === 6 ? 0 : i,...(i === 6 && {cut:true})}));
  const { track,file } = setup(t,switchingScene,'beacon','panel',[64,48],[[32,24]],mapping,views);
  const report = track('--review',file('review.html'));
  const [mesh,sdf,splats,card,covered,colorOnly,back] = report.samples;
  assert.equal(mesh.counts.visible,1);
  for (const [row,kind] of [[sdf,'sdf'],[splats,'splat'],[card,'sprite']]) {
    assert.deepEqual(row.mappings,[{ from:'mesh',to:kind,visible:1,occluded:0 }],JSON.stringify(row));
    assert.ok(row.examples[0].mapping.distance <= mapping.tolerance);
  }
  assert.equal(covered.counts.occluded,1);
  assert.equal(covered.examples[0].blocker.object,'housing');
  assert.equal(colorOnly.reasons['no-registered-correspondence'],1);
  assert.deepEqual(back.runs.visible,mesh.runs.visible);
  assert.match(fs.readFileSync(file('review.html'),'utf8'),/Mapped from/);
});

test('the existing part LOD binding reuses a baked depth card on camera pullback and resolves it from a saved view',t=>{
  const mapping = { version:1,id:'shell-space',tolerance:.18,sources:{mesh:true,sprite:translation(0,1.43,0)} };
  const scene = 'examples/part-representations.js';
  const views = [{id:'native',time:0},{id:'mix',time:2},{id:'distant',time:3.2},{id:'near',time:0,cut:true}];
  const { track,file,save,design,binding } = setup(t,scene,'brine-lantern','shell',[140,100],
    [[69,48],[70,49]],mapping,views);
  const [native,,distant,back] = track().samples;
  assert.equal(native.counts.visible,2);
  assert.deepEqual(distant.mappings,[{ from:'mesh',to:'sprite',visible:2,occluded:0 }]);
  assert.deepEqual(back.runs.visible,native.runs.visible);
  const [x,y] = distant.examples[0].at;
  cli('capture',scene,'--w','140','--h','100','--t','3.2','--out',file('camera.json'));
  const captured = ink.unpackPixelSourceView(JSON.parse(fs.readFileSync(file('camera.json'))));
  assert.equal(captured.passes.surfaceKind[y*140+x],4);
  const report = JSON.parse(cli('inspect',file('design.json'),'--binding','part','--at',x+','+y,'--source-view',file('camera.json')));
  assert.equal(report.scene.bindings[0].status,'resolved');
  assert.equal(report.scene.bindings[0].mapping.id,'shell-space');
  assert.deepEqual(report.scene.bindings[0].mapping.points,[{
    kind:'sprite',point:distant.examples[0].mapping.point
  }]);

  design.selections[0].pixels = [[x,y]];
  save('design.json',design);
  save('views.json',{version:1,samples:[{id:'sprite',time:3.2},{id:'near',time:0,cut:true}]});
  assert.deepEqual(track().samples[1].mappings,[{ from:'sprite',to:'mesh',visible:1,occluded:0 }]);

  binding.mapping.sources.sprite = translation(20,1.43,0);
  save('design.json',design);
  assert.equal(track().samples[1].reasons['no-registered-correspondence'],1);
  delete binding.mapping;
  save('design.json',design);
  assert.equal(track().samples[0].reasons['reference-address-unavailable'],1);
});

test('pixel documents reject unscoped or singular representation registrations',t=>{
  const mapping = { version:1,id:'panel-space',tolerance:.1,sources:{mesh:true,splat:true} };
  const { binding,design,save,file } = setup(t,'examples/part-representations.js','brine-lantern','shell',[1,1],[],mapping,[]);
  assert.doesNotThrow(()=>cli('validate',file('design.json')));
  delete binding.part;
  save('design.json',design);
  assert.throws(()=>cli('validate',file('design.json')),/needs a part/);
  binding.part = 'shell';
  binding.mapping.sources.mesh = Array(12).fill(0);
  save('design.json',design);
  assert.throws(()=>cli('validate',file('design.json')),/valid version 1 registration/);
});
