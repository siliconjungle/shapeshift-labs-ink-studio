'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const PNG = require('../../cli/png.js');
const portal = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tileset-pick-demo');
fs.mkdirSync(directory,{recursive:true});
const file = name=>path.join(directory,name);
const studio = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),...args],{encoding:'utf8'});
const {width,height,pixels} = portal.atlas();
fs.writeFileSync(file('masonry.png'),PNG.encode(width,height,pixels,4));
const scene = {id:'tide-gatehouse',style:'slate',solids:[],
  camera:{target:[.45,1.47,.1],dist:6.7,yaw:.32,pitch:.15,sway:0},
  topologyMeshes:{portal:{document:portal.portal(true),part:'stonework',
    materials:[portal.stone,portal.sign,portal.tunnel,portal.bevel].map(id=>({id,texture:{tileset:'masonry'}}))}}};
fs.writeFileSync(file('draft.json'),JSON.stringify(scene,null,2)+'\n');
studio('tileset','import',file('masonry.png'),'--scene',file('draft.json'),'--id','masonry','--out',file('painted.json'));
studio('tileset','create','--width','32','--height','24','--background','#31728580',
  '--scene',file('painted.json'),'--id','window-glass','--out',file('gatehouse-tiles.json'));
const pick = (id,...args)=>studio('tileset','pick','--scene',file('gatehouse-tiles.json'),'--id',id,...args);
const sign = ['--x','48','--y','0','--width','48','--height','16'];
pick('masonry',...sign,'--out',file('pick-masonry.html'));
pick('masonry',...sign,'--out',file('tide-sign-selection.json'));
pick('window-glass','--out',file('pick-blank.html'));
studio('render',file('gatehouse-tiles.json'),'--w','160','--h','104','--px','1','--ortho','--out',file('gatehouse-1x.png'));
fs.writeFileSync(file('README.txt'),[
  'Open pick-masonry.html to select the TIDE sign. Drag on the pixel grid or edit the four numbers, then download the selection.',
  'Compare the downloaded JSON to tide-sign-selection.json, which was generated with numeric CLI entry.',
  'Open pick-blank.html to inspect the 32 × 24 blank tileset and its translucent background.',
  'gatehouse-tiles.json carries both tilesets. Four mesh materials share the imported masonry image.',
  ''
].join('\n'));
