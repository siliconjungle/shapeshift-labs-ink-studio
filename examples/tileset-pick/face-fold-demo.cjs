'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'face-fold-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f3ddba')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
function sheet(name,width,height,commands) {
  const {data} = art.render({width,height,edges:'hard',commands});
  const png = PNG.encode(width,height,data,4);
  write(name+'.png',png);
  return ink.readTilesetImage(png);
}
const scene = {id:'pump-house-awning',style:'slate',solids:[],
  camera:{target:[0,1.03,-.28],dist:4,yaw:.48,pitch:.45,projection:'orthographic',sway:0},
  tilesets:{
    wall:sheet('pump-wall',44,24,[
      rect(0,0,44,24,'#754d42'),rect(0,1,44,22,'#a96b4c'),rect(0,2,44,1,'#d29363'),
      ...[5,11,17].flatMap((y,i)=>[rect(0,y,44,1,'#875746'),
        ...[5,17,29,41].map(x=>rect(x-(i%2)*4,y+1,1,5,'#875746'))]),
      rect(12,7,20,10,'#634e48'),rect(13,8,18,8,'#d59b65'),text('PUMP',14,10,1,'#553d37')
    ]),
    enamel:sheet('painted-awning',44,24,[
      rect(0,0,44,24,'#244653'),rect(1,1,42,21,'#527f82'),rect(1,2,42,1,'#98b2a0'),
      ...[4,12,20,28,36].flatMap(x=>[rect(x,3,4,18,'#3b6670'),rect(x,3,1,18,'#739699')]),
      rect(1,20,42,2,'#345664'),rect(19,8,6,7,'#e2aa63'),rect(20,9,4,5,'#f4d5a1'),
      rect(21,10,2,3,'#517478')
    ])
  }};
const pick = (tileset,width,height)=>ink.pickTilesetRectangle(scene,tileset,{x:0,y:0,width,height});
const editor = ink.createSceneEditor(scene);
editor.placeTilesetFace({object:'hatch',face:'wall',selection:pick('wall',44,24),worldSize:[2.1,1.08],origin:[-1.05,.05,0]});
const hinge = editor.meshTopology('hatch').document.edges
  .find(edge=>edge.vertices.includes('wall/v2') && edge.vertices.includes('wall/v3'));
editor.editMeshTopology('hatch',{edges:[{id:hinge.id,uvSeam:true,smooth:false}]});
editor.growTilesetFace({object:'hatch',edge:hinge.id,face:'awning',selection:pick('enamel',44,24),depth:.9});
const initial = editor.snapshot(), doc = editor.meshTopology('hatch').document;
const selection = T.select(doc,{domain:'faces',ids:['awning']});
json('flat.json',initial);
json('awning-selection.json',selection);

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+(stdout ? ' > '+stdout : ' > /dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const [id,degrees] of [['mid',-40],['open',-82]]) {
  json(id+'-request.json',{operation:{kind:'fold',edge:hinge.id,from:'wall/v3',degrees}});
  const args = ['mesh-topology','transform','flat.json',id+'-request.json','--object','hatch',
    '--selection','awning-selection.json'];
  run(args,id+'-preview.json');
  run(args.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const {report} = read(id+'-preview.json'), after = read(id+'.json').topologyMeshes.hatch;
  assert(report.canCommit,JSON.stringify(report.issues));
  assert.deepEqual(read(id+'-receipt.json').transform,report);
  assert.deepEqual(T.planTransform(doc,report.operation.replay).document,after.document);
  assert.deepEqual(after.document.faces,doc.faces);
  assert.deepEqual(after.bindings,initial.topologyMeshes.hatch.bindings);
  for (const vertex of report.operation.hinge.vertices)
    assert.deepEqual(after.document.vertices.find(row=>row.id===vertex),doc.vertices.find(row=>row.id===vertex));
}
const cases = [['flat','Before',0],['mid','Mid fold',-40],['open','Awning folded',-82]];
const w=152,h=103,zoom=2,W=980,H=421,y=112;
const renders = cases.map(([id])=>{
  const name = id+'-1x.png';
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',name]);
  return PNG.raster(file(name)).data;
});
assert.notDeepEqual(renders[0],renders[1]);
assert.notDeepEqual(renders[1],renders[2]);

const panelX = i=>16+i*322, hingeColor = '#edb678', panelColor = '#8fbfbb';
function profile(i,degrees) {
  const x = panelX(i)+164, y = 381, angle = degrees*Math.PI/180;
  return [line([[x,y+24],[x,y]],'#a28372',3),
    line([[x,y],[x+Math.round(34*Math.sin(angle)),y-Math.round(34*Math.cos(angle))]],panelColor,3),
    rect(x-2,y-2,5,5,hingeColor)];
}
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172831'),text('INK STUDIO / TILE MODELING',16,16,2,panelColor),
  text('Fold a painted face around its hinge',16,42,3),
  ...cases.flatMap(([,title,degrees],i)=>[
    text(title,panelX(i),86,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#526d76'),
    text(degrees+' DEG / SAME PAINT CROP',panelX(i),328,1,panelColor),...profile(i,degrees)
  ]),
  text('SIDE PROFILES / FIXED HINGE IN AMBER',16,405,1,hingeColor)
]});
for (const [i,data] of renders.entries()) for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
  const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
  board.data.set(data.subarray(at,at+4),((y+row)*W+panelX(i)+column)*4);
}
write('Face-fold.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Fold a painted face

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the previews, receipts, scene files, and 1× renders.

Both edits start from the same flat pump-house wall and awning.
The request pins a shared edge and applies its signed angle from the
specified endpoint. The awning's paint crop and all component IDs
survive both folds.
`);
