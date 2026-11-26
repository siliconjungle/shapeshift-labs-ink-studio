'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-array-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const {scene,library} = fixture(), {KIT:K} = ink.load();
const {prefabLibrary,instances,...base} = scene;
json('source.json',{...base,id:'painted-bay-array',prefabs:{...library,bay:{...library.bay,solids:{}}},topologyMeshes:{},
  instances:{seed:{prefab:'bay',transform:{translation:[-2.4,-.6,-1.35]}}},
  camera:{target:[.05,.55,.15],yaw:-.49,pitch:.31,dist:6.0,projection:'orthographic',sway:0}});
const array = {id:'rack',instance:'seed',count:[2,2,2],spacing:[2.15,1.50,2.75]};
json('create.json',array);
json('resize.json',{id:'rack',count:[3,1,2],spacing:[2.15,1.5,3.0]});
const selected = 'rack.1.0.1';
json('local.json',{instance:selected,faces:{panel:['sign']},edits:[{member:'panel',reskin:{face:'sign',
  selection:ink.pickTilesetRectangle(scene,'enamel',{x:48,y:0,width:24,height:24})}}]});
json('view.json',{w:226,h:120,raw:true,camera:{yaw:-.49,pitch:.31,dist:6,target:[.05,.55,.15],ortho:true,zoom:1.12}});

const commands = [];
function run(args,report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
const initial = JSON.parse(run(['mesh-topology','array-prefab','source.json','create.json','--view','view.json',
  '--preview','create-review','--out','array.json'],'create-receipt.json'));
run(['mesh-topology','isolate-prefab','array.json','local.json','--out','edited-array.json'],'local-receipt.json');
const resized = JSON.parse(run(['mesh-topology','array-prefab','edited-array.json','resize.json','--view','view.json',
  '--preview','resize-review','--out','resized.json'],'resize-receipt.json'));
assert(initial.canCommit && resized.canCommit);
assert(initial.cells.length===8 && resized.cells.length===6);
assert.equal(resized.retired.length,4);
assert.equal(resized.cells.filter(row=>row.status==='added').length,2);
const before = read('edited-array.json'), after = read('resized.json');
assert.deepEqual(after.instances[selected].meshOverrides,before.instances[selected].meshOverrides);

const w=730,h=264, drawing = K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['2 X 2 X 2 ARRAY','create-review/after.png','Eight linked placements on XYZ axes.'],
  ['LOCAL COPY EDIT','resize-review/before.png','The near bay gets its own NXT sign.'],
  ['RESIZE TO 3 X 1 X 2','resize-review/after.png','The NXT sign keeps its cell ID.']
];
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Resize a three-axis prefab array',16,34,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*236;
    return [label(title,x,89,1,'#b6e1cf'),label(note,x,238,1,'#abc9b4')];
  })
]});
for (const [i,[,png]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file(png));
  const x=16+i*236;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Prefab-instance-array.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Resize a three-axis prefab array','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'Make a 2 × 2 × 2 array from one painted bay and edit the sign on rack.1.0.1.',
  'Resize to 3 × 1 × 2 and increase the Z spacing.',
  'The upper layer retires and a new X column appears.',
  'The surviving NXT copy keeps the same ID and local edit.',
  'The receipts list each cell and the matched native previews.', ''
].join('\n'));
