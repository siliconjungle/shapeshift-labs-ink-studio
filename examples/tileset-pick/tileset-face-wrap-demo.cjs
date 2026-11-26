'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {drawing2d} = ink.load().KIT.procedural;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eedfc7')=>({type:'text',text,at:[x,y],scale,color});
const draw=(width,height,commands)=>drawing2d.render({width,height,edges:'hard',commands});
const atlas=draw(42,20,[
  rect(0,0,42,20,'#e940a6'),
  rect(1,1,24,18,'#38363c'),rect(1,1,24,2,'#e1aa71'),rect(1,3,24,1,'#98704f'),
  rect(1,16,24,2,'#966149'),rect(1,18,24,1,'#694b43'),
  ...[[1,5,8,4,'#9a594c'],[10,5,6,4,'#a97552'],[17,5,8,4,'#725047'],
    [1,10,5,5,'#744d49'],[7,10,9,5,'#ad6a4e'],[17,10,8,5,'#9b674d']]
    .map(([x,y,w,h,color])=>rect(x,y,w,h,color)),
  rect(2,5,3,10,'#b98465'),rect(3,6,2,1,'#e1aa71'),rect(9,12,3,1,'#d89560'),rect(22,11,1,3,'#654744'),
  rect(29,1,12,18,'#2e3c42'),rect(30,2,10,16,'#526667'),rect(31,3,8,1,'#adc2b4'),
  rect(31,5,2,11,'#6e817b'),rect(37,6,1,10,'#6f8b80'),rect(32,16,6,1,'#323f45')
]);
const source={id:'kiln-wall',style:'slate',solids:[],camera:{target:[0,0,0],yaw:0,pitch:0,dist:9,projection:'orthographic',sway:0},
  tilesets:{brick:ink.readTilesetImage(PNG.encode(atlas.width,atlas.height,atlas.data,4))}};
const editor=ink.createSceneEditor(source);
const crop=ink.pickTilesetRectangle(source,'brick',{x:1,y:1,width:24,height:18});
const end=ink.pickTilesetRectangle(source,'brick',{x:29,y:1,width:12,height:18});
for (const [face,selection,x,y,width,height] of [
  ['straight-run',crop,-3.34,-.68,6.68,1.36],['west-pier',end,-3.99,-.68,.65,1.71],['east-pier',end,3.34,-.68,.65,1.71]
]) editor.placeTilesetFace({object:'wall',face,selection,origin:[x,y,0],worldSize:[width,height]});
const row=editor.meshTopology('wall');
const tapered=row.document.vertices.filter(({position:[x,y]})=>Math.abs(x)>3.8 && y>.9)
  .map(vertex=>({...vertex,position:[vertex.position[0]-Math.sign(vertex.position[0])*.19,vertex.position[1],0]}));
assert.equal(tapered.length,2);
editor.editMeshTopology('wall',{vertices:tapered});

const out=path.resolve(process.argv[2] ?? 'tileset-wrap-demo'), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const write=(name,data)=>fs.writeFileSync(path.join(out,name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const commands=[];
fs.mkdirSync(out,{recursive:true});
json('wall.json',editor.snapshot());
function run(args,receipt) {
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  if (receipt) {
    write(receipt,output);
    return JSON.parse(output);
  }
}
const modes=['clamp','repeat','mirror'];
for (const mode of modes) {
  json(mode+'-request.json',{object:'wall',face:'straight-run',wrap:{u:mode,v:'clamp',repeats:[6,1]}});
  const args=['tileset','wrap',mode+'-request.json','--scene','wall.json'];
  const review=run(args,mode+'-review.json');
  assert(review.canCommit && review.faceTriangles===2 && review.meshFaces===3 && review.meshTriangles===6);
  run([...args,'--expect',mode+'-review.json','--out',mode+'.json'],mode+'-commit.json');
  run(['render',mode+'.json','--w','178','--h','72','--px','1','--zoom','1.55','--raw','--out',mode+'.png']);
}
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Crop wrapping on a wall\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'The center span uses two triangles in all three renders. The tapered piers stay separately editable.\n');
const w=774,h=235, xs=[20,270,520];
const sheet=draw(w,h,[rect(0,0,w,h,'#192a33'),text('INK STUDIO / TILESET WRAP',20,14,2,'#9bc0b3'),
  text('Six tile periods on one face',20,40,3),
  ...['CLAMP','REPEAT','MIRRORED REPEAT'].map((label,i)=>text(label,xs[i],82,2)),
  text('TWO TRIANGLES IN EACH STRAIGHT SPAN',20,214,1,'#9bc0b3')]);
for (const [i,mode] of modes.entries()) {
  const frame=PNG.raster(path.join(out,mode+'.png'));
  assert.deepEqual([frame.w,frame.h],[178,72]);
  for (let y=0;y<103;y++) for (let x=0;x<234;x++) {
    const at=4*(Math.floor(y*frame.h/103)*frame.w+Math.floor(x*frame.w/234));
    sheet.data.set(frame.data.subarray(at,at+4),4*((109+y)*w+xs[i]+x));
  }
}
write('Tileset-wrap.png',PNG.encode(w,h,sheet.data,4));
