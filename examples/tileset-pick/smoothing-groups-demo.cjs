'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'smoothing-groups-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e4cb')=>({type:'text',text,at:[x,y],scale,color});
const {data} = art.render({width:32,height:32,edges:'hard',commands:[
  rect(0,0,16,32,'#6eaaa8'),rect(0,0,16,1,'#b6c6a0'),rect(0,30,16,2,'#3a737b'),
  rect(0,7,16,1,'#60959a'),rect(0,24,16,1,'#54868d'),rect(2,3,2,2,'#527c86'),rect(12,3,2,2,'#527c86'),
  rect(2,26,2,2,'#527c86'),rect(12,26,2,2,'#527c86'),rect(6,12,4,6,'#7cb4ac'),
  rect(16,0,16,32,'#ac784e'),rect(16,0,16,3,'#684d3f'),rect(16,5,16,3,'#e1ae72'),
  rect(16,24,16,2,'#8e5d45'),rect(16,27,16,3,'#bd8658'),rect(16,30,16,2,'#6b5141')
]});
const atlas = PNG.encode(32,32,data,4);
write('housing-atlas.png',atlas);
const scene = {id:'pump-housing',style:'slate',solids:[],tilesets:{housing:ink.readTilesetImage(atlas)},
  finish:{areaLights:[{id:'key',shape:'disk',at:[1.4,2.6,3],normal:[-.4,-.4,-1],size:[.25,.25],
    color:'#faf6df',intensity:5,radius:6,sampleGrid:1,visible:false,shadows:false}]},
  camera:{target:[0,.93,.34],dist:3.7,yaw:-.18,pitch:.28,projection:'orthographic',sway:0}};

const angles = [-84,-56,-28,0,28,56,84].map(degrees=>degrees*Math.PI/180);
const levels = [[0,.86],[.21,1],[1.52,1],[1.81,.77]];
const vertex = (level,i)=>'r'+level+'/v'+i;
const vertices = levels.flatMap(([y,r],level)=>angles.map((angle,i)=>({
  id:vertex(level,i),position:[r*Math.sin(angle),y,r*Math.cos(angle)]
})));
const faces = levels.slice(1).flatMap((_,level)=>angles.slice(1).map((_,i)=>{
  const id = [ 'foot','body','rim' ][level]+'/'+i;
  const left = level===1 ? 0 : 16/31, right = level===1 ? 15/31 : 1;
  const ring = [vertex(level,i),vertex(level,i+1),vertex(level+1,i+1),vertex(level+1,i)];
  const uv = [[left,1],[right,1],[right,0],[left,0]];
  return {id,material:'enamel',corners:ring.map((vertex,slot)=>({id:id+'/c'+slot,vertex,uv:uv[slot]}))};
}));
const doc = T.create({id:'housing',vertices,faces});
scene.topologyMeshes = {housing:{document:doc,materials:[{id:'enamel',texture:{tileset:'housing'}}]}};
const edgeIds = T.inspect(doc).edges;
const seam = edgeIds.find(edge=>edge.vertices.includes(vertex(1,4)) && edge.vertices.includes(vertex(2,4))).id;
const body = T.select(doc,{domain:'faces',ids:faces.filter(face=>face.id.startsWith('body/')).map(face=>face.id)});
const rim = faces.filter(face=>face.id.startsWith('rim/')).map(face=>face.id);
const foot = faces.filter(face=>face.id.startsWith('foot/')).map(face=>face.id);
const request = {id:'housing-shading',revision:T.revision(doc)};
json('flat.json',scene);
json('all-request.json',{...request,groups:[{group:'housing',faces:faces.map(face=>face.id)}]});
json('groups-request.json',{...request,groups:[{group:'shell',selection:body},{group:'rim',faces:rim},{group:'foot',faces:foot}],
  edges:[{id:seam,uvSeam:true}]});
json('select-shell.json',{domain:'faces',filter:{smoothingGroups:['shell']}});
const w=146,h=106,zoom=2,W=965,H=579;
json('view.json',{w,h,raw:true});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+(stdout ? ' > '+stdout : ' > /dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const id of ['all','groups']) {
  const args = ['mesh-topology','shading','flat.json',id+'-request.json','--object','housing'];
  run(args,id+'-preview.json');
  run(args.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const revision = read(id+'-preview.json').report;
  assert.deepEqual(read(id+'-receipt.json').shading,revision);
  assert.deepEqual(read(id+'.json').topologyMeshes.housing.document.vertices,doc.vertices);
}
run(['mesh-topology','select','groups.json','select-shell.json','--object','housing'],'shell-selection.json');
assert.deepEqual(read('shell-selection.json').ids,body.ids);
run(['mesh-topology','shading','groups.json','--object','housing'],'group-inspection.json');
const inspection = read('group-inspection.json');
assert.equal(inspection.edges.find(edge=>edge.id===seam).rule,'uv-seam');
assert(inspection.edges.some(edge=>edge.rule==='group-boundary'));
assert(inspection.edges.some(edge=>edge.rule==='smooth-group'));

const cases = [
  ['flat','Flat tiles','FACETED BODY AND RIM'],
  ['all','All faces in one group','BODY AND RIM BLEND'],
  ['groups','Separate groups','SMOOTH BODY / HARD RIM AND SEAM']
];
const captures = cases.map(([id])=>{
  run(['mesh-topology','shading',id+'.json','--object','housing','--view','view.json','--preview',id+'-view']);
  return ['beauty','shading'].map(name=>PNG.raster(file(id+'-view/'+name+'.png')).data);
});
assert.notDeepEqual(captures[0][1],captures[1][1]);
assert.notDeepEqual(captures[1][1],captures[2][1]);
assert.notDeepEqual(captures[0][0],captures[1][0]);
assert.notDeepEqual(captures[1][0],captures[2][0]);

const x = i=>20+i*317, top=117, bottom=350;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#15252d'),text('INK STUDIO / TILE MODELING',20,16,2,'#a7c7bb'),
  text('Smooth the shell. Keep the seams.',20,41,3),
  ...cases.flatMap(([,title,note],i)=>[
    text(title,x(i),81,2),text(note,x(i),101,1,'#a7c7bb'),
    ...[top,bottom].map(y=>rect(x(i)-1,y-1,w*zoom+2,h*zoom+2,'#4d696f'))
  ]),
  text('SHADING NORMALS / XYZ AS RGB',20,337,1,'#a7c7bb')
]});
for (const [i,pair] of captures.entries()) for (const [j,pixels] of pair.entries()) {
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(pixels.subarray(at,at+4),(([top,bottom][j]+row)*W+x(i)+col)*4);
  }
}
write('Smoothing-groups.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Smoothing groups for painted tiles

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the revisions, receipts, group inspection, and native 1× captures.

The first view uses flat shading. The second blends the body and
trim in one smoothing group. The last assigns the shell, rim, and foot
independent groups and marks one vertical body edge as an authored
seam. All three views use the same geometry and atlas coordinates.
`);
