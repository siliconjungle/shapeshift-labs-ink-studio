'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'face-reskin-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f0e8d1')=>({type:'text',text,at:[x,y],scale,color});
const tile = (x,dark,base,edge,light,shape) => [
  rect(x,0,16,10,dark),rect(x+1,1,14,8,base),rect(x+1,1,14,1,edge),...shape(x,light)
];
const arrow = (x,c)=>[rect(x+4,4,6,2,c),rect(x+9,3,2,4,c),rect(x+11,4,2,2,c),rect(x+13,4,1,1,c)];
const notch = (x,c)=>[rect(x+3,3,3,2,c),rect(x+6,4,5,2,c),rect(x+10,4,2,4,c)];
const cross = (x,c)=>[rect(x+7,3,2,5,c),rect(x+5,4,6,2,c),rect(x+12,2,1,1,c)];
function sheet(commands) {
  const {data} = draw.render({width:32,height:10,edges:'hard',commands});
  return ink.readTilesetImage(PNG.encode(32,10,data,4));
}
const draft = {id:'reskin-wayfinding',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},tilesets:{
  dawn:sheet([...tile(0,'#56383d','#a9644e','#dc9762','#f4cd91',notch),rect(16,0,16,10,'#603b4c')]),
  dusk:sheet([...tile(0,'#3e334e','#765c82','#ae87a3','#ffcca3',cross),
    ...tile(16,'#22434b','#326a6c','#83af99','#f4d087',arrow)])
}};
write('draft.json',JSON.stringify(draft,null,2)+'\n');

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
const old = ['tileset','stamp','--scene','draft.json','--object','wall','--face','sign',
  '--material','enamel','--id','dawn','--x','0','--y','0','--width','16','--height','10',
  '--paint-rotate','90','--out','original.json'];
studio(old,'original-stamp.json');
studio(['tileset','stamp','--scene','original.json','--object','wall','--face','neighbor',
  '--material','enamel','--id','dawn','--x','0','--y','0','--width','16','--height','10',
  '--origin','3,0,0','--out','both.json'],'neighbor-stamp.json');
studio(['tileset','pick','--scene','both.json','--id','dusk','--x','16','--y','0','--width','16','--height','10',
  '--out','brush.json']);

const starter = read('both.json'), mesh = starter.topologyMeshes.wall.document;
const modes = [
  ['original','ORIGINAL FACE','DAWN / CROP A / PAINT 90 DEG','both.json'],
  ['crop','CROP','DUSK / CROP B / BRUSH ANGLE','crop.json'],
  ['tileset','TILESET','DUSK / SAME PIGMENT UVS','tileset.json'],
  ['relative','RELATIVE','DUSK / CROP B / FACE ANGLE','relative.json']
];
for (const [mode,,,output] of modes.slice(1)) {
  const args = ['tileset','reskin','--scene','both.json','--object','wall','--face','sign',
    '--mode',mode,'--selection','brush.json'];
  studio(args,mode+'-preview.json');
  studio([...args,'--out',output],mode+'-receipt.json');
  const result = read(mode+'-receipt.json'), migrated = read(output).topologyMeshes.wall.document;
  assert.deepEqual(result,read(mode+'-preview.json'));
  assert.deepEqual(migrated.vertices,mesh.vertices);
  assert.deepEqual(migrated.edges,mesh.edges);
  assert.deepEqual(migrated.faces.find(face=>face.id === 'neighbor'),mesh.faces.find(face=>face.id === 'neighbor'));
  assert.equal(result.after.source.selection.x,mode === 'tileset' ? 0 : 16);
  assert.equal(result.after.source.paint.rotation,mode === 'crop' ? 0 : 90);
  if (mode === 'tileset') assert(result.corners.every(row=>JSON.stringify(row.before) === JSON.stringify(row.after)));
}
const sdk = ink.createSceneEditor(starter);
sdk.applyTilesetReskin({object:'wall',face:'sign',mode:'relative',selection:read('brush.json')});
assert.equal(sdk.history().undo.at(-1),'Reskin sign');
sdk.undo();
assert.deepEqual(sdk.snapshot(),starter);
for (const [name,,,source] of modes)
  studio(['render',source,'--w','116','--h','89','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','.5,.3125,0','--zoom','8.4','--raw','--out',name+'-1x.png']);

const W = 1036,H = 356,Y = 131, panels = [24,278,532,786];
const board = draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#16242c'),text('INK STUDIO / PAINTED MESHES',24,19,2,'#a4dbbc'),
  text('Reskin one face in place',24,48,3),
  text('SAME FACE AND CAMERA / NATIVE 1X CAPTURES SHOWN AT 2X',24,80,1),
  ...modes.flatMap(([,label,note],i)=>[
    text(label,panels[i],104,2,'#a4dbbc'),rect(panels[i]-1,Y-1,234,180,'#486970'),
    text(note,panels[i],326,1)
  ])
]});
for (const [i,[name]] of modes.entries()) {
  const {w,h,data} = PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i]+x)*4);
  }
}
write('Face-reskin.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  modes.slice(1).map(([mode])=>'cmp '+mode+'-preview.json '+mode+'-receipt.json').join('\n')+'\n');
write('README.md',`# Reskin a painted face

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The three modes start
from the same rotated sign. Crop applies the new brush. Tileset changes
the atlas sampled by the current UVs. Relative fits the brush to the
existing paint orientation. Each capture uses the same native grid
and camera. The JSON receipts record the changed face and material.
`);
