'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'sequence-collection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f0e3ca')=>({type:'text',text,at:[x,y],scale,color});
const line = (x,y,w,color)=>rect(x,y,w,1,color);
const shapes = {
  field:x=>[line(x+2,5,6,'#488173'),line(x+7,10,7,'#2a4c55'),line(x+11,7,3,'#488173'),line(x+3,8,2,'#5a8e78')],
  seam:x=>[rect(x+6,4,4,9,'#1b3844'),rect(x+6,3,2,9,'#6f9c7a'),rect(x+8,3,1,10,'#38665f'),
    rect(x+6,6,2,2,'#b5aa73'),rect(x+6,10,2,1,'#95a47c')],
  crest:x=>[rect(x+2,4,12,8,'#20404a'),rect(x+4,5,8,6,'#386359'),rect(x+5,7,6,2,'#ca905a'),
    rect(x+7,5,2,6,'#ca905a'),rect(x+7,6,2,3,'#f2bf7d'),line(x+6,7,4,'#f2bf7d'),line(x+6,11,4,'#162f3b')],
  rivet:x=>[rect(x+3,6,3,3,'#294e50'),rect(x+10,6,3,3,'#294e50'),rect(x+3,6,2,2,'#ad8856'),
    rect(x+10,6,2,2,'#ad8856'),line(x+4,6,1,'#ebc781'),line(x+11,6,1,'#ebc781')]
};
const variants = Object.keys(shapes);
const motif = ['field','seam','crest','seam','field','rivet'];
const atlas = draw.render({width:64,height:16,edges:'hard',commands:variants.flatMap((id,i)=>{
  const x = i*16;
  return [rect(x,0,16,16,'#152b38'),rect(x,2,16,12,'#3b7167'),line(x,2,16,'#8baa78'),line(x,3,16,'#568e75'),
    line(x,13,16,'#244450'),line(x,14,16,'#50675d'),...shapes[id](x)];
})});
const png = PNG.encode(64,16,atlas.data,4);
write('Enamel-atlas.png',png);
const scene = {id:'sequenced-facade',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{enamel:ink.readTilesetImage(png)}};
json('facade-draft.json',scene);
json('collection-draft.json',{id:'enamel-frieze',sequence:motif,entries:variants.map((id,i)=>({id,
  weight:[8,2,0,1][i],selection:ink.pickTilesetRectangle(scene,'enamel',{x:i*16,y:0,width:16,height:16})}))});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
const collection = JSON.parse(studio(['tileset','collection','create','collection-draft.json','--scene','facade-draft.json',
  '--out','collection.json']));
const pick = JSON.parse(studio(['tileset','collection','play','collection.json','--scene','facade-draft.json','--step','8',
  '--out','crest-pick.json'],'step-8.json'));
assert.equal(pick.id,'crest');
assert.equal(pick.weight,0);

let before = 'facade-draft.json';
for (const [row,start] of [0,2,4].entries()) {
  const id = 'course-'+row;
  const stroke = row===0;
  const placement = stroke ? {mode:'draw',interval:1,path:[[0,row],[11,row]]} : {mode:'fill',from:[0,row],to:[11,row]};
  json(id+'-request.json',{id,object:'wall',...placement,sequenceStart:start});
  const args = ['tileset',stroke ? 'stroke' : 'rectangle',id+'-request.json','--scene',before,'--collection','collection.json'];
  const preview = studio(args,id+'-preview.json');
  const after = row===2 ? 'painted-facade.json' : id+'-scene.json';
  assert.equal(studio([...args,'--out',after],id+'-receipt.json'),preview);
  const report = JSON.parse(preview);
  assert.deepEqual((report.samples ?? report.cells).map(cell=>cell.variant.id),
    Array.from({length:12},(_,i)=>ink.playTilesetCollection(scene,collection,{step:start+i}).id));
  before = after;
}
studio(['render','painted-facade.json','--w','192','--h','86','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','6,1.5,0','--zoom','1.5','--raw','--out','Facade-1x.png']);

const W = 980,H = 448;
const board = draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#162930'),text('INK STUDIO / TILE MESHES',24,20,2,'#a3c4a2'),
  text('An authored tile sequence',24,52,3),text('36 EDITABLE FACES / THREE COURSE OFFSETS',24,89,2),
  rect(23,129,578,260,'#507773'),text('NATIVE 1X CAPTURE SHOWN AT 3X',24,406,1,'#a3c4a2'),
  text('ONE CYCLE',632,129,2,'#a3c4a2'),text('FIELD > SEAM > CREST > SEAM > FIELD > RIVET',632,208,1),
  text('COURSE OFFSETS',632,250,2,'#a3c4a2'),
  text('TOP        STEP 4',632,282,2),text('MIDDLE     STEP 2',632,310,2),text('BOTTOM     STEP 0',632,338,2),
  text('CREST HAS WEIGHT ZERO AND PLAYS IN THE MOTIF',632,378,1,'#a3c4a2')
]});
function blit(data,width,crop,at,scale) {
  const [sx,sy,w,h] = crop, [dx,dy] = at;
  for (let y=0;y<h*scale;y++) for (let x=0;x<w*scale;x++) {
    const start = ((sy+Math.floor(y/scale))*width+sx+Math.floor(x/scale))*4;
    board.data.set(data.subarray(start,start+4),((dy+y)*W+dx+x)*4);
  }
}
const facade = PNG.raster(file('Facade-1x.png'));
blit(facade.data,facade.w,[0,0,facade.w,facade.h],[24,130],3);
motif.forEach((id,i)=>blit(atlas.data,64,[16*variants.indexOf(id),0,16,16],[632+52*i,154],3));
write('Tile-sequence.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+[0,1,2].map(row=>
  `cmp course-${row}-preview.json course-${row}-receipt.json`).join('\n')+'\n');
write('README.md',`# Play a tile collection in sequence

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. A six-tile enamel
motif repeats on 36 editable faces. Each row starts at a different step.
The lower row uses a draw stroke. The other rows use rectangle fills.
The manual pick at step 8 resolves to the crest, which has weight zero.
\`Facade-1x.png\` is the native camera capture of the finished mesh.
`);
