'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const example = require('./scene.cjs');

const [rendererFile,out] = process.argv.slice(2);
if (!rendererFile || !out)
  throw new Error('Usage: node examples/secondary-emission/build-demo.cjs ink-renderer.mjs output.html');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const pack = data => gzipSync(data,{level:9}).toString('base64');
const spec = example(), world = Ink.load().KIT.diorama.build(spec);
const frame = Ink.render(world,{ w:336,h:172,px:1,raw:true,t:.99 });
const data = {
  '@TOOLKIT@':pack(Ink.bundle()+'\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, ContributionRules, RenderStages };'),
  '@RENDERER@':pack(fs.readFileSync(rendererFile)),
  '@SCENE@':pack(JSON.stringify(spec)),
  '@REFERENCE@':PNG.encode(frame.w,frame.h,frame.rgb).toString('base64'),
  '/* DEMO */':read('demo.js')
};
const html=read('demo.html').replace(/@TOOLKIT@|@RENDERER@|@SCENE@|@REFERENCE@|\/\* DEMO \*\//g,
  key=>data[key].replaceAll('</script','<\\/script'));
files.write(path.resolve(out),html);
