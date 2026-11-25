'use strict';

const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const width = 16, height = 11;
const pixels = new Uint8Array(width*height*4);
const colors = [0xa64836,0xb88b43,0x256d77,0x714588,0x287352,0x79352f];
for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
  const col = Math.floor((x-2)/5), row = Math.floor((y-1)/5);
  const tile = col>=0 && row>=0 && col<3 && row<2 && (x-2)%5<4 && (y-1)%5<4;
  const color = tile ? colors[row*3+col] : 0xfc00ff;
  pixels.set([color>>16,(color>>8)&255,color&255,255],(y*width+x)*4);
}
const scene = {id:'brush-repeat',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{paint:ink.readTilesetImage(PNG.encode(width,height,pixels,4))}};
const brush = ink.pickTilesetBlock(scene,'paint',{x:2,y:1,width:14,height:9},
  {width:4,height:4,paddingX:1,paddingY:1,offsetX:2,offsetY:1});
const request = {id:'ornament',object:'wall',brush,at:[0,0],count:2};

test('abut repeats a padded brush edge-to-edge on a snapped, rotated plane with one journal entry',()=>{
  const draft = {...scene,constructionPlane:{origin:[2,5,6],right:[0,0,-1],up:[0,1,0],grid:[2,.5],rounding:'floor'}};
  const editor = ink.createSceneEditor(draft), pick = {...request,at:[1.6,2.2],snapGrid:true};
  const preview = editor.planTilesetBrushRun(pick);
  assert.equal(preview.spacing,'abut');
  assert.deepEqual(preview.gridAt,[1,2]);
  assert.deepEqual(preview.anchor,[0,8]);
  assert.deepEqual(preview.tileSize,[1,1]);
  assert.deepEqual(preview.pitch,[3,0]);
  assert.deepEqual(preview.stamps.map(s=>[s.origin,s.point,s.replaced.length]),[
    [[2,6,4],[2,6,4],0],[[2,6,1],[2,6,1],0]]);
  assert.equal(preview.faces.length,12);
  assert.deepEqual(preview.faces.map(face=>[face.selection.x,face.selection.y]),
    [[2,1],[7,1],[12,1],[2,6],[7,6],[12,6],[2,1],[7,1],[12,1],[2,6],[7,6],[12,6]]);
  assert.deepEqual(editor.snapshot(),draft);
  assert.deepEqual(editor.applyTilesetBrushRun(pick),preview);

  const actual = editor.snapshot(), row = actual.topologyMeshes.wall;
  assert.equal(row.document.faces.length,12);
  const vertices = new Map(row.document.vertices.map(v=>[v.id,v.position]));
  assert.deepEqual(vertices.get('ornament/0/1/2/v1'),vertices.get('ornament/1/1/0/v0'));
  assert.deepEqual(row.bindings[11].data.placement,{run:'ornament',stamp:1,column:2,row:1});
  const mesh = editor.build().topologyMeshes.wall.mesh, api = ink.load().KIT.sceneMeshes;
  assert.deepEqual(Array.from({length:mesh.triangles},(_,i)=>api.trianglePigment(mesh,i).color),
    [...colors,...colors].flatMap(color=>[color,color]));
  assert.deepEqual(editor.history().undo,['Stamp ornament']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),draft);
  editor.redo();
  assert.deepEqual(editor.snapshot(),actual);
});

test('overlap uses the later tile in each shared cell and keeps a custom artwork anchor registered',()=>{
  const editor = ink.createSceneEditor(scene);
  const plan = editor.applyTilesetBrushRun({...request,at:[1,2],direction:'left',
    spacing:'overlap',overlapTiles:1,align:'anchor',anchor:[2,6]});
  assert.deepEqual(plan.anchor,[2,6]);
  assert.deepEqual(plan.pitch,[-2,0]);
  assert.deepEqual(plan.stamps.map(s=>[s.point,s.origin]),[
    [[1,2,0],[.5,1.5,0]],[[-1,2,0],[-1.5,1.5,0]]]);
  assert.deepEqual(plan.stamps[1].replaced,[
    {cell:[0,1],before:'ornament/0/0/0',after:'ornament/1/0/2'},
    {cell:[0,0],before:'ornament/0/1/0',after:'ornament/1/1/2'}
  ]);
  assert.equal(plan.faces.length,10);
  assert.equal(new Set(plan.faces.map(face=>face.cell.join(','))).size,10);
  const mesh = editor.meshTopology('wall');
  assert(!mesh.document.faces.some(face=>face.id === 'ornament/0/1/0'));
  assert.deepEqual(mesh.bindings.find(row=>row.element === 'ornament/1/1/2').data.selection,
    ink.pickTilesetRectangle(scene,'paint',{x:12,y:6,width:4,height:4}));
  assert.equal(editor.build().topologyMeshes.wall.mesh.triangles,20);
  editor.undo();
  assert.deepEqual(editor.snapshot(),scene);
});

test('vertical runs align by the travel edge and reuse the saved brush scale and per-cell insets',()=>{
  const editor = ink.createSceneEditor({...scene,tilesetDefaults:{texelsPerUnit:16}});
  const saved = {...brush,brushScale:2,uvInset:{left:1,top:1}};
  const report = editor.applyTilesetBrushRun({...request,brush:saved,at:[3,4],direction:'down',spacing:'overlap'});
  assert.deepEqual(report.anchor,[0,0]);
  assert.deepEqual(report.tileSize,[2,2]);
  assert.deepEqual(report.pitch,[0,-2]);
  assert.deepEqual(report.stamps.map(s=>[s.point,s.origin,s.replaced.length]),[
    [[3,4,0],[3,0,0],0],[[3,2,0],[3,-2,0],3]]);
  assert.equal(report.faces.length,9);
  const alive = editor.meshTopology('wall').document.faces.find(face=>face.id === 'ornament/0/0/0');
  assert.deepEqual(alive.corners.map(c=>c.uv),[[3/15,4/10],[5/15,4/10],[5/15,2/10],[3/15,2/10]]);
  assert.throws(()=>editor.planTilesetBrushRun({...request,spacing:'overlap',overlapTiles:3}),/smaller than the brush/);
  assert.throws(()=>editor.planTilesetBrushRun({...request,align:'anchor',anchor:[13,0]}),/inside the compact brush/);
  assert.throws(()=>editor.planTilesetBrushRun({...request,count:1000}),/4096 sampled cells/);
  assert.throws(()=>editor.planTilesetBrushRun({...request,direction:['right']}),/supported spacing and alignment/);
  assert.throws(()=>editor.planTilesetBrushRun({...request,brush:{...brush,columns:4}}),/row and column counts/);
});

test('source tile migrations preserve brush provenance and a separate rectangle can erase one landed cell',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetBrushRun(request);
  const id = 'ornament/0/1/0', original = editor.meshTopology('wall').bindings.find(row=>row.element === id);
  editor.transformTilesetCanvas('paint',{type:'swap',a:{x:2,y:6,width:4,height:4},b:{x:7,y:6,width:4,height:4}});
  const migrated = editor.meshTopology('wall').bindings.find(row=>row.element === id);
  assert.equal(migrated.data.selection.x,7);
  assert.deepEqual(migrated.data.placement,original.data.placement);
  const cut = editor.applyTilesetRectangle({mode:'erase',id:'one-cell',object:'wall',from:[0,0],to:[0,0]});
  assert.deepEqual(cut.changes.faces.map(face=>face.id),[id]);
  editor.undo();
  assert.deepEqual(editor.meshTopology('wall').bindings.find(row=>row.element === id),migrated);
});

test('CLI dry-runs and commits the same brush report and rejects a conflicting run atomically',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-brush-run-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  fs.writeFileSync(file('draft.json'),JSON.stringify(scene));
  const {brush:pick,...runSettings} = request;
  fs.writeFileSync(file('run.json'),JSON.stringify({...runSettings,spacing:'overlap',align:'anchor'}));
  fs.writeFileSync(file('brush.json'),JSON.stringify(pick));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (input,...args)=>spawnSync(process.execPath,[cli,'tileset','brush-run','run.json','--scene',input,'--brush-file','brush.json',...args],
    {cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result = run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const preview = json('draft.json');
  assert.equal(preview.faces.length,10);
  assert.deepEqual(preview.anchor,[6,4]);
  assert(!fs.existsSync(file('placed.json')));
  assert.deepEqual(json('draft.json','--out','placed.json'),preview);
  const blocked = run('placed.json','--out','blocked.json');
  assert.equal(blocked.status,1,blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).canCommit,false);
  assert(!fs.existsSync(file('blocked.json')));
});
