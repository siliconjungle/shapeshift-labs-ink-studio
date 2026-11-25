'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const PNG = require('../cli/png.js');
const ink = require('..');

const pixels = Uint8Array.from({length:4*4*4},(_,i)=>i%4 === 3 ? 255 : i);
const atlas = ink.readTilesetImage(PNG.encode(4,4,pixels,4));
const scene = {id:'tileset-canvas',style:'slate',solids:[],tilesetDefaults:{tileSize:{width:2,height:2}},
  tilesets:{painted:atlas},
  topologyMeshes:{panel:{document:{id:'panel',uvBindings:{pigment:1},
    vertices:[[0,0,0],[2,0,0],[2,2,0],[0,2,0]].map((position,i)=>({id:'v'+i,position})),
    faces:[{id:'plate',material:'paint',corners:[[.25,.75],[.75,.75],[.75,.25],[.25,.25]].map((uv,i)=>
      ({id:'uv'+i,vertex:'v'+i,uv:[uv[0]-.25,uv[1]-.25],attributes:{'uv/1':uv}}))}]},
    materials:[{id:'paint',texture:{tileset:'painted'}}],
    bakes:[{id:'recorded-paint',material:'paint',maps:{roughness:.31}}]}}};
const data = asset=>new Uint8Array(Buffer.from(asset.data,'base64'));

test('centered resize preserves art texels, remaps pigment references, and undoes both changes',()=>{
  const editor = ink.createSceneEditor(scene), before = editor.snapshot();
  const operation = {type:'resize',size:[6,6],anchor:'center'};
  const plan = editor.planTilesetCanvas('painted',operation);
  assert.equal(plan.canCommit,true);
  assert.deepEqual(plan.sourceOffset,[-1,-1]);
  assert.deepEqual(plan.grid.after,{width:2,height:2,offsetX:1,offsetY:1});
  assert.equal(plan.references[0].status,'remapped');
  assert.deepEqual(plan.references[0].corners[0],{id:'uv0',before:[.25,.75],after:[2/6,4/6]});
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.transformTilesetCanvas('painted',operation),plan);

  const after = editor.snapshot(), expected = new Uint8Array(6*6*4);
  for (let y=0;y<4;y++) expected.set(pixels.subarray(y*16,(y+1)*16),((y+1)*6+1)*4);
  assert.deepEqual(data(after.tilesets.painted),expected);
  const oldMesh = before.topologyMeshes.panel.document, newMesh = after.topologyMeshes.panel.document;
  assert.deepEqual(newMesh.vertices,oldMesh.vertices);
  assert.deepEqual(newMesh.faces[0].corners.map(corner=>corner.uv),oldMesh.faces[0].corners.map(corner=>corner.uv));
  assert.deepEqual(newMesh.faces[0].corners[0].attributes['uv/1'],[2/6,4/6]);
  assert.deepEqual(after.topologyMeshes.panel.bakes[0].invalidated,{faces:['plate']});
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('nearest-neighbor resampling scales art and grid while preserving normalized UVs',()=>{
  const editor = ink.createSceneEditor(scene), before=editor.snapshot();
  const report = editor.transformTilesetCanvas('painted',{type:'resample',size:[8,4]});
  assert.deepEqual(report.sourceScale,[.5,1]);
  assert.deepEqual(report.grid.after,{width:4,height:2});
  assert.equal(report.references[0].status,'resampled');
  assert.deepEqual(editor.snapshot().topologyMeshes.panel.document,before.topologyMeshes.panel.document);
  const expected = [];
  for (let i=0;i<pixels.length;i+=4) expected.push(...pixels.subarray(i,i+4),...pixels.subarray(i,i+4));
  assert.deepEqual([...data(editor.snapshot().tilesets.painted)],expected);
  const fractional = editor.planTilesetCanvas('painted',{type:'resample',size:[7,4]});
  assert.equal(fractional.canCommit,false);
  assert.equal(fractional.grid.after.width,3.5);
  assert.equal(editor.planTilesetCanvas('painted',{type:'resample',size:[7,4],tileSize:{width:7,height:2}}).canCommit,true);
});

test('resize previews clipped and pinned references and indexed padding keeps exact source swatches',()=>{
  const source = JSON.parse(JSON.stringify(scene));
  source.topologyMeshes.panel.document.faces[0].corners[0].uvPins = {1:true};
  const editor = ink.createSceneEditor(source);
  const operation = {type:'resize',size:[2,2]};
  const preview = editor.planTilesetCanvas('painted',operation);
  assert.equal(preview.canCommit,false);
  assert(preview.references[0].conflicts.some(conflict=>conflict.reason === 'outside-canvas'));
  assert(preview.references[0].conflicts.some(conflict=>conflict.reason === 'pinned-uv'));
  assert.throws(()=>editor.transformTilesetCanvas('painted',operation),error=>{
    assert.deepEqual(error.report,preview);
    return true;
  });
  assert.deepEqual(editor.snapshot(),source);

  const indexed = palette=>ink.createSceneEditor({id:'indexed-canvas',style:'slate',solids:[],
    tilesets:{indexed:{version:1,width:1,height:1,encoding:'indexed8',data:'AA==',palette}}});
  const padded = indexed([0x123456,0x123456]);
  padded.transformTilesetCanvas('indexed',{type:'resize',size:[513,1],anchor:'right'});
  const asset = padded.snapshot().tilesets.indexed;
  assert.deepEqual(asset.palette,[0x123456,0x123456,0]);
  assert.deepEqual(asset.alpha,[255,255,0]);
  assert.deepEqual(data(asset),new Uint8Array(513).fill(2).fill(0,512));
  const full = indexed(Array.from({length:256},(_,i)=>i+0x123456));
  full.transformTilesetCanvas('indexed',{type:'resize',size:[2,1],anchor:'right'});
  const rgba = full.snapshot().tilesets.indexed;
  assert.equal(rgba.encoding,'rgba8');
  assert.equal(rgba.palette,undefined);
  assert.deepEqual([...data(rgba)],[0,0,0,0,0x12,0x34,0x56,255]);
});

test('the CLI separates resize and resample and writes a scene only for a valid commit',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-canvas-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const input = path.join(dir,'source.json'), output = path.join(dir,'edited.json'), blocked = path.join(dir,'blocked.json');
  const contents = JSON.stringify(scene), cli = path.resolve(__dirname,'../cli/ink-studio.js');
  fs.writeFileSync(input,contents);
  const command = (action,...args)=>spawnSync(process.execPath,[cli,'tileset',action,'--scene',input,'--id','painted',...args],
    {cwd:dir,encoding:'utf8'});
  const size = ['--width','6','--height','6','--anchor','bottom-right'];
  const preview = command('resize',...size);
  assert.equal(preview.status,0,preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout).sourceOffset,[-2,-2]);
  assert(fs.readdirSync(dir).length === 1);
  const committed = command('resize',...size,'--out',output);
  assert.equal(committed.status,0,committed.stderr);
  assert.deepEqual(JSON.parse(committed.stdout),JSON.parse(preview.stdout));
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).tilesets.painted.width,6);

  const rejected = command('resize','--width','2','--height','2','--out',blocked);
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).canCommit,false);
  assert.equal(fs.existsSync(blocked),false);
  assert.equal(command('resample',...size).status,1);
  const resampled = command('resample','--width','8','--height','8');
  assert.equal(resampled.status,0,resampled.stderr);
  assert.equal(JSON.parse(resampled.stdout).references[0].status,'resampled');
  assert.equal(fs.readFileSync(input,'utf8'),contents);
});
