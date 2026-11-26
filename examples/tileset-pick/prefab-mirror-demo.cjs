'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'mirror-bays');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const read = name => fs.readFileSync(file(name));
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library,view,request} = fixture(), {KIT:K} = ink.load();
const source = {...scene,id:'mirror-station-bays',topologyMeshes:{},instances:{
  west:{prefab:'bay',transform:{translation:[-1.14,.04,0],rotation:[.15,-.04,.08]}}
}};
const settings = {...view,w:220,h:112,raw:true,camera:{...view.camera,zoom:1.55}};
json('source.json',source);
json('library.json',library);
json('view.json',settings);
json('mirror.json',{source:'west',instance:'east',plane:{origin:[0,0,0],normal:[1,0,0]}});
json('commit.json',{action:'commit',instance:'east'});
json('paint-both.json',{...request,hideSurroundings:false});
const pick = ink.pickTilesetRectangle(scene,'enamel',{x:0,y:0,width:24,height:24});
json('paint-east.json',{...request,hideSurroundings:false,instance:'east',
  edits:[{member:'panel',reskin:{face:'sign',selection:pick}}]});

const commands = [];
function run(args,receipt) {
  const value = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  if (receipt) write(receipt,value);
  return value;
}

const mirror = ['mesh-topology','mirror-prefab'], paint = ['mesh-topology','isolate-prefab'];
const link = JSON.parse(run([...mirror,'source.json','mirror.json','--preview','linked-review','--view','view.json',
  '--out','live.json'],'link-receipt.json'));
assert(link.canCommit);
run([...paint,'live.json','paint-both.json','--out','painted.json'],'paint-both-receipt.json');
const freeze = JSON.parse(run([...mirror,'painted.json','commit.json','--preview','commit-review','--view','view.json',
  '--out','independent.json'],'commit-receipt.json'));
assert(freeze.canCommit && freeze.preview.instances.every(row=>row.changedPixels===0 && row.beforePixels>0));
assert.deepEqual(read('commit-review/before.png'),read('commit-review/after.png'));
run([...paint,'independent.json','paint-east.json','--preview','east-edited.png','--view','view.json',
  '--out','asymmetric.json'],'paint-east-receipt.json');
const painted = JSON.parse(read('independent.json')).instances, asymmetric = JSON.parse(read('asymmetric.json')).instances;
assert.deepEqual(asymmetric.west,painted.west);
assert.notDeepEqual(asymmetric.east.meshOverrides,painted.east.meshOverrides);

const width=710,height=207, drawing=K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['01  LINK THE MIRROR','linked-review/after.png','One bay drives the reflection.'],
  ['02  PAINT THE SOURCE','commit-review/after.png','Both signs update. Commit is 0 px.'],
  ['03  EDIT THE RIGHT SIDE','east-edited.png','The left sign keeps its paint.']
];
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,13,1,'#abc9b4'),
  label('Live mirror, independent edits',16,30,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*229;
    return [label(title,x,63,1,'#b6e1cf'),label(note,x,190,1,'#abc9b4')];
  })
]});
for (const [i,[,name]] of panels.entries()) {
  const {w,h,data} = PNG.raster(file(name)), x=16+i*229;
  for (let y=0; y<h; y++) board.data.set(data.subarray(y*w*4,(y+1)*w*4),((74+y)*width+x)*4);
}
write('Live-prefab-mirror.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Live mirror, independent edits','',
  'Open Live-prefab-mirror.png for the three native-grid captures.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',
  'Link an authored bay across the center plane, then change the left sign.',
  'Both sides inherit the new paint while linked. Commit freezes the reflected placement.',
  'The commit preview changes zero pixels. A later edit changes only the right sign.',
  'The receipt includes the mirror plane and before/after world transforms.',''
].join('\n'));
