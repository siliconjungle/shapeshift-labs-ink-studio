const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');
const { spriteAtlas } = require('../cli/sprite-atlas.js');
const studies = require('./sprite-reconstruction.js')(ink.load());

const destination = process.argv[2] ?? path.join(__dirname, '../dist/sprite-reconstruction-atlases.js');
const atlases = {};
for (const kind of ['courier', 'beacon']) {
  const { world, pose } = studies.prototype(kind);
  const { metadata, images } = spriteAtlas(world, {
    width: 66,
    height: 66,
    directions: 16,
    pitches: [-0.14, 0.15, 0.44],
    columns: 16,
    times: kind === 'courier' ? [0, 0.25, 0.5, 0.75] : [0],
    fps: 4,
    maps: ['depth', 'normal', 'emission'],
    pose: (_, time) => pose(time),
    view: { raw: true }
  });
  const packed = Object.fromEntries(
    Object.entries(images).map(([name, data]) => [name, gzipSync(data).toString('base64')])
  );
  atlases[kind] = { metadata, images: packed };
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, 'const spriteReconstructionAtlases = ' + JSON.stringify(atlases) + ';\n');
console.log(destination);
