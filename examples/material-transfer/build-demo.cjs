'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('../..');
const png = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const makeScene = require('./scene.cjs');

const [rendererFile,out] = process.argv.slice(2);
if (!rendererFile || !out)
  throw new Error('Usage: node examples/material-transfer/build-demo.cjs recipe-renderer.mjs output.html');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const pack = data => gzipSync(data,{level:9}).toString('base64');
const spec = makeScene(), world = ink.load().KIT.diorama.build(spec), t = spec.timeline.duration;
world.anim.update(0,t);
const frame = ink.render(world,{ w:356,h:128,px:1,raw:true,t });
const data = {
  '@TOOLKIT@':pack(ink.bundle()+'\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, ContributionRules, RenderStages };'),
  '@RENDERER@':pack(fs.readFileSync(rendererFile)),
  '@SCENE@':pack(JSON.stringify(spec)),
  '@REFERENCE@':png.encode(frame.w,frame.h,frame.rgb).toString('base64'),
  '/* DEMO */':read('demo.js')
};
const html = read('demo.html').replace(/@TOOLKIT@|@RENDERER@|@SCENE@|@REFERENCE@|\/\* DEMO \*\//g,
  key => data[key].replaceAll('</script','<\\/script'));
files.write(path.resolve(out),html);
