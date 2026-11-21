// node scripts/check.js : the comment guard over the library's own sources
const fs = require('node:fs'),
  path = require('node:path'),
  lib = require('..'),
  webgl = path.join(__dirname, '../src/webgl'),
  webgpu = path.join(__dirname, '../src/webgpu'),
  moduleFiles = [webgl, webgpu].flatMap(folder =>
    fs.readdirSync(folder).filter(file => file.endsWith('.mjs')).map(file => path.join(folder, file))),
  bad = lib.lint(lib.files().concat(lib.demoFiles(), path.join(__dirname, '../webgl.mjs'),
    path.join(__dirname, '../webgpu.mjs'), path.join(__dirname, '../src/gaussian-splats.mjs'), path.join(__dirname, '../src/zstd.mjs'),
    path.join(__dirname, '../src/scene-replay.js'), moduleFiles));
if (bad.length) {
  console.error('code after a // comment on the same line (it would never run):\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('clean');
