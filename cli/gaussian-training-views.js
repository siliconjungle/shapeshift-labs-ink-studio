'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const Render = require('./render.js');
const { inRange, point, validId } = require('./scan-fusion-views.js');

const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const claimFields = (value, fields) => record(value) && Object.keys(value).every(key => fields.includes(key));
const integer = (n, min, max) => Number.isSafeInteger(n) && inRange(n, min, max);
const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const datasetFormat = 'ink-studio/gaussian-training';

function readBytes(file, limit) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new RangeError('Invalid or over-budget file ' + file);
    const bytes = Buffer.alloc(stat.size);
    if (fs.readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length)
      throw new Error('Could not read complete file ' + file);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function manifest(file, capture = false) {
  const bytes = readBytes(file, 1_000_000), document = JSON.parse(bytes);
  const { format, version, bounds, views } = document ?? {};
  if (!claimFields(document, ['format', 'version', 'bounds', 'views', 'settings']) ||
      format !== (capture ? datasetFormat + '-capture' : datasetFormat) || version !== 1 ||
      !claimFields(bounds, ['min', 'max']) || !point(bounds.min) || !point(bounds.max) ||
      !bounds.min.every((n, i) => inRange(bounds.max[i] - n, .0001, 1e5)) ||
      !Array.isArray(views) || !integer(views.length, 4, 24))
    throw new RangeError('Training needs finite bounds and 4 to 24 registered views');
  const ids = new Set();
  let pixels = 0;
  for (const row of views) {
    if (!claimFields(row, capture ? ['id', 'split', 'width', 'height', 'camera', 'time'] :
      ['id', 'split', 'width', 'height', 'camera', 'image', 'mask']) ||
        !validId(row.id) || ids.has(row.id.toLowerCase()) || !['train', 'holdout'].includes(row.split) ||
        ![row.width, row.height].every(n => integer(n, 8, 512)) || (pixels += row.width * row.height) > 1_600_000 ||
        (capture ? !record(row.camera) || !inRange(row.time ?? 0, 0, 120) :
          typeof row.image !== 'string' || !row.image || row.mask !== undefined && (typeof row.mask !== 'string' || !row.mask)))
      throw new RangeError('Invalid or over-budget registered view ' + row?.id);
    ids.add(row.id.toLowerCase());
  }
  const train = views.filter(row => row.split === 'train'), holdout = views.filter(row => row.split === 'holdout');
  if (train.length < 3 || !holdout.length || holdout.length > 8)
    throw new RangeError('Use at least three training views and one to eight held-out views');
  return { ...document, train, holdout, sha256: hash(bytes), pixels };
}

function cameraFor(camera, width, height, lens) {
  if (!claimFields(camera, ['type', 'pose', 'fx', 'fy', 'cx', 'cy', 'near', 'far']) ||
      !['perspective', 'orthographic'].includes(camera.type) ||
      ![camera.fx, camera.fy].every(n => inRange(n, 1e-6, 1e8)) ||
      !inRange(camera.cx, -width, 2 * width) || !inRange(camera.cy, -height, 2 * height) ||
      !inRange(camera.near, 1e-6, 1e7) || !inRange(camera.far, camera.near + 1e-6, 1e8))
    throw new RangeError('Use calibrated camera intrinsics and a valid depth range');
  return { type: camera.type, pose: lens.pose(camera.pose), fx: camera.fx, fy: camera.fy,
    cx: camera.cx, cy: camera.cy, near: camera.near, far: camera.far };
}

function cameraKey({ pose, type, fx, fy, cx, cy }) {
  return JSON.stringify([type, ...Object.values(pose).flat(), fx, fy, cx, cy].map(n =>
    typeof n === 'number' ? Number(n.toPrecision(10)) : n));
}

function checkCameras(views) {
  const keys = new Set();
  for (const view of views) {
    const key = cameraKey(view.camera);
    if (keys.has(key)) throw new RangeError('Registered views need distinct calibrated cameras at ' + view.id);
    keys.add(key);
  }
}

function loadView(row, directory, lens, cutoff) {
  const { width, height, id, split } = row, camera = cameraFor(row.camera, width, height, lens);
  const size = width * height, image = path.resolve(directory, row.image), mask = row.mask && path.resolve(directory, row.mask);
  function read(file) {
    const bytes = readBytes(file, 4_000_000);
    const layout = PNG.layout(bytes);
    if (layout.w !== width || layout.h !== height) throw new RangeError('Image must match the registered raster for ' + id);
    return { ...PNG.raster(bytes), sha256: hash(bytes) };
  }
  const source = read(image), matte = mask && read(mask);
  const target = new Float32Array(size * 4), silhouette = new Uint8Array(size);
  let foreground = 0;
  for (let i = 0; i < size; i++) {
    const j = i * 4;
    const alpha = matte ? matte.data[j] / matte.max * (matte.data[j + 3] / matte.max) : source.data[j + 3] / source.max;
    for (let c = 0; c < 3; c++) target[j + c] = source.data[j + c] / source.max * alpha;
    target[j + 3] = alpha;
    silhouette[i] = alpha >= cutoff;
    foreground += silhouette[i];
  }
  if (!foreground || foreground === size) throw new RangeError('View ' + id + ' needs a foreground mask and some background');
  const evidence = { id, split, width, height, camera, image: row.image, imageSha256: source.sha256, foreground,
    ...(matte && { mask: row.mask, maskSha256: matte.sha256 }) };
  return { id, split, width, height, camera, target, silhouette, evidence, files: mask ? [image, mask] : [image] };
}

function capture(row, build, pose, lens) {
  const { width: w, height: h, id, split, time: t = 0 } = row, world = build(t);
  pose(world, t);
  let registered;
  const frame = Render.render(world, { w, h, t, px: 1, raw: true, transparent: true, camera: row.camera,
    lockCamera: true, renderGrid: false, composite: false, renderGraph: false, cameraGuides: false, shutter: false,
    coverageFilter: false, snap: false, ...Render.cameraCapture(null, (raster, { focal }) => {
      registered = { type: raster.ortho ? 'orthographic' : 'perspective', pose: lens.fromView(raster.view),
        fx: focal, fy: focal, cx: w / 2, cy: h / 2, near: raster.clipNear, far: raster.clipFar };
    }) });
  if (frame.w !== w || frame.h !== h || frame.alpha?.length !== w * h || !registered)
    throw new RangeError('Capture needs a matching native-grid camera and RGBA frame for ' + id);
  const image = 'views/' + id + '.png';
  return { row: { id, split, width: w, height: h, camera: registered, image },
    artifact: { file: image, bytes: PNG.encodeFrame(PNG.packFrame(frame)) } };
}

module.exports = { claimFields, integer, hash, datasetFormat, manifest, loadView, capture, checkCameras };
