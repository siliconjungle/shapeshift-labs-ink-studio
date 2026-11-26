'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'), path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js'), R=require('../../cli/render.js'), {gif}=require('../../cli/critic.js');
const {drawing2d}=ink.load().KIT.procedural;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#ecdec1')=>({type:'text',text,at:[x,y],scale,color});
const art=(width,height,commands)=>drawing2d.render({width,height,edges:'hard',commands});
const png=image=>PNG.encode(image.width,image.height,image.data,4);

const brick=art(32,18,[
  rect(0,0,32,18,'#564743'),
  ...[[0,0,12,8,'#a96651'],[13,0,6,8,'#bb7f59'],[20,0,12,8,'#927062'],
    [0,9,5,8,'#a37558'],[6,9,13,8,'#97624c'],[20,9,12,8,'#aa6d4f']]
    .flatMap(([x,y,w,h,color])=>[rect(x,y,w,h,color),rect(x,y,w,1,'#cc9667'),rect(x,y+h-1,w,1,'#7e5745')])
]);
const room=art(52,33,[
  rect(0,0,52,33,'#463739'),rect(1,2,50,29,'#81583e'),rect(3,3,46,25,'#a8784c'),
  rect(5,5,42,20,'#c2955b'),rect(7,7,38,15,'#e0b77a'),rect(7,21,38,1,'#5d4b42'),
  rect(10,10,30,10,'#624d40'),label('TIDE',13,11,1,'#f3d49d'),
  rect(1,28,50,2,'#392d32'),...Array.from({length:5},(_,i)=>rect(6+i*8,24,4,2,'#755139'))
]);
const bars=art(50,30,[
  rect(0,0,50,2,'#294750'),rect(0,28,50,2,'#25424a'),rect(0,3,50,1,'#8b9e88'),
  rect(0,0,3,30,'#29464c'),rect(47,0,3,30,'#29464c'),
  ...[12,25,37].flatMap(x=>[rect(x,2,2,26,'#31515a'),rect(x,4,1,23,'#749184')]),
  rect(3,21,44,1,'#3a5c62'),rect(3,22,44,1,'#263d44')
]);
const glass=art(27,17,[
  rect(0,0,27,17,'#448ea2'),rect(1,1,25,15,'#4d9ca6'),rect(3,2,17,1,'#95c7bc'),
  rect(2,14,24,1,'#437c94'),rect(3,2,1,8,'#80adac')
]);
for (let i=3;i<glass.data.length;i+=4) glass.data[i]=glass.data[i-3]>110 ? 132 : 93;
const wash=art(23,13,[
  rect(1,1,20,11,'#94c2b7'),rect(0,3,22,6,'#9acdbb'),rect(2,2,19,1,'#d8e2b9'),
  rect(3,10,18,1,'#72a49b'),rect(4,6,15,1,'#a7ceb9')
]);
for (let i=3;i<wash.data.length;i+=4) if (wash.data[i]) wash.data[i]=154;
const iron=art(8,8,[rect(0,0,8,8,'#293d46'),rect(0,0,8,1,'#9e9d79'),rect(0,1,8,1,'#647264'),rect(0,6,8,1,'#3d5460')]);
const entries=[['brick',brick,'opaque'],['room',room,'opaque'],['bars',bars,'mask'],['glass',glass,'blend'],['wash',wash,'blend'],['iron',iron,'opaque']];
const tilesets=Object.fromEntries(entries.map(([id,image,alphaMode])=>[id,{...ink.readTilesetImage(png(image)),
  material:{alphaMode,lighting:'unlit'}}]));
const scene={id:'tide-station',style:'slate',solids:[],camera:{target:[0,0,0],dist:7.4,yaw:0,pitch:.015,projection:'orthographic',sway:0},tilesets};
const editor=ink.createSceneEditor(scene);
function stamp(object,face,tile,origin,worldSize) {
  const {width,height}=tilesets[tile];
  editor.placeTilesetFace({object,face,origin,worldSize,selection:ink.pickTilesetRectangle(scene,tile,{x:0,y:0,width,height})});
}
stamp('wall','facade','brick',[-2.9,-1.45,-.60],[5.8,2.9]);
editor.applyTilesetWrap({object:'wall',face:'facade',wrap:{u:'repeat',v:'repeat',repeats:[4,2]}});
stamp('window','interior','room',[-2.02,-1.07,-.38],[4.04,2.14]);
stamp('window','pane','glass',[-1.97,-1.04,.08],[3.94,2.08]);
stamp('window','wash','wash',[.06,-.55,.23],[1.54,1.10]);
stamp('window','screen','bars',[-2,-1.06,.36],[4,2.12]);
stamp('trim','top','iron',[-2.92,1.43,.0],[5.84,.19]);
stamp('trim','sill','iron',[-2.21,-1.17,.48],[4.42,.16]);
const patch=art(16,10,[rect(0,1,16,8,'#333b41'),rect(1,2,14,6,'#8e815d'),rect(1,2,14,1,'#c4af78'),rect(4,5,8,1,'#4b4b47')]);
editor.addSurfaceDecal({id:'inspection-tab',kind:'paint',anchor:{object:'wall',face:'facade',at:[2.49,.81,-.60],
  normal:[0,0,1],size:[.52,.31],bias:.006},image:{width:patch.width,height:patch.height,pixels:Array.from(patch.data)}});
const targets=[
  ['brick','wall','tileset/brick','opaque'],['room','window','tileset/room','opaque'],['screen','window','tileset/bars','mask'],
  ['glass','window','tileset/glass','blend'],['wash','window','tileset/wash','blend'],['tab','wall','decal:inspection-tab','mask']
].map(([id,object,material,mode])=>({id,object,material,mode}));
const views=Array.from({length:13},(_,i)=>({id:'view-'+String(i+1).padStart(2,'0'),t:i/12,
  camera:{yaw:-.42+.84*i/12,pitch:.025},zoom:1.08+.10*Math.sin(Math.PI*i/12)}));
const spec={w:188,h:108,views,targets,
  pairs:[{id:'screen-room',front:'screen',back:'room'},{id:'glass-room',front:'glass',back:'room'},
    {id:'wash-glass',front:'wash',back:'glass'}],
  checks:[{target:'screen',metric:'clearPixels',min:50},{target:'glass',metric:'fractionalPixels',min:50},
    {pair:'screen-room',metric:'openPixels',min:50},{pair:'glass-room',metric:'transmittedPixels',min:50},
    {pair:'wash-glass',metric:'transmittedPixels',min:10},{pair:'wash-glass',metric:'reversedPixels',max:0}]};
const directory=path.resolve(process.argv[2]??'tileset-coverage-demo'), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(directory,name), write=(name,data)=>fs.writeFileSync(file(name),data);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(directory,{recursive:true});
json('station.json',editor.snapshot());
json('coverage.json',spec);
const args=['tileset','coverage-review','coverage.json','--scene','station.json','--out','review'];
const report=JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'}));
assert(report.passed && report.frames.length===13);
write('COMMANDS.sh','#!/bin/sh\nset -eu\nink-studio '+args.join(' ')+'\n');
write('README.md','# Mixed coverage at the tide station\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Inspect `review/report.json` for the camera samples and authored checks. Each view includes a picture, a color attribution map and grayscale mattes.\n');

const w=650,h=358,xs=[20,231,442];
const sheet=art(w,h,[rect(0,0,w,h,'#192a33'),label('INK STUDIO / COVERAGE REVIEW',20,16,2,'#a3c3af'),
  label('Tide station window',20,42,3),label('VISIBLE MATERIAL CONTRIBUTIONS',20,218,1,'#a3c3af'),
  ...['LEFT','CENTER','RIGHT'].map((title,i)=>label(title,xs[i],86,2)),
  rect(21,345,8,8,'#e4a14f'),label('OPAQUE',34,345,1),
  rect(137,345,8,8,'#62e095'),label('CUTOUT',150,345,1),
  rect(260,345,8,8,'#5aadf8'),label('BLENDED',273,345,1)]);
function image(relative){
  const {w,h,data}=PNG.raster(file('review/'+relative));
  return {w,h,rgb:Uint8Array.from(data.filter((_,i)=>i%4!==3))};
}
function place(buffer,within,x,y){
  for(let j=0;j<within.h;j++)for(let i=0;i<within.w;i++){
    const at=(j*within.w+i)*3;
    buffer.data.set([within.rgb[at],within.rgb[at+1],within.rgb[at+2],255],4*((y+j)*buffer.width+x+i));
  }
}
for(const [column,frame] of [report.frames[0],report.frames[6],report.frames.at(-1)].entries()){
  place(sheet,image(frame.files.picture),xs[column],106);
  place(sheet,image(frame.files.coverage),xs[column],228);
}
write('Tileset-coverage.png',png(sheet));
const frames=report.frames.map(frame=>R.grid([image(frame.files.picture),image(frame.files.coverage)],2));
write('Camera-sweep.gif',gif(frames.concat(frames.slice(1,-1).reverse()),10));
