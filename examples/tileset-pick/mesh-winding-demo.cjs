'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir=path.resolve(process.argv[2] ?? 'winding-review');
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
const slate='#192830', muted='#adbfbd', gold='#f2cb80', green='#b8e9ba', red='#f1a398';
const paint=art.render({width:32,height:24,edges:'hard',commands:[
  rect(0,0,32,24,'#304a55'),rect(1,1,30,22,'#477f74'),rect(2,2,28,2,'#b1ce9a'),
  rect(3,6,26,12,'#284851'),rect(3,18,26,2,'#325a60'),
  line([[8,12],[23,12],[18,7]],gold,2),line([[23,12],[18,17]],gold,2),
  rect(3,20,2,2,'#9ab999'),rect(27,20,2,2,'#9ab999')
]});
const atlas=PNG.encode(32,24,paint.data,4);
const verts=[['hinge-low',[0,.14,0]],['tip-low',[1.26,.14,.18]],['tip-high',[1.26,1.05,.18]],['hinge-high',[0,1.05,0]]];
const authored=K.V.norm([-.18/1.26,0,1]);
const document=T.create({id:'plate',vertices:verts.map(([id,position])=>({id,position})),
  faces:[{id:'sign',material:'tileset/paint',corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({
    id:'sign/c'+i,vertex:verts[i][0],normal:authored,uv
  }))}],edges:[{id:'hinge',vertices:['hinge-low','hinge-high'],uvSeam:true}]});
const scene={id:'winding-bench',style:'slate',solids:[],
  camera:{target:[0,.64,0],dist:2.65,yaw:.12,pitch:.14,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(atlas)},topologyMeshes:{plate:{document,pivot:[0,0,0],
    materials:[{id:'tileset/paint',texture:{tileset:'paint'}}]}}};
json('original.json',scene);
write('paint.png',atlas);
const selection=T.select(document,{domain:'faces',ids:['sign']});
const operation={kind:'mirror',normal:[1,0,0],winding:'preserve',viewFrom:[0,0,1]};
json('mirror-request.json',{selection,operation});
json('corrected-request.json',{selection,operation:{...operation,winding:'reverse'}});
json('front-query.json',{domain:'faces',filter:{visibility:'through',backfaces:'exclude'}});
const view={w:156,h:101,px:1,raw:true,ortho:true};
json('view.json',view);

const commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const mirror=['mesh-topology','transform','original.json','mirror-request.json','--object','plate'];
run(mirror,'mirror-preview.json');
run([...mirror,'--out','mirrored.json','--report','mirror-receipt.json']);
const evidence=read('mirror-receipt.json').transform;
assert.deepEqual(read('mirror-preview.json').report,evidence);
const reflected=read('mirrored.json').topologyMeshes.plate.document;
json('repair-request.json',{revision:T.revision(reflected),operations:[
  {kind:'winding',faces:['sign'],normals:'reverse',viewFrom:operation.viewFrom}
]});
const repair=['mesh-topology','repair','mirrored.json','repair-request.json','--object','plate'];
run(repair,'repair-preview.json');
run([...repair,'--out','reversed.json','--report','repair-receipt.json']);
assert.deepEqual(read('repair-preview.json').report,read('repair-receipt.json').repair);
run(['mesh-topology','transform','original.json','corrected-request.json','--object','plate','--out','direct.json']);
assert.deepEqual(read('direct.json'),read('reversed.json'));
commands.push('cmp direct.json reversed.json');

const cases=[
  ['original','Original front','The sign starts on the right of the hinge.'],
  ['mirrored','Mirror + preserve','The same corner order now faces away.'],
  ['reversed','Reverse winding','Winding repair turns the mirrored front back.']
];
for (const [id] of cases) {
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
  run(['mesh-topology','select',id+'.json','front-query.json','--object','plate','--view','view.json'],'front-'+id+'.json');
}
assert.deepEqual(cases.map(([id])=>read('front-'+id+'.json').ids),[['sign'],[],['sign']]);

let camera,focal;
render(ink.createSceneEditor(scene).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2,W=1008,H=414;
const slots=cases.map((_,i)=>[20+328*i,110]);
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,slate),label('INK STUDIO / MESH TOPOLOGY',20,16,2,muted),
  label('Correct a mirrored face',20,45,3),
  ...cases.flatMap(([id,title,note],i)=>{
    const [x,y]=slots[i], bottom=y+zoom*view.h;
    const front=read('front-'+id+'.json').ids.length>0;
    return [label(title,x,y-22,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#526a70'),
      label(note,x,bottom+10,1,muted),
      label(front ? 'FRONT-FACING PICK   HIT' : 'FRONT-FACING PICK   MISS',x,bottom+34,1,front ? green : red)];
  }),
  label('GOLD / MIRROR PLANE',20,392,1,gold),
  label('NUMBERS / CORNER ORDER',348,392,1,muted)
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
  const doc=read(cases[i][0]+'.json').topologyMeshes.plate.document, color=i===1 ? red : green;
  const points=doc.faces[0].corners.map(({vertex})=>project(doc.vertices.find(row=>row.id===vertex).position));
  marks.push(line([project([0,-.16,0]),project([0,1.29,0])],gold,1));
  marks.push(line([...points,points[0]],color,1));
  for (const [j,[u,v]] of points.entries()) {
    marks.push(rect(u-3,v-3,7,7,slate),rect(u-2,v-2,5,5,color),rect(u+4,v-10,8,8,slate),
      label(String(j+1),u+6,v-9,1,color));
  }
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Mesh-winding.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Correct a mirrored face

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the native renders, front-facing picks, previews, and receipts.

The first transform reflects the sign while preserving corner order.
The sign turns away from the fixed camera. The winding repair reverses
the corner ring and the authored corner normals. A mirror with
explicit reversal produces the same final scene. The CLI selection
checks front participation at native resolution in each view.
`);
