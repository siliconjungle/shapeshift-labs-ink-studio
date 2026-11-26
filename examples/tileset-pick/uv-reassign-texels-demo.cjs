'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-reassign-texels-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f1e6cf')=>({type:'text',text,at:[x,y],scale,color});
function image(id,width,height,pigment) {
  const {data} = art.render({width,height,edges:'hard',commands:[
    rect(0,0,width,height,'#25353b'),rect(1,1,width-2,height-2,'#293e47'),
    ...Array.from({length:Math.floor(width/8)},(_,i)=>rect(i*8,0,1,height,'#344d56')),
    ...Array.from({length:Math.floor(height/8)},(_,i)=>rect(0,i*8,width,1,'#344d56')),
    rect(8,12,41,21,'#273c42'),rect(9,13,39,19,pigment),rect(9,13,39,1,'#b7b0a0'),
    rect(9,29,39,2,'#415d59'),rect(11,16,18,11,'#283d42'),rect(11,16,18,1,'#69868a'),
    text('R2',14,18,1,'#f5d19a'),text('08',34,16,1,'#f5d19a'),rect(33,25,15,1,'#d8b789'),
    rect(17,43,39,4,'#425b63'),rect(54,46,12,21,'#384f52')
  ]});
  const png = PNG.encode(width,height,data,4);
  write(id+'.png',png);
  return ink.readTilesetImage(png);
}
const tilesets = {
  original:image('original-atlas',64,64,'#64757a'),
  expanded:image('expanded-atlas',96,80,'#537878'),
  narrow:image('narrow-atlas',42,30,'#8c6751')
};
const vertices = [[-1.48,0,0],[0,0,0],[1.48,0,-.08],[-1.48,1.03,0],[0,1.03,0],[1.48,1.03,-.08]]
  .map((position,i)=>({id:'v'+i,position}));
const faces = [[0,1,4,3],[1,2,5,4]].map((keys,i)=>{
  const id = i ? 'return' : 'panel', l = 8+i*20;
  const points = [[l,32],[l+20,32],[l+20,12],[l,12]];
  return {id,material:'enamel',corners:keys.map((j,k)=>({id:id+'/'+k,vertex:'v'+j,uv:points[k].map(n=>n/63)}))};
});
const document = T.create({id:'relay-plate',vertices,faces});
const scene = {id:'relay-atlas-reassignment',style:'slate',solids:[],
  camera:{target:[0,.52,0],dist:3.5,yaw:-.08,pitch:.12,projection:'orthographic',sway:0},
  tilesets,topologyMeshes:{sign:{document,materials:[{id:'enamel',texture:{tileset:'original'}}]}}};
json('sign.json',scene);
const w=216,h=112, atlasSize=174;
json('view.json',{w,h:atlasSize});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const base = {object:'sign',ids:['panel','return'],revision:T.revision(document),mode:'sheet',mapping:'preserve-texels'};
const scenarios = [
  ['expanded',{tileset:'expanded'}],
  ['strict',{tileset:'narrow'}],
  ['clamped',{tileset:'narrow',clamp:true}]
];
for (const [id,settings] of scenarios) {
  json(id+'-request.json',{...base,...settings});
  const edit = ['tileset','assign',id+'-request.json','--scene','sign.json'];
  run(edit.concat('--view','view.json','--preview',id+'-review'),id+'-preview.json');
  const {preview,...planned} = read(id+'-preview.json');
  if (id==='strict') {
    assert(!planned.canCommit);
    assert.equal(preview.nativeAfter,'current');
    assert(planned.conflicts.every(row=>row.reason==='texel-outside-tileset'));
    continue;
  }
  assert(planned.canCommit);
  run(edit.concat('--out',id+'.json'),id+'-receipt.json');
  const receipt = read(id+'-receipt.json');
  assert.deepEqual(planned,receipt);
  assert.deepEqual(read(id+'.json').topologyMeshes.sign.document.vertices,document.vertices);
}
const expanded = read('expanded-receipt.json'), clamped = read('clamped-receipt.json'), strict = read('strict-preview.json');
assert(expanded.faces.every(face=>face.corners.every(row=>row.texels.before.every((n,i)=>n===row.texels.after[i]))));
assert.deepEqual(strict.faces,clamped.faces);
const clampedCount = clamped.faces.reduce((sum,row)=>sum+row.after.clampedCorners.length,0);
assert(clampedCount>=1);

for (const [id,scene] of [['original','sign.json'],['expanded','expanded.json'],['clamped','clamped.json']])
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--raw','--edges','off','--out',id+'-1x.png']);

const W=712,H=439,x=i=>19+i*232;
const poster = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#192a33'),text('INK STUDIO / TILESET UV',19,16,2,'#a3c8c4'),
  text('Reassign at texel scale',19,43,3),
  text('64 X 64  SOURCE',x(0),86,2),text('96 X 80  EXPANDED',x(1),86,2),text('42 X 30  CLAMPED',x(2),86,2),
  text('NATIVE RENDER / 1X',x(0),111,1,'#a6c4c6'),
  text('ATLAS FOOTPRINT',x(0),248,1,'#a6c4c6'),
  text('SAME TEXEL COORDINATES',x(1),405,1,'#a6c4c6'),
  rect(x(2),404,7,7,'#f391a6'),text(clampedCount+' CLAMPED CORNERS',x(2)+13,405,1,'#f6bec7'),
  text('STRICT PREVIEW BLOCKED THE EDIT',x(2),419,1,'#f6bec7')
]});
function blit(name,left,top,crop=0) {
  const image = PNG.raster(file(name));
  for (let row=0;row<image.h-2*crop;row++) {
    const start = (row+crop)*image.w*4, out = ((top+row)*W+left)*4;
    poster.data.set(image.data.subarray(start,start+image.w*4),out);
  }
}
for (const [i,id] of ['original','expanded','clamped'].entries()) {
  blit(id+'-1x.png',x(i),125);
  blit((i ? id+'-review/atlas-after.png' : 'expanded-review/atlas-before.png'),x(i)+21,264,25);
}
write('UV-reassign-texels.png',PNG.encode(W,H,poster.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Reassign a sheet at texel scale

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
review images, edited scenes, native renders, and receipts.

Both faces of the enamel sign keep their original texel coordinates
when the 64×64 sheet is replaced by its 96×80 version. The strict
preview for a 42×30 sheet reports the corners outside its bounds.
The explicit clamp shows how those corners move to the outer texel
centers and squeeze the sampled region on the narrower sheet.
`);
