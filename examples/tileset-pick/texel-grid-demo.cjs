'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'texel-grid-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
const navy = '#1b2b34', mint = '#a9e6be', amber = '#ffd491', slate = '#aec3c1';
const dims = {width:64,height:42};
const paint = art.render({...dims,edges:'hard',commands:[
  rect(0,0,64,42,'#23363e'),...Array.from({length:7},(_,i)=>rect(0,6*i,64,1,'#2a3f45')),
  rect(5,5,54,30,'#355052'),rect(6,6,52,28,'#688880'),rect(7,7,50,2,'#bfd2ac'),
  rect(5,18,54,5,'#d08b59'),rect(5,18,54,1,'#f3be7c'),rect(5,22,54,1,'#a45f49'),
  text('SERVICE',9,25,1,'#ece3b1'),
  ...[9,17,25,33,41,49].map(x=>rect(x,12,4,2,'#466466')),
  ...[[8,10],[55,10],[55,30]].map(([x,y])=>rect(x,y,2,2,'#c2d0a5'))
]});
const sheet = PNG.encode(dims.width,dims.height,paint.data,4);
write('sheet.png',sheet);
const scene = {id:'ribbed-panel',style:'slate',solids:[],
  camera:{target:[0,.69,.05],dist:3.16,yaw:.31,pitch:.29,projection:'orthographic',sway:0},
  tilesets:{sheet:ink.readTilesetImage(sheet)}};
const editor = ink.createSceneEditor(scene);
const selection = ink.pickTilesetRectangle(scene,'sheet',{x:5,y:5,width:54,height:30});
editor.placeTilesetFace({object:'panel',face:'cover',selection,origin:[-1.34,.07,0],worldSize:[2.68,1.24]});
const original = editor.meshTopology('panel').document;
json('panel.json',editor.snapshot());
json('texel-grid.json',{id:'rib-texels',revision:T.revision(original),
  operation:{kind:'subdivide-texels',face:'cover',x:16,y:[18,23]}});

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const edit = ['mesh-topology','edge-edit','panel.json','texel-grid.json','--object','panel'];
run(edit,'grid-preview.json');
run(edit.concat('--out','grid.json','--report','grid-receipt.json'));
const preview = read('grid-preview.json'), {cells,grid,atlas,texels} = preview.report.detail;
assert(preview.report.canCommit);
assert.deepEqual(read('grid-receipt.json').edgeEdit,preview.report);
assert.deepEqual(texels.axes.find(row=>row.atlasAxis==='x').cuts.map(row=>row.boundary),[21,37,53]);
const stripe = texels.axes.find(row=>row.atlasAxis==='y').cuts;
assert.deepEqual(stripe.map(row=>row.center),[22.5,17.5]);
const split = read('grid.json').topologyMeshes.panel.document;
const stripeFaces = cells.filter(cell=>cell.row===1).map(cell=>cell.face);
json('raise.json',{id:'raise-rib',revision:T.revision(split),selection:T.select(split,{domain:'faces',ids:stripeFaces}),
  operation:{kind:'extrude',distance:.17},rim:{material:'rib-edge'}});
const raise = ['mesh-topology','face-region','grid.json','raise.json','--object','panel'];
run(raise.concat('--out','raised.json','--report','raise-receipt.json'));
const raised = read('raised.json').topologyMeshes.panel.document;
const raisedPositions = new Map(raised.vertices.map(row=>[row.id,row.position]));
for (const id of stripeFaces) {
  const target = raised.faces.find(row=>row.id===id), source = split.faces.find(row=>row.id===id);
  assert.deepEqual(target.corners.map(row=>row.uv),source.corners.map(row=>row.uv));
  assert(target.corners.every(row=>Math.abs(raisedPositions.get(row.vertex)[2]-.17)<1e-9));
}

const w = 155, h = 104, zoom = 2, W = 1018, H = 368, y = 111;
const view = {w,h,px:1,ortho:true,raw:true};
for (const id of ['panel','grid','raised']) run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
assert.deepEqual(fs.readFileSync(file('panel-1x.png')),fs.readFileSync(file('grid-1x.png')));
assert.notDeepEqual(fs.readFileSync(file('grid-1x.png')),fs.readFileSync(file('raised-1x.png')));
commands.push('cmp panel-1x.png grid-1x.png');

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
const atlasAt = [panelX(0)+27,y+20], mapTexel = ([u,v])=>
  [Math.round(atlasAt[0]+4*(u+.5)),Math.round(atlasAt[1]+4*(v+.5))];
function lattice(points) {
  const horizontal = points.map((row,i)=>({points:row,color:i===1 || i===2 ? amber : mint}));
  const vertical = points[0].map((_,i)=>({points:points.map(row=>row[i]),color:mint}));
  return horizontal.concat(vertical).flatMap(({points,color})=>[line(points,navy,3),line(points,color)]);
}
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Raise a stripe at source texel boundaries',16,43,3),
  ...[
    ['Source atlas','STRIPE BOUNDARIES Y 18 AND Y 23',amber],
    ['Texel subdivision','16 TEXELS PER COLUMN / SHORT LAST CELL',mint],
    ['Raised stripe','SAME PAINT ON THE LIFTED CELLS',amber]
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
place(paint.data,dims.width,dims.height,...atlasAt,4);
place(PNG.raster(file('grid-1x.png')).data,w,h,panelX(1),y,zoom);
place(PNG.raster(file('raised-1x.png')).data,w,h,panelX(2),y,zoom);
const marks = art.render({width:W,height:H,edges:'hard',commands:[
  ...lattice(atlas.grid.map(row=>row.map(mapTexel))),...lattice(grid.map(row=>row.map(node=>project(node.position))))
]}).data;
for (let i=0;i<marks.length;i+=4) if (marks[i+3]) board.data.set(marks.subarray(i,i+4),i);
write('Texel-grid.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Raise a stripe at exact source texel boundaries

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the native renders, subdivision preview, and both edit receipts.

The painted stripe starts at atlas row 18 and ends before row 23.
Subdivision cuts between the relevant texel centers. The columns
advance by 16 texels from the registered crop origin. The second
command raises just the stripe cells while preserving their UVs.
`);
