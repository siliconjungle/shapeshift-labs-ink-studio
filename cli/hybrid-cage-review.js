const fs = require('node:fs');
const path = require('node:path');
const Camera = require('../src/camera-lens.js');
const PNG = require('./png.js');
const Composite = require('../src/frame-composite.js');
const R = require('./render.js');

const color = {
  handles: [82, 170, 179], expansion: [255, 166, 103], compression: [180, 132, 208],
  open: [155, 232, 183], failed: [255, 91, 111], root: [255, 232, 144], splat: [133, 220, 230]
};

function annotate(image, K, draw) {
  const { w, h } = image;
  const plan = K.frameComposite.prepare({ layers: [{ draw }] }, w, h, 1);
  return Composite.compose(image, K.frameComposite.layers(plan, {}, 0), w, h, 'nearest');
}

function text(text, at, color = '#dde9ec', size = 9) {
  return { type: 'text', text, at, size, color };
}

function overlay(image, camera, report, K) {
  const { V } = K;
  const { w, h } = image, rgb = image.rgb.map(n => Math.round(n * .47));
  const { eye, right, up, back } = Camera.fromView(camera.view);
  function project(p) {
    if (!p) return null;
    const delta = V.sub(p, eye), depth = -V.dot(back, delta);
    if (!camera.ortho && depth <= camera.clipNear) return null;
    const scale = camera.focal / (camera.ortho ? 1 : depth);
    return [w / 2 + V.dot(right, delta) * scale - .5, h / 2 - V.dot(up, delta) * scale - .5];
  }
  function pixel(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < w && y >= 0 && y < h) rgb.set(color, (y * w + x) * 3);
  }
  function mark(p, color, size = 1) {
    if (!p) return;
    for (let k = -size; k <= size; k++) {
      pixel(p[0] + k, p[1], color);
      pixel(p[0], p[1] + k, color);
    }
  }
  function line(a, b, color, step = 1) {
    if (!a || !b) return;
    const n = Math.min((w + h) * 4, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))));
    for (let i = 0; i <= n; i += step) pixel(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, color);
  }
  const handles = new Map(report.handles.map(row => [row.id, project(row.point)]));
  for (const row of report.stretching.triangles) {
    const points = row.points.map(project);
    const tone = row.collapsed ? color.failed : row.expansion * row.compression >= 1 ? color.expansion : color.compression;
    line(points[0], points[1], tone, 2);
    line(points[1], points[2], tone, 2);
    line(points[2], points[0], tone, 2);
  }
  for (const { id, at } of report.handles) {
    const point = handles.get(id);
    for (let axis = 0; axis < 3; axis++) {
      const next = at.map((n, k) => n + (k === axis ? 1 : 0)).join(':');
      line(point, handles.get(next), color.handles, 4);
    }
    mark(point, color.handles);
  }
  for (const group of report.grown) for (const strand of group.strands) for (const root of strand.roots)
    mark(project(root.point ?? root.restPoint), root.point ? color.root : color.failed, root.point ? 0 : 2);
  for (const splat of report.splats)
    mark(project(splat.point ?? splat.rest), splat.reason ? color.failed : color.splat, splat.reason ? 2 : 0);
  for (const { point } of report.cells.folds) mark(project(point), color.failed, 3);
  for (const gap of report.clearance) for (const { posed, violated } of gap.samples) {
    const a = project(posed.from), b = project(posed.to), tone = violated ? color.failed : color.open;
    line(a, b, tone);
    mark(a, tone, 2);
    mark(b, tone, 2);
    if (posed.obstruction) mark(project(posed.obstruction.point), color.failed, 3);
  }
  const labels = w >= 210 && h >= 100 ? [
    text('Stretch', [w * .13, h - 17], '#ffa667', 8),
    text('Compression', [w * .40, h - 17], '#b484d0', 8),
    text('Open', [w * .68, h - 17], '#9be8b7', 8),
    text('Failed', [w * .87, h - 17], '#ff5b6f', 8)
  ] : [];
  return annotate({ w, h, rgb }, K, labels);
}

function run(source, plan, directory, { kit, width = 256, height = 144, raw = false } = {}) {
  const poses = Array.isArray(plan) ? plan : [plan];
  if (!source.hybridCage || !poses.length || poses.length > 12 ||
      ![width, height].every(n => Number.isInteger(n) && n >= 64 && n <= 1024))
    throw new RangeError('Cage review needs a scene hybridCage, 1–12 poses, and a 64–1024 pixel view');
  const cage = kit.KIT.deform.hybridCage(source, source.hybridCage);
  const frames = poses.map(pose => {
    const { world, report } = cage.preview(pose);
    let camera;
    const image = R.render(world, { w: width, h: height, px: 1, t: 0, raw, edges: false,
      renderGrid: false, shutter: false, cameraGuides: false,
      ...R.cameraCapture(null, (view, sample) => {
        if (view.width === width && view.height === height) camera = { ...view, focal: sample.focal };
      }) });
    if (!camera) throw new RangeError('Cage review needs a camera at the native grid');
    return { image, diagnostics: overlay(image, camera, report, kit.KIT), report };
  });
  fs.mkdirSync(directory, { recursive: true });
  function write(file, img) {
    PNG.write(path.join(directory, file), img.w, img.h, img.rgb);
    return file;
  }
  const records = frames.map(({ image, diagnostics, report }, i) => ({
    ...report, image: write('pose-' + i + '.png', image), diagnostics: write('pose-' + i + '-diagnostics.png', diagnostics)
  }));
  if (frames.length <= 6) {
    const sheet = R.grid([...frames.map(f => f.image), ...frames.map(f => f.diagnostics)], frames.length);
    const labels = records.flatMap((row, i) => {
      const x = (i + .5) * width;
      const labels = [text(row.pose + (row.ready ? '  /  ready' : '  /  blocked'), [x, 16],
        row.ready ? '#dde9ec' : '#ff8391', 11)];
      if (row.clearance.length === 1) {
        const [gap] = row.clearance, widths = gap.samples.map(probe => probe.posed.width);
        const measure = widths.includes(null) ? 'unavailable' : Math.min(...widths).toFixed(3);
        labels.push(text(gap.id + '  ' + measure + '  /  min ' + gap.minWidth.toFixed(3), [x, height + 14],
          gap.violated ? '#ff8391' : '#9be8b7'));
      }
      return labels;
    });
    write('comparison.png', annotate(sheet, kit.KIT, labels));
  }
  const report = { format: 'ink-studio/hybrid-cage-review', version: 1, width, height, poses: records };
  fs.writeFileSync(path.join(directory, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { run };
