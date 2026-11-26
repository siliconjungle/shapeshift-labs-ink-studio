'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;
const {fixture} = require('../mesh-uv-workshop.cjs');
const dir = path.resolve(process.argv[2] ?? 'uv-pivot-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const base = fixture(kit);
const separated = UV.plan(base.doc,{operations:[{op:'cut',ids:[base.seam('left-wing'),base.seam('right-wing')]}]}).document;
const doc = UV.plan(separated,{operations:[{op:'pin',ids:['rear/brt'],pinned:true}]}).document;
const scene = {id:'field-case-uv-pivots',style:'slate',solids:[],
  topologyMeshes:{box:{document:doc,materials:base.view.materials}},
  camera:{target:[0,0,0],dist:7.4,yaw:.49,pitch:.31,projection:'orthographic',sway:0}};
json('scene.json',scene);
const layout = ink.createSceneEditor(scene).inspectMeshUV('box',{uvSet:'pigment'});
const corner = layout.corners.find(row=>row.id==='faceplate/frt');
const w=232,h=170;
json('view.json',{w,h,raw:true,material:'enamel'});
json('chart-query.json',{domain:'islands',atlas:{at:[.47,.42],face:'faceplate'}});
json('corner-query.json',{domain:'corners',atlas:{texel:corner.texel,face:'faceplate'}});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const id of ['chart','corner']) run(['mesh-uv','select','scene.json',id+'-query.json','--object','box',
  '--out',id+'-selection.json']);
const selection = read('chart-selection.json'), revision = T.revision(doc);
assert.deepEqual(selection.ids,['faceplate']);
json('transform.json',{revision,operations:[{op:'transform',selection,rotation:.35,scale:.9}]});
const cases = [
  ['center','Selection center',{kind:'selection-center',selection}],
  ['pinned','Pinned coordinate',{kind:'pinned',corner:'rear/brt'}],
  ['snapped','Snapped corner',{kind:'corner',selection:read('corner-selection.json')}]
];
const pivots = new Map(), outcomes = [];
for (const [id,,target] of cases) {
  json(id+'-pivot.json',{revision,operations:[{op:'set-pivot',target}]});
  const place = ['mesh-uv','edit','scene.json',id+'-pivot.json','--object','box'];
  run(place.concat('--out',id+'-ready.json','--report',id+'-pivot-receipt.json'));
  const placed = read(id+'-pivot-receipt.json');
  const pivot = placed.pivot.after;
  pivots.set(id,pivot);
  assert.equal(placed.outputRevision,revision);
  assert.equal(placed.corners.length,0);
  assert.deepEqual(read(id+'-ready.json').topologyMeshes.box.document.faces,doc.faces);
  run(['mesh-uv','layout',id+'-ready.json','--object','box'],id+'-layout.json');
  assert.deepEqual(read(id+'-layout.json').pivot,pivot);
  const transform = ['mesh-uv','edit',id+'-ready.json','transform.json','--object','box'];
  run(transform.concat('--view','view.json','--preview',id),id+'-preview.json');
  run(transform.concat('--out',id+'.json','--report',id+'-transform-receipt.json'));
  const preview = read(id+'-preview.json'), committed = read(id+'-transform-receipt.json');
  assert(preview.canCommit);
  assert.deepEqual(preview.preview.pivot,{before:pivot,after:pivot});
  assert.deepEqual(preview.operations,committed.operations);
  assert.deepEqual(committed.operations[0].evidence,{pivotSource:'dedicated',pivots:[{island:'faceplate',uv:pivot}]});
  const after = read(id+'.json').topologyMeshes.box.document;
  assert.deepEqual(after.vertices,doc.vertices);
  assert.deepEqual(after.uvPivots,{0:pivot});
  outcomes.push(after.faces.find(face=>face.id==='faceplate'));
}
assert.notDeepEqual(outcomes[0],outcomes[1]);
assert.notDeepEqual(outcomes[1],outcomes[2]);

const W=797,H=644,x=i=>18+i*262,y=[135,311,487];
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f0e2ce')=>({type:'text',text,at:[x,y],scale,color});
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / DEDICATED UV PIVOT',18,16,2,'#a4c5c1'),
  text('One rotation, three pivot anchors',18,42,3),
  ...cases.flatMap(([id,title],i)=>[text(title,x(i),83,2),
    text('UV '+pivots.get(id).map(n=>Number(n.toFixed(4))).join(', '),x(i),105,1,'#f0b8ff')]),
  text('ATLAS BEFORE',18,122,1,'#a4c5c1'),
  text('ATLAS AFTER',18,298,1,'#a4c5c1'),
  text('MODEL AFTER',18,474,1,'#a4c5c1')
]});
function blit(name,left,top,crop=0) {
  const image=PNG.raster(file(name)), height=image.h-2*crop;
  for (let row=0;row<height;row++) {
    const at=((top+row)*W+left)*4, start=(row+crop)*image.w*4;
    board.data.set(image.data.subarray(start,start+image.w*4),at);
  }
}
for (const [i,[id]] of cases.entries()) {
  blit(id+'/atlas-before.png',x(i)+Math.floor((w-h)/2),y[0],6);
  blit(id+'/atlas-after.png',x(i)+Math.floor((w-h)/2),y[1],6);
  blit(id+'/model-after.png',x(i),y[2],14);
}
write('UV-pivot.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Dedicated UV pivots

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
placement receipts, layout reports, transform previews, and edited scenes.

The same saved faceplate island selection is used in every transform.
Each version stores its own pivot before applying the same rotation and
scale. The atlas crosshair marks the pivot used by that transform.
`);
