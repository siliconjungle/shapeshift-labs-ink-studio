'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'tile-primitives',style:'slate',solids:[],tilesets:{
  atlas:ink.createBlankTileset({width:24,height:12,background:'#2f7e87'})
}};
const selection = ink.pickTilesetRectangle(scene,'atlas',{x:1,y:1,width:8,height:6});
const kit = ink.load().KIT;
const request = {id:'tool',object:'mesh',kind:'cylinder',at:[0,0],size:[2,1,1.5],selection};
const props = (...args)=>({...request,...Object.assign({},...args)});
function closed(row) {
  const doc=row.document;
  assert(kit.meshTopology.inspect(doc).edges.every(edge=>edge.uses.length===2));
  const counts=kit.meshTopology.health(doc).counts;
  assert.equal(counts.nonManifold,0);
  assert.equal(counts.winding,0);
  assert.equal(counts.selfIntersections,0);
}
const colors = face=>face.corners.map(corner=>corner.uv);

test('stamps five closed painted primitives with editable polygon and corner IDs',()=>{
  const setup = {...scene,constructionPlane:{origin:[5,8,2],right:[0,0,-1],up:[0,1,0],grid:[2,.5],rounding:'floor'}};
  const editor = ink.createSceneEditor(setup);
  const forms = [['box',{subdivisions:2},24],['wedge',{subdivisions:2},20],
    ['cylinder',{radial:8,axial:2},18],['cone',{radial:8,axial:2},17],['sphere',{radial:8,axial:4},32]];
  for (const [kind,segments,faces] of forms) {
    const placement=props({id:kind,object:kind,kind,segments,at:[1.7,2.4,.25],snapGrid:true,paint:{rotation:90,flipX:true}});
    const preview=editor.planTilesetPrimitive(placement);
    assert.deepEqual(preview.frame.origin,[5.25,9,0]);
    assert.equal(preview.faces,faces);
    assert.deepEqual(editor.applyTilesetPrimitive(placement),preview);
    const row=editor.meshTopology(kind);
    assert.equal(row.bindings.length,faces+1);
    assert.equal(row.bindings[0].data.kind,kind);
    assert(row.bindings.slice(1).every(binding=>binding.data.selection.tileset==='atlas'));
    assert(row.document.faces.every(face=>face.corners.every(corner=>corner.uv[0]>=1/23-1e-9 && corner.uv[0]<=8/23+1e-9)));
    closed(row);
  }
  const built=editor.build();
  assert.equal(Object.keys(built.topologyMeshes).length,5);
});

test('reopens and revises planar subdivisions and compound dimensions with one undo',()=>{
  const original=ink.createSceneEditor(scene);
  original.applyTilesetPrimitive(props({kind:'wedge'}));
  original.applyTilesetPrimitive(props({id:'neighbor',kind:'box',at:[5,0]}));
  const before=JSON.parse(JSON.stringify(original.snapshot())), editor=ink.createSceneEditor(before);
  const revision={id:'tool',object:'mesh',mode:'revise',size:[3,.75,2],segments:{subdivisions:3}};
  const report=editor.applyTilesetPrimitive(revision);
  assert.equal(report.faces,45);
  assert.deepEqual(report.size,[3,.75,2]);
  assert.deepEqual(report.segments,{subdivisions:3});
  const row=editor.meshTopology('mesh');
  assert.deepEqual(row.document.faces.filter(face=>face.id.startsWith('primitive/neighbor/')),
    before.topologyMeshes.mesh.document.faces.filter(face=>face.id.startsWith('primitive/neighbor/')));
  assert.deepEqual(row.bindings.find(binding=>binding.id==='primitive/tool').data.size,[3,.75,2]);
  closed(row);
  const after=editor.snapshot();
  const unchanged=editor.applyTilesetPrimitive(revision);
  assert.equal(unchanged.beforeRevision,unchanged.afterRevision);
  assert.deepEqual(editor.history().undo,['Revise tool']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('retessellates using the current paint chart after the source pixels move',()=>{
  const editor=ink.createSceneEditor(scene);
  editor.applyTilesetPrimitive(props({segments:{radial:8,axial:1},paint:{rotation:270,flipY:true},uvInset:{top:.5}}));
  const swap=editor.transformTilesetCanvas('atlas',{type:'swap',a:{x:1,y:1,width:8,height:6},b:{x:13,y:1,width:8,height:6}});
  assert.equal(swap.canCommit,true);
  const before=editor.snapshot();
  const options={object:'mesh',id:'tool',mode:'revise',segments:{radial:16,axial:2}};
  const result=editor.applyTilesetPrimitive(options);
  assert.equal(result.canCommit,true);
  assert.equal(result.faces,34);
  assert.equal(result.source.selection.x,13);
  const row=editor.meshTopology('mesh');
  assert(row.bindings.filter(item=>item.data.placement?.primitive==='tool').every(item=>item.data.selection.x===13));
  for (const face of row.document.faces) for (const [u,v] of colors(face)) {
    assert(u>=(13-1e-8)/23 && u<=(20+1e-8)/23);
    assert(v>=(1.5-1e-8)/11 && v<=(6+1e-8)/11);
  }
  closed(row);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('dimension revisions preserve individual reskins and retessellation reports mixed paint',()=>{
  const editor=ink.createSceneEditor(scene);
  editor.applyTilesetPrimitive(props({segments:{radial:8,axial:1}}));
  const face=editor.meshTopology('mesh').document.faces.find(row=>row.id.includes('/wall/')).id;
  editor.applyTilesetReskin({object:'mesh',face,mode:'crop',selection:{...selection,x:13}});
  const before=editor.meshTopology('mesh');
  const dimensions={id:'tool',object:'mesh',mode:'revise',size:[1,2,3]};
  assert.equal(editor.applyTilesetPrimitive(dimensions).canCommit,true);
  const after=editor.meshTopology('mesh');
  assert.deepEqual(after.document.faces,before.document.faces);
  const blocked=editor.planTilesetPrimitive({...dimensions,segments:{radial:16}});
  assert.deepEqual(blocked.issues,[{reason:'primitive-paint-or-topology-needs-review'}]);
  const v=after.document.vertices[0];
  editor.editMeshTopology('mesh',{vertices:[{id:v.id,position:[v.position[0]-.01,...v.position.slice(1)]}]});
  assert.deepEqual(editor.planTilesetPrimitive({...dimensions,size:[1,1,2]}).issues,[{reason:'primitive-topology-was-edited'}]);
});

test('stamps one chosen cell of a padded brush and uses its saved paint orientation',()=>{
  const brush=ink.pickTilesetBlock(scene,'atlas',{x:0,y:0,width:9,height:4},{width:4,height:4,paddingX:1});
  const editor=ink.createSceneEditor(scene), chosen={...brush,paint:{flipX:true}};
  assert.throws(()=>editor.planTilesetPrimitive(props({kind:'box',selection:chosen})),/column and row/);
  const result=editor.applyTilesetPrimitive(props({kind:'box',selection:chosen,cell:{column:1,row:0}}));
  assert.deepEqual(result.source.selection,ink.pickTilesetRectangle(scene,'atlas',{x:5,y:0,width:4,height:4}));
  assert.deepEqual(result.source.paint,{rotation:0,flipX:true,flipY:false});
});

test('CLI stamps from a saved pick, revises retained parameters, and rejects incompatible counts',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-primitive-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const {selection,...start}=props({kind:'sphere',segments:{radial:8,axial:4}});
  for (const [name,value] of [
    ['draft',scene],['stamp',start],['pick',selection],
    ['revise',{id:'tool',object:'mesh',mode:'revise',segments:{radial:12},size:[1,1,3]}],
    ['bad',{id:'tool',object:'mesh',mode:'revise',segments:{axial:1}}]
  ]) fs.writeFileSync(file(name+'.json'),JSON.stringify(value));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const command=(args)=>[cli,'tileset','primitive',...args];
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,command(args),{cwd:dir,encoding:'utf8'}));
  const stamp=['stamp.json','--scene','draft.json','--selection','pick.json'];
  const plan=run(...stamp);
  assert(!fs.existsSync(file('stamped.json')));
  assert.deepEqual(run(...stamp,'--out','stamped.json'),plan);
  const updated=run('revise.json','--scene','stamped.json','--out','updated.json');
  assert.deepEqual(updated.segments,{radial:12,axial:4});
  assert.equal(updated.faces,48);
  const bad=spawnSync(process.execPath,command(['bad.json','--scene','stamped.json','--out','blocked.json']),
    {cwd:dir,encoding:'utf8'});
  assert.equal(bad.status,1);
  assert.match(bad.stderr,/at least 2 axial/);
  assert(!fs.existsSync(file('blocked.json')));
});
