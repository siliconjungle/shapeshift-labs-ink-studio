const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const PNG = require('../cli/png.js');
const { scanner, matchingEnergy } = require('../cli/flash-flicker-metrics.js');

const thresholds = { minLumaDelta: .12, minRedDelta: .22, minArea: .08,
  maxPulseSeconds: .33, windowSeconds: 1, minFlashes: 3 };
const width = 48, height = 32, fps = 24, count = 44, firstFrame = 60;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const tools = ['ffmpeg', 'ffprobe'].every(binary => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0);

function raster(draw) {
  const bytes = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) bytes.set(draw(x, y), (y * width + x) * 3);
  return bytes;
}

function writeTrack(root, name, draw) {
  fs.mkdirSync(path.join(root, name));
  const frames = Array.from({ length: count }, (_, i) => {
    const file = name + '/' + String(i).padStart(3, '0') + '.png';
    PNG.write(path.join(root, file), width, height, raster((x, y) => draw(i, x, y)));
    return file;
  });
  return { fps, firstFrame, frames };
}

function clip(root, source, output, extra = []) {
  const video = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps), '-i', source + '/%03d.png', '-c:v', 'libx264', '-crf', '13', '-pix_fmt',
    'yuv420p', '-threads', '1', ...extra, output], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(video.status, 0, video.stderr ?? video.error?.message);
}

function rowRun(root, spec, out = 'review', flags = []) {
  fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(spec));
  return spawnSync(process.execPath, [cli, 'take', 'review-flashes', 'plan.json', '--out', out, ...flags],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
}

function folder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-flash-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('pulses require two opposing transitions within the same short spatial excursion', () => {
  const scan = scanner(width, height, fps, thresholds, true);
  const reference = scanner(width, height, fps, thresholds);
  const gray = [70, 70, 70], red = [144, 0, 0], bright = [195, 195, 195];
  for (let frame = 0; frame < count; frame++) {
    const data = raster((x, y) => {
      if (x < 20 && y < 20 && frame >= 3 && frame < 7) return red;
      if (x >= 32 && frame >= 9) return bright;
      return gray;
    });
    scan.sample(data, frame);
    reference.sample(raster((x, y) => x >= 32 && frame >= 9 ? bright : gray), frame);
  }
  const result = scan.finish(), [event] = result.qualified;
  assert.equal(result.qualified.length, 1);
  assert.equal(event.from, 3);
  assert.equal(event.peak, 3);
  assert.equal(event.frame, 7);
  assert.equal(event.lumaArea, 0);
  assert(event.redArea > .2);
  assert.deepEqual(event.bounds, [0, 0, 20, 20]);
  assert.equal(matchingEnergy(event, reference.finish()), 0);
  assert.equal(result.heat[0], 1);
  assert.equal(result.heat[width - 1], 0);
});

test('attributes accumulated flashes to stacked sources and verifies encoded preview reduction', { skip: !tools }, t => {
  const root = folder(t), flashes = [3, 9, 15, 21], neutral = [70, 70, 70];
  function draw(frame, x, y, level, enforceDelivery = false) {
    if (x > 7 && x < 40 && y > 4 && y < 25 && flashes.some(at => frame >= at && frame < at + 2))
      return [level, level, level];
    if (enforceDelivery && x >= 32 && y >= 20 && frame >= 34 && frame < 36)
      return [255, 0, 0];
    return neutral;
  }
  const picture = writeTrack(root, 'source', (i, x, y) => draw(i, x, y, 154));
  const withoutLight = writeTrack(root, 'light-disabled', (i, x, y) => draw(i, x, y, 105));
  const withoutEffect = writeTrack(root, 'effect-disabled', (i, x, y) => draw(i, x, y, 109));
  writeTrack(root, 'delivered', (i, x, y) => draw(i, x, y, 154, true));
  clip(root, 'delivered', 'delivery.mp4', ['-output_ts_offset', '1']);
  const spec = { format: 'ink-studio/flash-flicker-review', version: 1, picture, delivery: 'delivery.mp4',
    sources: [{ id: 'beacon', kind: 'light', without: withoutLight }, { id: 'arc', kind: 'effect', without: withoutEffect }] };
  const response = rowRun(root, spec, 'review', ['--fail-on-flags']);
  assert.equal(response.status, 2, response.stderr || response.stdout);
  const out = file => path.join(root, 'review', file);
  const report = JSON.parse(fs.readFileSync(out('report.json'), 'utf8'));
  assert.equal(report.status, 'flagged');
  assert.equal(report.composited.pulses, 4);
  assert.equal(report.decoded.pulses, 5);
  assert.equal(report.decoded.peakCount, 4);
  assert.equal(report.decoded.windows.length, 1);
  assert(report.delivery.firstPts > 0);
  assert.equal(report.events[0].peak, firstFrame + 3);
  assert.equal(report.events[0].frame, firstFrame + 5);
  assert.equal(report.events[0].origin, 'composited');
  assert(report.events[0].area > .35);
  assert.deepEqual(report.events[0].contributors.map(row => row.id), ['beacon', 'arc']);
  assert.equal(report.events.at(-1).origin, 'delivery-only');
  assert.deepEqual(report.events.at(-1).contributors, []);
  assert.equal(report.preview.decoded.pulses, 0);
  assert.equal(report.preview.decoded.windows.length, 0);
  assert(fs.existsSync(out(report.preview.file)));
  assert.equal(PNG.read(out(report.evidence.heatmap)).w, width);
  assert.equal(PNG.read(out(report.evidence.preview)).h, height);
});

test('uses a re-encode for delivery-only pulses and rejects a misaligned attribution track', { skip: !tools }, t => {
  const root = folder(t);
  const picture = writeTrack(root, 'source', () => [62, 64, 82]);
  writeTrack(root, 'delivered', i => i >= 4 && i <= 6 ? [230, 230, 230] : [62, 64, 82]);
  clip(root, 'delivered', 'delivery.mp4');
  const spec = { format: 'ink-studio/flash-flicker-review', version: 1, picture, delivery: 'delivery.mp4' };
  const response = rowRun(root, spec);
  assert.equal(response.status, 0, response.stderr || response.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'review/report.json'), 'utf8'));
  assert.equal(report.status, 'reviewed');
  assert.equal(report.events[0].origin, 'delivery-only');
  assert.equal(report.preview.change, 're-encode');
  assert.equal(report.preview.decoded.pulses, 0);
  const bad = rowRun(root, { ...spec, sources: [{ id: 'misaligned', kind: 'light', without: {
    ...picture, firstFrame: firstFrame - 1
  } }] }, 'invalid');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /match the source frame range and rate/);
  assert(!fs.existsSync(path.join(root, 'invalid')));
});
