'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'face-grow-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const drawing = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eae2cc')=>({type:'text',text,at:[x,y],scale,color});
function sheet(width,height,commands) {
  const {data} = drawing.render({width,height,edges:'hard',commands});
  return ink.readTilesetImage(PNG.encode(width,height,data,4));
}
const draft = {id:'folded-watch-post',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:12},tilesets:{
  wall:sheet(24,12,[
    rect(0,0,24,12,'#694d48'),rect(0,1,24,10,'#996752'),rect(0,1,24,1,'#c18d64'),
    rect(0,4,24,1,'#785745'),rect(0,8,24,1,'#785745'),
    rect(3,2,1,2,'#785745'),rect(19,2,1,2,'#785745'),rect(5,5,1,3,'#785745'),
    rect(17,5,1,3,'#785745'),rect(11,9,1,2,'#785745'),rect(7,5,9,3,'#df9a62'),
    rect(8,5,7,2,'#f0c482'),rect(10,5,3,1,'#6b5147')
  ]),
  roof:sheet(16,12,[
    rect(0,0,16,12,'#264955'),rect(1,0,14,11,'#3b7380'),rect(1,1,14,1,'#76a89e'),
    rect(1,3,14,1,'#578f95'),rect(1,6,14,1,'#305d6e'),rect(1,9,14,1,'#305d6e'),
    rect(5,2,1,9,'#2d5561'),rect(10,2,1,9,'#2d5561'),
    rect(6,7,3,2,'#b49e77'),rect(7,7,1,1,'#d7bb8a'),rect(1,11,14,1,'#90b5a6')
  ])
}};
const seed = ink.createSceneEditor(draft);
seed.placeTilesetFace({object:'post',face:'wall',selection:ink.pickTilesetRectangle(draft,'wall',{x:0,y:0,width:24,height:12})});
const original = JSON.parse(JSON.stringify(seed.snapshot()));
const doc = original.topologyMeshes.post.document;
const eave = doc.edges.find(edge=>edge.vertices.includes('wall/v2') && edge.vertices.includes('wall/v3'));
Object.assign(eave,{id:'eave',smooth:false,uvSeam:true});
json('wall.json',original);

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

studio(['tileset','pick','--scene','wall.json','--id','roof','--x','0','--y','0','--width','16','--height','12','--out','roof-tile.json']);
const crop = read('roof-tile.json');
const setup = ['tileset','grow','--scene','wall.json','--object','post','--edge','eave','--face','roof',
  '--selection','roof-tile.json','--angle','-60'];
for (const [name,args,depth] of [['proportional',[],1.5],['explicit',['--depth','.55'],.55]]) {
  studio([...setup,...args],name+'-preview.json');
  studio([...setup,...args,'--out',name+'.json'],name+'-receipt.json');
  const receipt = read(name+'-receipt.json');
  const saved = read(name+'.json').topologyMeshes.post;
  assert.deepEqual(receipt,read(name+'-preview.json'));
  assert.deepEqual(receipt.size,[2,depth]);
  assert.deepEqual(receipt.sharedVertices.map(vertex=>vertex.id),['wall/v3','wall/v2']);
  assert.equal(saved.document.vertices.length,6);
  assert.deepEqual(saved.document.edges.find(edge=>edge.id === 'eave'),eave);
}
const sdk = ink.createSceneEditor(original);
sdk.growTilesetFace({object:'post',edge:'eave',face:'roof',angle:-60,selection:crop});
assert.equal(sdk.history().undo.at(-1),'Grow roof');
sdk.undo();
assert.deepEqual(sdk.snapshot(),original);

const views = [
  ['wall','SOURCE EDGE','2 SCENE UNITS'],
  ['proportional','PROPORTIONAL','2 X 1.5 / 16 X 12 CROP'],
  ['explicit','EXPLICIT DEPTH','2 X 0.55 / SAME CROP']
];
for (const [name] of views)
  studio(['render',name+'.json','--w','146','--h','102','--px','1','--ortho','--yaw','.48','--pitch','.48',
    '--target','1,.88,-.45','--zoom','3.7','--raw','--out',name+'-1x.png']);

const W=960,H=392,Y=133,panels=[23,334,645];
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#14232d'),text('INK STUDIO / PAINTED MESHES',23,19,2,'#a8dfc0'),
  text('Grow a tile from a shared edge',23,48,3),
  text('-60 DEG FOLD / MATCHED CAMERA / NATIVE 1X CAPTURES SHOWN AT 2X',23,82,1),
  ...views.flatMap(([,label,note],i)=>[
    text(label,panels[i],108,2,'#a8dfc0'),rect(panels[i]-1,Y-1,294,206,'#4a6e75'),
    text(note,panels[i],354,1)
  ])
]});
for (const [i,[name]] of views.entries()) {
  const {w,h,data} = PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i]+x)*4);
  }
}
write('Face-grow.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\ncmp proportional-preview.json proportional-receipt.json\ncmp explicit-preview.json explicit-receipt.json\n');
write('README.md',`# Grow a tile from a shared edge

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. Both roof faces
reuse the same 2-unit eave and fold by 60 degrees. One fits the crop's
proportions at a depth of 1.5 units. The other uses an explicit depth
of 0.55 units. Each scene includes two shared endpoints, two new
vertices, and its own retained paint crop.
`);
