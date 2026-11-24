'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { deflateSync } = require('node:zlib');
const { createPixelEditor,pixelDocumentFromAseprite,pixelDocumentFromAsepriteTiles,pixelDocumentFromLayerDeck } = require('..');
const PNG = require('../cli/png.js');

const bytes = (...items)=>Buffer.from(items);
const empty = size=>Buffer.alloc(size);
const join = (...parts)=>Buffer.concat(parts);
const words = (...values)=>join(...values.map(value=>{
  const result = empty(2);
  result.writeUInt16LE(value & 0xffff);
  return result;
}));
const dwords = (...values)=>join(...values.map(value=>{
  const result = empty(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}));
const string = value=>{
  const encoded = Buffer.from(value);
  return join(words(encoded.length),encoded);
};
const chunk = (type,...data)=>join(dwords(6+data.reduce((n,x)=>n+x.length,0)),words(type),...data);
const layer = (name,{ flags = 3,type = 0,level = 0,blend = 0,opacity = 255,tileset,uuid } = {})=>chunk(0x2004,
  words(flags,type,level,0,0,blend),bytes(opacity),empty(3),string(name),
  ...(tileset === undefined ? [] : [dwords(tileset)]),...(uuid ? [uuid] : []));
const cel = (layer,type,{ x = 0,y = 0,opacity = 255,z = 0 } = {},...body)=>chunk(0x2005,
  words(layer,x,y),bytes(opacity),words(type,z),empty(5),...body);
const palette = (count,first,...entries)=>chunk(0x2019,dwords(count,first,first+entries.length-1),empty(8),
  ...entries.map(([rgba,label])=>join(words(label ? 1 : 0),bytes(...rgba),...(label ? [string(label)] : []))));
const frame = (duration,...chunks)=>{
  const body = join(...chunks);
  return join(dwords(body.length+16),words(0xf1fa,0xffff,duration,0),dwords(chunks.length),body);
};
const sprite = ({width = 4,height = 3,depth = 8,flags = 1,colors = 4},...frames)=>{
  const body = join(...frames);
  return join(dwords(body.length+128),words(0xa5e0,frames.length,width,height,depth),dwords(flags),
    words(90),empty(12),words(colors),bytes(2,1),words(0,0,2,2),empty(84),body);
};
const red = [200,20,10,255], green = [8,160,40,255], blue = [30,40,200,255];
const rgbaAt = (rgba,width,x,y)=>[...rgba.subarray((y*width+x)*4,(y*width+x+1)*4)];
const rgba = (editor,frame)=>PNG.raster(editor.png({frame,colorMode:'rgba'})).data;
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const command = (...args)=>execFileSync(process.execPath,[cli,'pixel-art',...args],{ encoding:'utf8',cwd:os.tmpdir(),stdio:'pipe' });
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-layered-ase-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('layered indexed import preserves groups, exact swatches, held artwork, offsets and cel opacity',t=>{
  const uuid = bytes(...Array.from({length:16},(_,i)=>i));
  const tags = chunk(0x2018,words(1),empty(8),words(0,2),bytes(3),words(2),empty(10),string('Light Sweep'));
  const slice = chunk(0x2022,dwords(1,3,0),string('Lamp'),dwords(0,1,0,3,3,1,1,1,1,2,1));
  const old = chunk(0x0004,words(1),bytes(0,1,255,255,255));
  const source = sprite({flags:7},frame(77,old,
    palette(4,0,[[0,0,0,255],'Invisible'],[red,'Clay'],[[200,20,10,128],'Wash'],[[30,40,200,0],'Slate']),
    layer('Housing',{type:1,opacity:204,uuid}),layer('Pigment',{level:1,uuid}),
    layer('Guide',{flags:0,blend:4,uuid}),
    cel(1,0,{x:1,y:1},words(3,1),bytes(1,2,3)),
    tags,slice,chunk(0x2020,dwords(1),string('source note'))
  ),frame(0,cel(1,1,{x:0,y:2,opacity:128,z:1},words(0))),
  frame(201,palette(4,1,[green,'Jade']),cel(1,1,{x:2,y:0},words(0))));
  const doc = pixelDocumentFromAseprite(source), editor = createPixelEditor(doc);
  assert.deepEqual(doc.pixelAspect,[2,1]);
  assert.deepEqual(doc.layers.map(row=>[row.label,row.kind,row.parent,row.visible,row.locked]),[
    ['Housing','group',undefined,true,false],['Pigment','paint','layer-1',true,false],['Guide','paint',undefined,false,true]
  ]);
  assert.deepEqual(doc.frames[1].cels['layer-2'],{ offset:[0,2],opacity:128,hold:'frame-1/layer-2' });
  assert.equal(doc.frames[2].cels['layer-2'].slots[0],'slot-1-08a028');
  assert.deepEqual(doc.frames.map(row=>row.durationMs),[77,90,201]);
  assert.deepEqual(doc.palette['slot-1'],{ color:'#c8140a',label:'Clay' });
  assert.deepEqual(doc.palette['slot-2'],{ color:'#c8140a',label:'Wash' });
  const hidden = editor.stamp({frame:'frame-1',layer:'layer-2'});
  assert.equal(hidden.swatchIds[hidden.slots[7]],'slot-3');
  assert.equal(hidden.alpha[7],0);
  assert.deepEqual(rgbaAt(rgba(editor,'frame-2'),4,0,2),[200,20,10,102]);
  assert.deepEqual(rgbaAt(rgba(editor,'frame-2'),4,1,2),[200,20,10,51]);
  assert.deepEqual(rgbaAt(rgba(editor,'frame-3'),4,2,0),[8,160,40,204]);
  assert.deepEqual(editor.timeline().tags[0].order,['frame-3','frame-2','frame-1','frame-2','frame-3']);
  assert.deepEqual(editor.slices({frame:'frame-2'}).active[0].registration,[3,1]);
  const { report,paletteHistory,layers,cels } = doc.legacyMetadata.asepriteFile;
  assert.deepEqual(report.issues.map(row=>row.code).sort(),['blend-mode','cel-z-index','link-materialized','palette-timeline','user-data']);
  assert.equal(paletteHistory[1].entries[1].label,'Jade');
  assert.equal(layers[0].uuid,'000102030405060708090a0b0c0d0e0f');
  assert.equal(cels[2].link,'frame-1/layer-2');
  assert.deepEqual(rgba(createPixelEditor(pixelDocumentFromLayerDeck(editor.layerDeck())),'frame-2'),rgba(editor,'frame-2'));
  assert.equal(editor.inspect([0,2],{frame:'frame-2'}).composite.alpha,102);

  const dir = workspace(t), file = path.join(dir,'lamp.aseprite'), output = path.join(dir,'lamp.json');
  fs.writeFileSync(file,source);
  assert.deepEqual(JSON.parse(command('import',file,'--out',output)),report);
  assert.deepEqual(read(output),JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(JSON.parse(command('validate',output)).asepriteFile,report);
});

test('embedded tiles retain sparse placements, flip flags, spare art and linked map cels',t=>{
  const tilePixels = join(empty(16),bytes(...red,...green,...blue,255,224,64,255),bytes(...green,...red,...red,...green));
  const compressed = deflateSync(tilePixels);
  const tileset = chunk(0x2023,dwords(7,6,3),words(2,2,1),empty(14),string('Machine'),
    dwords(compressed.length),compressed);
  const map = cel(0,3,{},words(2,2,32),dwords(0x1fffffff,0x80000000,0x40000000,0x20000000),empty(10),
    deflateSync(dwords(1,0x80000001,0x20000001,0)));
  const source = sprite({height:4,depth:32},frame(100,tileset,layer('Floor',{type:2,tileset:7}),map),
    frame(110,cel(0,1,{x:1},words(0))));
  const doc = pixelDocumentFromAseprite(source), editor = createPixelEditor(doc);
  assert.deepEqual(doc.frames[1].cels['layer-1'],{offset:[1,0],hold:'frame-1/layer-1'});
  const frame1 = rgba(editor,'frame-1');
  assert.deepEqual(rgbaAt(frame1,4,0,0),red);
  assert.deepEqual(rgbaAt(frame1,4,2,0),green);
  assert.deepEqual(rgbaAt(frame1,4,0,3),green);
  assert.deepEqual(rgbaAt(frame1,4,3,3),[0,0,0,0]);
  assert.deepEqual(rgbaAt(rgba(editor,'frame-2'),4,1,0),red);

  const options = {frame:'frame-2',layer:'layer-1'}, tileDoc = pixelDocumentFromAsepriteTiles(doc,options);
  assert.deepEqual(tileDoc.tilemap.cells,[
    {at:[0,0],tile:'tile-1'}, {at:[1,0],tile:'tile-1-flip-1'}, {at:[0,1],tile:'tile-1-flip-4'}
  ]);
  assert.ok(tileDoc.frames.some(row=>row.id === 'tile-2'));
  assert.deepEqual(tileDoc.legacyMetadata.asepriteTilemap.offset,[1,0]);
  const tiles = createPixelEditor(tileDoc), flipped = rgba(tiles,'tile-1-flip-4');
  assert.deepEqual(rgbaAt(flipped,2,0,1),green);
  const dir = workspace(t), json = path.join(dir,'map.json'), out = path.join(dir,'tiles.json');
  fs.writeFileSync(json,JSON.stringify(doc));
  command('aseprite-tiles',json,'--layer','layer-1','--frame','frame-2','--out',out);
  assert.deepEqual(read(out),tileDoc);
});

test('grayscale compressed cels render with alpha and damaged inputs fail before publication',t=>{
  const image = cel(0,2,{},words(2,1),deflateSync(bytes(45,255,180,123)));
  const source = sprite({width:2,height:1,depth:16},frame(100,layer('Wash'),image));
  const editor = createPixelEditor(pixelDocumentFromAseprite(source));
  assert.deepEqual([...rgba(editor,'frame-1')],[45,45,45,255,180,180,180,123]);
  assert.throws(()=>pixelDocumentFromAseprite(source.subarray(0,-1)),/complete binary/);
  const damaged = sprite({width:2,height:1,depth:16},frame(100,layer('Wash'),cel(0,2,{},words(2,1),deflateSync(bytes(45,255)))));
  const dir = workspace(t), file = path.join(dir,'damaged.ase'), out = path.join(dir,'doc.json');
  fs.writeFileSync(file,damaged);
  assert.throws(()=>command('import',file,'--out',out),/image byte count/);
  assert.equal(fs.existsSync(out),false);
});
