'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'subdivision-orientation-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
const navy = '#1b2b34', mint = '#b2e8c3', amber = '#ffcc86', slate = '#aec5c4';
const plate = art.render({width:54,height:30,edges:'hard',commands:[
  rect(0,0,54,30,'#2b4853'),rect(1,1,52,28,'#698a81'),rect(3,3,48,2,'#c5d4aa'),
  rect(3,10,48,11,'#345159'),text('LEVEL 7',6,12,1,'#f3dfb2'),
  ...[5,13,21,29,37,45].map(x=>rect(x,24,4,2,'#d19b67')),
  ...[[3,6],[49,6],[3,26],[49,26]].map(([x,y])=>rect(x,y,2,2,'#bfd0a8'))
]});
const atlas = PNG.encode(54,30,plate.data,4);
write('plate-atlas.png',atlas);
const center = [0,1.3,0], angle = 73*Math.PI/180, width = 2.5, height = 1.28;
const right = [Math.cos(angle),Math.sin(angle),0], up = [-right[1],right[0],0];
const origin = K.V.mad(K.V.mad(center,right,-width/2),up,-height/2);
const scene = {id:'level-indicator',style:'slate',solids:[],
  camera:{target:center,dist:4.6,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{plate:ink.readTilesetImage(atlas)}};
const editor = ink.createSceneEditor(scene);
const selection = ink.pickTilesetRectangle(scene,'plate',{x:0,y:0,width:54,height:30});
editor.placeTilesetFace({object:'sign',face:'panel',selection,origin,right,up,worldSize:[width,height]});
const doc = editor.meshTopology('sign').document;
json('sign.json',editor.snapshot());
for (const basis of ['uv','camera']) json(basis+'-request.json',{id:'level-grid',revision:T.revision(doc),
  operation:{kind:'subdivide-face',face:'panel',rows:2,columns:4,basis}});

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const details = {};
for (const basis of ['uv','camera']) {
  const args = ['mesh-topology','edge-edit','sign.json',basis+'-request.json','--object','sign'];
  run(args,basis+'-preview.json');
  run(args.concat('--out',basis+'.json','--report',basis+'-receipt.json'));
  const preview = read(basis+'-preview.json');
  assert(preview.report.canCommit);
  assert.deepEqual(read(basis+'-receipt.json').edgeEdit,preview.report);
  assert.equal(preview.report.detail.children.length,8);
  details[basis] = preview.report.detail;
}
assert.deepEqual(details.uv.orientation.axes.map(row=>row.faceAxis),['u','v']);
assert.deepEqual(details.camera.orientation.axes.map(row=>row.faceAxis),['v','u']);
assert.notDeepEqual(details.uv.grid,details.camera.grid);

const w = 154, h = 126, zoom = 2, W = 1018, H = 407, y = 110;
const view = {w,h,px:1,ortho:true,raw:true};
for (const id of ['sign','uv','camera'])
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
for (const id of ['uv','camera']) {
  assert.deepEqual(fs.readFileSync(file('sign-1x.png')),fs.readFileSync(file(id+'-1x.png')));
  commands.push('cmp sign-1x.png '+id+'-1x.png');
}
let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width === w && raster.height === h) { camera = raster; focal = sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view), panelX = i=>16+i*333;
const project = (i,p)=>{
  const offset = K.V.sub(p,pose.eye);
  return [Math.round(panelX(i)+w+zoom*focal*K.V.dot(offset,pose.right)),Math.round(y+h-zoom*focal*K.V.dot(offset,pose.up))];
};
function guides(detail,i) {
  const grid = detail.grid.map(row=>row.map(node=>project(i,node.position)));
  const rows = grid.map(points=>[points,amber]);
  const columns = grid[0].map((_,j)=>[grid.map(row=>row[j]),mint]);
  return rows.concat(columns).flatMap(([points,color])=>[line(points,navy,3),line(points,color)]);
}
const cases = [
  ['sign','Rotated tile','73 DEGREES IN THE VIEW'],
  ['uv','UV basis','COLUMNS FOLLOW INCREASING PAINT U'],
  ['camera','Camera basis','COLUMNS FOLLOW THE SCREEN-RIGHT EDGE']
];
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Choose the basis for a rotated tile',16,43,3),
  ...cases.flatMap(([,title,note],i)=>[
    text(title,panelX(i),86,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#506e74'),
    text(note,panelX(i),374,1,slate)
  ]),
  text('2 ROWS X 4 COLUMNS IN EACH GRID',16,393,1,slate),
  text('COLUMN BOUNDARIES',349,393,1,mint),text('ROW BOUNDARIES',682,393,1,amber)
]});
for (const [i,[id]] of cases.entries()) {
  const {data} = PNG.raster(file(id+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+panelX(i)+column)*4);
  }
}
const marks = art.render({width:W,height:H,edges:'hard',commands:[...guides(details.uv,1),...guides(details.camera,2)]}).data;
for (let i=0;i<marks.length;i+=4) if (marks[i+3]) board.data.set(marks.subarray(i,i+4),i);
write('Subdivision-orientation.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Orient subdivision on a rotated tile

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
both previews, edit receipts, and native renders.

The tile is rotated 73 degrees in the picture. Both edits request two
rows and four columns. UV mode counts across increasing pigment U.
Camera mode maps the grid's first axis to the face edge closest to
screen right. The native paint matches the original in both renders.
`);
