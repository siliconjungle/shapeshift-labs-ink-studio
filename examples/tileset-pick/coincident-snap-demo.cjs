'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');
const { fixture } = require('./coincident-snap-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'coincident-snap-review');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const { scene, library, request, paint } = fixture();
const cases = [
  {id:'original', title:'Original', notes:['All three painted panels meet.','Gold marks the fixed guide edge.']},
  {id:'independent', title:'Independent vertices', notes:['The sign reaches the guide.','An extra split opens on the trim side.']},
  {id:'linked', title:'Coincident travel', notes:['Both trim corners follow the sign.','The authored seam opens on the left.']}
];
json('original.json',scene);
json('library.json',library);
json('independent-request.json',{...request,coincident:false});
json('linked-request.json',request);
write('tileset.png',paint);

const view = {w:156,h:93,px:1,raw:true,ortho:true};
const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const {id} of cases) {
  if (id !== 'original') {
    const args = ['mesh-topology','transform','original.json',id+'-request.json','--object','panels'];
    run(args,id+'-preview.json');
    run([...args,'--out',id+'.json','--report',id+'-receipt.json']);
  }
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
}

const end = read('linked-receipt.json').transform;
assert.deepEqual(end,read('linked-preview.json').report);
assert.deepEqual(end.snap.pairs.map(({source,target})=>[source,target]),[['sign/v1','base'],['sign/v2','top']]);
assert(end.snap.residual < 1e-8);
assert.equal(end.coincident.groups.length,2);
assert.equal(end.coincident.blockedCount,2);
const vertices = id => new Map(read(id+'.json').topologyMeshes.panels.document.vertices.map(({id,position})=>[id,position]));
const [initial,independent,linked] = cases.map(({id})=>vertices(id));
assert.deepEqual(independent.get('east/v3'),initial.get('east/v3'));
assert.deepEqual(linked.get('east/v3'),linked.get('sign/v2'));
assert.deepEqual(linked.get('east/v0'),linked.get('sign/v1'));
assert.deepEqual(linked.get('west/v2'),initial.get('west/v2'));

const kit = ink.load(), { KIT: K } = kit;
let camera,focal;
render(ink.createSceneEditor(scene,{env:{prefabs:library}}).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view), zoom=2, W=1014,H=358;
const art=K.procedural.drawing2d, accent='#a9e3c9', seam='#e5a7b3', gold='#f2c382', soft='#bdcfd0';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f4e9d4')=>({type:'text',text,at:[x,y],scale,color});
const slots=cases.map((_,i)=>[21+i*330,117]);
const rasters=cases.map(({id})=>PNG.raster(file(id+'-1x.png')));
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182830'),label('INK STUDIO / MESH TOPOLOGY',21,16,2,soft),
  label('Snap an edge and carry its trim',21,44,3),
  ...cases.flatMap(({title,notes},i)=>{
    const [x,y]=slots[i];
    return [label(title,x,y-22,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#526c70'),
      ...notes.map((note,j)=>label(note,x,y+zoom*view.h+9+j*13,1,soft))];
  }),
  label('GOLD / GUIDE ENDPOINTS',21,342,1,gold),
  label('PINK / AUTHORED SEAM',351,342,1,seam),
  label('MINT / TRIM VERTICES',681,342,1,accent)
]});
const marks=[];
for (const [i,[x,y]] of slots.entries()) {
  const {w,h,data}=rasters[i], mesh=[initial,independent,linked][i];
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at=(Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  function mark(point,color,offset,filled) {
    const at=K.V.sub(point,pose.eye);
    const u=Math.round(x+w+zoom*focal*K.V.dot(at,pose.right))+offset, v=Math.round(y+h-zoom*focal*K.V.dot(at,pose.up));
    marks.push(rect(u-3,v-3,7,7,'#182830'),rect(u-2,v-2,5,5,color));
    if (!filled) marks.push(rect(u-1,v-1,3,3,'#182830'));
  }
  for (const {point} of end.snap.pairs) mark(point,gold,0,false);
  for (const id of ['west/v1','west/v2']) mark(mesh.get(id),seam,0,true);
  for (const id of ['east/v0','east/v3']) mark(mesh.get(id),accent,i===2 ? 6 : 0,true);
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Coincident-edge-snap.png',PNG.encode(W,H,board.data,4));

write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Snap an edge and carry its trim

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the three
native-resolution captures, previews, and receipts.

The center sign moves to an edge of the gold guide in a placed prefab.
The two requests differ only in \`coincident\`. In the linked scene the
two separate trim vertices follow the sign edge. The left seam stays
independent. The preview and receipt give the matched endpoint IDs,
the two displacement groups, and the authored seam that blocked
the other coincident pairs.
`);
