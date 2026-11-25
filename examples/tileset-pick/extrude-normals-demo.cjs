'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'extrude-normals-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const navy = '#1b2b34', mint = '#b3ddc0', amber = '#ffd091', slate = '#aec2c1';
function atlas(id,width,height,commands) {
  const artGrid = art.render({width,height,edges:'hard',commands});
  const png = PNG.encode(width,height,artGrid.data,4);
  write(id+'.png',png);
  return ink.readTilesetImage(png);
}
const scene = {id:'intake-cover',style:'slate',solids:[],
  camera:{target:[0,.79,.24],dist:3.4,yaw:.60,pitch:.36,projection:'orthographic',sway:0},
  tilesets:{
    enamel:atlas('enamel-atlas',48,29,[
      rect(0,0,48,29,'#34505b'),rect(2,2,44,25,'#668e87'),rect(3,3,42,2,'#afd0aa'),
      rect(4,10,40,11,'#2b4b50'),text('PUMP 4',6,12,1,'#e6ddb1'),
      ...[4,11,18,25,32,39].map(x=>rect(x,23,4,2,'#d2a06c'))
    ]),
    bronze:atlas('bronze-atlas',20,12,[
      rect(0,0,20,12,'#8e5543'),rect(0,0,20,3,'#c18860'),rect(0,9,20,3,'#e1b37c'),
      ...[1,6,11,16].map(x=>rect(x,4,2,4,'#b77854'))
    ])
  }};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',{x:0,y:0,width:48,height:29});
editor.placeTilesetFace({object:'cover',face:'plate',selection:crop,origin:[-1.12,.13,0],worldSize:[2.24,1.30]});
const sceneBefore = JSON.parse(JSON.stringify(editor.snapshot())), row = sceneBefore.topologyMeshes.cover;
const cornerNormals = [[-.18,-.11,1],[.18,-.11,1],[.68,.24,.72],[-.68,.24,.72]];
const doc = T.create({...row.document,uvBindings:{pigment:1},faces:row.document.faces.map(face=>({
  ...face,corners:face.corners.map((corner,i)=>({...corner,uv:[0,0],normal:cornerNormals[i],attributes:{'uv/1':corner.uv}}))
}))});
row.document = doc;
row.materials.push({id:'bronze',texture:{tileset:'bronze'}});
json('before.json',sceneBefore);

const distance = .43, selection = T.select(doc,{domain:'faces',ids:['plate']});
for (const normals of ['face','vertex']) json(normals+'-request.json',{id:'lift-panel',revision:T.revision(doc),selection,
  operation:{kind:'extrude',distance,normals},rim:{material:'bronze',uv:'per-edge',uvSets:[1]}});
const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const mode of ['face','vertex']) {
  const args = ['mesh-topology','face-region','before.json',mode+'-request.json','--object','cover'];
  run(args,mode+'-preview.json');
  run(args.concat('--out',mode+'.json','--report',mode+'-receipt.json'));
  const plan = read(mode+'-preview.json').report, after = read(mode+'.json').topologyMeshes.cover;
  assert(plan.canCommit);
  assert.deepEqual(read(mode+'-receipt.json').faceRegion,plan);
  assert.deepEqual(after.bindings,row.bindings);
  assert.deepEqual(after.document.faces[0].corners.map(corner=>corner.attributes),doc.faces[0].corners.map(corner=>corner.attributes));
  assert(after.document.faces.slice(1).every(face=>face.material==='bronze' &&
    face.corners.every(corner=>corner.attributes['uv/1'].every((n,i)=>n===corner.uv[i]))));
  assert.equal(plan.extrusion.motion.every(move=>Math.abs(move.displacement[2]-distance)<1e-9),mode==='face');
}

const w = 154, h = 106, zoom = 2, W = 1018, H = 366, y = 111;
const cases = [
  ['before','Painted source','ORIGINAL ENAMEL UVS',slate],
  ['face','Face normals','ONE DIRECTION / STRAIGHT WALLS',mint],
  ['vertex','Vertex normals','CORNER DIRECTIONS / FLARED WALLS',amber]
];
for (const [id] of cases)
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
assert.notDeepEqual(fs.readFileSync(file('face-1x.png')),fs.readFileSync(file('vertex-1x.png')));
const panelX = i=>16+i*333;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Extrude a painted cap along its normals',16,43,3),
  ...cases.flatMap(([,title,note,color],i)=>[
    text(title,panelX(i),86,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#527077'),
    text(note,panelX(i),334,1,color)
  ]),
  text('BOTH EXTRUSIONS USE THE BRONZE ATLAS ON EACH SIDEWALL',16,352,1,slate)
]});
for (const [i,[id]] of cases.entries()) {
  const {data} = PNG.raster(file(id+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+panelX(i)+column)*4);
  }
}
write('Extrude-normals.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Extrude a painted cap along its normals

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the previews, edit receipts, and native renders.

Both commands move the cap by 0.43 mesh units. Face mode sends every
corner along the face normal. Vertex mode uses the authored normal
at each corner, widening the top of the cap. Both keep the enamel
paint and use the full bronze crop on each sidewall.
`);
