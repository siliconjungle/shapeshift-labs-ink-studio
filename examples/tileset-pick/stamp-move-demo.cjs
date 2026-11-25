'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {atlas:gatehouseAtlas} = require('../gatehouse-revision/portal.cjs');

const dir = path.resolve(process.argv[2] ?? 'tileset-stamp-move-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>fs.readFileSync(file(name));
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const width=65,height=17, pixels = new Uint8Array(width*height*4);
const {width:portalWidth,pixels:portalPixels} = gatehouseAtlas();
function pixel(x,y,rgba) {
  pixels.set(rgba,(y*width+x)*4);
}
for (let y=0;y<height;y++) for (let x=0;x<width;x++) pixel(x,y,[28,40,49,255]);
for (let y=0;y<8;y++) {
  for (let x=0;x<16;x++) {
    const at=((24+y)*portalWidth+24+x)*4;
    pixel(1+x,3+y,portalPixels.subarray(at,at+4));
  }
  for (let x=0;x<48;x++) {
    const edge = y === 0 || y === 7 || x === 0 || x === 47;
    const brass = (x === 3 || x === 44 || x === 23) && (y === 2 || y === 5);
    const stripe = (x+y*2)%10<2;
    pixel(17+x,3+y,edge ? [31,56,64,255] : brass ? [230,175,106,255] :
      stripe ? [118,175,150,255] : [65,122,124,255]);
  }
}
const source = {id:'stamp-move-gate',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{masonry:ink.readTilesetImage(PNG.encode(width,height,pixels,4))}};
const editor = ink.createSceneEditor(source);
const brick = ink.pickTilesetRectangle(source,'masonry',{x:1,y:3,width:16,height:8});
for (const [side,x] of [['left',0],['right',2]]) for (let row=0;row<3;row++) {
  editor.placeTilesetFace({object:'entrance',face:side+'-'+row,selection:brick,origin:[x,row*.5,0]});
}
json('posts.json',editor.snapshot());

studio(['tileset','pick','--scene','posts.json','--id','masonry','--x','17','--y','3','--width','48','--height','8',
  '--out','lintel-pick.json']);
const stamp=['tileset','stamp','--scene','posts.json','--object','entrance','--face','lintel',
  '--selection','lintel-pick.json','--origin','0,1.5,0'];
const placed=JSON.parse(studio(stamp,'stamp-preview.json'));
assert.equal(placed.face,'lintel');
assert.equal(placed.source.selection.width,48);
assert.equal(placed.vertices.length,4);
assert.deepEqual(JSON.parse(studio([...stamp,'--out','stamped.json'],'stamp-commit.json')),placed);

const move=['mesh-topology','move','stamped.json','--object','entrance','--vertex','lintel/v2','--by','.30,.34,0'];
const edited=JSON.parse(studio(move,'move-preview.json'));
assert.deepEqual(edited.vertices,[{id:'lintel/v2',before:[3,2,0],after:[3.3,2.34,0],weight:1,selected:true}]);
assert.deepEqual(JSON.parse(studio([...move,'--expect',edited.beforeRevision,'--out','moved.json'],'move-commit.json')),edited);
const [stamped,moved]=['stamped.json','moved.json'].map(name=>JSON.parse(read(name)).topologyMeshes.entrance);
assert.deepEqual(moved.document.faces,stamped.document.faces);
assert.deepEqual(moved.bindings,stamped.bindings);

const renders = ['posts','stamped','moved'];
for (const scene of renders) {
  studio(['render',scene+'.json','--w','146','--h','105','--px','1','--ortho','--target','1.56,1.16,0',
    '--zoom','2.7','--yaw','0','--pitch','0','--raw','--out',scene+'-1x.png']);
}
assert.notDeepEqual(read('posts-1x.png'),read('stamped-1x.png'));
assert.notDeepEqual(read('stamped-1x.png'),read('moved-1x.png'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp stamp-preview.json stamp-commit.json\ncmp move-preview.json move-commit.json\n');
write('README.md',`# Lintel stamp and vertex move

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. It saves the
lintel pick, previews and commits a stamp, then previews and commits
a one-vertex move. The two JSON previews show the source and new corners
for the stamp, and exact before and after positions for the move.
The 1× renders use the same camera.
`);

const W=964,H=383,x=[25,336,647];
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121d28'),
  text('INK STUDIO / TILESET AND TOPOLOGY',25,20,2,'#a6e3cd'),
  text('Lintel placement and vertex edit',25,49,3),
  text('EXISTING POSTS',x[0],106,2),
  text('TILESET STAMP',x[1],106,2,'#a6e3cd'),
  text('MESH-TOPOLOGY MOVE',x[2],106,2,'#ffc789'),
  ...x.map(value=>rect(value-1,134,294,212,'#506d75')),
  text('6 EDITABLE QUADS',x[0],358,1),
  text('ADDED LINTEL / 48 x 8 TEXEL PICK',x[1],358,1,'#a6e3cd'),
  text('LINTEL/V2 MOVED / UVS RETAINED',x[2],358,1,'#ffc789')
]});
for (const [j,name] of renders.entries()) {
  const {w,h,data}=PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let i=0;i<w*2;i++) {
    const at=(Math.floor(y/2)*w+Math.floor(i/2))*4;
    board.data.set(data.subarray(at,at+4),((135+y)*W+x[j]+i)*4);
  }
}
write('Stamp-and-vertex-move.png',PNG.encode(W,H,board.data,4));
