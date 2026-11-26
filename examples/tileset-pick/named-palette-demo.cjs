'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library} = fixture(), asset = scene.tilesets.enamel;
delete scene.topologyMeshes.pillar;

const shades = [0xbde2b4,0xbde2b4,0xbde2b4,0x417d74,0x293f44];
const alpha = [255,255,160];
const unique = new Map(shades.map((rgb,i)=>[rgb,i]));
const raw = Buffer.from(asset.data,'base64'), indices = Buffer.alloc(raw.length/4);
for (let i=0;i<indices.length;i++) {
  const color = raw.readUInt32BE(i*4)>>>8;
  if (!unique.has(color)) { unique.set(color,shades.length); shades.push(color); }
  const x = i%asset.width, y = Math.floor(i/asset.width);
  indices[i] = color===0xbde2b4 ? y===1 ? 2 : x%2 : unique.get(color);
}
scene.tilesets.enamel = {...asset,encoding:'indexed8',data:indices.toString('base64'),palette:shades,alpha};
const desired = [
  ['glaze','Jade glaze','#bde2b4'],['glaze-copy','Glaze copy','#bde2b4'],['faded','Faded glaze','#bde2b4'],
  ['enamel','Teal enamel','#417d74'],['shadow','Deep shadow','#293f44']
];
const palette = {format:'ink-studio/pixel-palette',version:1,
  swatches:desired.map(([id,label,color],i)=>({id,label,color,...(i===0 && {locked:true})})),
  ramps:[{id:'enamel-light',label:'Enamel light',swatches:['shadow','enamel','glaze-copy']}]};

const directory = path.resolve(process.argv[2] ?? 'named-palette-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);
json('enamel.json',palette);
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+(receipt ?? '/dev/null'));
  const stdout = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  if (!receipt) return;
  write(receipt,stdout);
  return JSON.parse(stdout);
}
const paletteCommand = (source,args,receipt)=>run(['tileset','palette',...args,'--scene',source,'--id','enamel'],receipt);
function edit(name,source,action,request) {
  const receipt = name+'-review.json', output = name+'-station.json';
  const preview = paletteCommand(source,[action,request],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.deepEqual(paletteCommand(source,[action,request,'--expect',receipt,'--out',output],name+'-commit.json'),preview);
  return output;
}
const named = edit('named','station.json','import','enamel.json');
const before = paletteCommand(named,['inspect'],'before.json');
assert.deepEqual(before.duplicates,[{rgba:'#bde2b4ff',ids:['glaze','glaze-copy']}]);
json('reorder.json',{type:'reorder',order:['shadow','enamel','faded','glaze','glaze-copy',
  ...before.swatches.slice(desired.length).map(row=>row.id)]});
const sorted = edit('sorted',named,'edit','reorder.json');
json('consolidate.json',{type:'consolidate',map:{'glaze-copy':'glaze'}});
const merged = edit('merged',sorted,'edit','consolidate.json');
const after = paletteCommand(merged,['inspect'],'after.json');
assert(after.duplicates.length===0 && after.alphaVariants.length===1);
assert.deepEqual(after.ramps[0].swatches,['shadow','enamel','glaze']);
paletteCommand(merged,['export','--out','shared.json'],'export-json.json');
paletteCommand(merged,['export','--out','shared.gpl'],'export-gpl.json');

const render = (source,out)=>run(['render',source,'--w','206','--h','100','--px','1','--out',out,'--ortho',
  '--yaw','0','--pitch','0','--target','0,.5,0','--zoom','1.6','--raw']);
render('station.json','before.png');
render(merged,'after.png');
const beforeBytes = fs.readFileSync(file('before.png'));
assert.deepEqual(fs.readFileSync(file('after.png')),beforeBytes);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp before.png after.png\n');
write('README.md','# Named enamel palette\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Import named swatches, inspect two exact aliases and one alpha variant, then\n'+
  'reorder and consolidate. The native renders must match byte for byte.\n'+
  'The final Ink JSON and GIMP palette are available for reuse.\n');

const {drawing2d} = ink.load().KIT.procedural;
const W=818,H=337, inkColor='#eee3cb', muted='#a4d1c0';
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale,color=inkColor)=>({type:'text',text,at:[x,y],scale,color});
const swatches = (report,x)=>report.swatches.slice(0,report===before ? 5 : 4).flatMap((row,i)=>{
  const y = 114+i*34;
  return [rect(x,y,19,19,row.color),label(row.label,x+29,y+3,2),
    label('A'+row.alpha,x+222,y+5,1,row.alpha===255 ? muted : '#e6ae65')];
});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),label('INK STUDIO / TILESET PALETTE',20,16,2,muted),
  label('Named swatches on bound paint',20,41,3),
  label('IMPORTED',20,83,2),label('CONSOLIDATED',291,83,2),label('NATIVE RENDER',568,83,2),
  ...swatches(before,20),...swatches(after,291),
  label('GLAZE COPY MERGED INTO JADE GLAZE',20,302,2,muted),
  label('EXACT MATCH AFTER EDIT',568,290,1,muted)
]});
const frame = PNG.raster(beforeBytes);
for (let y=0;y<162;y++) for (let x=0;x<204;x++) {
  const p = ((24+Math.floor(y/3))*frame.w+127+Math.floor(x/3))*4;
  board.data.set(frame.data.subarray(p,p+4),((y+108)*W+x+568)*4);
}
write('Named-tileset-palette.png',PNG.encode(W,H,board.data,4));
