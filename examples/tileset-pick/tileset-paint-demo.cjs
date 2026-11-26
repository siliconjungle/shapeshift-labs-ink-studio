'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'tileset-paint-demo'), cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eee1c6')=>({type:'text',text,at:[x,y],scale,color});
const width=54,height=34;
const sheet = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#233942'),rect(2,4,28,22,'#314d54'),
  rect(6,7,21,15,'#677d70'),rect(7,8,19,1,'#a6ad84'),rect(7,19,19,2,'#486660'),
  rect(9,11,13,7,'#283d44'),text('R4',11,12,1,'#eac088'),
  rect(33,5,18,8,'#47586b'),rect(34,6,16,1,'#9e9d85'),
  rect(33,18,18,10,'#5b646c'),rect(34,19,16,1,'#8897a4'),
  rect(34,25,16,2,'#435964'),rect(6,29,21,3,'#526e71')
]});
const image = PNG.encode(width,height,sheet.data,4);
write('atlas.png',image);
const vertices = [[-1.2,0,0],[1.2,0,0],[1.2,1.4,0],[-1.2,1.4,0]].map((position,i)=>({id:'v'+i,position}));
const doc = T.create({id:'enamel-sign',vertices,faces:[{id:'plate',material:'enamel',
  corners:[[6,21],[26,21],[26,7],[6,7]].map(([x,y],i)=>({id:'c'+i,vertex:'v'+i,uv:[x/(width-1),y/(height-1)]}))}]});
const scene = {id:'paint-relay-sheet',style:'slate',solids:[],
  tilesets:{enamel:{...ink.readTilesetImage(image),tileSize:{width:14,height:12,paddingX:2,paddingY:2,offsetX:2,offsetY:3}}},
  topologyMeshes:{sign:{document:doc,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}},
  camera:{target:[0,.7,0],dist:4,yaw:-.11,pitch:.12,projection:'orthographic'}};
json('relay.json',scene);
json('paint-request.json',{tileset:'enamel',grid:true,uv:{object:'sign'}});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
run(['tileset','pick','--scene','relay.json','--id','enamel','--x',4,'--y',5,'--width',25,'--height',20,'--out','pick.json']);
run(['tileset','paint','open','paint-request.json','--scene','relay.json','--selection','pick.json','--out','crop'],'crop-open.json');
function edit(directory,name,points,rgba) {
  const pixels = ink.createPixelEditor(read(directory+'/paint.json'));
  json(name+'-patch.json',{id:name,frame:'artwork',revision:pixels.describe().revision,
    operation:{tool:'rgba',layer:'image',pixels:points.map(at=>({at,rgba}))}});
  run(['pixel-art','edit',directory+'/paint.json',name+'-patch.json','--out',name+'.json']);
}
edit('crop','highlight',[[5,13],[6,13],[7,13],[8,13],[13,13],[14,13],[15,13],[16,13]],[231,159,100,255]);
run(['tileset','paint','write','crop/binding.json','highlight.json','--scene','relay.json','--out','crop-edited.json'],'crop-receipt.json');
run(['pixel-art','draw','highlight.json','--out','highlight']);
run(['tileset','paint','open','paint-request.json','--scene','crop-edited.json','--out','sheet'],'sheet-open.json');
edit('sheet','maker-mark',[[37,22],[38,22],[39,22],[40,22],[40,23],[39,24],[38,24],[37,24]],[163,209,188,255]);
run(['tileset','paint','write','sheet/binding.json','maker-mark.json','--scene','crop-edited.json','--out','sheet-edited.json'],'sheet-receipt.json');
run(['pixel-art','draw','maker-mark.json','--out','maker-mark']);
assert.equal(read('crop-receipt.json').changedTexels,8);
assert.deepEqual(read('crop-receipt.json').samples[0].at,[9,18]);
assert.equal(read('sheet-receipt.json').changedTexels,8);
assert.deepEqual(read('sheet-edited.json').topologyMeshes.sign.document,doc);

const W=636,H=351;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#192b35'),text('INK STUDIO / TILESET PAINT',18,15,2,'#a9c9c0'),
  text('Paint a crop or the whole sheet',18,42,3),
  text('PICKED CROP',18,89,2),text('GRID + UV',176,89,2),text('CROP EDIT',378,89,2),
  text('SOURCE-ALIGNED',18,109,1,'#a9c9c0'),text('DISPLAY ONLY',176,109,1,'#a9c9c0'),
  text('8 TEXELS WRITTEN',378,109,1,'#a9c9c0'),
  text('WHOLE SHEET',18,227,2),text('SHEET EDIT',272,227,2),text('8 MORE TEXELS',430,241,1,'#a9c9c0')
]});
function blit(name,left,top,scale) {
  const image = PNG.raster(file(name));
  for (let y=0;y<image.h*scale;y++) for (let x=0;x<image.w*scale;x++) {
    const at = (Math.floor(y/scale)*image.w+Math.floor(x/scale))*4;
    if (image.data[at+3]) board.data.set(image.data.subarray(at,at+4),((y+top)*W+left+x)*4);
  }
}
blit('crop/paint.png',18,126,4);
blit('crop/overlay.png',176,126,4);
blit('highlight/art.png',378,126,4);
blit('sheet/overlay.png',18,255,2);
blit('maker-mark/art.png',272,255,2);
write('Tileset-paint.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Paint a picked crop or the whole sheet

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to recreate the
native canvases, both edits, previews, and revised scenes.

The crop edit adds a warm highlight under the relay label. The sheet
edit adds a mint mark to a different tile. Both use the existing pixel
editor, with tile-grid and UV reference layers visible in the overlay
exports and absent from the written atlas.
`);
