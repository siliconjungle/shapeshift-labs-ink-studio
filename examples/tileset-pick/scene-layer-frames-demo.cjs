'use strict';

const assert = require('node:assert/strict'), {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'station-frames');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), file = name => path.join(dir,name);
const read = name => fs.readFileSync(file(name));
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library,view} = fixture(), kit = ink.load(), {KIT:K,CameraLens} = kit;
const {prefabLibrary,...base} = scene, grid = {w:220,h:135};
const camera = {...view.camera,target:[0,1.04,0],zoom:1.11};
const source = {...base,id:'station-survey',prefabs:library,topologyMeshes:{},
  constructionPlane:{origin:[-.6,.22,0],grid:[.25,.25]},
  instances:{west:{prefab:'bay',transform:{translation:[-1.33,.04,0]}},
    east:{prefab:'bay',transform:{translation:[1.26,.11,0],rotation:[.15,-.04,.07]}},
    upper:{prefab:'bay',parent:'east',transform:{translation:[.12,1.05,.12],scale:.61}}},
  sceneLayers:{layers:{station:{},floor:{parent:'station'},overlook:{parent:'station'}},
    members:{west:'floor',east:'floor',upper:'overlook'}}};
json('source.json',source);
json('view.json',{...view,...grid,camera});
json('inspect.json',{action:'inspect',layer:'station'});
json('center.json',{action:'center',layer:'station'});
json('origins.json',{action:'set-origins',layer:'station',target:{kind:'module-center'}});

const commands = [];
function run(args,receipt) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  write(receipt,result);
  return JSON.parse(result);
}

const layer = ['mesh-topology','scene-layer'];
const inspected = run([...layer,'source.json','inspect.json'],'inspect-receipt.json');
const centered = run([...layer,'source.json','center.json','--out','centered.json'],'center-receipt.json');
const updated = run([...layer,'centered.json','origins.json','--view','view.json','--preview','origin-review',
  '--out','updated.json'],'origins-receipt.json');
const result = JSON.parse(read('updated.json'));
assert(centered.canCommit && updated.canCommit && updated.origins.length===3);
assert.deepEqual(result.constructionPlane.origin,inspected.measurement.center);
assert(updated.preview.instances.every(row=>row.beforePixels>0 && row.changedPixels===0));
assert.deepEqual(read('origin-review/before.png'),read('origin-review/after.png'));
for (const [id,row] of Object.entries(result.instances)) assert.deepEqual(row.transform,source.instances[id].transform);

const world = ink.createSceneEditor(source).build(), {w,h} = grid;
const frame = CameraLens.frame(world,{camera},w,h), focal = h/(2*frame.tangent*frame.dist);
const projector = CameraLens.rasterProjector({view:frame.view,focal,ortho:frame.ortho,width:w,height:h});
const xy = point => projector.project(projector.viewPoint(point)).map(Math.round);
const width=710,height=235, drawing=K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['01  INSPECT THE LAYER','origin-review/before.png','Gold marks the original origins.'],
  ['02  CENTER THE FRAME','origin-review/before.png','The outline is the rest envelope.'],
  ['03  SET MODULE ORIGINS','origin-review/after.png','Origins move. Geometry stays put.']
];
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192c34'},
  label('INK STUDIO / SCENE LAYERS',16,13,1,'#abc9b4'),
  label('Survey and set origins',16,30,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*229;
    return [label(title,x,63,1,'#b6e1cf'),label(note,x,218,1,'#abc9b4')];
  })
]});
const pixel = (panel,x,y,color) => {
  if (x>=0 && x<w && y>=0 && y<h) board.data.set(color,((74+y)*width+16+panel*229+x)*4);
};
const gold=[255,200,91,255], mint=[155,237,195,255];
function mark(panel,point,color) {
  const [x,y] = xy(point);
  for (const [i,j] of [[0,0],[-4,0],[-3,0],[3,0],[4,0],[0,-4],[0,-3],[0,3],[0,4]])
    pixel(panel,x+i,y+j,color);
}
for (const [i,[,name]] of panels.entries()) {
  const {data} = PNG.raster(file(name)), x=16+i*229;
  for (let y=0; y<h; y++) board.data.set(data.subarray(y*w*4,(y+1)*w*4),((74+y)*width+x)*4);
}
for (const {before,after} of updated.origins) {
  mark(0,before,gold);
  mark(2,after,mint);
}
const {min,max} = inspected.measurement.bounds, mid = inspected.measurement.center;
const [left,bottom] = xy([min[0],min[1],mid[2]]), [right,top] = xy([max[0],max[1],mid[2]]);
for (let x=left; x<=right; x+=2) for (const y of [top,bottom]) pixel(1,x,y,mint);
for (let y=top; y<=bottom; y+=2) for (const x of [left,right]) pixel(1,x,y,mint);
mark(1,centered.frame.target,gold);
write('Layer-bounds-and-origins.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Survey and set origins','',
  'Open Layer-bounds-and-origins.png to see the origins, measured envelope, and centered frame.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',
  'The station contains three bays in two nested layers, including a bay parented to another prefab.',
  'Inspect the branch, center the construction frame, and assign each module its own bounds center.',
  'The matched native before and after captures compare byte for byte. The receipt records each origin edit.',''
].join('\n'));
