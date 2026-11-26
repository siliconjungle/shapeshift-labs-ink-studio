'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), kit = ink.load(), K = kit.KIT, T = K.meshTopology;
const cli = path.join(__dirname,'../cli/ink-studio.js');
const width=12,height=10;
const asset = (width,height)=>ink.createBlankTileset({width,height});
const rgba = [65,157,137,255], foreign = [217,57,108,255];
const writePixels = (image,cells,fill)=>{
  const pixels = Buffer.from(image.data,'base64');
  if (fill) for (let i=0;i<pixels.length;i+=4) pixels.set(fill,i);
  for (const [x,y,color] of cells) pixels.set(color,(y*image.width+x)*4);
  return {...image,data:pixels.toString('base64')};
};
const pixel = (image,x,y)=>[...Buffer.from(image.data,'base64').subarray((y*image.width+x)*4,(y*image.width+x+1)*4)];
function mesh(id,w,h,texels) {
  const vertices = [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]].slice(0,texels.length)
    .map((position,i)=>({id:'v'+i,position}));
  return T.create({id,vertices,faces:[{id:'plate',material:'paint',corners:texels.map(([x,y],i)=>
    ({id:'c'+i,vertex:'v'+i,uv:[x/(w-1),y/(h-1)]}))}]});
}
const slot = {id:'paint',texture:{tileset:'atlas'}};
const base = image=>({id:'gutters',style:'slate',solids:[],tilesets:{atlas:image}});

test('write exterior RGBA gutters, hold unrelated chart and paint, and undo the atlas revision',()=>{
  const original = writePixels(asset(width,height),[[2,2,rgba],[3,2,rgba],[2,3,rgba],[3,3,rgba],[2,1,foreign]]);
  const doc = mesh('spare',width,height,[[5,3],[6,3],[6,2],[5,2]]);
  const scene = {...base(original),topologyMeshes:{spare:{document:doc,materials:[slot]}}};
  const editor = ink.createSceneEditor(scene), request = {tileset:'atlas',padding:2,regions:[{id:'tile',rect:[2,2,2,2]}]};
  const preview = editor.planTilesetGutters(request);
  assert(preview.canCommit && preview.writtenTexels>0);
  assert(preview.occupiedPaint>0 && preview.protectedTexels>0);
  assert.equal(preview.uvEdits,0);
  assert.deepEqual(editor.snapshot(),scene);
  const applied = editor.editTilesetGutters(request);
  assert.deepEqual(preview,applied);
  const output = editor.snapshot();
  assert.deepEqual(output.topologyMeshes,scene.topologyMeshes);
  assert.deepEqual(pixel(output.tilesets.atlas,1,2),rgba);
  assert.deepEqual(pixel(output.tilesets.atlas,2,1),foreign);
  assert.deepEqual(pixel(output.tilesets.atlas,5,2),[0,0,0,0]);
  assert.deepEqual(pixel(output.tilesets.atlas,2,2),rgba);
  assert.equal(editor.planTilesetGutters(request).writtenTexels,0);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  const replace = editor.editTilesetGutters({...request,writable:[[2,1,1,1],[5,2,1,1]]});
  assert(replace.writtenTexels>preview.writtenTexels);
  assert.deepEqual(pixel(editor.snapshot().tilesets.atlas,2,1),rgba);
  assert.deepEqual(pixel(editor.snapshot().tilesets.atlas,5,2),[0,0,0,0]);
});

test('pad actual triangle coverage and retain indexed slots and contested boundaries',()=>{
  const slots = new Uint8Array(width*height);
  for (let y=2;y<=5;y++) for (let x=2;x<=y;x++) slots[y*width+x]=1;
  slots[5*width+9]=2;
  const original = {version:1,width,height,encoding:'indexed8',data:Buffer.from(slots).toString('base64'),
    palette:[0,0x419d89,0xd9396c],alpha:[0,255,255]};
  const doc = mesh('triangle',width,height,[[2,5],[5,5],[2,2]]);
  const scene = {...base(original),topologyMeshes:{relief:{document:doc,materials:[slot]}}};
  const editor = ink.createSceneEditor(scene);
  const report = editor.editTilesetGutters({tileset:'atlas',padding:2,
    regions:[{id:'a',object:'relief',island:'plate'},{id:'b',rect:[9,5,1,1]}]});
  const image = editor.snapshot().tilesets.atlas, bytes = Buffer.from(image.data,'base64');
  assert.equal(report.encoding,'indexed8');
  assert.equal(report.regions[0].sourceTexels,10);
  assert(report.contestedTexels>0);
  assert.deepEqual(image.palette,original.palette);
  assert.deepEqual(image.alpha,original.alpha);
  assert.equal(bytes[3*width+4],1);
  assert.equal(bytes[2*width+5],0);
  assert.equal(bytes[5*width+6],1);
  assert.equal(bytes[5*width+7],0);
  assert.equal(bytes[5*width+8],2);
  assert.equal(bytes[4*width+7],0);
});

test('compare filtered motion using matching isolated-crop references in the CLI',t=>{
  const w=64,h=48, rect=[14,9,28,28], cells=[];
  for (let y=9;y<37;y++) for (let x=14;x<42;x++) cells.push([x,y,rgba]);
  const image = writePixels(asset(w,h),cells,foreign), document = mesh('relay',w,h,[[14,36],[41,36],[41,9],[14,9]]);
  const scene = {...base(image),camera:{target:[0,0,0],dist:8,yaw:.23,pitch:.14,projection:'orthographic'},
    topologyMeshes:{relay:{document,materials:[{...slot,mipmaps:true}]}}};
  const request = {object:'relay',face:'plate',rect,padding:8,writable:[[0,0,w,h]],
    inset:{top:3,bottom:3,left:3,right:3},w:112,h:90,
    views:[16,24,42,54].map((dist,i)=>({t:i/12,camera:{dist,yaw:.62+i*.08,pitch:.26}}))};
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-gutters-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,data)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(data));
  write('scene.json',scene);
  write('request.json',request);
  const args = [cli,'tileset','bleed-review','request.json','--scene','scene.json','--out','review'];
  const report = JSON.parse(execFileSync(process.execPath,args,{cwd,encoding:'utf8'}));
  assert.equal(report.frames.length,4);
  assert.equal(report.inset.paintWrites,0);
  assert.equal(report.inset.uvEdits,4);
  assert.equal(report.gutter.uvEdits,0);
  assert(report.gutter.writtenTexels>0);
  const {baseline,inset,gutter} = report.summary;
  assert(baseline.colorBleedPixels>0,JSON.stringify(report.summary));
  assert(inset.affectedPixels<baseline.affectedPixels);
  assert.equal(gutter.affectedPixels,0);
  assert.equal(baseline.referencePixels,gutter.referencePixels);
  for (const file of report.files) assert(fs.existsSync(path.join(cwd,'review',file)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd,'scene.json'),'utf8')),scene);
});
