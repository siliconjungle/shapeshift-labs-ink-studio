'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'extrude-edge-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
const navy = '#1b2b34', mint = '#b3e2c1', amber = '#ffd195', slate = '#aec4c5';
function atlas(id,width,height,commands) {
  const raster = art.render({width,height,edges:'hard',commands});
  const png = PNG.encode(width,height,raster.data,4);
  write(id+'.png',png);
  return ink.readTilesetImage(png);
}
const scene = {id:'service-trim',style:'slate',solids:[],
  camera:{target:[0,.79,.20],dist:3.9,yaw:.36,pitch:.37,projection:'orthographic',sway:0},
  tilesets:{
    enamel:atlas('enamel-atlas',52,29,[
      rect(0,0,52,29,'#324c54'),rect(2,2,48,25,'#629186'),rect(4,3,44,2,'#bed4ae'),
      rect(4,10,44,11,'#2f4b50'),text('VALVE 2',6,12,1,'#eadfb0'),
      ...[6,13,20,27,34,41].map(x=>rect(x,24,4,2,'#d5a16c'))
    ]),
    bronze:atlas('bronze-atlas',52,12,[
      rect(0,0,52,12,'#8c5143'),rect(0,1,52,2,'#d99e69'),rect(0,9,52,2,'#eabd89'),
      ...[2,9,16,23,30,37,44].map(x=>rect(x,5,4,2,'#ba7957'))
    ])
  }};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',{x:0,y:0,width:52,height:29});
editor.placeTilesetFace({object:'panel',face:'plate',selection:crop,origin:[-1.25,.08,0],worldSize:[2.5,1.22]});
const authored = editor.meshTopology('panel').document;
editor.editMeshEdges('panel',{id:'split-panel',revision:T.revision(authored),
  operation:{kind:'subdivide-face',face:'plate',rows:1,columns:2}});
const before = JSON.parse(JSON.stringify(editor.snapshot())), row = before.topologyMeshes.panel, doc = row.document;
row.materials.push({id:'bronze',texture:{tileset:'bronze'}});
json('before.json',before);

const byVertex = new Map(doc.vertices.map(row=>[row.id,row.position]));
const top = T.inspect(doc).edges.filter(edge=>edge.uses.length===1 &&
  edge.vertices.every(id=>Math.abs(byVertex.get(id)[1]-1.3)<1e-9)).map(edge=>edge.id);
assert.equal(top.length,2);
const selection = T.select(doc,{domain:'edges',ids:top}), distance = .43;
const setups = [['edge','edge',true],['face','face',true],['locked',[0,4,3],true]];
for (const [id,direction,strict] of setups) json(id+'-request.json',{id:'extrude-trim',revision:T.revision(doc),
  operation:{kind:'extrude-edge',selection,direction,strict,distance,material:'bronze',uv:'strip'}});

const commands = [], motion = new Map();
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const [id] of setups) {
  const args = ['mesh-topology','edge-edit','before.json',id+'-request.json','--object','panel'];
  run(args,id+'-preview.json');
  run(args.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), report = preview.report, after = read(id+'.json').topologyMeshes.panel;
  assert.deepEqual(read(id+'-receipt.json').edgeEdit,report);
  assert(report.canCommit);
  assert.equal(report.detail.motion.length,3);
  assert.equal(report.detail.faces.length,2);
  assert.deepEqual(after.document.faces.slice(0,doc.faces.length),doc.faces);
  assert.deepEqual(after.bindings,row.bindings);
  const delta = report.detail.motion[0].displacement;
  assert(report.detail.motion.every(({displacement})=>displacement.every((n,i)=>n===delta[i])));
  motion.set(id,delta);
}
assert.deepEqual(motion.get('locked'),[0,.8*distance,.6*distance]);
const w = 154, h = 104, zoom = 2, W = 1018, H = 430, y = 111;
const cases = [
  ['edge','Edge direction','OUTWARD IN THE PANEL PLANE',mint],
  ['face','Face direction','ALONG THE FACE NORMAL',mint],
  ['locked','Locked direction','EXACT AXIS [0, 0.8, 0.6]',amber]
];
const renders = cases.map(([id])=>{
  const name = id+'-1x.png';
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',name]);
  return PNG.raster(file(name)).data;
});
assert.notDeepEqual(renders[0],renders[1]);
assert.notDeepEqual(renders[1],renders[2]);

const panelX = i=>16+i*333;
function profile(i,id,color) {
  const x = panelX(i)+148, y = 385, scale = 60, delta = motion.get(id);
  const end = [Math.round(x+scale*delta[2]),Math.round(y-scale*delta[1])];
  return [line([[x,y+24],[x,y]],slate,3),line([[x,y],end],color,2),
    rect(x-2,y-2,5,5,slate),rect(end[0]-2,end[1]-2,5,5,color)];
}
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Grow a painted strip from an open edge',16,43,3),
  ...cases.flatMap(([id,title,note,color],i)=>[
    text(title,panelX(i),86,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#527076'),
    text(note,panelX(i),330,1,color),...profile(i,id,color)
  ]),
  text('SIDE SECTIONS / Y UP / Z RIGHT',16,414,1,slate)
]});
for (const [i,data] of renders.entries()) for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
  const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
  board.data.set(data.subarray(at,at+4),((y+row)*W+panelX(i)+column)*4);
}
write('Extrude-open-edge.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Extrude an open edge

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the previews, edit receipts, and native renders.

The same two open edges grow into a connected bronze strip.
Edge mode stays in the panel plane. Face mode follows the panel's
normal. The last edit locks a diagonal direction in mesh coordinates,
so all three outer vertices move by the same amount.
`);
