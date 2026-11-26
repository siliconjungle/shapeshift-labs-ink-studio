'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const { fixture } = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-billboards');
const file = name => path.join(dir,name);
fs.mkdirSync(dir,{recursive:true});
const json = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const cliFile = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function cli(args, output) {
  const result = execFileSync(process.execPath,[cliFile,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(output ? ' > '+output : ''));
  if (output) fs.writeFileSync(file(output),result);
  return result;
}

const { scene, library } = fixture(), { prefabLibrary, ...base } = scene;
const yaw = 1.2, pitch = .47;
const camera = {yaw,pitch,dist:4.5,target:[0,.44,0],ortho:true};
library.bay.solids.body.at[2] = -.22;
const place = x => ({prefab:'bay',origin:[0,.44,0],
  transform:{translation:[Math.cos(yaw)*x,0,-Math.sin(yaw)*x],scale:.84}});
json('station.json',{...base,id:'billboard-station',topologyMeshes:{},prefabs:library,
  instances:{west:place(-1.02),east:place(1.02)}});
json('view.json',{w:260,h:152,camera});
for (const [name,billboard] of [
  ['parallel',{mode:'full',facing:'direction'}],
  ['upright',{mode:'upright',facing:'position',snapDegrees:15}]
]) {
  json(name+'.request.json',{instances:['west','east'],billboard});
  const report = JSON.parse(cli(['mesh-topology','billboard-prefab','station.json',name+'.request.json',
    '--preview',name+'-review','--view','view.json','--out',name+'.scene.json'],name+'.receipt.json'));
  assert.ok(report.canCommit && report.preview.instances.every(row => row.afterPixels > row.beforePixels));
}

for (const [scene,out,angle] of [
  ['parallel.scene.json','Parallel-full.png',yaw],
  ['upright.scene.json','Position-upright.png',yaw],
  ['upright.scene.json','Position-upright-orbit.png',-.68]
]) cli(['render',scene,'--w','260','--h','152','--px','1','--yaw',String(angle),'--pitch',String(pitch),
  '--dist','4.5','--target','0,.44,0','--ortho','--raw','--out',out]);

fs.writeFileSync(file('COMMANDS.sh'),'#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
fs.writeFileSync(file('README.md'),[
  '# Station billboards','',
  'Both signs start as ordinary placed modules.',
  'Open parallel-review/before.png for the unmodified view.',
  'Parallel-full.png faces both signs squarely towards the same camera axis.',
  'Position-upright.png uses the eye vector for each sign and snaps its yaw in 15-degree steps.',
  'Position-upright-orbit.png shows the same saved scene from another camera.',
  'The review images use one native pixel per output pixel.',
  'Run sh COMMANDS.sh from a fresh copy with ink-studio on your PATH.',''
].join('\n'));
