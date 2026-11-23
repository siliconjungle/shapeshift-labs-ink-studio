const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const poseBlocking = require('./pose-blocking.js');
const PNG = require('../cli/png.js');
const clips = require('./signal-courier-sprite-clips.json');

const kit = ink.load(), scene = poseBlocking(kit);
const settings = {
  directions: 4, clips,
  pivot: [0, 1.58, 0], yaw: Math.PI - .36,
  view: { dist: 6.5, pitch: .11, dither: 0 }
};
const bake = options => ink.spriteAtlas(scene.build(scene.seed), { ...settings, ...options });
const sprite = bake({ width: 60, height: 60, maps: ['normal', 'silhouette'], normalSpace: 'view' });
const rig = bake({ width: 120, height: 120, view: { ...settings.view, raw: true } });
const encode = ({ metadata: { width, height }, images }, name) =>
  'data:image/png;base64,' + PNG.encode(width, height, images[name], 4).toString('base64');
const files = Object.fromEntries(Object.keys(sprite.images).map(name => [name, encode(sprite, name)]));
const data = JSON.stringify({ metadata: sprite.metadata, files, rig: encode(rig, 'color') });
const template = fs.readFileSync(path.join(__dirname, 'rig-sprite-bake.html.template'), 'utf8');
const output = path.resolve(process.argv[2] || 'signal-courier-sprite-bake.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, template.replace('/* DATA */', () => data));
console.log('wrote', output, sprite.metadata.frames.length, 'sprite views');
