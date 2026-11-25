'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'face-eyedrop-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const drawing = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eae1cc')=>({type:'text',text,at:[x,y],scale,color});
const sheet = drawing.render({width:20,height:12,edges:'hard',commands:[
  rect(0,0,20,12,'#422e51'),
  rect(2,2,16,8,'#21343e'),rect(3,3,14,6,'#35676b'),
  rect(3,3,14,1,'#80b1a2'),rect(3,8,14,1,'#2b5058'),
  rect(5,5,2,2,'#d7985b'),rect(9,5,6,2,'#f2ca84'),
  rect(12,4,2,4,'#f2ca84'),rect(15,5,1,2,'#f2ca84'),
  rect(16,5,1,1,'#f2ca84')
]});
const draft = {id:'eyedrop-wayfinding',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{signs:ink.readTilesetImage(PNG.encode(20,12,sheet.data,4))}};
write('draft.json',JSON.stringify(draft,null,2)+'\n');

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

studio(['tileset','stamp','--scene','draft.json','--id','signs','--x','2','--y','2','--width','16','--height','8',
  '--object','west','--face','gate-sign','--material','route-enamel','--brush-scale','1.5','--paint-flip-x',
  '--out','source.json'],'source-receipt.json');

const eyedrop = ['tileset','eyedrop','--scene','source.json','--object','west','--face','gate-sign'];
studio([...eyedrop,'--brush-size','--out','pick.json'],'pick-receipt.json');
studio(eyedrop,'pick-without-size.json');
const pick = read('pick.json');
assert.deepEqual(pick,read('pick-receipt.json'));
assert.equal(pick.sourceStatus,'retained');
assert.deepEqual(pick.paint,{rotation:0,flipX:true,flipY:false});
assert.deepEqual(pick.brushSize,[1.5,.75]);
assert.equal(Object.hasOwn(read('pick-without-size.json').stamp,'worldSize'),false);

const copy = ['tileset','stamp','--scene','source.json','--selection','pick.json','--object','east','--face','gate-sign-copy',
  '--origin','4.25,0,0','--right','0,1,0','--up','-1,0,0'];
studio(copy,'copy-preview.json');
studio([...copy,'--out','copied.json'],'copy-receipt.json');
const preview = read('copy-preview.json');
assert.deepEqual(preview,read('copy-receipt.json'));
assert.deepEqual(preview.corners.map(c=>c.uv),pick.uv.map(c=>c.uv));
assert.deepEqual(preview.size,pick.brushSize);
assert.equal(preview.material,pick.material);
const sdk = ink.createSceneEditor(read('source.json'));
const history = sdk.history();
assert.deepEqual(sdk.eyedropTilesetFace({object:'west',face:'gate-sign',brushSize:true}),pick);
assert.deepEqual(sdk.history(),history);

for (const [scene,name,target] of [['source.json','source-1x.png','.75,.375,0'],['copied.json','copy-1x.png','3.875,.75,0']])
  studio(['render',scene,'--w','152','--h','100','--px','1','--ortho','--yaw','0','--pitch','0','--target',target,
    '--zoom','5.2','--raw','--out',name]);

const W=1000,H=390,Y=126;
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#12222b'),
  text('INK STUDIO / PAINTED MESHES',24,19,2,'#a4dabc'),
  text('Eyedrop and restamp a painted face',24,50,3),
  text('SOURCE FACE',24,101,2,'#a4dabc'),rect(23,Y-1,306,202,'#4a6a72'),
  text('RECOVERED PICK',356,101,2,'#a4dabc'),rect(355,Y-1,288,202,'#4a6a72'),
  rect(356,Y,286,200,'#1b313b'),
  text('ATLAS   2, 2 / 16 X 8',374,Y+25,1),
  text('MATERIAL   ROUTE-ENAMEL',374,Y+55,1),
  text('PAINT   FLIP X',374,Y+85,1),
  text('SIZE   1.5 X 0.75',374,Y+115,1),
  text('SOURCE   RETAINED',374,Y+145,1,'#a4dabc'),
  text('RESTAMPED PICK',671,101,2,'#a4dabc'),rect(670,Y-1,306,202,'#4a6a72'),
  text('NATIVE 1X CAPTURES SHOWN AT 2X',24,350,1)
]});
for (const [x0,name] of [[24,'source-1x.png'],[671,'copy-1x.png']]) {
  const {w,h,data} = PNG.raster(file(name));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+x0+x)*4);
  }
}
write('Face-eyedrop.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\ncmp copy-preview.json copy-receipt.json\ncmp pick.json pick-receipt.json\n');
write('README.md',`# Eyedrop a painted face

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The original
stamp uses mirrored paint and a scaled face. Eyedrop captures its
atlas crop, material, UV orientation, and world size. The second stamp
uses the saved pick and its own world frame. The bundle includes the
plain pick without size, the full receipt, and native render captures.
`);
