'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'tile-grid-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
const navy = '#1b2b34', mint = '#b1edc5', amber = '#f5c27d', slate = '#aec5c4';
const size = {width:64,height:42};
const paint = art.render({...size,edges:'hard',commands:[
  rect(0,0,64,42,'#24363e'),...Array.from({length:7},(_,i)=>rect(0,6*i,64,1,'#2c4148')),
  rect(5,6,54,30,'#324e55'),rect(6,7,52,28,'#658e88'),rect(8,8,48,2,'#b5d0ac'),
  rect(8,15,48,11,'#294a53'),text('LOCK 12',11,17,1,'#eee4b1'),
  ...[9,17,25,33,41,49].map(x=>rect(x,30,5,2,'#d7a366')),
  ...[[7,12],[54,12],[7,32],[54,32]].map(([x,y])=>rect(x,y,2,2,'#b5d0ac'))
]});
const atlasPNG = PNG.encode(size.width,size.height,paint.data,4);
write('enamel-atlas.png',atlasPNG);
const scene = {id:'lock-number',style:'slate',solids:[],
  camera:{target:[0,.71,.04],dist:3.2,yaw:.20,pitch:.15,projection:'orthographic',sway:0},
  tilesets:{enamel:ink.readTilesetImage(atlasPNG)}};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',{x:5,y:6,width:54,height:30});
editor.placeTilesetFace({object:'sign',face:'panel',selection:crop,origin:[-1.34,.09,0],worldSize:[2.68,1.24]});
const doc = editor.meshTopology('sign').document;
json('sign.json',editor.snapshot());
json('grid.json',{id:'lock-grid',revision:T.revision(doc),
  operation:{kind:'subdivide-face',face:'panel',rows:2,columns:3}});

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const repair = ['mesh-topology','edge-edit','sign.json','grid.json','--object','sign'];
run(repair,'preview.json');
run(repair.concat('--out','tiled.json','--report','receipt.json'));
const preview = read('preview.json'), {cells,grid,atlas} = preview.report.detail;
assert(preview.report.canCommit);
assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
assert.equal(cells.length,6);
assert.equal(preview.patch.lineage.faces.length,5);
for (const [i,{face}] of cells.entries()) {
  const name = 'cell-'+(i+1)+'-crop.json';
  run(['tileset','eyedrop','--scene','tiled.json','--object','sign','--face',face,'--out',name]);
  const pick = read(name);
  assert.equal(pick.sourceStatus,'retained');
  assert.deepEqual(pick.selection,atlas.children[i].selection);
}

const w = 155, h = 104, zoom = 2, W = 1018, H = 366, y = 111;
const view = {w,h,px:1,ortho:true,raw:true};
for (const id of ['sign','tiled']) run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
assert.deepEqual(fs.readFileSync(file('sign-1x.png')),fs.readFileSync(file('tiled-1x.png')));
commands.push('cmp sign-1x.png tiled-1x.png');

let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width === w && raster.height === h) { camera = raster; focal = sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view), panelX = i=>16+i*333;
const project = p=>{
  const offset = K.V.sub(p,pose.eye);
  return [Math.round(panelX(1)+w+zoom*focal*K.V.dot(offset,pose.right)),Math.round(y+h-zoom*focal*K.V.dot(offset,pose.up))];
};
const atlasZoom = 4, atlasAt = [panelX(2)+27,y+20];
const atlasPoint = ([u,v])=>[Math.round(atlasAt[0]+atlasZoom*(u+.5)),Math.round(atlasAt[1]+atlasZoom*(v+.5))];
function lattice(points,color) {
  const guides = points.concat(points[0].map((_,column)=>points.map(row=>row[column])));
  return guides.flatMap(points=>[line(points,navy,3),line(points,color,1)]);
}
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Subdivide one painted tile into a grid',16,43,3),
  ...[
    ['Original tile','ONE FACE / AUTHORED UVS',slate],
    ['2 rows x 3 columns','SIX EDITABLE QUADS / IDENTICAL 1X PAINT',mint],
    ['Source atlas','EVERY CELL HAS A REUSABLE CROP',amber]
  ].flatMap(([title,note,color],i)=>[
    text(title,panelX(i),87,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#506e74'),
    rect(panelX(i),y,w*zoom,h*zoom,'#14252a'),text(note,panelX(i),332,1,color)
  ])
]});
function place(data,width,height,x,y,scale) {
  for (let row=0;row<height*scale;row++) for (let col=0;col<width*scale;col++) {
    const at = (Math.floor(row/scale)*width+Math.floor(col/scale))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
}
place(PNG.raster(file('sign-1x.png')).data,w,h,panelX(0),y,zoom);
place(PNG.raster(file('tiled-1x.png')).data,w,h,panelX(1),y,zoom);
place(paint.data,size.width,size.height,...atlasAt,atlasZoom);
const marks = art.render({width:W,height:H,edges:'hard',commands:[
  ...lattice(grid.map(row=>row.map(node=>project(node.position))),mint),
  ...lattice(atlas.grid.map(row=>row.map(atlasPoint)),amber)
]}).data;
for (let i=0;i<marks.length;i+=4) if (marks[i+3]) board.data.set(marks.subarray(i,i+4),i);
write('Tile-grid.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Subdivide a painted tile into rows and columns

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the native renders, six source picks, preview, and edit receipt.

The 2-by-3 grid keeps the original face ID on the first cell. Its
receipt links the other five cells to the same face and shows the
grid in mesh positions and atlas texels. The native render is
byte-identical before and after the edit.
`);
