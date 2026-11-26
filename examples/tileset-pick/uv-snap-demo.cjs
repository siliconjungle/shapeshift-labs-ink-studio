'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('../mesh-uv-workshop.cjs');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-snap-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const base = fixture(kit), texture = base.view.materials[0].texture;
const source = PNG.encode(texture.width,texture.height,Uint8Array.from(texture.pixels),4);
write('enamel.png',source);
const authored = UV.plan(base.doc,{operations:[
  {op:'cut',ids:[base.seam('left-wing'),base.seam('right-wing')]},
  {op:'transform',ids:['right-wall'],translate:[.065,0]}
]});
assert(authored.report.canCommit);
const doc = authored.document, w=232, h=184;
const scene = {id:'field-case-uv-snap',style:'slate',solids:[],
  tilesets:{enamel:{...ink.readTilesetImage(source),tileSize:{width:18,height:20,paddingX:2,offsetX:3}}},
  topologyMeshes:{box:{document:doc,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}},
  camera:{target:[0,0,0],dist:7.4,yaw:.49,pitch:.31,projection:'orthographic',sway:0}};
json('scene.json',scene);
json('view.json',{w,h,raw:true,material:'enamel'});

const commands = [];
function cliRun(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const object = ['--object','box'];
function pick(id,query) {
  json(id+'-query.json',query);
  cliRun(['mesh-uv','select','scene.json',id+'-query.json',...object,'--out',id+'-selection.json']);
  return read(id+'-selection.json');
}
const edgePick = (face,u)=>({domain:'edges',atlas:{at:[u,.42],face}});
const grid = pick('grid',edgePick('left-wing',.28));
const chart = pick('chart',{domain:'corners',atlas:{at:[.64,.27],face:'faceplate'}});
const seam = pick('seam',edgePick('right-wing',.705));
const reference = pick('seam-reference',edgePick('faceplate',.64));
const cases = [
  {id:'grid',title:'Tile grid line',note:'U = source texel 23',selection:grid,target:{kind:'grid',axis:'u',units:'tile'}},
  {id:'chart',title:'Another chart',note:'Faceplate corner to lid corner',selection:chart,target:{kind:'chart',corner:'lid/frt'}},
  {id:'seam',title:'Existing seam',note:'Right wing to faceplate side',selection:seam,target:{kind:'seam',selection:reference}}
];
for (const {id,selection,target} of cases) {
  json(id+'-request.json',{revision:T.revision(doc),operations:[{op:'snap',scope:'independent',selection,target}]});
  const edit = ['mesh-uv','edit','scene.json',id+'-request.json',...object];
  cliRun(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  cliRun(edit.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), receipt = read(id+'-receipt.json');
  assert(preview.canCommit);
  assert.deepEqual(preview.operations,receipt.operations);
  assert.deepEqual(preview.preview.cornerScope.moving,selection.corners);
  assert.deepEqual(read(id+'.json').topologyMeshes.box.document.vertices,doc.vertices);
  assert.deepEqual(receipt.seams,[]);
  assert.deepEqual(receipt.corners.map(row=>row.id).sort(),selection.corners);
  const guide = receipt.operations[0].evidence.guides[0].points;
  if (id==='grid') {
    assert.deepEqual(guide,[[23/99,0],[23/99,1]]);
    assert(receipt.corners.every(row=>row.after[0]===23/99 && row.after[1]===row.before[1]));
  } else if (id==='chart') assert.deepEqual(receipt.corners[0].after,guide[0]);
  else assert.deepEqual(receipt.corners.map(row=>row.after),guide);
}

const W=698,H=710, x=i=>18+i*226, atlasBefore=129, atlasAfter=336, modelAfter=543;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f0e2ce')=>({type:'text',text,at:[x,y],scale,color});
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Snap corners and edges',18,42,3),
  ...cases.flatMap(({title,note},i)=>[text(title,x(i),81,2),text(note,x(i),103,1,'#e3c591')]),
  text('ATLAS BEFORE',18,117,1,'#a4c5c1'),
  text('ATLAS AFTER',18,324,1,'#a4c5c1'),
  text('MODEL AFTER',18,531,1,'#a4c5c1'),
  rect(18,691,7,7,'#ffe181'),text('SNAP TARGET',31,691,1),
  rect(134,691,7,7,'#75e2c8'),text('SELECTED CORNERS',147,691,1)
]});
function blit(name,left,top,cropX,cropY) {
  const image = PNG.raster(file(name)), width=image.w-2*cropX, height=image.h-2*cropY;
  for (let row=0;row<height;row++) {
    const start=((row+cropY)*image.w+cropX)*4, output=((top+row)*W+left)*4;
    board.data.set(image.data.subarray(start,start+width*4),output);
  }
}
for (const [i,{id}] of cases.entries()) {
  blit(id+'-preview/atlas-before.png',x(i),atlasBefore,0,0);
  blit(id+'-preview/atlas-after.png',x(i),atlasAfter,0,0);
  blit(id+'-preview/model-after.png',x(i),modelAfter,24,24);
}
write('UV-snap.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# UV snapping

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
saved selections, preview images, and receipts. The generator also
assembles the contact sheet.

Each edit starts with the same painted case. It aligns a left-wing
edge to a registered tile-grid line, a faceplate corner to a corner
on the lid chart, or the right-wing seam to the fixed faceplate side.
Gold overlays show the exact snap targets before and after each edit.
`);
