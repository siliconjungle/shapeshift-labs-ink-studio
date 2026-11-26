'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-combination-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const {scene,library,request:local} = fixture(), {KIT:K} = ink.load();
const {prefabLibrary,...base} = scene;
json('source.json',{...base,id:'double-bay-assembly',prefabs:library,topologyMeshes:{},
  instances:{...base.instances,east:{prefab:'bay',transform:{
    translation:[1.19,.08,-.1],rotation:[-.13,.0,.045],scale:1.08}}},
  constructionPlane:{origin:[-1.31,1.42,0],grid:[.5,.5]},
  camera:{target:[0,1.2,0],yaw:-.09,pitch:.03,dist:5,projection:'orthographic',sway:0}});
json('local.json',local);
const decal = K.surfaceDecals.add(undefined,{id:'west-marker',kind:'lettering',
  anchor:{object:'west.panel',face:'sign',uv:{min:[.71,.14],max:[.77,.29]},bias:.004},
  image:{width:1,height:1,pixels:[246,203,118,255]}});
json('marker.json',[{op:'set',path:'/surfaceDecals',value:decal}]);
json('selection-query.json',{domain:'instances',query:{kind:'prefab',ids:['west','east']}});
json('keep.json',{prefab:'paired-bays',mode:'keep'});
json('replace.json',{prefab:'paired-bays',mode:'replace',instance:'lower-module'});
json('stamp.json',{prefab:'paired-bays',id:'upper-module',at:[0,0]});
json('view.json',{w:226,h:116,raw:true,camera:{yaw:-.09,pitch:.03,dist:5,target:[0,1.2,0],ortho:true,zoom:1.28}});

const commands = [];
function run(args,report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['mesh-topology','isolate-prefab','source.json','local.json','--out','local-scene.json'],'sign-receipt.json');
run(['scene','apply','local-scene.json','marker.json','--out','context.json']);
run(['tileset','select','selection-query.json','--scene','context.json','--out','selected.json'],'selection-receipt.json');
const command = ['mesh-topology','combine-prefab','context.json'];
const keep = JSON.parse(run([...command,'keep.json','--selection','selected.json','--out','kept.json'],'keep-receipt.json'));
const replace = JSON.parse(run([...command,'replace.json','--selection','selected.json','--view','view.json',
  '--preview','combine-review','--out','combined.json'],'combine-receipt.json'));
assert(keep.canCommit && replace.canCommit);
assert.deepEqual(read('kept.json').instances,read('context.json').instances);
assert.deepEqual(read('kept.json').prefabs['paired-bays'],read('combined.json').prefabs['paired-bays']);
assert(fs.readFileSync(file('combine-review/before.png')).equals(fs.readFileSync(file('combine-review/after.png'))));
assert.equal(replace.anchors[0].after.object,'lower-module.west.panel');
run(['tileset','stamp-prefab','stamp.json','--scene','combined.json','--out','repeated.json'],'stamp-receipt.json');
assert.equal(read('repeated.json').instances['upper-module'].prefab,'paired-bays');
run(['render','repeated.json','--raw','--w','226','--h','116','--px','1','--zoom','1','--out','repeated.png']);

const w=730,h=257, drawing = K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['TWO SOURCE PLACEMENTS','combine-review/before.png','The west bay has a custom sign.'],
  ['ONE COMBINED MODULE','combine-review/after.png','The replacement matches at 1x.'],
  ['SECOND MODULE STAMP','repeated.png','Both bays repeat as one prefab.']
];
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Combine a pair of station bays',16,34,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*236;
    return [label(title,x,89,1,'#b6e1cf'),label(note,x,235,1,'#abc9b4')];
  })
]});
for (const [i,[,png]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file(png));
  const x=16+i*236;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Prefab-combination.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Combine a pair of station bays','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'Select two painted bays, then save one reusable prefab using both keep and replace.',
  'The replacement remaps the marker and matches the original render pixel for pixel.',
  'Stamp the combined module again to repeat the complete arrangement.',
  'The receipts record original revisions, member mappings and the module origin.', ''
].join('\n'));
