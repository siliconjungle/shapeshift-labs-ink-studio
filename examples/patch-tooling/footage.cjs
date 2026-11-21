const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PNG = require('../../cli/png.js');

const width = 320, height = 180, fps = 15, count = 60;
const byte = n => Math.max(0, Math.min(255, Math.round(n)));

function cleanPlate() {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const seam = x % 52 < 2 || y % 43 < 2 ? 28 : 0;
    const grain = 7 * Math.sin(x * .36 + 2 * Math.sin(y * .09)) + 4 * Math.cos(y * 1.9 + x * .53);
    const light = 24 * Math.cos((x + y) * .009) + grain - seam;
    const tape = y >= 22 && y < 29 && x >= 199 && x < 294;
    pixels.set((tape ? [194, 172, 110] : [122, 110, 97]).map(n => byte(n + light)).concat(255), (y * width + x) * 4);
  }
  return pixels;
}

function render(frames, plate) {
  const size = plate.length;
  for (let n = 0; n < count; n++) {
    const frame = frames.subarray(n * size, (n + 1) * size);
    plate.copy(frame);
    const subjects = [[38 + n * 4.1, 69 + 12 * Math.sin(n * .12), 17, [211, 73, 54]]];
    if (n !== 31) subjects.push([268 - n * 3.7, 125 + 13 * Math.sin(n * .10), 13, [37, 135, 157]]);
    for (const [cx, cy, radius, rgb] of subjects) {
      for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, cy + radius); y++) {
        for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, cx + radius); x++) {
          const r = Math.hypot(x - cx, y - cy);
          if (r > radius || (x === Math.round(cx) && y === Math.round(cy))) continue;
          const light = 5 * (x - cx + y - cy) / radius + (r >= radius - 2 ? -12 : 0);
          for (let c = 0; c < 3; c++) frame[(y * width + x) * 4 + c] = byte(rgb[c] + light);
        }
      }
    }
    const drift = Math.round(15 * Math.sin(n * .16));
    for (let p = 0; p < frame.length; p += 4)
      for (let c = 0; c < 3; c++) frame[p + c] = byte(frame[p + c] + drift);
    for (let i = 0; i < 12; i++) {
      const p = (11 + (i * 29 + n * 13) % 63) * width + ((i * 137 + n * 41) % width);
      frame.set([230, 225, 213], p * 4);
    }
  }
}

function graph() {
  const link = (node, port = 'value') => ({ node, port });
  const input = name => ({ input: name });
  const inputs = Object.fromEntries(Object.entries({ threshold: 26, maxDrift: 20, minArea: 20, halfLife: .09 }).map(
    ([name, value]) => [name, { type: 'number', default: value }]));
  return { format: 'ink-studio/graph-project', version: 1, inputs,
    assets: { plate: { format: 'png', file: 'clean-plate.png' } },
    nodes: {
      original: { op: 'patch.video' },
      reference: { op: 'pngAsset', inputs: { name: 'plate' } },
      subtract: { op: 'patch.cleanPlate', inputs: { source: link('original'), plate: link('reference'),
        threshold: input('threshold'), maxDrift: input('maxDrift') } },
      cleanup: { op: 'patch.cleanMask', inputs: { source: link('subtract'), minArea: input('minArea') } },
      tracking: { op: 'patch.track', inputs: { source: link('cleanup'), options: { maxDistance: 20, maxRegions: 8 } } },
      ids: { op: 'patch.trackIds', inputs: { labels: link('tracking', 'labels') } },
      smooth: { op: 'patch.smoothTracks', inputs: { tracks: link('tracking'), generation: link('tracking', 'generation'),
        halfLife: input('halfLife') } },
      overlay: { op: 'patch.overlay', inputs: { source: link('original'), tracks: link('smooth'), options: { links: false } } }
    }, outputs: { picture: link('overlay'), tracks: link('smooth') }
  };
}

function main(directory, executable = 'ffmpeg') {
  if (!directory) throw new Error('Usage: node examples/patch-tooling/footage.cjs <new-output-dir> [ffmpeg]');
  const out = path.resolve(directory);
  fs.mkdirSync(out);
  const plate = cleanPlate(), frames = Buffer.alloc(count * plate.length);
  render(frames, plate);
  fs.writeFileSync(path.join(out, 'clean-plate.png'), PNG.encode(width, height, plate, 4));
  fs.writeFileSync(path.join(out, 'tracking.json'), JSON.stringify(graph(), null, 2) + '\n');
  execFileSync(executable, ['-nostdin', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', width + 'x' + height, '-framerate', String(fps), '-i', 'pipe:0',
    '-c:v', 'ffv1', '-pix_fmt', 'bgr0', path.join(out, 'tabletop.mkv')], { input: frames });
  process.stdout.write('Wrote the synthetic tabletop clip, clean plate and tracking patch to ' + out + '\n');
}

try { main(process.argv[2], process.argv[3]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
