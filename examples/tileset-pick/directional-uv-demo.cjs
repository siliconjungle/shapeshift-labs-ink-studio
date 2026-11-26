'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const K = ink.load().KIT, drawing = K.procedural.drawing2d;
const dirs = K.authoring.directionalUV.compass, tile = 24;
const dir = path.resolve(process.argv[2] ?? 'directional-uv');
const file = name => path.join(dir,name);
const json = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
fs.mkdirSync(dir,{recursive:true});
function run(args,receipt) {
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (receipt) fs.writeFileSync(file(receipt),output);
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
}

const palette = { dark:'#182630',steel:'#31404a',rim:'#718b87',pale:'#c7c8a3',paper:'#f3e6b2',
  rust:'#9d543c',copper:'#d99057',sea:'#255b58',mint:'#a4ebbc',ochre:'#935a35',gold:'#f0c778' };
const byColor = new Map(Object.entries(palette).map(([id,hex])=>[parseInt(hex.slice(1),16),id]));
const rect = (x,y,w,h,color) => ({type:'rect',rect:[x,y,w,h],fill:palette[color]});
const label = (text,x,y,color) => ({type:'text',text,at:[x,y],scale:1,color:palette[color]});
function paint(index,pose) {
  const side = index===0 || index===4 ? 0 : index<4 ? 1 : -1, back = index>=3 && index<=5;
  const x = side===-1 ? 6 : 4, width = side ? 13 : 16;
  const panel = back ? 'rust' : 'sea', lamp = back ? (pose ? 'gold' : 'ochre') : (pose ? 'mint' : 'rim');
  const art = drawing.render({width:tile,height:tile,edges:'hard',commands:[
    rect(x+2,20,width-3,2,'dark'),rect(x+4,18,3,3,'steel'),rect(x+width-6,18,3,3,'rust'),
    rect(x+2,4,width-3,15,'dark'),rect(x,6,width,12,'dark'),
    ...(side ? [rect(side>0 ? x+width-2 : x-2,7,4,9,'rust'),
      rect(side>0 ? x+width-1 : x-1,7,2,2,'copper')] : []),
    rect(x+1,6,width-2,12,'steel'),rect(x+2,6,width-4,1,'pale'),
    rect(x+2,8,width-4,8,panel),rect(x+3,9,width-6,1,back ? 'copper' : 'rim'),
    rect(x+2,16,width-4,1,'dark'),
    rect(x+Math.floor(width/2)-1,2,3,3,'dark'),rect(x+Math.floor(width/2),2,2,2,lamp),
    label(dirs[index].toUpperCase(),x+3,10,'paper'),
    rect(x+width-4,15,1,1,lamp)
  ]});
  const marks = [];
  for (let i=0;i<tile*tile;i++) if (art.data[i*4+3]) {
    const color = art.data[i*4]*65536+art.data[i*4+1]*256+art.data[i*4+2];
    const swatch = byColor.get(color);
    assert.ok(swatch);
    marks.push({swatch,at:[i%tile,Math.floor(i/tile)]});
  }
  return marks;
}

const frames = [], views = [];
for (const pose of [0,1]) dirs.forEach((direction,index)=>{
  const id = direction+'-'+pose;
  frames.push({id,durationMs:pose ? 160 : 100,cels:{art:{marks:paint(index,pose)}}});
  views.push({frame:id,pose,yaw:index*Math.PI/4,pitch:0,pivot:[tile/2,21],unitsPerPixel:1/16,handoff:'exact'});
});
json('art.json',{format:'ink-studio/pixel-art',version:2,width:tile,height:tile,pixelAspect:[1,1],
  palette,layers:[{id:'art'}],frames,directional:{version:1,views,approvedSwatches:Object.keys(palette)}});
json('bindings.json',{tileset:'signal-views',faces:['indicator'],directions:dirs,default:'n'});
json('camera.json',{w:128,h:100,camera:{yaw:Math.PI/2,pitch:.14,dist:4.8,ortho:true,target:[0,.7,0]}});
run(['pixel-art','directions','export','art.json','--out','atlas.json'],'atlas-receipt.json');
run(['pixel-art','directions','uv-clips','atlas.json','--settings','bindings.json','--out','uv-clips.json']);
const rule = read('uv-clips.json'), image = ink.readTilesetImage(file(read('atlas.json').files.color));
const source = {id:'beacon-directions',style:'slate',solids:[],
  camera:{yaw:0,pitch:.14,dist:3.7,target:[0,.7,0],projection:'orthographic',sway:0},tilesets:{
  'signal-views':{...image,material:{lighting:'unlit',alphaMode:'mask'}}
}};
const editor = ink.createSceneEditor(source);
editor.placeTilesetFace({object:'signal',face:'indicator',origin:[-.72,0,0],worldSize:[1.44,1.44],
  selection:ink.pickTilesetRectangle(source,'signal-views',rule.clips[rule.directions.n].frames[0].rect)});
json('station.json',{...editor.snapshot(),topologyMeshes:{},prefabs:{beacon:{revision:1,solids:{},
  topologyMeshes:{signal:editor.meshTopology('signal')}}},instances:{station:{prefab:'beacon',billboard:{mode:'full'}}}});
const editExpression = "const f=require('node:fs'),u=JSON.parse(f.readFileSync('uv-clips.json'));f.writeFileSync('edit.json',JSON.stringify({instance:'station',revision:1,edits:[{member:'signal',directionalUV:u}]},null,2)+'\\n')";
execFileSync(process.execPath,['-e',editExpression],{cwd:dir});
commands.push("node -e "+JSON.stringify(editExpression));
run(['mesh-topology','edit-prefab','station.json','edit.json','--view','camera.json','--preview','review','--out','placed.json'],
  'prefab-receipt.json');

function capture(direction,index,time,suffix='') {
  const name = direction+suffix;
  run(['render','placed.json','--yaw',String(index*Math.PI/4),'--pitch','.14','--dist','4.8',
    '--target','0,.7,0','--ortho','--w','128','--h','100','--px','1','--raw','--t',String(time),
    '--directional-uv-report',name+'.json','--out',name+'.png']);
  const [choice] = read(name+'.json').choices;
  assert.equal(choice.direction,direction);
  assert.equal(choice.frame,time<.1 ? 0 : 1);
  assert.equal(choice.faces[0],'indicator');
}
dirs.forEach((direction,index)=>capture(direction,index,.17));
capture('n',0,.05,'-early');

const width = 544, height = 264, tint = '#9fbcb4';
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192b32'},
  {type:'text',text:'BEACON / DIRECTIONAL UV CLIPS',at:[12,9],scale:1,color:tint},
  ...dirs.map((name,index)=>({type:'text',text:name.toUpperCase(),at:[12+132*(index%4),131+116*Math.floor(index/4)],scale:1,color:tint}))
]});
dirs.forEach((name,index)=>{
  const {w,h,rgb} = PNG.read(file(name+'.png')), ox = 10+132*(index%4), oy = 26+116*Math.floor(index/4);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p = (y*w+x)*3, q = ((oy+y)*width+ox+x)*4;
    board.data.set([rgb[p],rgb[p+1],rgb[p+2],255],q);
  }
});
fs.writeFileSync(file('Eight-views.png'),PNG.encode(width,height,board.data,4));
fs.writeFileSync(file('COMMANDS.sh'),'#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
fs.writeFileSync(file('README.md'),[
  '# Beacon views','',
  'Eight-views.png collects the eight headless renders at 0.17 seconds.',
  'Compare n.png with n-early.png to see the two exposures of the same UV clip.',
  'The direction receipts record the selected clip and exact source rectangle.',
  'Run sh COMMANDS.sh in a fresh copy with Ink Studio and Node on your PATH.',''
].join('\n'));
