'use strict';

const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {test}=require('node:test');
const ink=require('..'), kit=ink.load(), K=kit.KIT, PNG=require('../cli/png.js');
const {preview}=require('../cli/tileset-decal.js');
const view={w:128,h:88,t:1,raw:true};

function fixture() {
  const scene={id:'cistern-wall',style:'slate',solids:[],camera:{target:[0,0,0],dist:5,yaw:0,pitch:0,projection:'orthographic',sway:0},
    tilesets:{
      brick:{version:1,width:3,height:2,encoding:'rgba8',data:Buffer.from([
        119,81,69,255,149,107,82,255,138,77,61,255,119,81,69,255,149,107,82,255,138,77,61,255]).toString('base64')},
      steel:ink.createBlankTileset({width:1,height:1,background:'#416d74'})
    }};
  const editor=ink.createSceneEditor(scene), brick=ink.pickTilesetRectangle(scene,'brick',{x:0,y:0,width:3,height:2});
  for (const [face,x] of [['west',-2],['east',0]]) {
    editor.placeTilesetFace({object:'wall',part:'plaster',face,selection:brick,origin:[x,-.7,0],worldSize:[2,1.4]});
    editor.applyTilesetWrap({object:'wall',face,wrap:{u:'repeat',repeats:[5,1]}});
  }
  editor.placeTilesetFace({object:'pipe',face:'cover',
    selection:ink.pickTilesetRectangle(scene,'steel',{x:0,y:0,width:1,height:1}),
    origin:[-.5,-1,.23],worldSize:[.21,2]});
  return editor;
}

const gold=[242,197,93,255], pale=[182,221,189,255];
const sign={id:'sign',kind:'lettering',anchor:{object:'wall',part:'plaster',face:'west',at:[-.28,0,0],
  normal:[0,0,1],size:[1.4,.85],bias:.009},image:{width:1,height:1,pixels:gold},grid:[14,8],
  lifetime:{start:.25,end:3,fadeOut:.5}};

function render(editor,time=1) {
  return ink.render(editor.build(),{...view,t:time,px:1,passes:['materialId','objectId']});
}

test('a retained projector clips to one of two named faces sharing the same repeating material',()=>{
  const editor=fixture(), before=editor.snapshot(), base=render(editor);
  const plan=editor.planSurfaceDecal(sign);
  assert(plan.canCommit);
  assert(!editor.planSurfaceDecal({...sign,anchor:{...sign.anchor,face:'missing'}}).canCommit);
  assert(!editor.planSurfaceDecal({...sign,anchor:{...sign.anchor,part:'wrong'}}).canCommit);
  assert.deepEqual(editor.addSurfaceDecal(sign),plan);
  const saved=editor.snapshot(), world=editor.build(), api=world.surfaceDecals;
  assert.deepEqual(saved.tilesets,before.tilesets);
  assert.deepEqual(saved.topologyMeshes,before.topologyMeshes);
  const first=api.sample(1);
  assert(first.report[0].triangles>0);
  assert.equal(first.report[0].face,'west');
  assert(Math.max(...Array.from(first.layers[0].vertices).filter((_,i)=>i%5===0))<=1e-7);
  const shot=render(editor), {materials,materialId}=shot.passes;
  const indices=Array.from(materialId,(slot,i)=>materials[slot]==='decal:sign' ? i : -1).filter(i=>i>=0);
  assert(indices.length>30 && indices.every(i=>i%shot.w<shot.w/2));
  const pipe=base.passes.objects.indexOf('pipe');
  assert(Array.from(base.passes.objectId).every((slot,i)=>slot!==pipe || materialId[i]!==materials.indexOf('decal:sign')));
  assert(Buffer.from(render(editor,3).rgb).equals(base.rgb));

  const mesh=world.topologyMeshes.wall.mesh, {positions}=K.sceneMeshes.geometry(mesh);
  const oldX=first.layers[0].vertices[0];
  K.sceneMeshes.pose(mesh,Array.from(positions,(value,i)=>i%3===0 ? value+1 : value));
  const moved=api.sample(1).layers[0].vertices;
  assert(Math.abs(moved[0]-oldX-1)<1e-6);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),saved);
});

test('named UV decals place once per surface and retain depth order and existing decal edits',()=>{
  const editor=fixture();
  const uv={id:'repair',anchor:{object:'wall',face:'east',uv:{min:[.15,.2],max:[.8,.8]},bias:.007},
    image:{width:1,height:1,pixels:pale}};
  assert(!editor.planSurfaceDecal({...uv,anchor:{...uv.anchor,material:'missing'}}).canCommit);
  editor.addSurfaceDecal(uv);
  editor.addSurfaceDecal({...uv,id:'contact',anchor:{...uv.anchor,uv:{min:[.2,.25],max:[.85,.72]}},
    image:{...uv.image,pixels:gold}});
  const winner=frame=>{
    const owner=frame.passes.materials[frame.passes.materialId[Math.floor(frame.h/2)*frame.w+frame.w/2+16]];
    return owner;
  };
  assert.equal(winner(render(editor)),'decal:repair');
  editor.addSurfaceDecal({...uv,id:'raised',anchor:{...uv.anchor,bias:.04},image:{...uv.image,pixels:gold}});
  assert.equal(winner(render(editor)),'decal:raised');
  const layers=editor.build().surfaceDecals.sample(1).layers;
  assert(layers.every(layer=>Array.from(layer.vertices).filter((_,i)=>i%5===0).every(x=>x>=0)));
  editor.editSurfaceDecal('raised',{type:'mask',mask:[0]});
  assert.equal(winner(render(editor)),'decal:repair');
});

test('depth review identifies foreground blockers, coplanar depth, and source clipping',t=>{
  const original=fixture(), draft=original.fork();
  draft.addSurfaceDecal(sign);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-decal-depth-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const review=preview(original,draft,sign,view,dir,kit);
  assert(review.counts.projected>review.counts.visible && review.counts.visible>0);
  assert(review.counts.occluded>0);
  assert.equal(review.counts.mismatch,0);
  assert.equal(review.counts.unsupported,0);
  assert(review.blockers.some(row=>row.object==='pipe' && row.face==='cover' && row.occluded>0));
  assert.deepEqual(review.files.map(file=>PNG.layout(path.join(dir,file)).w),[view.w,view.w,view.w]);
  const coplanar={...sign,anchor:{...sign.anchor,bias:0}}, flat=original.fork();
  flat.addSurfaceDecal(coplanar);
  const contact=preview(original,flat,coplanar,view,dir,kit);
  assert(contact.counts.nearCoplanar>0);
  assert.equal(contact.counts.visible,0);
  assert(contact.blockers.some(row=>row.object==='wall' && row.face==='west' && row.nearCoplanar>0));
});

test('CLI accepts portable PNGs and rejects a stale preview',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-decals-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=file=>path.join(dir,file), save=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value));
  const {image,...request}=sign, scene=fixture().snapshot();
  save('scene.json',scene);
  save('request.json',request);
  save('view.json',view);
  fs.writeFileSync(at('art.png'),PNG.encode(1,1,Uint8Array.from(image.pixels),4));
  const args=[path.resolve(__dirname,'../cli/ink-studio.js'),'tileset','decal','request.json','--scene','scene.json','--image','art.png'];
  const run=(...flags)=>JSON.parse(execFileSync(process.execPath,[...args,...flags],{cwd:dir,encoding:'utf8'}));
  const report=run('--preview','review','--view','view.json');
  assert(report.canCommit && report.native.counts.occluded>0);
  save('receipt.json',report);
  run('--expect','receipt.json','--out','placed.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(at('placed.json'))).surfaceDecals.decals[0].image,image);
  save('scene.json',{...scene,name:'changed'});
  const stale=spawnSync(process.execPath,[...args,'--expect','receipt.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.match(stale.stderr,/preview is stale/);
  assert(!fs.existsSync(at('stale.json')));
});

function worlds({KIT},docs) {
  return docs.map(doc=>KIT.diorama.build(doc));
}

test('WebGL clips named decals to the face and keeps them behind a foreground blocker',{skip:!process.env.INK_TEST_CHROME},()=>{
  const editor=fixture(), before=editor.snapshot();
  editor.addSurfaceDecal(sign);
  editor.addSurfaceDecal({...sign,id:'tie',grid:[9,7],image:{...sign.image,pixels:pale}});
  const result=require('../cli/look-webgl.js')({},worlds,(kit,build,backend,[before,after,view])=>{
    const draw=backend(view.w,view.h,{raw:true,dither:0});
    try {
      const [plain,painted]=build(kit,[before,after]), shots=[];
      for (const world of [plain,painted]) {
        draw.draw(world,{t:1});
        shots.push(draw.sample({art:[46,45],pipe:[55,45],other:[67,45]}));
      }
      return {shots};
    } finally { draw.close(); }
  },[before,editor.snapshot(),view]);
  const [plain,painted]=result.shots;
  assert.deepEqual(painted.art,gold.slice(0,3));
  assert.deepEqual(painted.pipe,plain.pipe);
  assert.deepEqual(painted.other,plain.other);
});
