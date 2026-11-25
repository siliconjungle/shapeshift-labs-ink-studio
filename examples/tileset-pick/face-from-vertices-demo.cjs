'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir=path.resolve(process.argv[2] ?? 'painted-closures');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(dir,name);
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit=ink.load(), { KIT: K }=kit, T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f5ebd8')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width)=>({type:'path',points,color,width});
const slate='#18272e', faded='#b3c9ca', gold='#f1cb7e', green='#b9e0b6';
const drawing=art.render({width:96,height:32,edges:'hard',commands:[
  rect(0,0,32,32,'#567376'),rect(0,1,32,3,'#a0a487'),rect(0,29,32,3,'#334d57'),
  ...[6,13,20,27].flatMap((y,i)=>[rect(0,y,32,1,'#435e64'),...[6,18,28].map(x=>rect(x+(i%2)*3,y,1,6,'#435e64'))]),
  rect(9,12,14,20,'#879b88'),rect(11,14,10,18,'#2e4b58'),rect(13,16,6,16,'#283c49'),rect(17,23,2,2,gold),
  rect(32,0,32,32,'#814a49'),...Array.from({length:8},(_,i)=>[
    rect(32,i*4,32,1,'#c37959'),rect(32,i*4+3,32,1,'#623f45'),
    ...[3,11,19,27].map(x=>rect(32+x+(i%2)*2,i*4+1,1,2,'#a96151'))]).flat(),
  rect(32,29,32,3,'#e2a46c'),
  rect(64,0,32,32,'#376168'),rect(65,2,30,28,'#699989'),rect(66,2,28,2,'#b2cd9b'),
  rect(72,7,18,19,'#35525b'),rect(74,10,14,13,'#c09963'),rect(76,12,10,9,'#f0cf89'),
  rect(80,10,2,13,'#6b664f'),rect(74,15,14,2,'#6b664f'),rect(64,29,32,3,'#304d58')
]});
const atlas=PNG.encode(96,32,drawing.data,4);
const positions={
  'a-wall':[-1.22,0,0],'b-wall':[.45,0,0],'a-eave':[.45,.91,0],'z-eave':[-1.22,.91,0],
  ridge:[-.385,1.59,0],'annex-low':[1.33,0,.17],'annex-high':[1.33,.91,.17]
};
const wall=['a-wall','b-wall','a-eave','z-eave'];
const tri=['z-eave','a-eave','ridge'], quad=['b-wall','annex-low','annex-high','a-eave'];
const document=T.create({id:'lockhouse',vertices:Object.entries(positions).map(([id,position])=>({id,position})),
  faces:[{id:'wall',material:'tileset/paint',corners:[[0,1],[31/95,1],[31/95,0],[0,0]].map((uv,i)=>
    ({id:'wall/c'+i,vertex:wall[i],uv}))}],
  edges:[{id:'eave',vertices:['a-eave','z-eave'],uvSeam:true}]});
const scene={id:'lockhouse',style:'slate',solids:[],
  camera:{target:[.02,.73,0],dist:2.95,yaw:.23,pitch:.12,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(atlas)},topologyMeshes:{house:{document,
    materials:[{id:'tileset/paint',texture:{tileset:'paint'}}]}}};
json('original.json',scene);
write('paint.png',atlas);

const view={w:160,h:106,px:1,raw:true,ortho:true}, commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
function draw(id) {
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
}
function createFace(id,source,order,x,explicit) {
  json(id+'-query.json',{domain:'vertices',ids:[...order].reverse()});
  json(id+'-request.json',{object:'house',face:id,...(explicit && {order})});
  run(['tileset','pick','--scene',source+'.json','--id','paint','--x',x,'--y','0','--width','32','--height','32',
    '--out',id+'-crop.json']);
  run(['mesh-topology','select',source+'.json',id+'-query.json','--object','house','--out',id+'-vertices.json']);
  const args=['tileset','face',id+'-request.json','--scene',source+'.json','--vertices-file',id+'-vertices.json','--selection',id+'-crop.json'];
  run(args,id+'-preview.json');
  run([...args,'--out',id+'.json'],id+'-receipt.json');
  const receipt=read(id+'-receipt.json');
  assert.deepEqual(read(id+'-preview.json'),receipt);
  assert.deepEqual(receipt.cornerOrder,order);
  assert.deepEqual(read(id+'.json').topologyMeshes.house.document.vertices,document.vertices);
  draw(id);
}
draw('original');
createFace('gable','original',tri,32,false);
createFace('annex','gable',quad,64,true);
run(['tileset','eyedrop','--scene','annex.json','--object','house','--face','gable','--out','gable-eyedrop.json']);
assert.deepEqual(read('gable-eyedrop.json').selection,read('gable-crop.json'));

let camera,focal;
render(ink.createSceneEditor(scene).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2,W=1032,H=398;
const cases=[
  ['original','Selected vertices','The wall and its anchor vertices.'],
  ['gable','Painted triangle','The saved selection infers corner order.'],
  ['annex','Painted quad','An explicit order places the window crop.']
];
const slots=cases.map((_,i)=>[18+338*i,112]);
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,slate),label('INK STUDIO / TILESET MODELING',18,16,2,faded),
  label('Build a lockhouse from its vertices',18,45,3),
  ...cases.flatMap(([,title,note],i)=>{
    const [x,y]=slots[i];
    return [label(title,x,y-22,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#506970'),
      label(note,x,y+view.h*zoom+10,1,faded)];
  }),
  label('GOLD / TRIANGLE CORNER ORDER',356,367,1,gold),
  label('MINT / QUAD CORNER ORDER',694,367,1,green)
]});
const marks=[];
for (const [i,[x,y]] of slots.entries()) {
  const {w,h,data}=PNG.raster(file(cases[i][0]+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at=(Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  const project = point => {
    const at=K.V.sub(point,pose.eye);
    return [Math.round(x+w+zoom*focal*K.V.dot(at,pose.right)),Math.round(y+h-zoom*focal*K.V.dot(at,pose.up))];
  };
  const ids=i===0 ? [...new Set([...tri,...quad])] : read(cases[i][0]+'-receipt.json').cornerOrder;
  const color=i===2 ? green : gold;
  const points=ids.map(id=>project(positions[id]));
  if (i) marks.push(line([...points,points[0]],color,1));
  for (const [j,[u,v]] of points.entries()) {
    marks.push(rect(u-3,v-3,7,7,slate),rect(u-2,v-2,5,5,color));
    if (i) marks.push(rect(u+4,v-10,8,8,slate),label(String(j+1),u+6,v-9,1,color));
  }
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Face-from-vertices.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Build a lockhouse from its vertices

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the three native-resolution views, selections, previews, and receipts.

The gable uses three existing vertices and an inferred ring. The
annex uses four existing vertices and a specified order. Each
face shares an edge with the wall. The receipts record the UVs and
numbered corner order. Eyedrop saves the triangle's exact roof crop.
`);
