'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const view = {w:120,h:80,ortho:true,yaw:0,pitch:0,target:[0,0,0],zoom:1.14,lockCamera:true};
const source = {id:'tile-through',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:8},
  camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{paint:ink.createBlankTileset({width:8,height:8,background:'#458275'})}};
const selection = ink.pickTilesetRectangle(source,'paint',{x:0,y:0,width:8,height:8});

function draft() {
  const editor = ink.createSceneEditor(source);
  function stamp(object,face,x,z,right=[1,0,0],worldSize) {
    editor.placeTilesetFace({object,face,selection,origin:[x,-.5,z],right,worldSize});
  }
  stamp('panels','front',-1.7,0);
  stamp('panels','covered',-.5,0);
  stamp('panels','rear-covered',.5,-.35,[-1,0,0]);
  stamp('panels','reverse',1.7,0,[-1,0,0]);
  stamp('panels','under-reverse',.7,-.35);
  stamp('panels','offscreen',60,0);
  stamp('shutter','cover',-.55,.8,[1,0,0],[1.1,1]);
  return editor;
}

function query(domain, visibility, backfaces) {
  return {object:'panels',domain,query:{filter:{visibility,...(backfaces && {backfaces})}}};
}

test('switches between frontmost and through picks with independent backface participation',()=>{
  const editor = draft();
  const {visibility} = ink.captureMeshTopologyVisibility(editor.build(),'panels',view,{participation:true});
  const pick = (domain,mode,backfaces)=>editor.selectTilesetComponents(query(domain,mode,backfaces),{visibility}).ids;
  assert.deepEqual(pick('tiles','visible','include'),['front','reverse']);
  assert.deepEqual(pick('tiles','visible','exclude'),['front']);
  assert.deepEqual(pick('tiles','through','include'),['covered','front','rear-covered','reverse','under-reverse']);
  assert.deepEqual(pick('tiles','through','exclude'),['covered','front','under-reverse']);
  assert.deepEqual(pick('tiles','hidden'),['covered','offscreen','rear-covered','under-reverse']);
  for (const domain of ['edges','vertices']) {
    const eligible = pick(domain,'through','exclude');
    assert.equal(eligible.length,12);
    assert.equal(pick(domain,'through','include').length,20);
    assert.equal(pick(domain,'visible','exclude').length,4);
    assert(eligible.every(id=>['front','covered','under-reverse'].some(face=>id.includes(face))));
  }
  const ordinary = ink.captureMeshTopologyVisibility(editor.build(),'panels',view).visibility;
  assert.deepEqual(editor.selectTilesetComponents(query('tiles','visible','include'),{visibility:ordinary}).ids,['front','reverse']);
  assert.throws(()=>editor.selectTilesetComponents(query('tiles','through'),{visibility:ordinary}),/backface participation/);
  assert.throws(()=>editor.selectTilesetComponents(query('tiles','hidden','exclude'),{visibility}),/with visible or through/);
  assert.throws(()=>editor.selectTilesetComponents(query('tiles','through'),{visibility:{...visibility,object:'other'}}),/scene object and part/);
  const native = editor.selectMeshTopology('panels',{domain:'faces',filter:{visibility:'through',backfaces:'exclude'}},{visibility});
  assert.deepEqual(native.ids,pick('tiles','through','exclude'));
  editor.transformMeshTopology('panels',{selection:native,operation:{kind:'move',offset:[0,0,-.02]}});
  assert.throws(()=>editor.selectTilesetComponents(query('tiles','through'),{visibility}),/topology revision/);
});

test('clips through components against the perspective viewport and depth planes',()=>{
  const {KIT} = ink.load(), {meshTopology} = KIT;
  const polygons = {
    crossing:[[-4,-.5,-2],[4,-.5,-2],[4,.5,-2],[-4,.5,-2]],
    near:[[-.2,-.2,-.5],[.3,-.2,-2],[.2,.3,-2]],
    beyond:[[0,0,-20],[1,0,-20],[1,1,-20]],
    behind:[[0,0,2],[1,0,2],[1,1,2]],
    outside:[[1.8,4,-2],[4,1.8,-2],[4,4,-2]]
  };
  const ids = (key,points)=>points.map((_,i)=>key+'/v'+i);
  const source = meshTopology.create({id:'perspective-panels',vertices:Object.entries(polygons).flatMap(([key,points])=>
    ids(key,points).map((id,i)=>({id,position:points[i]}))),faces:Object.entries(polygons).map(([id,points])=>({id,
    corners:ids(id,points).map((vertex,i)=>({id:id+'/c'+i,vertex}))}))});
  const mesh = meshTopology.toSceneMesh(source), w=64, h=64;
  const frame = {w,h,passes:{sourceSurface:new Int32Array(w*h).fill(-1),sourceTriangle:new Int32Array(w*h),surfaceSources:[]}};
  const camera = {view:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],focal:32,ortho:false,clipNear:1,clipFar:8};
  const evidence = meshTopology.captureVisibility(mesh,frame,camera,{participation:true}).participation;
  assert.deepEqual(evidence.through.faces,['crossing','near']);
  assert.deepEqual(evidence.throughFront.faces,['crossing','near']);
  assert.deepEqual(evidence.through.vertices,['near/v1','near/v2']);
  assert.equal(evidence.through.edges.filter(id=>id.includes('crossing')).length,2);
});

test('CLI resolves live and saved participation into compatible native selections',t=>{
  const editor = draft();
  const {visibility} = ink.captureMeshTopologyVisibility(editor.build(),'panels',view,{participation:true});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-through-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const request = query('tiles','through','exclude');
  for (const [name,data] of Object.entries({scene:editor.snapshot(),visibility,view,query:request,
    native:{domain:'faces',filter:request.query.filter}}))
    fs.writeFileSync(path.join(cwd,name+'.json'),JSON.stringify(data));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  const args = ['tileset','select','query.json','--scene','scene.json'];
  const live = run(...args,'--view','view.json','--topology-out','faces.json');
  assert.deepEqual(live,run(...args,'--visibility','visibility.json'));
  assert.deepEqual(live.ids,['covered','front','under-reverse']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd,'faces.json'),'utf8')),live.selection);
  assert.deepEqual(run('mesh-topology','select','scene.json','native.json','--object','panels','--view','view.json'),live.selection);
});
