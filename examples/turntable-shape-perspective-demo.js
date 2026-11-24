// Run the same capture and fit commands an artist uses, then assemble the three-view proof.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../index.js');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');
const approved = require('../cli/turntable-shape-views.js');
const { maskImage } = require('../cli/turntable-shape.js');

const kit = ink.load(), { KIT: K } = kit, S = K.turntableShape;
const recipePath = path.join(__dirname, 'turntable-shape-perspective.js');
const planPath = path.join(__dirname, 'turntable-shape-perspective-views.json');
const recipe = require(recipePath)(kit), plan = require(planPath);
const directory = path.resolve(process.argv[2] ?? 'studio/out/perspective-shape-demo');
const captureDir = path.join(directory, 'capture'), reviewDir = path.join(directory, 'review');
const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'shape', ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

cli('capture', recipePath, '--views', planPath, '--out', captureDir);
const capture = JSON.parse(fs.readFileSync(path.join(captureDir, 'capture.json'), 'utf8'));
const goal = S.fromSdf(recipe.target, recipe);
for (const [i, row] of capture.views.entries()) {
  const name = 'view-0' + (i + 1) + '.png';
  const { camera, checksum, depth, depthBias } = row;
  const occluderDepth = approved.depthFile(path.join(captureDir, depth), camera, checksum);
  const mask = S.silhouette(goal, camera, { occluderDepth, depthBias });
  fs.writeFileSync(path.join(captureDir, name), maskImage(mask, camera.width, camera.height));
}
const report = JSON.parse(cli('fit', captureDir, '--review', reviewDir));
const fitted = JSON.parse(fs.readFileSync(report.output, 'utf8'));
const priorWorld = recipe.withShape(capture.prior), fittedWorld = recipe.withShape(fitted);
for (const [i, view] of plan.views.entries()) {
  const width = view.width, height = view.height;
  const render = world => ink.render(world, { w: width, h: height, px: 1, t: 0, camera: view.camera, raw: true, edges: false });
  const stem = 'view-0' + (i + 1);
  for (const [name, frame] of [['before', render(priorWorld)], ['fitted', render(fittedWorld)]])
    PNG.write(path.join(reviewDir, stem + '-' + name + '.png'), width, height, frame.rgb);
}
const draw = [], layers = [], gap = 6, left = 78, top = 47, tileWidth = 160, tileHeight = 152;
const width = left + 3 * (tileWidth + gap), height = top + 3 * (tileHeight + gap) + 20;
function text(value, x, y, size = 9, color = '#d6e7ea') {
  draw.push({ type: 'text', text: value, at: [x, y], size, color });
}
function tile(file, x, y) {
  const { w, h, data } = PNG.raster(fs.readFileSync(file));
  layers.push({ source: { w, h, rgba: Uint8Array.from(data) }, rect: [x, y, w, h] });
}
text('Workshop lantern', width / 2, 13, 13);
text('One fitted handle   /   Three approved perspective cameras', width / 2, 29, 9, '#9fb9c0');
for (const [j, row] of ['Before', 'Fitted', 'Review'].entries())
  text(row, left / 2, top + j * (tileHeight + gap) + tileHeight / 2, 10);
for (const [i, row] of report.views.entries()) {
  const x = left + i * (tileWidth + gap), stem = 'view-0' + (i + 1);
  text(row.id, x + tileWidth / 2, top - 6);
  for (const [j, type] of ['before', 'fitted', 'review'].entries())
    tile(path.join(reviewDir, stem + '-' + type + '.png'), x, top + j * (tileHeight + gap));
}
text('Protected opening', left + 75, height - 12, 9, '#6fd8ac');
text('Occluded geometry', left + 240, height - 12, 9, '#697fd2');
text('Visible disagreement', left + 407, height - 12, 9, '#ff8666');
const prepared = K.frameComposite.prepare({ layers: [...layers, { draw }] }, width, height, 1);
const sheet = Composite.compose({ w: 1, h: 1, rgb: Uint8Array.of(10, 19, 27) },
  K.frameComposite.layers(prepared, {}, 0), width, height, 'nearest');
PNG.write(path.join(directory, 'comparison.png'), sheet.w, sheet.h, sheet.rgb);
report.output = path.relative(directory, report.output);
for (const view of report.views) view.review = path.relative(directory, view.review);
fs.writeFileSync(path.join(directory, 'fit-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(directory);
