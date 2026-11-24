'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {width,height,study,light} = require('./shadow-band-scene.cjs');

function build(file) {
  const {world,pose} = study(ink.load());
  const count = 49, angles = Array.from({length:count},(_,i)=>-84+168*i/(count-1));
  const sheets = [false,true].map(()=>new Uint8Array(width*height*count*3));
  for (const [i,angle] of angles.entries()) {
    pose(-angle*.18);
    for (const [mode,sheet] of sheets.entries()) {
      const {rgb} = ink.render(world,{w:width,h:height,px:1,outline:false,dither:0,
        pbrLights:light(angle),shadowBandPaint:mode===1});
      sheet.set(rgb,i*width*height*3);
    }
  }
  const images = sheets.map(sheet=>PNG.encode(width,height*count,sheet).toString('base64'));
  const source = fs.readFileSync(path.join(__dirname,'shadow-band-demo.html'),'utf8');
  fs.writeFileSync(file,source.replace('@FRAMES@',JSON.stringify({width,height,angles,images})));
}

const [file] = process.argv.slice(2);
if (!file) throw new Error('Usage: node build-shadow-band-demo.cjs brass-warden.html');
build(file);
