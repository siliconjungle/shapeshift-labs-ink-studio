'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const dir = path.resolve(process.argv[2] ?? 'uv-camera-project-demo');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const box = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale,color='#f0e4cc')=>({type:'text',text,at:[x,y],scale,color});
const w=216,h=144;
const painted = art.render({width:w,height:h,edges:'hard',commands:[
  box(0,0,w,h,'#172b37'),
  ...Array.from({length:14},(_,i)=>box(i*16,0,1,h,'#294655')),
  ...Array.from({length:9},(_,i)=>box(0,i*16,w,1,'#294655')),
  box(36,48,145,47,'#314a51'),
  box(36,49,145,2,'#9cb29b'),
  box(36,87,145,4,'#d5a567'),
  box(36,91,145,1,'#775c52'),
  box(54,57,52,25,'#263a43'),
  box(55,58,50,1,'#6a9191'),
  label('GATE',60,62,2,'#e9c389'),
  box(117,58,40,21,'#3c5a5f'),
  label('12',126,62,2,'#f0d3a4'),
  ...[37,41,45,163,167,171,175].map((x,i)=>box(x,68+(i%2)*5,2,7,'#a5c0a3'))
]});
const texture = PNG.encode(w,h,painted.data,4);
write('panel-atlas.png',texture);

const vertices = [[-1.84,1.25],[.10,0],[1.87,-1.04]].flatMap(([x,z],i)=>[
  {id:'b'+i,position:[x,-.74,z]},{id:'t'+i,position:[x,.74,z]}
]);
const ids = ['approach','return'];
const faces = ids.map((id,i)=>{
  const u = i*.08;
  const uv = [[.05+u,.25],[.13+u,.25],[.13+u,.13],[.05+u,.13]];
  return {id, material:'enamel',corners:['b'+i,'b'+(i+1),'t'+(i+1),'t'+i]
    .map((vertex,j)=>({id:id+'/'+j,vertex,uv:uv[j]}))};
});
const document = T.create({id:'folded-enamel-panel',vertices,faces});
const shot = {target:[0,0,0],eye:[0,0,4.9],fov:.74};
json('panel.json',{id:'approved-camera-uvs',style:'slate',solids:[],
  cameraRig:{shots:{
    orthographic:{...shot,projection:'orthographic'},
    perspective:{...shot,projection:'perspective'},
    cropped:{...shot,fov:.32,projection:'perspective'}
  }},
  tilesets:{enamel:ink.readTilesetImage(texture)},
  topologyMeshes:{panel:{document,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}}});
json('project.json',{revision:T.revision(document),operations:[{op:'project-camera',ids}]});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}

const edit = ['mesh-uv','edit','panel.json','project.json','--object','panel'];
const shots = ['orthographic','perspective'];
const projected = new Map();
for (const id of [...shots,'cropped']) {
  json(id+'-view.json',{w,h,cameraShot:id});
  const args = edit.concat('--view',id+'-view.json');
  run(args.concat('--preview',id+'-review'),id+'-preview.json');
  const preview = read(id+'-preview.json');
  if (id==='cropped') {
    assert(!preview.canCommit);
    assert(preview.operations[0].conflicts.some(row=>row.code==='outside-camera-frame'));
    continue;
  }
  assert(preview.canCommit);
  run(args.concat('--out',id+'-panel.json','--report',id+'-receipt.json'));
  const receipt = read(id+'-receipt.json');
  assert.deepEqual(preview.operations,receipt.operations);
  const edited = read(id+'-panel.json').topologyMeshes.panel.document;
  assert.deepEqual(edited.vertices,document.vertices);
  const evidence = receipt.operations[0].evidence;
  assert.equal(evidence.sample.shot,id);
  assert.equal(evidence.camera.ortho,id==='orthographic');
  projected.set(id,evidence);
  for (const [state,name] of [['before','panel.json'],['after',id+'-panel.json']]) {
    run(['render',name,'--camera-shot',id,'--w',w,'--h',h,'--px',1,'--raw','--edges','off','--out',id+'-'+state+'-1x.png']);
  }
}
assert.notDeepEqual(projected.get(shots[0]).corners.map(row=>row.uv),projected.get(shots[1]).corners.map(row=>row.uv));

const W=500,H=560,x=i=>24+i*236, top=118, middle=286, bottom=456;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  box(0,0,W,H,'#162833'),label('INK STUDIO / MESH UV',24,16,2,'#9fc2bf'),
  label('Project from camera',24,44,3),
  label('ORTHOGRAPHIC',x(0),87,2),label('PERSPECTIVE',x(1),87,2),
  label('NATIVE RENDER / BEFORE',24,108,1,'#9fc2bf'),
  label('NATIVE RENDER / PROJECTED',24,276,1,'#9fc2bf'),
  label('UV FOOTPRINT ON SOURCE ATLAS',24,446,1,'#9fc2bf')
]});
function blit(name,left,top,startX,startY,width,height) {
  const atlas = PNG.raster(file(name));
  for (let row=0;row<height;row++) {
    const start=((row+startY)*atlas.w+startX)*4, output=((top+row)*W+left)*4;
    board.data.set(atlas.data.subarray(start,start+width*4),output);
  }
}
for (const [i,id] of shots.entries()) {
  blit(id+'-before-1x.png',x(i),top,0,0,w,h);
  blit(id+'-after-1x.png',x(i),middle,0,0,w,h);
  blit(id+'-review/atlas-after.png',x(i)+36,bottom,0,27,h,91);
}
write('UV-camera-projection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Project UVs from an approved camera

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the edited scenes, receipts, captures, and review images.

The same folded enamel panel is projected from two authored shots.
The orthographic shot uses constant magnification. The perspective
shot expands the near edge of the panel and compresses the far one.
The cropped shot reports offscreen corners and leaves the mesh unedited.
`);
