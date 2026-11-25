'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'camera-plane-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const read = name=>fs.readFileSync(file(name));
const write = (name,data)=>fs.writeFileSync(file(name),data);
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const draw=ink.load().KIT.procedural.drawing2d;
const tile=draw.render({width:24,height:20,edges:'hard',commands:[
  {type:'rect',rect:[0,0,24,20],fill:'#233b46'},
  {type:'rect',rect:[1,1,22,18],fill:'#4a8885'},
  {type:'rect',rect:[1,1,22,1],fill:'#a1c5a4'},
  {type:'rect',rect:[3,4,9,14],fill:'#346468'},
  {type:'rect',rect:[14,4,5,8],fill:'#e8b46e'},
  {type:'rect',rect:[20,4,1,8],fill:'#a1c5a4'},
  {type:'rect',rect:[14,14,7,2],fill:'#a1c5a4'},
  {type:'rect',rect:[5,7,5,1],fill:'#a1c5a4'},
  {type:'rect',rect:[5,10,4,1],fill:'#a1c5a4'}
]});
const paint=ink.readTilesetImage(PNG.encode(24,20,tile.data,4));
write('draft.json',JSON.stringify({id:'plane-orbit-proof',style:'slate',solids:[],camera:{yaw:1.05,pitch:.22},
  tilesetDefaults:{texelsPerUnit:16},tilesets:{paint}},null,2)+'\n');

function pick(input, name, ...args) {
  return JSON.parse(studio(['mesh-topology','plane',input,'--from-camera',...args,'--out',name+'.json'],name+'-pick.json'));
}
const initial=pick('draft.json','auto-start','--grid','.25');
const orbit=pick('auto-start.json','auto-orbit','--yaw','.2','--pitch','.22');
const locked=pick('auto-start.json','x-lock','--lock','x');
const lockOrbit=pick('x-lock.json','locked-orbit','--yaw','.2','--pitch','.22');
const opposite=pick('locked-orbit.json','locked-reverse','--yaw','-1.57','--pitch','0');
assert.equal(initial.camera.axis,'x');
assert.equal(orbit.camera.axis,'z');
assert.equal(locked.after.lock,'x');
assert.deepEqual(lockOrbit.axes,initial.axes);
assert.deepEqual(opposite.after,locked.after);
assert.notDeepEqual(opposite.camera.pose.back,locked.camera.pose.back);
assert.equal(pick('auto-start.json','y-lock','--lock','Y','--pitch','1.5').camera.axis,'y');
assert.equal(pick('auto-start.json','z-lock','--lock','Z','--yaw','0').camera.axis,'z');

const names=['auto-start','auto-orbit','locked-orbit'];
const stamps=names.map(name=>JSON.parse(studio(['tileset','stamp','--scene',name+'.json',
  '--object','guide','--face','panel','--id','paint','--x','0','--y','0','--width','24','--height','20',
  '--plane','1,1','--out',name+'-stamp.json'],name+'-placement.json')));
assert.deepEqual(stamps[0].vertices,stamps[2].vertices);
assert.notDeepEqual(stamps[0].vertices,stamps[1].vertices);
for (const name of names) studio(['render',name+'-stamp.json','--w','146','--h','101','--px','1','--ortho',
  '--yaw','.79','--pitch','.24','--target','.45,.8,-.45','--zoom','4.7','--raw','--out',name+'-1x.png']);
assert.deepEqual(read('auto-start-1x.png'),read('locked-orbit-1x.png'));
assert.notDeepEqual(read('auto-start-1x.png'),read('auto-orbit-1x.png'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp auto-start-1x.png locked-orbit-1x.png\n');
write('README.md',`# Camera plane picks and axis locks

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.
The placement camera starts at yaw 1.05 and orbits to yaw .2.
Automatic picking changes the normal from X to Z. The saved X lock
retains its axes through that orbit and a second view from the opposite
side. The three 1× renders use a single review camera. The script
compares the original and locked placement byte for byte.
`);

const W=960,H=390, panels=[23,334,645];
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board=draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c27'),
  text('INK STUDIO / CAMERA PLANE PICK',23,20,2,'#a6e3cd'),
  text('One orbit with two placement modes',23,52,3),
  text('AUTO / START',panels[0],111,2),
  text('AUTO / AFTER ORBIT',panels[1],111,2,'#a6e3cd'),
  text('X LOCK / AFTER ORBIT',panels[2],111,2,'#ffc789'),
  ...panels.map(x=>rect(x-1,139,294,204,'#506d75')),
  text('X NORMAL / 1.05 RAD YAW',panels[0],359,1),
  text('Z NORMAL / .20 RAD YAW',panels[1],359,1,'#a6e3cd'),
  text('X NORMAL / .20 RAD YAW',panels[2],359,1,'#ffc789')
]});
for (const [index,name] of names.entries()) {
  const {w,h,data}=PNG.raster(file(name+'-1x.png'));
  let visible=0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>900);
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((140+y)*W+panels[index]+x)*4);
  }
}
write('Camera-plane-lock.png',PNG.encode(W,H,board.data,4));
