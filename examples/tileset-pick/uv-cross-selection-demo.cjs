'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {capture} = require('../../cli/mesh-uv-editor.js');
const {fixture} = require('../mesh-uv-workshop.cjs');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-cross-selection-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const base = fixture(kit), seam = base.seam('right-wing');
const doc = UV.plan(base.doc,{operations:[{op:'cut',ids:[seam]}]}).document;
const {camera,materials} = base.view, view = {w:205,h:161,camera,raw:true,material:'enamel'};
const scene = {id:'field-case-picks',style:'slate',solids:[],topologyMeshes:{box:{document:doc,materials}},
  camera:{target:[0,0,0],dist:camera.dist,yaw:camera.yaw,pitch:camera.pitch,projection:'orthographic',sway:0}};
json('scene.json',scene);
json('view.json',view);
const editor = ink.createSceneEditor(scene), layout = editor.inspectMeshUV('box',{uvSet:'pigment'});
const native = capture(doc,{...view,t:0},kit,editor,'box');
const {faces,faceAt} = UV.modelFaces(native.mesh,native.frame), side = layout.edges.find(row=>row.id===seam).sides[0];
const corner = layout.corners.find(row=>row.id==='faceplate/frt');
const mean = (a,b)=>a.map((n,i)=>(n+b[i])*.5);
const cases = [
  {key:'corner',title:'UV corner',domain:'corners',face:'faceplate',id:corner.id,texel:corner.texel,at:corner.uv},
  {key:'edge',title:'Seam edge',domain:'edges',face:'faceplate',id:seam,texel:mean(...side.texels),at:mean(...side.uv)},
  {key:'face',title:'Full face',domain:'faces',face:'right-wing',id:'right-wing',texel:[.72*99,.42*79],at:[.72,.42]},
  {key:'chart',title:'Connected chart',domain:'islands',face:'faceplate',id:layout.faces.find(row=>row.id==='faceplate').island,
    texel:[.47*99,.42*79],at:[.47,.42]}
];

function modelPixel(row) {
  const owner = faces.indexOf(row.face);
  let best = Infinity, pixel;
  for (const [i,face] of faceAt.entries()) if (face === owner) {
    const at = [i%view.w,Math.floor(i/view.w)];
    const pick = UV.pickModel(native.mesh,native.frame,at,row.domain);
    if (pick.ids[0] !== row.id) continue;
    const distance = Math.hypot(pick.hit.uv[0]-row.at[0],pick.hit.uv[1]-row.at[1]);
    if (distance<best) { best=distance; pixel=at; }
  }
  assert(pixel,'A visible '+row.key+' witness is required');
  return pixel;
}
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const {key,domain,face,id,texel,...row} of cases) {
  json(key+'-atlas-query.json',{domain,atlas:{texel,face}});
  json(key+'-model-query.json',{domain,model:{pixel:modelPixel({domain,face,id,key,...row})}});
  for (const origin of ['atlas','model']) {
    const prefix=key+'-'+origin;
    run(['mesh-uv','select','scene.json',prefix+'-query.json','--object','box','--view','view.json',
      '--preview',prefix,'--out',prefix+'.json','--topology-out',prefix+'-topology.json','--topology-domain','match']);
  }
  const atlas=read(key+'-atlas.json'), model=read(key+'-model.json');
  assert.deepEqual(atlas.ids,[id]);
  for (const lane of ['ids','faces','corners','vertices','edgeSides']) assert.deepEqual(atlas[lane],model[lane]);
  assert.deepEqual(read(key+'-atlas-topology.json'),read(key+'-model-topology.json'));
  if (domain==='edges') assert.deepEqual(atlas.edgeSides.map(side=>side.face),['faceplate']);
  if (domain==='islands') assert(atlas.faces.length>1);
}
const vertexSelection = read('corner-atlas-topology.json');
json('reverse-corner-query.json',{domain:'corners',topology:{selection:vertexSelection,face:'faceplate'}});
run(['mesh-uv','select','scene.json','reverse-corner-query.json','--object','box'],'reverse-corner.json');
assert.deepEqual(read('reverse-corner.json').ids,[corner.id]);

const W=896,H=492,top=112,bottom=309;
const text = (text,x,y,scale,color='#f2e2cc')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const X = i=>18+i*218;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172831'),text('INK STUDIO / LINKED UV SELECTION',18,16,2,'#9fc8c3'),
  text('Pick in the atlas or on the mesh',18,42,3),
  ...cases.flatMap(({title},i)=>[text(title,X(i),82,2),
    rect(X(i)-1,top-1,view.w+2,view.h+2,'#4d6b74'),
    rect(X(i),top,view.w,view.h,'#0d1821'),
    rect(X(i)-1,bottom-1,view.w+2,view.h+2,'#4d6b74')]),
  text('SOURCE TEXEL PICK',18,101,1,'#9fc8c3'),
  text('NATIVE MODEL PIXEL PICK / SAME SELECTION',18,293,1,'#9fc8c3')
]});
function blit(image,x,y) {
  for (let row=0;row<image.h;row++) {
    const at=((y+row)*W+x)*4;
    board.data.set(image.data.subarray(row*image.w*4,(row+1)*image.w*4),at);
  }
}
for (const [i,{key}] of cases.entries()) {
  const atlas = PNG.raster(file(key+'-atlas/atlas-before.png'));
  const model = PNG.raster(file(key+'-model/model-before.png'));
  blit(atlas,X(i)+Math.floor((view.w-atlas.w)/2),top);
  blit(model,X(i),bottom);
}
write('UV-cross-selection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Cross-select UV and mesh components

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the selections and all native comparison views.

The atlas queries use source texel coordinates. Each corresponding
model query starts at a visible art pixel and resolves the same IDs.
The edge query keeps the faceplate's side of a UV cut. The chart
query expands from the picked face to both connected panels on its
left. The CLI also exports a matching mesh component selection for
each pick, plus a reverse lookup of the selected vertex.
`);
