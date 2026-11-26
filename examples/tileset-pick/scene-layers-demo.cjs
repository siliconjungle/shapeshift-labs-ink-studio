'use strict';

const assert = require('node:assert/strict'), {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'station-layers');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const read = name => JSON.parse(fs.readFileSync(file(name)));
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library,view} = fixture(), {KIT:K} = ink.load();
const {prefabLibrary,...base} = scene;
json('source.json',{...base,id:'station-wings',prefabs:library,topologyMeshes:{},
  camera:{...base.camera,target:[0,1.05,0]},constructionPlane:{origin:[0,0,.09],grid:[.25,.25]},
  instances:{west:{prefab:'bay',transform:{translation:[-1.37,0,0]}},
    east:{prefab:'bay',transform:{translation:[1.35,.12,0],rotation:[.13,.02,.055]}},
    upper:{prefab:'bay',parent:'east',transform:{translation:[.05,1.08,.16],scale:.67}}},
  sceneLayers:{layers:{station:{label:'Station'},west:{parent:'station'},east:{parent:'station'},
    yard:{label:'Service yard'}},members:{west:'west',east:'east'}}});
json('view.json',{...view,w:220,h:132,camera:{...view.camera,target:[0,1.05,0],zoom:1.17}});
json('hide.json',{action:'set',layer:'east',visible:false});
json('pick.json',{domain:'instances',query:{layer:'east'}});
json('move.json',{action:'move',layer:'yard'});
json('insertion.json',{action:'insertion',layer:'yard'});
json('inspect.json',{action:'inspect'});
json('stamp.json',{id:'service',prefab:'bay',at:[-5,5],angle:-6});

const commands = [];
function run(args,receipt) {
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  if (receipt) write(receipt,output);
  return output;
}

const layer = ['mesh-topology','scene-layer'];
const hide = JSON.parse(run([...layer,'source.json','hide.json','--view','view.json','--preview','wing-review',
  '--out','hidden.json'],'hide-receipt.json'));
assert(hide.canCommit && hide.preview.instances.find(row=>row.instance==='east').afterPixels===0);
assert(hide.preview.instances.find(row=>row.instance==='upper').beforePixels>0);
const selected = JSON.parse(run(['tileset','select','pick.json','--scene','hidden.json','--out','selection.json'],
  'selection-receipt.json'));
assert.deepEqual(selected.instances.map(row=>row.instance),['east','upper']);
const moved = JSON.parse(run([...layer,'hidden.json','move.json','--selection','selection.json',
  '--out','reorganized.json'],'move-receipt.json'));
assert.deepEqual(moved.moved,['east','upper']);
assert.deepEqual(read('source.json').instances,read('reorganized.json').instances);
run([...layer,'reorganized.json','insertion.json','--out','targeted.json'],'insertion-receipt.json');
const stamped = JSON.parse(run(['tileset','stamp-prefab','stamp.json','--scene','targeted.json','--out','stamped.json'],
  'stamp-receipt.json'));
assert(stamped.canCommit);
assert.equal(read('stamped.json').sceneLayers.members.service,'yard');
run([...layer,'stamped.json','inspect.json','--view','view.json','--preview','yard-review'],'yard-receipt.json');

const width=710,height=231, drawing=K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['01  OPEN STATION','wing-review/before.png','East includes its nested bay.'],
  ['02  HIDE EAST WING','wing-review/after.png','Both modules leave the render.'],
  ['03  MOVE TO THE YARD','yard-review/after.png','Both return. New stamps go here.']
];
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192c34'},
  label('INK STUDIO / SCENE LAYERS',16,13,1,'#abc9b4'),
  label('Reorganize a station wing',16,30,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*229;
    return [label(title,x,63,1,'#b6e1cf'),label(note,x,213,1,'#abc9b4')];
  })
]});
for (const [i,[,name]] of panels.entries()) {
  const {w,h,data} = PNG.raster(file(name)), x=16+i*229;
  for (let y=0; y<h; y++) board.data.set(data.subarray(y*w*4,(y+1)*w*4),((74+y)*width+x)*4);
}
write('Nested-scene-layers.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Reorganize a station wing','',
  'Open Nested-scene-layers.png for the three native-grid captures.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',
  'Hide the east branch, select both hidden prefabs, and move them into the yard.',
  'The east bay and its nested upper bay retain their original transforms.',
  'Set the insertion layer to yard and stamp a new service bay into it.',''
].join('\n'));
