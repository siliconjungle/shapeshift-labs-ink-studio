'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');
const { fixture } = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'pivot-review');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit = ink.load(), { KIT: K } = kit;
const { scene: source, panel, shared } = fixture();
const library = { peg:{ revision:1,solids:{marker:{kind:'box',at:[0,.08,0],half:[.075,.08,.08],mat:'accent'}} } };
const scene = {id:'pivot-workbench',style:'slate',solids:[],tilesets:source.tilesets,
  prefabLibrary:'library.json',instances:{peg:{prefab:'peg',transform:{translation:[.97,-.16,.10]}}},
  camera:{target:[.09,.36,0],yaw:.27,pitch:.20,dist:3.75,projection:'orthographic',sway:0},
  topologyMeshes:{sign:panel}};
const editor = ink.createSceneEditor(scene,{env:{prefabs:library}}), T = K.meshTopology;
const pick = T.select(panel.document,{domain:'faces',ids:['sign']});
const hinge = panel.document.edges.find(row=>shared.every(id=>row.vertices.includes(id)));
const cases = [
  ['vertex','VERTEX',{kind:'vertex',id:'sign/v3'},'#94ddc6'],
  ['edge','EDGE',{kind:'edge',id:hinge.id,at:.35},'#f1bf83'],
  ['instance','INSTANCE ANCHOR',{kind:'instance',instance:'peg'},'#d2adf4'],
  ['center','SELECTION CENTER',{kind:'center',selection:pick},'#a7cdf7']
];
json('workbench.json',scene);
json('library.json',library);
json('turn.json',{selection:pick,operation:{kind:'rotate',axis:[0,1,0],degrees:31},pins:{vertices:shared}});
const view = {w:170,h:112,px:1,raw:true,ortho:true};
const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
function image(scene, output) {
  run(['render',scene,'--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',output]);
}
image('workbench.json','original-1x.png');
for (const [id,,target] of cases) {
  json(id+'-request.json',{target,revision:pick.revision});
  run(['mesh-topology','pivot','workbench.json',id+'-request.json','--object','sign','--out',id+'-scene.json'],id+'-report.json');
  const row = read(id+'-scene.json').topologyMeshes.sign;
  assert.deepEqual(row.document,panel.document);
  assert.deepEqual(row.bindings,panel.bindings);
  assert.equal(read(id+'-report.json').revision,pick.revision);
  image(id+'-scene.json',id+'-1x.png');
  assert.deepEqual(fs.readFileSync(file(id+'-1x.png')),fs.readFileSync(file('original-1x.png')));
}
run(['mesh-topology','transform','edge-scene.json','turn.json','--object','sign','--out','turned.json','--report','turned-report.json']);
image('turned.json','turned-1x.png');
assert.deepEqual(read('turned-report.json').transform.worldPivot,read('edge-report.json').after.world);
assert.notDeepEqual(fs.readFileSync(file('turned-1x.png')),fs.readFileSync(file('original-1x.png')));

let camera,focal;
render(editor.build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if(raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view), raster=PNG.raster(file('original-1x.png'));
const W=742,H=692,panels=[[22,122],[380,122],[22,403],[380,403]],art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f0e9d3')=>({type:'text',text,at:[x,y],scale,color});
const pathMark=(points,color,width)=>({type:'path',points,color,width});
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182a34'),label('INK STUDIO / TRANSFORM PIVOTS',22,18,2,'#a7c5b4'),
  label('Place the pivot',22,49,3),
  ...cases.flatMap(([id,title,,color],i)=>{
    const [x,y]=panels[i], coords=read(id+'-report.json').after.world.map(n=>Number(n.toFixed(2))).join(' / ');
    return [label(title,x,y-24,2,color),rect(x-1,y-1,342,226,'#4e6c73'),
      label('WORLD  '+coords,x,y+239,1,color)];
  }),
  label('All four placements reproduce the same 1x render.',22,673,1,'#b4c6c4')
]});

const marks=[];
for (const [i,[id,,,color]] of cases.entries()) {
  const [x,y]=panels[i];
  for (let row=0;row<raster.h*2;row++) for (let col=0;col<raster.w*2;col++) {
    const at=(Math.floor(row/2)*raster.w+Math.floor(col/2))*4;
    board.data.set(raster.data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  const at=K.V.sub(read(id+'-report.json').after.world,pose.eye);
  const u=x+raster.w+2*focal*K.V.dot(at,pose.right), v=y+raster.h-2*focal*K.V.dot(at,pose.up);
  const lines=[[[u-10,v],[u+10,v]],[[u,v-10],[u,v+10]],[[u-4,v-4],[u+4,v-4],[u+4,v+4],[u-4,v+4],[u-4,v-4]]];
  for (const points of lines) marks.push(pathMark(points,'#16242e',4),pathMark(points,color,2));
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Mesh-pivots.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  'for anchor in vertex edge instance center; do cmp original-1x.png "$anchor-1x.png"; done\n');
write('README.md',`# Place the pivot

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.

Move the sign's pivot to a vertex, a point along the shared hinge,
the placed peg's origin, and the selected painted face's center.
All four scenes keep the same topology revision and produce an
identical render. The last command rotates the sign around the saved
edge pivot and leaves the adjacent grille in place.
`);
