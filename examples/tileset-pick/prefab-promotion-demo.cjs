'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-promotion-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const {scene,panel} = fixture();
const {prefabLibrary,instances,...base} = scene;
const editor = ink.createSceneEditor({...base,id:'painted-station-kits',
  constructionPlane:{origin:[-1.34,0,0],grid:.25},
  topologyMeshes:{'bay-panel':panel},
  camera:{target:[0,.56,0],dist:5.35,yaw:-.23,pitch:.10,projection:'orthographic',sway:0}});
const allFaces = editor.selectMeshTopology('bay-panel',{domain:'faces'});
editor.transformMeshTopology('bay-panel',{selection:allFaces,operation:{kind:'move',offset:[-.59,0,0]}});
editor.placeTilesetFace({object:'bay-panel',face:'kept-marker',origin:[-1.34,.96,0],worldSize:[.48,.38],
  selection:ink.pickTilesetRectangle(editor.snapshot(),'enamel',{x:48,y:0,width:24,height:24})});
json('station.json',editor.snapshot());
json('pick-bay.json',{domain:'tiles',object:'bay-panel',query:{ids:['sign','grille']}});
json('promote.json',{prefab:'painted-bay',instance:'west',faces:{'bay-panel':null},origin:{kind:'plane'}});
const shell = [];
function run(args, report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  shell.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['tileset','select','pick-bay.json','--scene','station.json','--topology-out','faces.json'],'selection-report.json');
const promote = ['tileset','promote-prefab','promote.json','--scene','station.json','--selection','faces.json'];
run(promote,'preview.json');
run([...promote,'--out','promoted.json'],'receipt.json');
const receipt = read('receipt.json');
assert.deepEqual(receipt,read('preview.json'));
assert(receipt.canCommit);
assert.deepEqual(receipt.sources[0].selection.ids.sort(),['grille','sign']);
assert.equal(receipt.sources[0].remaining,1);

const promoted = ink.createSceneEditor(read('promoted.json'));
promoted.setPrefabInstance('east',{prefab:'painted-bay',transform:{translation:[.43,0,0]}});
json('reused.json',promoted.snapshot());
assert.deepEqual(Object.keys(promoted.build().topologyMeshes).sort(),['bay-panel','east.bay-panel','west.bay-panel']);

const panels = [['SOURCE TILE FACES','station.json','Source-1x.png'],
  ['PROMOTED IN PLACE','promoted.json','Promoted-1x.png'],
  ['SECOND INSTANCE','reused.json','Reused-1x.png']];
for (const [,scene,name] of panels) run(['render',scene,'--raw','--w','208','--h','104','--px','1','--out',name]);
assert(fs.readFileSync(file('Source-1x.png')).equals(fs.readFileSync(file('Promoted-1x.png'))));

const w=672,h=232, drawing = ink.load().KIT.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / TILE PREFABS',16,15,1,'#abc9b4'),
  label('Paint once, place again',16,34,3,'#efe6ce'),
  ...panels.map(([title],i) => label(title,16+i*216,88,1,'#b6e1cf')),
  label('The NXT marker stays outside the prefab.',16,213,1,'#abc9b4')
]});
for (const [i,[,,name]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file(name));
  const x = 16+i*216;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((103+y)*w+x)*4);
}
write('Tile-prefab-promotion.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+shell.join('\n')+'\n');
write('README.md',[
  '# Promote painted tile faces','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'The source and promoted images should match exactly.',
  'The construction plane is at the left edge of the BAY panel.',
  'The checked-in demo generator uses `setPrefabInstance` for the east placement.',
  'The loose NXT marker remains in the scene.', ''
].join('\n'));
