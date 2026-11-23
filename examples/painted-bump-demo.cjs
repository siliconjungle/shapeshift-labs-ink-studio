const fs = require('node:fs');
const path = require('node:path');
const { source, lightDirection } = require('./painted-bump.js');
const PNG = require('../cli/png.js');

const { metadata, images } = source();
const { width, height } = metadata;
const data = JSON.stringify({ metadata, color: Buffer.from(images.color).toString('base64'),
  png: 'data:image/png;base64,' + PNG.encode(width,height,images.color,4).toString('base64') });
const files = ['drawing-primitives','view-annotations','frame-composite','sprite-cels','shadow-shell',
  'sprite-cutout-mipmaps','atlas-sprites'];
const library = files.map(name => fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8')).join('\n');
const html = fs.readFileSync(path.join(__dirname,'painted-bump.html.template'),'utf8');
const out = path.resolve(process.argv[2] || 'painted-bump.html');
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,html.replace('/* ATLAS */',()=>library).replace('/* DATA */',()=>data)
  .replace('/* LIGHT */',()=>lightDirection.toString()));
console.log('wrote',out);
