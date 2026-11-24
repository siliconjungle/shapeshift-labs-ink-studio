'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const library = require('../../cli/effect-recipes.js');
const api = require('./runtime.js');

const [rendererPath,out] = process.argv.slice(2);
if (!rendererPath || !out) throw new Error('Usage: node examples/effect-recipes/build-demo.cjs recipe-renderer.mjs output.html');
const kit = Ink.load(), entries = library.library();
const report = library.check(entries);
if (!report.pass) throw new Error('An effect recipe failed preview/export verification');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const pack = data => gzipSync(data,{level:9}).toString('base64');
const frames = recipe => library.exportFrames(recipe,kit).map(png => 'data:image/png;base64,' + png.toString('base64'));
const payload = entries.map(({ recipe },i) => ({
  recipe, check:report.recipes[i],
  original:frames(recipe),
  edited:frames(api.edited(recipe,api.exampleEdit(recipe)))
}));
const data = {
  '@TOOLKIT@':pack(Ink.bundle()+'\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, ContributionRules, RenderStages };'),
  '@RENDERER@':pack(fs.readFileSync(rendererPath)),
  '@RECIPES@':pack(JSON.stringify(payload)),
  '/* RUNTIME */':read('runtime.js'),
  '/* DEMO */':read('demo.js')
};
const template = read('demo.html').replace(/@TOOLKIT@|@RENDERER@|@RECIPES@|\/\* RUNTIME \*\/|\/\* DEMO \*\//g,
  key => data[key].replaceAll('</script','<\\/script'));
files.write(path.resolve(out),template);
