'use strict';

const fs = require('node:fs');
const path = require('node:path');
const lighting = require('../../src/pixel-lighting.js');
const { encode } = require('../../cli/png.js');
const scene = require('./scene.cjs');

const [out] = process.argv.slice(2);
if (!out) throw new Error('Usage: node examples/pixel-lighting/build-demo.cjs output.html');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const core = read('../../src/pixel-lighting.js');
const resources = read('../../src/webgl/resources.mjs').replace('export function', 'function');
const webgl = read('../../src/webgl/pixel-lighting.mjs').replace(/^import .+\n/, '').replace('export function', 'function');
const asset = read('scene.cjs').replace(/^module.exports = .+;$/m, '');
const { w, h, rgba } = lighting.render(scene());
const png = 'data:image/png;base64,' + encode(w, h, rgba, 4).toString('base64');
const code = [core, resources, webgl, asset, read('demo.js')].join('\n');
const script = '<script>try {\n' + code + '\n} catch (error) { document.getElementById("error").textContent = error.message; }</script>';
fs.writeFileSync(out, read('demo.html').replace('__HEADLESS_PNG__', png).replace('<!-- INK_DEMO_SCRIPT -->', () => script));
