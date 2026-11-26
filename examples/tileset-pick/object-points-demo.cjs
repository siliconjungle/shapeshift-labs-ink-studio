'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'station-points');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const read = name => fs.readFileSync(file(name));
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library} = fixture(), kit = ink.load(), {KIT:K,CameraLens} = kit;
const {prefabLibrary,...base} = scene, support = scene.topologyMeshes.pillar;
const corners = [[.17,-.06,.06],[.32,-.06,.06],[.32,.53,.06],[.17,.53,.06]];
const locator = {...support,document:{...support.document,vertices:support.document.vertices.map((row,i)=>
  ({...row,position:corners[i]}))}};
const source = {...base,id:'station-dock',prefabs:library,topologyMeshes:{support:locator},
  instances:{west:{prefab:'bay',transform:{translation:[-1.28,.02,0]}}},
  camera:{...scene.camera,target:[.02,.88,0]}};
const target = {kind:'object-point',instance:'west',id:'dock'};
json('source.json',source);
json('points.json',{instance:'west',points:{
  dock:{position:[1.60,.51,.06],direction:[1,0,0]},foot:{position:[-.75,0,0]}
}});
json('pivot.json',{target});
json('stamp.json',{prefab:'bay',id:'upper',anchor:'foot',target,orientation:'world',angle:8});
json('inspect.json',{instance:'upper'});

const commands = [];
function run(args,receipt) {
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  if (receipt) write(receipt,output);
  return output;
}

const imageSize = [226,124], zoom = 1.21;
function render(scene,image) {
  run(['render',scene,'--raw','--w',String(imageSize[0]),'--h',String(imageSize[1]),'--px','1',
    '--zoom',String(zoom),'--out',image]);
}
run(['tileset','object-points','points.json','--scene','source.json','--out','named.json'],'points-receipt.json');
const pivot = JSON.parse(run(['mesh-topology','pivot','named.json','pivot.json','--object','support',
  '--out','pivoted.json'],'pivot-receipt.json'));
const plane = JSON.parse(run(['mesh-topology','plane','pivoted.json','--snap-origin','object-point',
  '--instance','west','--point-id','dock','--out','aligned.json'],'plane-receipt.json'));
const stamped = JSON.parse(run(['tileset','stamp-prefab','stamp.json','--scene','aligned.json',
  '--out','stamped.json'],'stamp-receipt.json'));
const inspected = JSON.parse(run(['tileset','object-points','inspect.json','--scene','stamped.json'],'inspect-receipt.json'));
const xyz = plane.after.origin;
assert.deepEqual(xyz,pivot.after.world);
assert.deepEqual(xyz,stamped.placements[0].anchorAt);
assert(K.V.dist(xyz,inspected.after.find(row=>row.id==='foot').world.position)<1e-10);
render('aligned.json','dock.png');
render('stamped.json','connected.png');

const [w,h] = imageSize, world = ink.createSceneEditor(source).build(),
  camera = CameraLens.frame(world,{zoom},w,h),
  projector = CameraLens.rasterProjector({view:camera.view,focal:h/(2*camera.tangent*camera.dist),
    ortho:true,width:w,height:h});
const [px,py] = projector.project(projector.viewPoint(xyz)).map(Math.round);
const drawing = K.procedural.drawing2d, width=504,height=218;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['01  NAME THE DOCK','dock.png','The pivot and plane share this point.'],
  ['02  STAMP BY THE FOOT','connected.png','The foot lands at that exact XYZ.']
];
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192c34'},
  label('INK STUDIO / OBJECT POINTS',16,13,1,'#abc9b4'),
  label('One point, three uses',16,30,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*245;
    return [label(title,x,63,1,'#b6e1cf'),label(note,x,202,1,'#abc9b4')];
  })
]});
for (const [i,[,name]] of panels.entries()) {
  const {data} = PNG.raster(file(name)), x=16+i*245;
  for (let y=0; y<h; y++) board.data.set(data.subarray(y*w*4,(y+1)*w*4),((74+y)*width+x)*4);
  const marker = [251,210,107,255];
  for (const [dx,dy] of [[0,0],[-5,0],[-4,0],[4,0],[5,0],[0,-5],[0,-4],[0,4],[0,5]])
    board.data.set(marker,((74+py+dy)*width+x+px+dx)*4);
}
write('Named-object-points.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# One point, three uses','',
  'Open Named-object-points.png to compare the two native-grid captures. The gold cross marks the resolved dock.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH to replay the edits and both native renders.',
  'The dock position is shared by the mesh pivot, construction-plane origin, and upper bay foot.',
  'The point receipt records its local location and world location. The stamp receipt verifies the same coordinate.',
  ''
].join('\n'));
