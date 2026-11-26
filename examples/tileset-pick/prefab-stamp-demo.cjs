'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-stamp-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,panel} = fixture();
const {prefabLibrary,instances,...base} = scene;
json('source.json',{...base,id:'linked-station-run',topologyMeshes:{panel},
  camera:{target:[.10,.28,0],dist:9,yaw:-.17,pitch:.06,projection:'orthographic',sway:0}});
json('promote.json',{prefab:'painted-bay',instance:'source',faces:{panel:['sign','grille']},
  origin:{kind:'point',id:'threshold',at:[-.75,0,0]}});
const flat = {origin:[-3.3,-.78,0],right:[1,0,0],up:[0,1,0],grid:[.5,.5]};
const a=.24, b=.26;
const tilted = {origin:[-3.3,-1.02,0],right:[Math.cos(a)*Math.cos(b),Math.sin(a)*Math.cos(b),-Math.sin(b)],
  up:[-Math.sin(a),Math.cos(a),0],grid:[.5,.5]};
const {KIT:K} = ink.load();
const pick = K.V.mad(K.V.mad(K.V.mad(tilted.origin,tilted.right,.33),tilted.up,-.175),
  K.V.cross(tilted.right,tilted.up),2);
for (const [name,plane] of [['flat',flat],['tilted',tilted]]) {
  json(name+'-plane.json',[{op:'remove',path:'/instances/source'},
    {op:'set',path:'/constructionPlane',value:plane}]);
}
const requests = [
  ['floor','FLOOR ROUNDING','flat',{at:[.66,-.35],rounding:'floor'}],
  ['ceiling','CEILING ROUNDING','flat',{at:[.66,-.35],rounding:'ceiling'}],
  ['ramp','TILTED PLANE','tilted',{point:pick,angle:-6,normalOffset:.05,rounding:'nearest'}]
];
const shell = [];
function run(args, report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  shell.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['tileset','promote-prefab','promote.json','--scene','source.json','--out','promoted.json'],'promotion.json');
for (const name of ['flat','tilted'])
  run(['scene','apply','promoted.json',name+'-plane.json','--out',name+'.json']);
const panels = requests.map(([name,title,reference,options]) => {
  json(name+'-stamp.json',{prefab:'painted-bay',id:'bay',count:4,step:[3.65,.32],...options});
  const args = ['tileset','stamp-prefab',name+'-stamp.json','--scene',reference+'.json'];
  const preview = JSON.parse(run(args,name+'-preview.json'));
  const report = JSON.parse(run([...args,'--out',name+'-scene.json'],name+'-receipt.json'));
  assert.deepEqual(report,preview);
  assert(report.canCommit);
  const png = name+'-1x.png';
  run(['render',name+'-scene.json','--raw','--w','256','--h','114','--px','1','--zoom','1.6','--out',png]);
  return {title,png,cells:report.placements.map(row => row.gridAt.join(',')).join('   ')};
});

const w=816,h=254, drawing = K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Stamp a station run',16,34,3,'#efe6ce'),
  ...panels.flatMap(({title,cells},i) => {
    const x = 16+i*264;
    return [label(title,x,88,1,'#b6e1cf'),label(cells,x,224,1,'#b6e1cf')];
  }),
  label('Resolved U,V grid cells',16,240,1,'#abc9b4')
]});
for (const [i,{png}] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file(png));
  const x = 16+i*264;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Linked-prefab-stamping.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+shell.join('\n')+'\n');
write('README.md',[
  '# Stamp a station run','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'Promote the painted bay once, then stamp it in three scenes.',
  'Floor and ceiling modes share a plane, start address and spacing.',
  'The ramp projects a world point onto a tilted working plane before stamping.',
  'Each scene links its four instances to the same saved prefab definition.',
  'Each receipt lists the requested positions, rounded cells and saved transforms.', ''
].join('\n'));
