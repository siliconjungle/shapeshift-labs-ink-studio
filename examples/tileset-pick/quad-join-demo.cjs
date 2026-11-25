'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { KIT: K } = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'quad-join-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const type = (text,x,y,scale,color='#f5efdb')=>({type:'text',text,at:[x,y],scale,color});
const navy = '#1b2b34', mint = '#9fd2b0', amber = '#f2bc75', gray = '#aec2c1';
const label = art.render({width:40,height:28,edges:'hard',commands:[
  rect(0,0,40,28,'#335057'),rect(2,2,36,24,'#59847d'),
  rect(3,3,34,2,'#c3dcb0'),rect(3,6,34,1,'#32545b'),
  rect(5,9,30,9,'#28454e'),type('INLET',6,10,1,'#dfdeab'),
  ...[7,14,21,28].map(x=>rect(x,21,5,2,'#d49b5d')),
  ...[[3,7],[35,7],[3,23],[35,23]].map(([x,y])=>rect(x,y,2,2,'#b4d9b0'))
]});
const atlas = PNG.encode(40,28,label.data,4);
write('enamel.png',atlas);

const scene = {id:'station-intake',style:'slate',solids:[],
  camera:{target:[0,.71,.24],dist:3.1,yaw:.24,pitch:.14,projection:'orthographic',sway:0},
  tilesets:{enamel:ink.readTilesetImage(atlas)}};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',{x:0,y:0,width:40,height:28});
editor.placeTilesetFace({object:'panel',face:'cover',selection:crop,worldSize:[2.2,1.4],origin:[-1.1,0,0]});
const raw = editor.meshTopology('panel').document;
editor.editMeshTopology('panel',{vertices:[{id:'cover/v2',position:[1.1,1.4,.7]}],
  faces:[{...raw.faces[0],diagonal:['cover/c0','cover/c2']}]});
const original = editor.meshTopology('panel').document;
editor.repairMeshTopology('panel',{revision:T.revision(original),operations:[{kind:'split-quad',faces:['cover']}]});
const triangles = editor.meshTopology('panel').document;
const edge = T.inspect(triangles).edges.find(row=>row.uses.length === 2);
json('matched.json',editor.snapshot());
const plan = (doc,operation)=>({revision:T.revision(doc),operations:[{kind:'join-triangles',edge:edge.id,...operation}]});
json('join-matched.json',plan(triangles,{}));
const other = triangles.faces.find(face=>face.id !== 'cover');
editor.editMeshTopology('panel',{faces:[{...other,corners:other.corners.map(corner=>
  edge.vertices.includes(corner.vertex) ? {...corner,uv:corner.uv.map(n=>n*.62+.19)} : corner)}]});
const shifted = editor.meshTopology('panel').document;
json('seam.json',editor.snapshot());
json('join-safe.json',plan(shifted,{}));
json('join-override.json',plan(shifted,{keep:'cover',uvs:'keep'}));

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const repair = (scene,request)=>['mesh-topology','repair',scene+'.json',request+'.json','--object','panel'];
const safe = repair('seam','join-safe');
run(repair('matched','join-matched').concat('--out','matched-quad.json','--report','matched-receipt.json'));
run(safe,'safe-preview.json');
const refusal = safe.concat('--out','blocked-quad.json','--report','blocked-receipt.json');
commands.push('if ink-studio '+refusal.join(' ')+' 2> blocked.log; then exit 1; fi','test ! -e blocked-quad.json');
const attempt = spawnSync(process.execPath,[cli,...refusal],{cwd:dir,encoding:'utf8'});
assert.equal(attempt.status,1);
assert.match(attempt.stderr,/remove a UV seam/);
assert(!fs.existsSync(file('blocked-quad.json')));
write('blocked.log',attempt.stderr);
const override = repair('seam','join-override');
run(override,'override-preview.json');
run(override.concat('--out','seam-quad.json','--report','override-receipt.json'));
assert.equal(read('safe-preview.json').report.blockers[0].code,'join-uv-seam');
assert.deepEqual(read('override-preview.json').report,read('override-receipt.json').repair);
assert.equal(read('override-preview.json').report.steps[0].uvSets[0].endpoints.filter(row=>row.delta.some(Boolean)).length,2);

const w = 118, h = 86, zoom = 2;
const cases = [
  ['matched','Matching triangles','2 faces / same shared UVs',mint],
  ['matched-quad','Safe join','1 quad / identical pixels',mint],
  ['seam','UV seam','Safe join blocked',amber],
  ['seam-quad','Override','Keeps COVER UVs',amber]
];
for (const [id] of cases)
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
const image = id=>fs.readFileSync(file(id+'-1x.png'));
assert.deepEqual(image('matched'),image('matched-quad'));
assert.notDeepEqual(image('seam'),image('seam-quad'));
assert.deepEqual(image('matched-quad'),image('seam-quad'));
commands.push('cmp matched-1x.png matched-quad-1x.png','cmp matched-quad-1x.png seam-quad-1x.png');

const W = 1020, H = 332, y = 115;
const xAt = i=>16+i*251;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),type('INK STUDIO / MESH TOPOLOGY',16,16,2,gray),
  type('Join triangles on a painted panel',16,43,3),
  ...cases.flatMap(([,title,note,color],i)=>{
    const x = xAt(i);
    return [type(title,x,90,2),rect(x-1,y-1,w*zoom+2,h*zoom+2,'#53727b'),
      type(note,x,y+h*zoom+14,1,color)];
  })
]});
for (const [i,[id]] of cases.entries()) {
  const {data} = PNG.raster(file(id+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+xAt(i)+column)*4);
  }
}
write('Quad-join.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Join triangles on a painted panel

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
native renders, previews, and receipts.

The matching triangles join with identical native pixels. A second
scene shifts the shared UVs on one triangle. Safe mode reports both
endpoint changes and leaves the scene untouched. The explicit override
chooses COVER as the keeper and restores the continuous paint.
`);
