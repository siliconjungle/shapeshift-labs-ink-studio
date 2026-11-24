'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createPixelEditor,pixelDocumentFromAseprite,pixelDocumentFromLayerDeck } = require('..');
const PNG = require('../cli/png.js');

const rect = (x,y,w,h)=>({ x,y,w,h });
const row = (filename,frame,spriteSourceSize,duration)=>({
  filename,frame,spriteSourceSize,duration,sourceSize:{w:4,h:3},rotated:false,trimmed:true
});
const write = (file,data)=>fs.writeFileSync(file,JSON.stringify(data));
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const cli = path.resolve(__dirname,'../cli/ink-studio.js');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-aseprite-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  return dir;
}

test('Aseprite JSON Array restores trimmed cels and preserves playback, slice keys and packing provenance',t=>{
  const dir = workspace(t), source = path.join(dir,'sprite.json'), sheet = path.join(dir,'sprite.png');
  const out = path.join(dir,'ink.json'), rgba = new Uint8Array(8*4*4);
  const first = row('Lantern idle',rect(0,0,4,3),rect(1,1,2,1),77);
  const second = row('Lantern lit',rect(5,0,1,2),rect(3,0,1,2),142);
  const third = { ...first,filename:'Lantern hold',duration:311 };
  rgba.set([255,255,255,255],0); // packing gutter, outside the cel
  rgba.set([160,32,54,255,36,64,112,127],(8+1)*4);
  rgba.set([249,190,90,255],5*4);
  rgba.set([249,190,90,17],(8+5)*4);
  fs.writeFileSync(sheet,PNG.encode(8,4,rgba,4));
  write(source,{ frames:[first,second,third],meta:{ image:'sprite.png',size:{w:8,h:4},scale:'1',frameTags:[
    {name:'Lantern swing',from:0,to:2,direction:'pingpong_reverse',repeat:'2'},
    {name:'Lantern-swing',from:1,to:2,direction:'forward'}
  ],slices:[
    {name:'Panel',keys:[
      {frame:0,bounds:rect(0,0,3,3),pivot:{x:2,y:1},center:rect(1,1,1,1)},
      {frame:2,bounds:rect(1,0,3,3),pivot:{x:-1,y:2}}
    ]},
    {name:'Bulb',keys:[{frame:0,bounds:rect(1,1,1,1)},{frame:1,bounds:rect(0,0,0,0)}]}
  ]} });

  execFileSync(process.execPath,[cli,'pixel-art','import',source,'--out',out],{ cwd:os.tmpdir() });
  const doc = read(out);
  assert.deepEqual(doc,pixelDocumentFromAseprite(source));
  assert.deepEqual(doc.frames.map(({label,durationMs})=>[label,durationMs]),[
    ['Lantern idle',77],['Lantern lit',142],['Lantern hold',311]
  ]);
  assert.deepEqual(Object.values(doc.palette),['#a02036','#244070','#f9be5a']);
  const editor = createPixelEditor(doc), frame = id=>PNG.raster(editor.png({ frame:id,colorMode:'rgba' })).data;
  assert.deepEqual([...frame('frame-1').subarray(20,28)],[160,32,54,255,36,64,112,127]);
  assert.deepEqual([...frame('frame-1').subarray(0,4)],[0,0,0,0]);
  assert.deepEqual([...frame('frame-2').subarray(28,32)],[249,190,90,17]);
  assert.deepEqual(frame('frame-3'),frame('frame-1'));

  const [swing,loop] = editor.timeline().tags;
  assert.deepEqual([swing.id,swing.repeat,swing.loop,swing.durationMs,swing.order],[
    'lantern-swing',2,false,983,['frame-3','frame-2','frame-1','frame-2','frame-3']
  ]);
  assert.equal(loop.id,'lantern-swing-2');
  assert.equal(loop.loop,true);
  assert.deepEqual(editor.slices({ frame:'frame-2' }).active,[{
    id:'panel',label:'Panel',keyFrame:'frame-1',bounds:[0,0,3,3],pivot:[2,1],
    registration:[2,1],nineSlice:[1,1,1,1],stretch:[1,1,1,1]
  }]);
  assert.deepEqual(editor.slices({ frame:'frame-3' }).active[0].registration,[0,2]);
  assert.deepEqual(editor.slices({ frame:'frame-1' }).active.map(row=>row.id),['panel','bulb']);
  const metadata = doc.legacyMetadata.aseprite;
  assert.deepEqual(metadata.frames[0],{
    id:'frame-1',label:'Lantern idle',frame:[0,0,4,3],spriteSourceSize:[1,1,2,1],sourceSize:[4,3],
    trimmed:true,rotated:false
  });
  assert.deepEqual(metadata.frames[2].frame,metadata.frames[0].frame);
  assert.deepEqual(editor.describe().aseprite,metadata);
  assert.deepEqual(pixelDocumentFromLayerDeck(editor.layerDeck()),doc);

  const pack = editor.exportPreset({
    format:'ink-studio/pixel-export-preset',version:1,id:'panel',outputs:['frames','atlas'],slice:'panel',tag:'lantern-swing'
  },{ out:path.join(dir,'export') });
  assert.deepEqual(pack.frames.map(({frame,durationMs})=>[frame,durationMs]),[
    ['frame-3',311],['frame-2',142],['frame-1',77],['frame-2',142],['frame-3',311]
  ]);
  assert.equal(pack.playback.repeat,2);
});

test('Aseprite JSON Hash retains duplicate indexed swatches and rehomes an off-canvas slice',t=>{
  const dir = workspace(t), file = path.join(dir,'asset.json'), sheet = path.join(dir,'moved.png');
  const pixels = Array(516).fill(null);
  pixels[512] = 0;
  pixels[513] = 1;
  PNG.writeIndexed(sheet,516,1,pixels,[[64,48,32],[64,48,32]]);
  const { filename,...first } = row('Z first',rect(512,0,2,1),rect(1,0,2,1),35);
  const data = { frames:{[filename]:first,'A second':{
    ...first,frame:rect(514,0,2,1),duration:211
  }},meta:{image:'missing.png',slices:[{name:'Wing',keys:[{frame:0,bounds:rect(-1,0,3,2),pivot:{x:0,y:1}}]}]} };
  write(file,data);
  const doc = pixelDocumentFromAseprite(file,{ sheet }), editor = createPixelEditor(doc);
  assert.deepEqual(doc.frames.map(frame=>frame.label),['Z first','A second']);
  assert.deepEqual(doc.palette,{'slot-0':'#403020','slot-1':'#403020'});
  assert.deepEqual([doc.width,doc.height,doc.legacyMetadata.aseprite.canvasOrigin],[5,3,[-1,0]]);
  assert.deepEqual(editor.stamp({frame:'frame-1',layer:'image'}).slots.slice(0,5),[null,null,0,1,null]);
  assert.ok(editor.stamp({frame:'frame-2',layer:'image'}).slots.every(slot=>slot === null));
  assert.deepEqual(editor.slices({frame:'frame-1'}).active[0].registration,[0,1]);
  const bytes = fs.readFileSync(sheet);
  assert.throws(()=>execFileSync(process.execPath,[cli,'pixel-art','import',file,'--sheet',sheet,'--out',sheet],
    { stdio:'pipe' }),/separate file from the sheet PNG/);
  assert.deepEqual(fs.readFileSync(sheet),bytes);
  data.meta.frameTags = [{name:'Outside',from:0,to:2,direction:'forward'}];
  write(file,data);
  assert.throws(()=>pixelDocumentFromAseprite(file,{ sheet }),/Export the complete timeline/);
  delete data.meta.frameTags;
  data.frames[filename].frame.x = 515;
  write(file,data);
  assert.throws(()=>pixelDocumentFromAseprite(file,{ sheet }),/invalid sheet or source bounds/);
});
