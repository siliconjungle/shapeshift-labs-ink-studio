'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir=path.resolve(process.argv[2] ?? 'editable-triangles-review');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(dir,name);
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit=ink.load(), { KIT: K }=kit, T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f6edda')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width)=>({type:'path',points,color,width});
const slate='#192830', muted='#afc5c6', mint='#b2e4bd', copper='#efb685';
function stampPaint(name,colors,text) {
  const [shadow,body,band,light]=colors;
  const image=art.render({width:36,height:26,edges:'hard',commands:[
    rect(0,0,36,26,shadow),rect(1,1,34,24,body),rect(2,2,32,2,light),
    ...[6,18].map(y=>rect(2,y,32,1,band)),rect(5,8,26,9,shadow),
    label(text,7,9,1,light),
    ...[[3,4],[31,4],[3,20],[31,20]].map(([x,y])=>rect(x,y,2,2,light)),
    ...[9,13,17,21,25].map(x=>rect(x,20,2,1,band))
  ]});
  const png=PNG.encode(36,26,image.data,4);
  write(name+'.png',png);
  return ink.readTilesetImage(png);
}
const scene={id:'service-cover',style:'slate',solids:[],
  camera:{target:[0,.76,.19],dist:3.14,yaw:.32,pitch:.17,projection:'orthographic',sway:0},
  tilesets:{
    enamel:stampPaint('enamel-atlas',['#2c4c58','#507f79','#406870','#c3dcb0'],'VENT'),
    copper:stampPaint('copper-atlas',['#533a47','#a26358','#7e534d','#f6ce90'],'HEAT')
  }};
const editor=ink.createSceneEditor(scene);
const pick=(id)=>ink.pickTilesetRectangle(scene,id,{x:0,y:0,width:36,height:26});
const enamel=pick('enamel'), hot=pick('copper');
editor.placeTilesetFace({object:'panel',face:'cover',selection:enamel,worldSize:[2.22,1.44],origin:[-1.11,.04,0]});
editor.editMeshTopology('panel',{vertices:[{id:'cover/v2',position:[1.11,1.48,.72]}]});
const auto=editor.meshTopology('panel').document;
editor.repairMeshTopology('panel',{revision:T.revision(auto),operations:[{kind:'flip-diagonal',faces:['cover']}]});
const original=editor.snapshot(), document=original.topologyMeshes.panel.document;
json('original.json',original);
json('split-request.json',{revision:T.revision(document),operations:[{kind:'split-quad',
  selection:T.select(document,{domain:'faces',ids:['cover']})}]});
json('copper-crop.json',hot);
const view={w:156,h:105,px:1,raw:true,ortho:true}, commands=[];

function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const action=['mesh-topology','repair','original.json','split-request.json','--object','panel'];
run(action,'split-preview.json');
run([...action,'--out','split.json','--report','split-receipt.json']);
const receipt=read('split-receipt.json').repair, row=receipt.steps[0].faces[0];
assert.deepEqual(read('split-preview.json').report,receipt);
const split=read('split.json').topologyMeshes.panel.document;
const [first,second]=row.triangles.map(child=>child.face);
assert.deepEqual(split.vertices,document.vertices);
assert(split.faces.every(face=>face.sourceQuad.face==='cover' && face.material==='tileset/enamel'));
for (const [i,id] of [first,second].entries()) {
  run(['tileset','eyedrop','--scene','split.json','--object','panel','--face',id,'--out','triangle-'+(i+1)+'-crop.json']);
  assert.deepEqual(read('triangle-'+(i+1)+'-crop.json').selection,enamel);
}
run(['tileset','reskin','--scene','split.json','--object','panel','--face',second,'--mode','crop','--selection','copper-crop.json',
  '--out','repainted.json'],'reskin-receipt.json');
const repainted=read('repainted.json').topologyMeshes.panel.document;
assert.deepEqual(repainted.faces[0],split.faces[0]);
assert.deepEqual(repainted.faces[1].sourceQuad,split.faces[1].sourceQuad);

const cases=[
  ['original','Authored quad','One painted face with four corners.'],
  ['split','Editable triangles','Both triangles keep the enamel crop.'],
  ['repainted','One triangle reskinned','The copper crop belongs to the new face.']
];
for (const [id] of cases) run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
assert.deepEqual(fs.readFileSync(file('original-1x.png')),fs.readFileSync(file('split-1x.png')));
assert.notDeepEqual(fs.readFileSync(file('split-1x.png')),fs.readFileSync(file('repainted-1x.png')));
commands.push('cmp original-1x.png split-1x.png');

let camera,focal;
render(editor.build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2,W=1008,H=408;
const slots=cases.map((_,i)=>[20+328*i,111]);
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,slate),label('INK STUDIO / MESH TOPOLOGY',20,16,2,muted),
  label('Split a painted cover into editable faces',20,45,3),
  ...cases.flatMap(([,title,note],i)=>{
    const [x,y]=slots[i];
    return [label(title,x,y-22,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#536f74'),
      label(note,x,y+view.h*zoom+10,1,muted)];
  }),
  label('1 FACE / 4 CORNERS',20,360,1,mint),
  label('2 FACES / SHARED EDGE',348,360,1,mint),
  label('COPPER / '+second.toUpperCase(),676,360,1,copper),
  label('BOTH TRIANGLES TRACE BACK TO COVER',20,390,1,muted),
  label('THE FIRST TWO NATIVE RENDERS MATCH',348,390,1,muted)
]});
const marks=[];
for (const [i,[x,y]] of slots.entries()) {
  const {w,h,data}=PNG.raster(file(cases[i][0]+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at=(Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  const project = id => {
    const p=document.vertices.find(row=>row.id===id).position, at=K.V.sub(p,pose.eye);
    return [Math.round(x+w+zoom*focal*K.V.dot(at,pose.right)),Math.round(y+h-zoom*focal*K.V.dot(at,pose.up))];
  };
  const boundary=document.faces[0].corners.map(row=>project(row.vertex));
  marks.push(line([...boundary,boundary[0]],mint,1));
  if (i) {
    const edge=row.vertices.map(project), color=i===2 ? copper : mint;
    marks.push(line(edge,slate,3),line(edge,color,1));
    for (const [u,v] of edge) marks.push(rect(u-2,v-2,5,5,color));
  }
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Quad-split.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Split a painted cover into editable faces

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the native renders, picked crops, preview, and receipts.

The bent quad starts with an authored diagonal. The split produces
two editable faces along that diagonal. Their material and corner
data match the quad, and both can eyedrop the enamel crop. The final
command sequence changes only the new triangle to copper.
`);
