'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const K = ink.load().KIT;
const dir = path.resolve(process.argv[2] ?? 'construction-lights');
const file = name => path.join(dir,name);
const json = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
fs.mkdirSync(dir,{recursive:true});

function run(args,receipt) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (receipt) fs.writeFileSync(file(receipt),result);
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  return receipt && JSON.parse(result);
}

const box = (id,at,half,mat) => ({id,kind:'box',at,half,mat});
const camera = {yaw:.30,pitch:.57,dist:6.1,target:[0,.65,.03],projection:'orthographic',sway:0};
const scene = {
  id:'rig-light-review',style:'slate',camera,
  constructionPlane:{origin:[-1.18,1.78,.2],grid:[.34,.25]},
  light:{sun:[-.5,.9,.2],amb:.11,sky:.15,disableSun:true},
  solids:[
    box('deck',[0,-.13,0],[2.13,.13,1.67],'stone'),
    box('back-bar',[0,.09,-1.52],[2.02,.09,.13],'dark'),
    box('left-pad',[-.95,.04,.78],[.41,.04,.28],'stone'),
    box('divider',[.24,.27,-.51],[.13,.27,.47],'stone'),
    box('step',[.74,.06,.48],[.59,.06,.52],'dark')
  ],
  prefabs:{
    crane:{revision:1,solids:{
      base:box('base',[-1.18,.11,.08],[.26,.11,.26],'dark'),
      mast:box('mast',[-1.18,.98,.08],[.085,.82,.09],'stone'),
      beam:{...box('beam',[-.83,1.85,.22],[.37,.09,.09],'dark'),part:'boom'},
      head:{kind:'ball',at:[-.51,1.78,.45],r:.11,part:'boom',mat:'stone',
        sockets:{lamp:{p:[-.50,1.78,.45],dir:[0,-1,0]}}}
    },parts:{boom:{joint:[-1.18,1.78,.2]}},motion:{turn:{do:'spin',part:'boom',axis:[0,1,0],speed:Math.PI/1.55}}},
    receiver:{revision:1,solids:{
      block:box('block',[0,.16,0],[.46,.16,.36],'stone'),
      strip:box('strip',[0,.19,.37],[.31,.085,.032],'dark')
    },points:{mark:{position:[0,.26,.05],direction:[0,0,1]}}}
  },
  instances:{gantry:{prefab:'crane'},cargo:{prefab:'receiver',transform:{translation:[1.08,.12,.46]}}}
};
json('scene.json',scene);
json('fixture.json',{id:'key',parent:{kind:'bone',part:'gantry.boom'},fixture:{
  mount:{kind:'plane',at:[2.1,0],height:.25,snapGrid:true},
  aim:{kind:'object-point',instance:'cargo',id:'mark'},
  emitter:{shape:'disk',size:[.29,.29],color:'#ffbb68',intensity:8,radius:3.8,
    sampleGrid:3,visible:true,shadows:true}
}});
json('inspect.json',{id:'key'});
json('rest.json',{w:212,h:148,camera:{...camera,ortho:true},t:0});
json('swing.json',{w:212,h:148,camera:{...camera,ortho:true},t:.43});
const command = ['mesh-topology','construction-light'];
const placed = run([...command,'scene.json','fixture.json','--view','rest.json','--preview','placement','--out','lit.json'],'placement.json');
const swung = run([...command,'lit.json','inspect.json','--view','swing.json','--preview','swing'],'swing-receipt.json');
const start = placed.preview.lights.after[0], end = swung.preview.lights.after[0];
assert.ok(placed.preview.changedPixels>100);
assert.deepEqual(start.target,end.target);
assert.ok(K.V.dist(start.at,end.at)>.4);
assert.ok(K.V.dist(start.normal,end.normal)>.1);

const width=660,height=218, drawing = K.procedural.drawing2d;
const label = (text,x,y,color)=>({type:'text',text,at:[x,y],scale:1,color});
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#1d2e33'},
  label('GANTRY LIGHT / INDEPENDENT AIM',10,10,'#a5c1b5'),
  label('BEFORE FIXTURE',10,36,'#e9d696'),
  label('RIG REST POSE',228,36,'#e9d696'),label('RIG AT 0.43 S',446,36,'#e9d696'),
  label('The mount moves with the boom. The aim point stays on the cargo.',10,202,'#a5c1b5')
]});
['placement/before.png','placement/after.png','swing/after.png'].forEach((name,i)=>{
  const {w,h,rgb} = PNG.read(file(name)), ox = 10+i*218, oy = 47;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=(y*w+x)*3,q=((oy+y)*width+ox+x)*4;
    board.data.set([rgb[p],rgb[p+1],rgb[p+2],255],q);
  }
});
fs.writeFileSync(file('Gantry-light.png'),PNG.encode(width,height,board.data,4));
fs.writeFileSync(file('COMMANDS.sh'),'#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
fs.writeFileSync(file('README.md'),[
  '# Gantry light','',
  'Gantry-light.png shows the scene without the fixture, then with it attached to the boom in two poses.',
  'The rest and swing receipts record the world mount, independent target, orientation, and pixel changes.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',''
].join('\n'));
