'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

function buildCases(texels=2) {
  const pixels=Array.from({length:texels},(_,i)=>i%2 ? [0,0,224,255] : [224,0,0,128]).flat();
  const scene={id:'tiled-signal',style:'slate',solids:[],
    camera:{yaw:0,pitch:0,dist:4,target:[0,0,0],projection:'orthographic',sway:0},
    tilesets:{
      enamel:{version:1,width:texels,height:1,encoding:'rgba8',data:Buffer.from(pixels).toString('base64')},
      backing:ink.createBlankTileset({width:1,height:1,background:'#306438'})
    }};
  const editor=ink.createSceneEditor(scene);
  for (const [object,sheet,z,width] of [['signal','enamel',0,texels],['backing','backing',-.25,1]]) {
    editor.placeTilesetFace({object,face:'main',origin:[-1,-1,z],worldSize:[object==='signal' ? 2 : 1,2],
      selection:ink.pickTilesetRectangle(scene,sheet,{x:0,y:0,width,height:1})});
  }
  return editor.snapshot();
}

const original=buildCases();
const settings={lighting:'unlit',alphaMode:'blend',sidedness:'front',minFilter:'linear',magFilter:'nearest',emissiveGain:0};
const request=(settings)=>({type:'material',id:'enamel',settings});
const view={w:96,h:72,px:1,raw:true};
const point=(frame,x,y)=>Array.from(frame.rgb.slice(3*(frame.w*y+x),3*(frame.w*y+x)+3));
const edited=(settings,scene=original)=> {
  const editor=ink.createSceneEditor(scene);
  editor.editTilesetRevision(request(settings));
  return editor.snapshot();
};

test('sheet settings update all dependent faces, undo, and survive clone, extract and image replacement',()=>{
  const source=structuredClone(original);
  const panel=source.topologyMeshes.signal;
  source.prefabs={badge:{revision:1,solids:{},topologyMeshes:{panel},usesTilesets:['enamel']}};
  source.instances={copy:{prefab:'badge',transform:{translation:[3,0,0]}}};
  const editor=ink.createSceneEditor(source), preview=editor.planTilesetRevision(request(settings));
  assert(preview.canCommit);
  assert.deepEqual(preview.before[0].faces.map(({object,face})=>[object,face]),[['copy.panel','main'],['signal','main']]);
  assert.notEqual(preview.before[0].revision,preview.after[0].revision);
  assert.deepEqual(editor.editTilesetRevision(request(settings)),preview);
  const revised=editor.snapshot();
  assert.equal(revised.tilesets.enamel.data,source.tilesets.enamel.data);
  assert.deepEqual(revised.topologyMeshes,source.topologyMeshes);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),source);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),revised);
  editor.editTilesetRevision({type:'clone',id:'enamel',newId:'cloned'});
  editor.extractTileset('enamel','extracted',{x:0,y:0,width:1,height:1});
  editor.editTilesetRevision({type:'replace',id:'cloned',asset:source.tilesets.enamel});
  for (const id of ['cloned','extracted']) assert.deepEqual(editor.snapshot().tilesets[id].material,revised.tilesets.enamel.material);
  editor.editTilesetRevision({type:'combine',ids:['enamel','cloned'],newId:'matching'});
  assert.deepEqual(editor.snapshot().tilesets.matching.material,revised.tilesets.enamel.material);
  editor.editTilesetRevision(request(null));
  assert.equal(editor.snapshot().tilesets.enamel.material,undefined);
  const join=editor.planTilesetRevision({type:'combine',ids:['enamel','cloned'],newId:'joined'});
  assert.deepEqual(join.omittedMaterials,['cloned']);
  assert.equal(editor.planTilesetRevision({type:'deduplicate',id:'cloned',keepId:'enamel'}).canCommit,false);
  assert.throws(()=>editor.planTilesetRevision(request({minFilter:'cubic'})),/filter settings/);
});

test('headless tileset materials control color, alpha, face winding and the two filter scales',()=>{
  const draw=(material,overrides={})=>ink.render(ink.createSceneEditor(edited(material)).build(),{...view,...overrides});
  const modes=Object.fromEntries(['opaque','mask','blend'].map(alphaMode=>[alphaMode,draw({...settings,alphaMode,alphaCutoff:.7})]));
  assert.deepEqual(point(modes.opaque,37,38),[224,0,0]);
  assert.deepEqual(point(modes.mask,37,38),[48,100,56]);
  const blended=point(modes.blend,37,38);
  assert(blended.every((n,i)=>Math.abs(n-[136,50,28][i])<=1),JSON.stringify(blended));
  for (const x of [37,42,52,58]) assert.deepEqual(point(modes.opaque,x,38),point(draw({...settings,alphaMode:'opaque',minFilter:'nearest'}),x,38));
  const linear=draw({...settings,alphaMode:'opaque',magFilter:'linear'});
  assert(point(linear,45,38)[2]>0);
  const dense=buildCases(32);
  const minified=(minFilter,magFilter)=>ink.render(ink.createSceneEditor(
    edited({...settings,alphaMode:'opaque',minFilter,magFilter},dense)).build(),{...view,w:15,h:15});
  const nearest=minified('nearest','linear'), minLinear=minified('linear','nearest');
  assert(!Buffer.from(nearest.rgb).equals(minLinear.rgb));
  assert(Buffer.from(nearest.rgb).equals(minified('nearest','nearest').rgb));
  assert(Buffer.from(minLinear.rgb).equals(minified('linear','linear').rgb));
  const back={camera:{yaw:180}};
  assert.deepEqual(point(draw(settings,back),37,38),[7,8,11]);
  assert.deepEqual(point(draw({...settings,sidedness:'double'},back),37,38),[0,0,224]);
  const dark=draw({...settings,lighting:'lit',alphaMode:'opaque'},{liveSun:{direction:[0,0,-1],ambient:.2,intensity:.8}});
  assert(point(dark,37,38)[0]<190);
  const luminous=draw({...settings,alphaMode:'opaque',emissiveGain:1},{passes:['emission']});
  assert(point(luminous,37,38)[0]>224);
  assert(luminous.passes.emission.some(n=>n>0));
});

test('CLI exports a reusable preset and refuses a stale preview',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-material-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  save('station.json',original);
  save('settings.json',settings);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const args=['tileset','material'];
  const run=(action,params)=>JSON.parse(execFileSync(process.execPath,[cli,...args,action,...params],
    {cwd:dir,encoding:'utf8'}));
  const set=['settings.json','--scene','station.json','--id','enamel'];
  const review=run('set',set);
  assert(review.canCommit);
  save('review.json',review);
  run('set',[...set,'--expect','review.json','--out','revised.json']);
  assert.equal(run('inspect',['--scene','revised.json','--id','enamel']).source,'sheet');
  run('export',['--scene','revised.json','--id','enamel','--out','preset.json']);
  run('set',['preset.json','--scene','revised.json','--id','backing','--out','reused.json']);
  const revised=JSON.parse(fs.readFileSync(path.join(dir,'reused.json')));
  assert.deepEqual(revised.tilesets.enamel.material,revised.tilesets.backing.material);
  const stale=spawnSync(process.execPath,[cli,...args,'set',...set,
    '--scene','reused.json','--expect','review.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/preview is stale/);
  assert(!fs.existsSync(path.join(dir,'stale.json')));
});

function assemble({KIT},documents) {
  return Object.fromEntries(Object.entries(documents).map(([id,doc])=>[id,KIT.diorama.build(doc)]));
}

test('WebGL uses saved filter, emission, sidedness and coverage settings', {skip:!process.env.INK_TEST_CHROME},()=>{
  const documents={
    opaque:edited({...settings,alphaMode:'opaque'}),
    mask:edited({...settings,alphaMode:'mask',alphaCutoff:.7}),
    linear:edited({...settings,alphaMode:'opaque',magFilter:'linear'}),
    glow:edited({...settings,alphaMode:'opaque',emissiveGain:1}),
    blend:edited(settings)
  };
  const result=require('../cli/look-webgl.js')({},assemble,(kit,fixture,backend,scenes)=>{
    const render=backend(96,72,{raw:true,dither:0});
    const samples={};
    try {
      const worlds=fixture(kit,scenes);
      for (const [id,world] of Object.entries(worlds)) {
        render.draw(world);
        samples[id]=render.sample({left:[37,38],adjacent:[38,38],center:[45,38]});
      }
      render.draw(worlds.opaque,{camera:{yaw:180}});
      samples.back=render.sample({left:[37,38]});
      return {samples};
    } finally { render.close(); }
  },documents).samples;
  assert.deepEqual(result.opaque.left,[224,0,0]);
  assert.deepEqual(result.mask.left,[48,100,56]);
  assert.deepEqual(result.back.left,[7,8,11]);
  assert(result.linear.center[2]>0);
  assert(result.glow.left[0]>224);
  assert.notDeepEqual(result.blend.left,result.blend.adjacent);
});
