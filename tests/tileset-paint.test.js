'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), K = ink.load().KIT, T = K.meshTopology;
const PNG = require('../cli/png.js');
const cli = path.join(__dirname,'../cli/ink-studio.js');
const width=18,height=14;

function fixture() {
  const asset = ink.createBlankTileset({width,height,background:'#426875'});
  const pixels = Buffer.from(asset.data,'base64');
  pixels.set([9,7,5,0],(3*width+4)*4);
  const document = T.create({id:'crop-overlay',vertices:[[0,0,0],[3,0,0],[3,2,0],[0,2,0]]
    .map((position,i)=>({id:'v'+i,position})),faces:[{id:'sign',material:'enamel',
      corners:[[3,10],[12,10],[12,3],[3,3]].map(([x,y],i)=>({id:'c'+i,vertex:'v'+i,uv:[x/(width-1),y/(height-1)]}))}]});
  const scene = {id:'tileset-canvas',style:'slate',solids:[],
    tilesets:{atlas:{...asset,data:pixels.toString('base64'),tileSize:{width:5,height:5,paddingX:2,paddingY:1,offsetX:1,offsetY:2}}},
    topologyMeshes:{sign:{document,materials:[{id:'enamel',texture:{tileset:'atlas'}}],
      bakes:[{id:'finish',material:'enamel',maps:{roughness:.5}}]}}};
  const selection = ink.pickTilesetRectangle(scene,'atlas',{x:3,y:3,width:8,height:7});
  return {scene,selection,document};
}

function paint(document,id,operation) {
  const editor = ink.createPixelEditor(document);
  editor.apply({id,frame:'artwork',revision:editor.describe().revision,operation:{layer:'image',...operation}});
  return editor.snapshot();
}

test('open an atlas-aligned crop with display-only references and write only edited texels',()=>{
  const {scene,selection,document:mesh} = fixture(), editor = ink.createSceneEditor(scene);
  const opened = ink.openTilesetPaint(editor,{tileset:'atlas',selection,grid:true,uv:{object:'sign'}});
  assert.deepEqual(opened.binding.rect,[3,3,8,7]);
  assert.equal(opened.binding.scope,'crop');
  assert.deepEqual(opened.binding.overlays.grid.columns,[3,5]);
  assert.deepEqual(opened.binding.overlays.grid.rows,[4,5]);
  assert.equal(opened.binding.overlays.uv.meshRevision,T.revision(mesh));
  assert(opened.binding.overlays.uv.pixels>0);
  const pixel = ink.createPixelEditor(opened.document);
  const clean = pixel.stamp(), over = pixel.stamp({references:true});
  assert.notDeepEqual(clean.slots,over.slots);
  assert.deepEqual(opened.document.layers.map(row=>[row.id,row.kind ?? 'paint']),
    [['image','paint'],['tile-grid','reference'],['uv-outline','reference']]);
  assert.equal(ink.writeTilesetPaint(editor,opened.binding,opened.document).changedTexels,0);

  const changed = paint(opened.document,'highlight',{tool:'rgba',pixels:[{at:[2,2],rgba:[231,149,92,160]}]});
  const preview = ink.writeTilesetPaint(editor,opened.binding,changed);
  assert(preview.canCommit,JSON.stringify(preview.conflicts));
  assert.equal(preview.changedTexels,1);
  assert.deepEqual(preview.samples[0].at,[5,5]);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(ink.writeTilesetPaint(editor,opened.binding,changed,{apply:true}),preview);
  const after = editor.snapshot(), oldBytes = Buffer.from(scene.tilesets.atlas.data,'base64');
  oldBytes.set([231,149,92,160],(5*width+5)*4);
  assert.deepEqual(Buffer.from(after.tilesets.atlas.data,'base64'),oldBytes);
  assert.deepEqual(after.tilesets.atlas.tileSize,scene.tilesets.atlas.tileSize);
  assert.deepEqual(after.topologyMeshes.sign.document,mesh);
  assert.deepEqual(after.topologyMeshes.sign.bakes[0].invalidated.faces,['sign']);
  assert.equal(ink.writeTilesetPaint(editor,opened.binding,changed).conflicts[0].code,'stale-tileset-paint');
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);

  const masquerade = {...opened.document,layers:opened.document.layers.map(row=>row.id==='tile-grid' ? {...row,kind:'paint'} : row)};
  assert.equal(ink.writeTilesetPaint(ink.createSceneEditor(scene),opened.binding,masquerade).conflicts[0].code,'overlay-is-paint');
});

test('keep indexed colors and alpha exact and distinguish duplicate palette slots on the whole sheet',()=>{
  const image = {version:1,width:4,height:2,encoding:'indexed8',data:Buffer.from([1,0,2,3,0,1,2,3]).toString('base64'),
    palette:[0x448678,0x448678,0x101010,0x112223],alpha:[255,255,170,0]};
  const scene = {id:'indexed-canvas',solids:[],tilesets:{atlas:image}};
  const editor = ink.createSceneEditor(scene), {document,binding} = ink.openTilesetPaint(editor,{tileset:'atlas'});
  assert.equal(binding.scope,'sheet');
  assert.deepEqual(binding.rect,[0,0,4,2]);
  const changed = paint(document,'swap-index',{tool:'pencil',swatch:'slot-1',points:[[1,0]]});
  const revised = paint(changed,'paint-different-color',{tool:'rgba',pixels:[{at:[2,0],rgba:[237,147,85,97]}]});
  const report = ink.writeTilesetPaint(editor,binding,revised,{apply:true});
  assert.equal(report.changedTexels,2);
  assert.equal(report.paletteAdded,1);
  assert.deepEqual(report.samples,[
    {at:[1,0],before:0,after:1},{at:[2,0],before:2,after:4}
  ]);
  const output = editor.snapshot().tilesets.atlas;
  assert.equal(output.encoding,'indexed8');
  assert.deepEqual([...Buffer.from(output.data,'base64')],[1,1,4,3,0,1,2,3]);
  assert.deepEqual(output.palette,[...image.palette,0xed9355]);
  assert.deepEqual(output.alpha,[255,255,170,0,97]);

  const full = {...image,palette:Array.from({length:256},(_,i)=>i)};
  const limited = ink.createSceneEditor({...scene,tilesets:{atlas:full}});
  const open = ink.openTilesetPaint(limited,{tileset:'atlas'});
  const edited = paint(open.document,'palette-limit',{tool:'rgba',pixels:[{at:[0,0],rgba:[255,200,100,255]}]});
  assert.equal(ink.writeTilesetPaint(limited,open.binding,edited,{apply:true}).conflicts[0].code,'indexed-palette-full');
  assert.deepEqual(limited.snapshot().tilesets.atlas,full);
});

test('preserve native spacing in brush crops and reject stale UV overlays',()=>{
  const {scene} = fixture(), editor = ink.createSceneEditor(scene);
  const selection = ink.pickTilesetBlock(scene,'atlas',{x:1,y:2,width:12,height:11});
  const open = ink.openTilesetPaint(editor,{tileset:'atlas',selection,uv:{object:'sign',mode:'faces'}});
  assert.deepEqual(open.binding.rect,[1,2,12,11]);
  editor.editMeshTopology('sign',{vertices:[{id:'v0',position:[0,.2,0]}]});
  assert.equal(ink.writeTilesetPaint(editor,open.binding,open.document).conflicts[0].code,'stale-uv-overlay');
});

test('use existing pixel commands with a saved crop and write a new scene through the CLI',t=>{
  const {scene,selection} = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-paint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save = (name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  save('scene.json',scene);
  save('request.json',{tileset:'atlas',grid:true,uv:{object:'sign'}});
  save('selection.json',selection);
  run('tileset','paint','open','request.json','--scene','scene.json','--selection','selection.json','--out','crop');
  const clean=PNG.raster(path.join(dir,'crop/paint.png')), overlay=PNG.raster(path.join(dir,'crop/overlay.png'));
  assert.deepEqual([clean.w,clean.h,overlay.w,overlay.h],[8,7,8,7]);
  assert.notDeepEqual(clean.data,overlay.data);
  const source = ink.createPixelEditor(read('crop/paint.json'));
  save('stroke.json',{id:'stroke',frame:'artwork',revision:source.describe().revision,
    operation:{tool:'rgba',layer:'image',pixels:[{at:[3,4],rgba:[255,88,67,255]}]}});
  run('pixel-art','edit','crop/paint.json','stroke.json','--out','edited.json');
  const args = ['tileset','paint','write','crop/binding.json','edited.json','--scene','scene.json'];
  const preview = JSON.parse(run(...args));
  assert.deepEqual(preview.samples.map(row=>row.at),[[6,7]]);
  assert.deepEqual(JSON.parse(run(...args,'--out','revised.json')),preview);
  assert.deepEqual(read('scene.json'),scene);
  const rewritten = read('revised.json');
  assert.deepEqual([...Buffer.from(rewritten.tilesets.atlas.data,'base64').subarray((7*width+6)*4,(7*width+6)*4+4)],
    [255,88,67,255]);
  const rejected = spawnSync(process.execPath,[cli,...args.slice(0,-1),'revised.json','--out','blocked.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).conflicts[0].code,'stale-tileset-paint');
  assert(!fs.existsSync(path.join(dir,'blocked.json')));
});
