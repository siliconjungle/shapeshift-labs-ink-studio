const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const fixture = require('../examples/hybrid-depth-review.js');
const png = require('./png.js');
const runWebGL = require('./look-webgl.js');

const variants = ['combined', 'no-proxy', 'no-effects', 'no-glass', 'no-fog', 'no-reflection'];

function browserFrames(kit, make, backend, variants) {
  const { view } = make(kit);
  const painter = backend(view.width, view.height, view);
  const frames = {};
  try {
    for (const variant of variants) {
      const { world, portal, view } = make(kit, variant);
      const views = [];
      painter.draw(world, { ...view, portal, hybridDepthFrame(frame) {
        const bytes = new Uint8Array(frame.depth.length * 4);
        const littleEndian = new DataView(bytes.buffer);
        for (let i = 0; i < frame.depth.length; i++) littleEndian.setFloat32(i * 4, frame.depth[i], true);
        let data = '';
        for (let i = 0; i < bytes.length; i++) data += String.fromCharCode(bytes[i]);
        views.push({ ...frame, depth: btoa(data) });
      } });
      frames[variant] = { rgb: painter.image(), views };
    }
    return { frames, driver: painter.driver };
  } finally { painter.close(); }
}

function headlessFrames(kit, variants) {
  return Object.fromEntries(variants.map(variant => {
    const { world, view } = fixture(kit, variant);
    const views = [];
    const image = ink.render(world, { w:view.width, h:view.height, px:1, colored:false, dither:0,
      edges:false, atmosphere:view.atmosphere, reflections:view.reflections, t:view.time,
      hybridDepthFrame(frame) { views.push(frame); } });
    return [variant, { rgb: image.rgb, views }];
  }));
}

function label(view) {
  const camera = view.portalDepth ? 'portal-' + view.portalDepth : 'camera';
  return view.reflection ? 'reflection-' + view.reflection + (view.portalDepth ? '-' + camera : '') : camera;
}

function depthValues(frame) {
  if (typeof frame.depth !== 'string') return frame.depth;
  const bytes = Buffer.from(frame.depth, 'base64');
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}

function writeDepth(directory, stem, frame, distance) {
  const values = depthValues(frame), gray = new Uint16Array(values.length);
  const raw = Buffer.alloc(values.length * 4);
  let near = Infinity, far = -Infinity, hits = 0;
  for (let i = 0; i < values.length; i++) {
    const z = values[i];
    raw.writeFloatLE(z, i * 4);
    if (!Number.isFinite(z)) continue;
    hits++;
    near = Math.min(near, z);
    far = Math.max(far, z);
    gray[i] = Math.max(1, Math.min(65535, Math.round((1 - z / distance) * 65535)));
  }
  const image = stem + '.png', depth = stem + '.f32le';
  fs.writeFileSync(path.join(directory, image), png.encodeGray(frame.width, frame.height, gray));
  fs.writeFileSync(path.join(directory, depth), raw);
  return { view: frame.view, portalDepth: frame.portalDepth, reflection: frame.reflection,
    width: frame.width, height: frame.height, image, depth, hits,
    near: hits ? near : null, far: hits ? far : null };
}

function compare(a, b, width, height) {
  const difference = new Uint8Array(a.length);
  let changed = 0, maximum = 0;
  const bounds = [width, height, -1, -1];
  for (let p = 0; p < a.length / 3; p++) {
    const i = p * 3;
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]));
    if (delta > 2) {
      const x = p % width, y = Math.floor(p / width);
      bounds[0] = Math.min(bounds[0], x); bounds[2] = Math.max(bounds[2], x);
      bounds[1] = Math.min(bounds[1], y); bounds[3] = Math.max(bounds[3], y);
      changed++;
      difference[i] = Math.min(255, delta * 4);
      difference[i+1] = Math.min(255, delta * 2);
      difference[i+2] = Math.min(255, delta);
    }
    maximum = Math.max(maximum, delta);
  }
  return { difference, changed, maximum, bounds: changed ? bounds : null };
}

function compareDepth(base, control) {
  const controls = new Map(control.map(view => [label(view), view]));
  return base.map(view => {
    const id = label(view), next = controls.get(id);
    if (!next) return { id, missing: true };
    if (next.width !== view.width || next.height !== view.height)
      throw new Error('Hybrid depth control changed the size of ' + id);
    const a = depthValues(view), b = depthValues(next);
    let filled = 0, cleared = 0, moved = 0;
    for (let i = 0; i < a.length; i++) {
      const wasHit = Number.isFinite(a[i]), isHit = Number.isFinite(b[i]);
      if (!wasHit && isHit) filled++;
      else if (wasHit && !isHit) cleared++;
      else if (wasHit && Math.abs(a[i] - b[i]) > .001) moved++;
    }
    return { id, filled, cleared, moved };
  });
}

function run(directory, { chrome, hardware } = {}) {
  const kit = ink.load();
  const { view } = fixture(kit);
  const { width, height } = view;
  const gpu = runWebGL({ chrome, hardware }, fixture, browserFrames, variants);
  const cpu = headlessFrames(kit, variants);
  const report = { width, height, time: view.time, rows: 'top-down', depthFormat: 'f32le axial world units; infinity is empty',
    previewFar:16, rgbDifferenceThreshold:2, chrome:gpu.browser, driver:gpu.driver, backends:{} };
  fs.mkdirSync(directory, { recursive: true });
  for (const [backend, frames] of [['webgl',gpu.frames], ['headless',cpu]]) {
    const base = typeof frames.combined.rgb === 'string' ? Buffer.from(frames.combined.rgb, 'base64') : frames.combined.rgb;
    const entries = report.backends[backend] = {};
    for (const [variant, frame] of Object.entries(frames)) {
      const pixels = typeof frame.rgb === 'string' ? Buffer.from(frame.rgb, 'base64') : frame.rgb;
      const stem = backend + '-' + variant, image = stem + '.png';
      png.write(path.join(directory,image), width, height, pixels);
      const views = frame.views.map(view => writeDepth(directory, stem+'-'+label(view)+'-depth', view, report.previewFar));
      entries[variant] = { image, views };
      if (variant !== 'combined') {
        const { difference, ...metrics } = compare(base, pixels, width, height);
        const image = stem + '-difference.png';
        png.write(path.join(directory,image), width, height, difference);
        entries[variant].difference = { image, ...metrics,
          depthViews: compareDepth(frames.combined.views, frame.views) };
      }
    }
  }
  fs.writeFileSync(path.join(directory,'review.json'), JSON.stringify(report,null,2) + '\n');
  return report;
}

module.exports = { run };
