'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const { createScene, paletteMaterials, width, height } = require('./scene.cjs');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const pack = data => gzipSync(data,{level:9}).toString('base64');

async function main() {
  const [renderer, output, still] = process.argv.slice(2);
  if (!renderer || !output) throw new Error('Usage: node build-demo.cjs bundled-preview.mjs demo.html [still.png]');
  const api = await import('./preview.mjs');
  const world = createScene(Ink.load(),api);
  const frame = Ink.render(world,{ w:width,h:height,px:2,dither:.15,
    pbrMaterials:paletteMaterials(world.look.pbrMaterials,true) });
  const png = PNG.encode(frame.w,frame.h,frame.rgb);
  if (still) fs.writeFileSync(still,png);
  const data = {
    '@TOOLKIT@':pack(Ink.bundle()+'\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, ContributionRules, RenderStages };'),
    '@RENDERER@':pack(fs.readFileSync(renderer)),
    '@REFERENCE@':png.toString('base64'),
    '/* SCENE */':read('scene.cjs'),
    '/* DEMO */':read('demo.js')
  };
  const html=read('demo.html')
    .replace(/\/\* SCENE \*\/|\/\* DEMO \*\//g,key=>data[key].replaceAll('</script','<\\/script'))
    .replace(/@TOOLKIT@|@RENDERER@|@REFERENCE@/g,key=>data[key]);
  fs.writeFileSync(output,html);
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
