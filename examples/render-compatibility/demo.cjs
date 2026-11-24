const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PNG = require('../../cli/png.js');
const runWebGL = require('../../cli/look-webgl.js');
const beacon = require('./beacon.cjs');

const args = process.argv.slice(2);
const output = path.resolve(args.find(value => value !== '--skip-webgl') ?? 'ink-compatibility-demo');
const cli = path.join(__dirname, '../../cli/ink-studio.js');
const w = 192, h = 128, at = .75;
const file = name => path.join(output, name);
const describe = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const json = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });

fs.mkdirSync(output, { recursive: true });
const cases = [{ id: 'original', spec: beacon() }, { id: 'adjusted', spec: beacon(true) }];
for (const { id, spec } of cases) {
  json(id + '.scene.json', spec);
  const source = file(id + '.js');
  fs.writeFileSync(source, `const { scene, palette } = require('./${id}.scene.json');
module.exports = ({ KIT }) => ({
  id: scene.id, name: scene.name, seed: scene.seed,
  build(seed, options) {
    const world = KIT.diorama.scene(scene).build(seed, options);
    world.pal = palette.slice();
    return world;
  }
});
`);
  const size = ['--w', String(w), '--h', String(h), '--px', '1'];
  run('render', source, ...size, '--t', String(at), '--compatibility-report', 'on', '--out', file(id + '-headless.png'));
  run('export-scene', source, ...size, '--t', String(at), '--still-scale', '1', '--fps', '8',
    '--formats', 'still,loop', '--out', file(id + '-export'));
}
assert.deepEqual(describe('original-headless.compatibility.json').issues.map(issue => issue.code),
  ['palette-limit', 'density-field']);
assert.deepEqual(describe('adjusted-headless.compatibility.json').issues, []);
if (!args.includes('--skip-webgl')) {
  const { frames, renderer } = runWebGL({}, ({ KIT }, spec, at) => {
    const world = KIT.diorama.scene(spec.scene).build();
    world.pal = spec.palette.slice();
    world.anim?.update(1 / 60, at);
    return world;
  }, (kit, build, backend, { cases, w, h, at }) => {
    const render = backend(w, h, { colored: false, dither: 0, offscreen: true });
    try {
      const frames = cases.map(({ id, spec }) => {
        const world = build(kit, spec, at);
        let report;
        render.draw(world, { time: at, onCompatibility(value) { report = value; } });
        return { id, report, image: render.image() };
      });
      return { frames, renderer: render.driver };
    } finally { render.close(); }
  }, { cases, w, h, at });
  for (const { id, report, image } of frames) {
    assert.deepEqual(report, describe(id + '-headless.compatibility.json'));
    fs.writeFileSync(file(id + '-webgl.png'), PNG.encode(w, h, Buffer.from(image, 'base64')));
    json(id + '-webgl.compatibility.json', { renderer, ...report });
  }
}
console.log('Review files in', output);
