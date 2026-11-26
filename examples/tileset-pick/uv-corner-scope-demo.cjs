'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, art = K.procedural.drawing2d;
const {fixture} = require('../mesh-uv-workshop.cjs');
const dir = path.resolve(process.argv[2] ?? 'uv-corner-scope-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const base = fixture(kit), front = base.doc.faces.find(row=>row.id==='faceplate');
const vertices = new Map(base.doc.vertices.map(row=>[row.id,row]));
const spare = front.corners.map(({vertex})=>{
  const [x,y,z] = vertices.get(vertex).position;
  return {id:'spare/'+vertex,position:[.75*x-.42,.75*y-1.69,z]};
});
const doc = T.edit(base.doc,{vertices:spare,faces:[{...front,id:'spare',corners:front.corners.map(({vertex,uv},i)=>({
  id:'spare-corner/'+vertex,vertex:spare[i].id,uv
}))}]});
const scene = {id:'stacked-paint',style:'slate',solids:[],topologyMeshes:{box:{document:doc,materials:base.view.materials}},
  camera:{target:[0,-.63,0],dist:7.4,yaw:.42,pitch:.27,projection:'orthographic',sway:0}};
json('field-case.json',scene);
const w=222,h=166;
json('view.json',{w,h,raw:true,material:'enamel'});

const corner = front.corners.find(row=>row.vertex==='frt'), commands = [];
json('pick.json',{domain:'corners',atlas:{at:corner.uv,face:'faceplate'}});
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
run(['mesh-uv','select','field-case.json','pick.json','--object','box','--out','seed.json']);
const selection = read('seed.json'), revision = T.revision(doc);
const request = (scope,translate)=>({revision,operations:[{op:'move-corners',selection,scope,...(translate && {translate})}]});
json('scope-query.json',request('together'));
run(['mesh-uv','edit','field-case.json','scope-query.json','--object','box'],'scope-report.json');
assert.equal(read('scope-report.json').operations[0].pointEdits,0);
for (const scope of ['together','independent']) {
  json(scope+'-request.json',request(scope,[-.065,.06]));
  const args = ['mesh-uv','edit','field-case.json',scope+'-request.json','--object','box'];
  run(args.concat('--view','view.json','--preview',scope),scope+'-preview.json');
  run(args.concat('--out',scope+'.json','--report',scope+'-receipt.json'));
  const preview = read(scope+'-preview.json'), receipt = read(scope+'-receipt.json'), step = preview.operations[0].evidence;
  assert(preview.canCommit,JSON.stringify(preview.operations));
  assert.deepEqual(preview.operations,receipt.operations);
  assert.equal(step.moving.length,scope==='together' ? 3 : 1);
  assert.equal(step.held.length,scope==='together' ? 0 : 2);
  assert.deepEqual(preview.preview.cornerScope.moving,step.moving.map(row=>row.id));
  assert.deepEqual(preview.preview.cornerScope.held,step.held.map(row=>row.id));
  assert.deepEqual(read(scope+'.json').topologyMeshes.box.document.vertices,doc.vertices);
}

const text = (text,x,y,scale,color='#f0e2cc')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const mint='#75e2c8', blue='#a8beff', W=848,H=499,col=[18,432], row=[120,315], gap=10;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182a32'),text('INK STUDIO / UV CORNER SCOPE',18,16,2,'#a6c9c2'),
  text('Choose which stacked corners move',18,42,3),
  text('Together',col[0],82,2),text('Independent',col[1],82,2),
  text('3 CORNERS IN MOVE SCOPE',col[0],103,1,mint),
  text('1 CORNER IN MOVE SCOPE / 2 HELD',col[1],103,1,blue),
  ...col.flatMap(x=>row.flatMap(y=>[
    rect(x-1,y-1,h+2,h+2,'#52717a'),rect(x+h+gap-1,y-1,w+2,h+2,'#52717a')
  ])),
  text('AFTER TRANSLATION',18,299,1,'#a6c9c2')
]});
function blit(name,x,y) {
  const image=PNG.raster(file(name));
  for (let row=0;row<image.h;row++) {
    const at=((y+row)*W+x)*4;
    board.data.set(image.data.subarray(row*image.w*4,(row+1)*image.w*4),at);
  }
}
for (const [i,scope] of ['together','independent'].entries()) for (const [j,state] of ['before','after'].entries()) {
  blit(scope+'/atlas-'+state+'.png',col[i],row[j]);
  blit(scope+'/model-'+state+'.png',col[i]+h+gap,row[j]);
}
write('UV-corner-scope.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Overlapping UV corner scope

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce
the previews, edit receipts, and revised scenes.

One corner on the case shares a weld with the adjoining wing and
overlaps a spare painted panel at the same UV. Together moves all
three. Independent moves the picked face corner and holds the other
two. Mint marks the active move scope. Blue outlines held corners.
The scope-only request inspects those IDs without a translation.
`);
