'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {drawing2d} = ink.load().KIT.procedural;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const draw=(width,height,commands)=>drawing2d.render({width,height,edges:'hard',commands});

const glass=draw(32,24,[
  rect(0,2,32,20,'#335361'),rect(2,0,28,24,'#335361'),rect(2,2,28,20,'#85b4b0'),
  rect(3,3,26,18,'#397f9d'),rect(4,4,24,1,'#a7d0c7'),rect(4,19,24,1,'#1c4f6d'),
  rect(5,8,22,9,'#1e4f66'),text('BAY',8,9,1,'#c6ddc4'),rect(7,6,4,1,'#e3d1a2'),rect(21,6,4,1,'#e3d1a2'),
  rect(6,18,20,1,'#68a0a8')
]);
for (let y=3;y<21;y++) for (let x=3;x<29;x++) {
  const at=4*(y*glass.width+x);
  if (glass.data[at]===57) glass.data[at+3]=96;
}
const board=draw(32,24,[
  rect(0,0,32,24,'#20383c'), ...[4,8,13,17,24,28].map((x,i)=>rect(x,0,2,24,i%2?'#d99a57':'#a96345')),
  rect(0,11,32,2,'#755944'),rect(1,2,30,1,'#e5bd78'),rect(1,21,30,1,'#273b3e')
]);
const dense=draw(96,8,[rect(0,0,96,8,'#80c4b6'),
  ...Array.from({length:48},(_,i)=>rect(i*2,0,1,8,'#283f50'))]);
const tilesets=Object.fromEntries([['glass',glass],['board',board],['signal',dense]].map(([id,raster])=>
  [id,ink.readTilesetImage(PNG.encode(raster.width,raster.height,raster.data,4))]));
const base={id:'signal-window',style:'slate',solids:[],tilesets,
  camera:{yaw:0,pitch:0,dist:4,target:[0,0,0],projection:'orthographic',sway:0}};
const editor=ink.createSceneEditor(base);
function stamp(editor,id,origin,worldSize) {
  const {width,height}=tilesets[id];
  editor.placeTilesetFace({object:id,face:id,origin,worldSize,selection:ink.pickTilesetRectangle(base,id,{x:0,y:0,width,height})});
}
stamp(editor,'board',[-.94,-.68,-.14],[1.88,1.36]);
stamp(editor,'glass',[-1.16,-.88,0],[2.32,1.76]);
const scale=ink.createSceneEditor({...base,id:'signal-filter'});
stamp(scale,'signal',[-1.14,-.15,0],[2.28,.3]);

const out=path.resolve(process.argv[2] ?? 'tileset-material-demo');
const file=name=>path.join(out,name), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const commands=[];
fs.mkdirSync(out,{recursive:true});
json('window.json',editor.snapshot());
json('filter.json',scale.snapshot());
function command(args,receipt) {
  if (receipt) commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  else commands.push('ink-studio '+args.join(' '));
  const stdout=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  if (receipt) {
    write(receipt,stdout);
    return JSON.parse(stdout);
  }
}
function material(source,id,name,settings) {
  const request=typeof settings==='string' ? settings : name+'-settings.json';
  if (typeof settings!=='string') json(request,settings);
  const scene=name+'.json', review=name+'-review.json';
  const args=['tileset','material','set',request,'--scene',source,'--id',id];
  const preview=command(args,review);
  assert(preview.canCommit && preview.before[0].faces.length===1);
  command([...args,'--expect',review,'--out',scene],name+'-commit.json');
  return scene;
}
function render(scene,target,options=[]) {
  command(['render',scene,'--w','96','--h','64','--px1','--raw','--sun-direction','0.8,0.6,-0.25',
    '--sun-ambient','0.2','--sun-intensity','0.8','--sun-shadows','off','--out',target+'.png',...options]);
}
const unlit={lighting:'unlit',sidedness:'double',minFilter:'nearest',magFilter:'nearest'};
for (const [key,rules] of Object.entries({
  'lit-mask':{...unlit,lighting:'lit',alphaMode:'mask'},
  'unlit-mask':{...unlit,emissiveGain:.25,alphaMode:'mask'},
  'opaque':{...unlit,alphaMode:'opaque'},
  'blend':{...unlit,alphaMode:'blend'},
  'front-only':{...unlit,sidedness:'front',alphaMode:'mask'}
})) render(material('window.json','glass',key,rules),key);
render('front-only.json','back-culled',['--yaw','180']);
render('unlit-mask.json','back-visible',['--yaw','180']);
command(['tileset','material','export','--scene','blend.json','--id','glass','--out','glass-preset.json'],'preset-receipt.json');
material('window.json','board','reused','glass-preset.json');
for (const minFilter of ['nearest','linear'])
  render(material('filter.json','signal','min-'+minFilter,{...unlit,alphaMode:'opaque',minFilter}),'min-'+minFilter);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Shared tileset materials\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'The window panels use the same source pixels. The split comparisons show lighting, emissive gain,\n'+
  'alpha, sidedness and independent minification. The export is applied to a second sheet in reused.json.\n');

const w=839,h=409, xs=[20,222,424,626], titles=['LIT / MASK','UNLIT / EMISSIVE','OPAQUE','ALPHA BLEND',
  'BACK / CULLED','BACK / DOUBLE','MIN / NEAREST','MIN / LINEAR'];
const sheet=draw(w,h,[rect(0,0,w,h,'#172833'),text('INK STUDIO / TILESET MATERIALS',20,15,2,'#9dc7b5'),
  text('One sheet, different surfaces',20,40,3),
  ...titles.map((title,i)=>text(title,xs[i%4],i<4?79:244,2))]);
for (const [i,key] of ['lit-mask','unlit-mask','opaque','blend','back-culled','back-visible','min-nearest','min-linear'].entries()) {
  const result=PNG.raster(file(key+'.png'));
  for (let y=0;y<128;y++) for (let x=0;x<192;x++) {
    const at=4*(Math.floor(y/2)*result.w+Math.floor(x/2));
    sheet.data.set(result.data.subarray(at,at+4),4*((y+(i<4?101:266))*w+xs[i%4]+x));
  }
}
assert.notDeepEqual(fs.readFileSync(file('min-nearest.png')),fs.readFileSync(file('min-linear.png')));
write('Tileset-materials.png',PNG.encode(w,h,sheet.data,4));
