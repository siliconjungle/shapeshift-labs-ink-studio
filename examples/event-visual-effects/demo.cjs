const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(process.env.INK_STUDIO_REPO ?? path.join(__dirname, '../..'));
const out = path.resolve(process.argv[2] ?? './spillway-review');
const gpuModule = process.argv[3] && path.resolve(process.argv[3]);
const PNG = require(path.join(repo, 'cli/png.js'));
const cli = path.join(repo, 'cli/ink-studio.js');
const effectFile = 'spillway.effects.json';
const file = name => path.join(out, name);

fs.mkdirSync(out, { recursive: true });
function command(...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
}

for (const name of ['spillway.world.json', 'spillway.effects-plan.json', 'spillway.wgsl']) {
  const source = path.join(__dirname, name);
  if (source !== file(name)) fs.copyFileSync(source, file(name));
}
command('sim', 'run', 'spillway.world.json', '--ticks', '112', '--record', 'spillway.run.json');
command('story', 'effects', 'spillway.run.json', 'spillway.effects-plan.json', '--out', effectFile);

function gallery(inputs, columns, destination) {
  const images = inputs.map(name => PNG.raster(file(name))), { w, h } = images[0], gap = 8;
  const width = columns * (w + gap) - gap, height = Math.ceil(images.length / columns) * (h + gap) - gap;
  const rgb = Buffer.alloc(width * height * 3, 16);
  for (const [i, image] of images.entries()) {
    if (image.w !== w || image.h !== h || image.max !== 255) throw new Error('Demo render dimensions or depth differ');
    const ox = (i % columns) * (w + gap), oy = Math.floor(i / columns) * (h + gap);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4, dst = ((oy + y) * width + ox + x) * 3;
      for (let channel = 0; channel < 3; channel++) rgb[dst + channel] = image.data[src + channel];
    }
  }
  PNG.write(file(destination), width, height, rgb);
}

const snapshots = [
  [5, '01-before'], [12, '02-west-impact'], [37, '03-east-impact'], [64, '04-marks'],
  [110, '05-cleared']
];
for (const [tick, name] of snapshots) {
  command('sim', 'render', 'spillway.run.json', '--ticks', String(tick), '--event-effects', effectFile,
    '--colored', '--w', '640', '--h', '400', '--out', name + '.png');
}
gallery(snapshots.slice(0, 4).map(([, name]) => name + '.png'), 2, 'world-review.png');

const link = (node, port) => ({ node, ...(port && { port }) });
const graph = {
  format: 'ink-studio/graph-project', version: 1,
  nodes: {
    base: { op: 'raster.canvas', inputs: { width: 296, height: 178, color: [17, 25, 39, 255] } },
    event: { op: 'scene.eventEffects', inputs: { sheet: JSON.parse(fs.readFileSync(file(effectFile), 'utf8')) } },
    gauge: { op: 'patch.shader', inputs: { source: link('base'), amount: link('event', 'amount'),
      position: link('event', 'position'), wgsl: fs.readFileSync(file('spillway.wgsl'), 'utf8') } }
  },
  outputs: { picture: link('gauge') }
};
fs.writeFileSync(file('spillway.patch.json'), JSON.stringify(graph, null, 2) + '\n');
if (gpuModule) {
  const progress = command('patch', 'run', 'spillway.patch.json', '--frames', '38', '--fps', '20',
    '--gpu-module', gpuModule, '--watch', 'image=$picture,source=event:shader', '--out', 'patch-run', '--keep', '--progress');
  const reports = progress.trim().split('\n').map(line => JSON.parse(line));
  const selected = [5, 12, 37];
  fs.writeFileSync(file('shader-watches.json'), JSON.stringify(selected.map(index => reports[index]), null, 2) + '\n');
  const pictures = selected.map(index => {
    const frame = String(index).padStart(6, '0');
    const name = 'shader-' + frame + '.png';
    fs.copyFileSync(file('patch-run/frames/' + frame + '/previews/image.png'), file(name));
    return name;
  });
  gallery(pictures, 3, 'shader-review.png');
}
console.log(out);
