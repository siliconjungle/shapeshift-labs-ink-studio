'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {atlas:paintedPortal} = require('../gatehouse-revision/portal.cjs');

const dir = path.resolve(process.argv[2] ?? 'tileset-place-face-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>fs.readFileSync(file(name));
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const width=65,height=33, brick=[3,5,16,16], trim=[38,5,16,16], pixels = new Uint8Array(width*height*4);
const portal = paintedPortal();
const paint = (x,y,rgba)=>pixels.set(rgba,(y*width+x)*4);
for (let y=0;y<height;y++) for (let x=0;x<width;x++) paint(x,y,[26+(x+y)%2*5,37,48,255]);
for (let y=0;y<16;y++) for (let x=0;x<16;x++) {
  const at=((24+y%8)*portal.width+24+x)*4;
  paint(brick[0]+x,brick[1]+y,portal.pixels.subarray(at,at+4));
  const frame = x === 0 || x === 15 || y === 0 || y === 15;
  const bolt = [2,13].includes(x) && [2,13].includes(y);
  const bar = (x+y)%7 < 2 || [3,12].includes(y);
  paint(trim[0]+x,trim[1]+y,frame ? [36,55,60,255] : bolt ? [224,166,104,255] :
    bar ? [112,166,144,255] : [68,127,122,255]);
}
write('masonry.png',PNG.encode(width,height,pixels,4));
write('empty-gate.json',JSON.stringify({id:'tile-placed-gate',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16}},null,2)+'\n');
studio(['tileset','import','masonry.png','--scene','empty-gate.json','--id','masonry',
  '--tile-width','16','--tile-height','16','--out','gate-0.json'],'import.json');
for (const [name,[x,y,w,h]] of [['brick',brick],['trim',trim]])
  studio(['tileset','pick','--scene','gate-0.json','--id','masonry','--x',x,'--y',y,'--width',w,'--height',h,
    '--out',name+'-pick.json']);

const tiles = [
  ['left-foot','brick','0,0,0'],['right-foot','brick','2,0,0'],['left-post','brick','0,1,0'],
  ['right-post','brick','2,1,0'],['left-trim','trim','0,2,0'],['lintel','trim','1,2,0'],
  ['right-trim','trim','2,2,0'],['return-foot','brick','3,0,0','0,0,-1'],
  ['return-post','brick','3,1,0','0,0,-1'],['return-trim','trim','3,2,0','0,0,-1']
];
for (const [i,[id,pick,origin,right]] of tiles.entries()) {
  const args=['tileset','place','--scene','gate-'+i+'.json','--selection',pick+'-pick.json',
    '--object','entrance','--face',id,'--origin',origin,...(right ? ['--right',right] : [])];
  if (id === 'lintel') studio(args,'lintel-preview.json');
  const report=JSON.parse(studio([...args,'--out','gate-'+(i+1)+'.json'],id+'-placement.json'));
  assert.equal(report.canCommit,true);
}
const gate='gate-'+tiles.length+'.json', swapped='gate-swapped.json';
const snapshot = JSON.parse(read(gate)), row=snapshot.topologyMeshes.entrance;
assert.equal(row.document.faces.length,tiles.length);
assert.equal(row.materials.length,1);
assert.equal(row.bindings.length,tiles.length);
const swap=JSON.parse(studio(['tileset','swap','--scene',gate,'--id','masonry','--a',brick.join(','),'--b',trim.join(','),
  '--out',swapped],'swap-preview.json'));
assert.equal(swap.references.length,tiles.length);
assert.equal(swap.sourceBindings.length,tiles.length);
assert.equal(swap.sourceBindings.find(ref=>ref.face === 'lintel').after.selection.x,brick[0]);

for (const [source,out] of [[gate,'gate-1x.png'],[swapped,'gate-swapped-1x.png']])
  studio(['render',source,'--w','191','--h','125','--px','1','--ortho','--target','1.6,1.45,-.2',
    '--zoom','2.25','--yaw','.55','--pitch','.12','--raw','--out',out]);
assert.deepEqual(read('gate-1x.png'),read('gate-swapped-1x.png'));
const {data} = PNG.raster(file('gate-1x.png'));
let count=0;
for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) count++;
assert(count>2500);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp gate-1x.png gate-swapped-1x.png\n');
write('README.md',`# Painted tile placement demo

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. It imports the
atlas, saves two texel picks, places ten faces on two planes, and renders
the gate at 1×. The final atlas swap moves the source rectangles and
UVs together. The script checks both native-resolution frames byte for
byte. Read \`lintel-preview.json\` for the exact face placement.
`);

const W=804,H=442;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121d28'),
  text('INK STUDIO / PAINTED TILE PLACEMENT',26,20,2,'#a6e3cd'),
  text('Gatehouse built from two atlas picks',26,51,3),
  text('SOURCE ATLAS',26,104,2),
  text('EDITABLE MESH AT 1X',389,104,2),
  rect(25,139,327,167,'#4a666f'),rect(388,139,384,252,'#4a666f'),
  text('BRICK / 3,5,16,16',26,320,1),text('TRIM / 38,5,16,16',201,320,1),
  text('10 QUADS / 1 SHARED MATERIAL',389,414,1,'#a6e3cd'),
  text('ATLAS SWAP MATCHED BYTE FOR BYTE',26,414,1,'#a6e3cd')
]});
function blit(name,x,y,zoom) {
  const {w,h,data} = PNG.raster(file(name));
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit('masonry.png',26,140,5);
blit('gate-1x.png',389,140,2);
write('Painted-tile-placement.png',PNG.encode(W,H,board.data,4));
