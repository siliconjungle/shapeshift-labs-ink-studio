const fs = require('node:fs');
const path = require('node:path');
const { load } = require('..');
const poseBlocking = require('./pose-blocking.js');
const { spriteAtlas } = require('../cli/sprite-atlas.js');
const { pose } = require('../cli/diarama-pose.js');
const PNG = require('../cli/png.js');

const kit = load();
const scene = poseBlocking(kit);
const world = scene.build(scene.seed);
const fps = 12, times = Array.from({ length: 38 }, (_, frame) => frame / fps);
const { metadata, images } = spriteAtlas(world, {
  width: 80, height: 80, directions: 1, columns: 8, fps, times,
  yaw: world.cam.yaw - .32, pivot: [0, 1.65, 0], view: { dither: 0 },
  maps: ['normal'], normalSpace: 'view', pose: (asset, time) => pose(asset, time, { kit })
});
metadata.files = { color: 'color.png', normal: 'normal.png' };
const data = JSON.stringify({ metadata, files: Object.fromEntries(Object.entries(images).map(([name, bytes]) => [name,
  'data:image/png;base64,' + PNG.encode(metadata.width, metadata.height, bytes, 4).toString('base64')])) });
const shader = fs.readFileSync(path.join(__dirname, '../src/webgl/sprite-normal-preview.mjs'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, 'baked-sprite-normals.html.template'), 'utf8');
const output = path.resolve(process.argv[2] || 'baked-sprite-normals.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, template.replace('/* SHADER */', () => shader).replace('/* DATA */', () => data));
console.log('wrote', output, metadata.frames.length, 'frames');
