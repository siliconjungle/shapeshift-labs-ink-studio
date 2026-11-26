'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-normalization-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const boards = [
  {id:'lead',x:2,at:[-1.44,.82,0],paint:{},colors:['#684631','#b98152','#f2bf7f']},
  {id:'turned',x:17,at:[.09,.82,0],paint:{rotation:90},colors:['#6c443d','#b76b54','#efb68a']},
  {id:'reversed',x:32,at:[-1.44,0,0],paint:{rotation:180},colors:['#596045','#9d965c','#e1c783']},
  {id:'mirrored',x:47,at:[.09,0,0],paint:{flipX:true},colors:['#4c5d56','#759788','#d3c795']}
];
const width=62,height=15;
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#22343e'),
  ...boards.flatMap(({x,colors:[dark,body,light]})=>[
    rect(x,3,13,9,dark),rect(x,3,13,1,light),rect(x,4,13,7,body),
    rect(x+1,5,11,1,dark),rect(x+2,6,4,1,light),rect(x+1,9,8,1,dark),
    rect(x+4,7,6,1,light),rect(x+8,6,1,1,light),rect(x+8,8,1,1,light),
    rect(x+1,7,1,1,dark),rect(x+11,8,1,1,dark),rect(x+8,10,4,1,light)
  ])
]});
const texture = PNG.encode(width,height,painted.data,4);
write('wood-atlas.png',texture);
const scene = {id:'board-grain-reference',style:'slate',solids:[],
  camera:{target:[0,.77,0],dist:4.15,yaw:-.1,pitch:.09,projection:'orthographic',sway:0},
  tilesets:{wood:ink.readTilesetImage(texture)}};
const editor = ink.createSceneEditor(scene);
for (const {id,x,at,paint} of boards) {
  const selection = ink.pickTilesetRectangle(scene,'wood',{x,y:3,width:13,height:9});
  editor.placeTilesetFace({object:'siding',face:id,selection,origin:at,worldSize:[1.35,.72],paint});
}
const before = editor.snapshot(), doc = before.topologyMeshes.siding.document;
const edge = doc.edges.find(row=>row.vertices.includes('lead/v0') && row.vertices.includes('lead/v1')).id;
json('boards.json',before);
const w=214,h=130,atlasSize=178;
json('view.json',{w,h:atlasSize,raw:true});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const target = ['--object','siding','--channel','pigment'];
function pick(id,query) {
  json(id+'-query.json',query);
  run(['mesh-uv','select','boards.json',id+'-query.json',...target,'--out',id+'-selection.json']);
  return read(id+'-selection.json');
}
const selection = pick('boards',{domain:'faces',ids:boards.map(row=>row.id)});
const face = pick('reference-face',{domain:'faces',ids:['lead']});
const side = pick('reference-edge',{domain:'edges',ids:[edge]});
function capture(id,scene) {
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
}
capture('original','boards.json');
const cases = [
  {id:'face',title:'Match a face',note:'COPY GRAIN AND HANDEDNESS',reference:{selection:face}},
  {id:'edge',title:'Follow an edge',note:'ALIGN GRAIN TO THE EDGE',reference:{selection:side,from:'lead/v0'}}
];
for (const {id,reference} of cases) {
  json(id+'-request.json',{revision:T.revision(doc),operations:[{
    op:'normalize-orientation',selection,reference,maxError:0
  }]});
  const edit = ['mesh-uv','edit','boards.json',id+'-request.json',...target];
  run(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  run(edit.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), receipt = read(id+'-receipt.json');
  assert(preview.canCommit);
  assert.deepEqual(preview.operations,receipt.operations);
  const evidence = receipt.operations[0].evidence;
  assert.equal(evidence.reference.kind,id);
  assert.deepEqual(preview.preview.normalization.faces,evidence.faces);
  assert(evidence.faces.every(row=>row.status==='reference' || row.afterError<=1e-9));
  assert.equal(evidence.faces.find(row=>row.face==='mirrored').flipX,id==='face');
  assert.deepEqual(read(id+'.json').topologyMeshes.siding.document.vertices,doc.vertices);
  for (const board of boards) {
    const name = id+'-'+board.id+'-eyedrop.json';
    run(['tileset','eyedrop','--scene',id+'.json','--object','siding','--face',board.id],name);
    const dropped = read(name);
    assert(dropped.canStamp);
    assert.deepEqual([dropped.selection.x,dropped.selection.y,dropped.selection.width,dropped.selection.height],[board.x,3,13,9]);
    if (id==='face') assert.deepEqual(dropped.paint,{rotation:0,flipX:false,flipY:false});
  }
  capture(id,id+'.json');
}

const W=716,H=358, x=i=>18+i*232, top=125, atlasY=281;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Normalize board grain',18,42,3),
  ...[{title:'Original',note:'MIXED PAINT DIRECTIONS'},...cases].flatMap(({title,note},i)=>[
    text(title,x(i),80,2),text(note,x(i),101,1,'#e5c289')
  ]),
  text('NATIVE RENDER / 1X',18,113,1,'#a4c5c1'),
  text('SOURCE ATLAS',18,267,1,'#a4c5c1'),
  rect(18,341,7,7,'#ffe181'),text('REFERENCE FACE OR EDGE',31,341,1)
]});
function blit(name,left,top,cropY=0,zoom=1) {
  const image=PNG.raster(file(name));
  for (let row=0;row<(image.h-2*cropY)*zoom;row++) for (let col=0;col<image.w*zoom;col++) {
    const src=((Math.floor(row/zoom)+cropY)*image.w+Math.floor(col/zoom))*4, dst=((top+row)*W+left+col)*4;
    board.data.set(image.data.subarray(src,src+4),dst);
  }
}
blit('wood-atlas.png',x(0)+14,atlasY+4,0,3);
for (const [i,id] of ['original',...cases.map(row=>row.id)].entries()) {
  blit(id+'-1x.png',x(i),top);
  if (i) blit(id+'-preview/atlas-after.png',x(i)+Math.floor((w-atlasSize)/2),atlasY,62);
}
write('UV-normalization.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Normalize board grain

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
captures, previews, receipts, and exact atlas crop checks.

The four boards start with one standard, one turned, one reversed, and
one mirrored mapping. Match the painted reference face to align both
direction and handedness. Follow the directed edge to align the grain
while keeping each board's existing mirror parity. Both edits retain
all four original atlas crops.
`);
