'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('../..'), toolkit = studio.load();
const Render = require('../../cli/render.js');
const PNG = require('../../cli/png.js');
const Files = require('../../cli/asset-files.js');

async function demo(directory) {
  const cli = path.join(__dirname, '../../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  const scenePath = path.join(__dirname, 'signal-keeper.js');
  const plan = path.join(__dirname, 'cameras.json');
  const captures = path.join(directory, 'capture'), fitted = path.join(directory, 'fit');
  run('gaussian-train', 'capture', scenePath, plan, '--out', captures);
  run('gaussian-train', 'train', path.join(captures, 'dataset.json'), '--out', fitted);

  const report = JSON.parse(fs.readFileSync(path.join(fitted, 'report.json'), 'utf8'));
  const ply = path.join(fitted, report.asset.file), cloud = await studio.readGaussianSplat(ply);
  const { gaussianSplatWorld } = await import('../../src/gaussian-splats.mjs');
  assert.equal(cloud.count, report.asset.points);
  assert.equal(report.heldOut.length, 3);
  assert(report.fit.losses[report.fit.bestIteration] < .4 * report.fit.losses[0]);
  assert(report.heldOut.every(row => row.fit.silhouetteIoU > .96 && row.fit.mse < row.before.mse));

  const sourceScene = require(scenePath)(toolkit), source = sourceScene.build(sourceScene.seed);
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const [i, n] of cloud.positions.entries()) {
    low[i % 3] = Math.min(low[i % 3], n);
    high[i % 3] = Math.max(high[i % 3], n);
  }
  const span = Math.max(...high.map((n, i) => n - low[i]), 6 * cloud.scales.reduce((a, b) => Math.max(a, b), 0));
  const center = high.map((n, i) => (n + low[i]) / 2);
  // Import normally, then register the two cameras against the importer's centering convention.
  const reconstructed = gaussianSplatWorld(cloud, { size: span, palette: source.pal });
  const frames = [], w = 224, h = 210;
  const masthead = toolkit.KIT.procedural.drawing2d.render({
    width: 2 * w, height: 20, edges: 'hard',
    commands: [
      { type: 'rect', rect: [0, 0, 2 * w, 20], fill: '#141b24' },
      { type: 'text', text: 'REFERENCE', at: [9, 6], color: '#bcdadd' },
      { type: 'text', text: 'IMPORTED CLOUD', at: [w + 9, 6], color: '#f1d9a4' }
    ]
  });
  const header = new Uint8Array(masthead.width * masthead.height * 3);
  for (let i = 0; i < header.length; i++) header[i] = masthead.data[Math.floor(i / 3) * 4 + i % 3];
  for (let i = 0; i < 48; i++) {
    const options = { w, h, px: 1, t: 0, raw: true, lockCamera: true,
      yaw: .47 + 2 * Math.PI * i / 48, pitch: .25 + .15 * Math.sin(2 * Math.PI * i / 48),
      dist: 4.95, ortho: true, snap: false, target: [0, 1.28, 0] };
    const input = Render.render(source, options);
    const output = Render.render(reconstructed, { ...options, target: options.target.map((n, k) => n - center[k]),
      gaussianFilter: { footprint: 'compensated' } });
    const pair = Render.grid([input, output], 2);
    const comparison = { w: pair.w, h: pair.h + masthead.height, rgb: new Uint8Array(header.length + pair.rgb.length) };
    comparison.rgb.set(header);
    comparison.rgb.set(pair.rgb, header.length);
    if (i === 0) Files.write(path.join(directory, 'native-render.png'), PNG.encode(comparison.w, comparison.h, comparison.rgb));
    frames.push(PNG.packFrame(comparison));
  }
  Files.write(path.join(directory, 'turntable.png'), PNG.encodeAnimation(frames, 12));
  console.log('Rendered the fitted asset at ' + frames.length + ' native turntable angles in ' + directory);
}

demo(path.resolve(process.argv[2] ?? 'studio/signal-keeper')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
