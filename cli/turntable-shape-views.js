const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const R = require('./render.js');
const { pose } = require('./diarama-pose.js');

const format = 'ink-studio/perspective-shape-views';
const idOK = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
const sizeOK = (w, h) => [w, h].every(n => Number.isInteger(n) && n >= 8 && n <= 1024) && w * h <= 262144;
const fileOK = name => typeof name === 'string' && Boolean(name.trim());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function depthFile(file, camera, checksum) {
  const expected = camera.width * camera.height * 4;
  if (fs.statSync(file).size !== expected) throw new RangeError('Occluder depth must keep its native dimensions');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== expected || checksum !== undefined && digest(bytes) !== checksum)
    throw new RangeError('Occluder depth changed after the view was captured');
  return Float32Array.from({ length: expected / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}

function exportDepth(file, depth) {
  const bytes = Buffer.alloc(depth.length * 4);
  for (let i = 0; i < depth.length; i++) bytes.writeFloatLE(depth[i] ?? Infinity, i * 4);
  fs.writeFileSync(file, bytes);
  return digest(bytes);
}

function capture(world, row, kit) {
  const { width: w, height: h, time: t = 0, camera: authored, cameraShot } = row;
  if (!sizeOK(w, h) || !Number.isFinite(t) || t < 0 || t > 120 ||
      authored !== undefined && (!authored || typeof authored !== 'object' || Array.isArray(authored)) ||
      cameraShot !== undefined && (!fileOK(cameraShot) || cameraShot.length > 128))
    throw new RangeError('Production views need a native width, height, and an optional camera, shot and time');
  if (cameraShot !== undefined && !world.cameraRig)
    throw new RangeError('The occluder scene has no camera rig for ' + cameraShot);
  pose(world, t, { kit, maxSteps: 7200 });
  let camera;
  const raster = R.render(world, { w, h, px: 1, t, camera: authored, cameraShot, passes: ['depth'],
    edges: false, renderGrid: false, shutter: false, cameraGuides: false,
    ...R.cameraCapture(null, view => {
      if (view.width !== w || view.height !== h) return;
      const { width, height, view: matrix, tangent, ortho, clipNear, clipFar } = view;
      camera = { width, height, view: matrix, tangent, ortho, clipNear, clipFar };
    }) });
  if (!camera || camera.ortho || !raster.passes?.depth)
    throw new RangeError('Approved production views need a native perspective capture and axial depth');
  return { camera, depth: raster.passes.depth };
}

function read(file, kit, build) {
  const directory = path.dirname(file), plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan?.format !== format || plan.version !== 1 || !Array.isArray(plan.views) ||
      plan.views.length < 2 || plan.views.length > 12 ||
      plan.occluders !== undefined && !fileOK(plan.occluders))
    throw new RangeError('Expected 2–12 approved views in a version 1 perspective shape view plan');
  const ids = new Set(), api = kit.KIT.turntableShape;
  return plan.views.map(row => {
    if (!idOK(row?.id) || ids.has(row.id) || row.depth !== undefined && !fileOK(row.depth) ||
        row.openings !== undefined && !Array.isArray(row.openings))
      throw new RangeError('Approved views need distinct IDs, optional depth files, and opening witnesses');
    ids.add(row.id);
    const placement = row.placement ?? plan.placement;
    let camera, depth;
    if (row.camera?.view !== undefined) {
      camera = api.perspectiveCamera(row.camera, placement);
      if (row.depth !== undefined) depth = depthFile(path.resolve(directory, row.depth), camera);
      else if (plan.occluders !== undefined)
        throw new RangeError('An approved camera grid needs its recorded depth when the plan has occluders');
    } else {
      if (row.depth !== undefined) throw new RangeError('Use a recorded camera grid with recorded depth');
      const world = plan.occluders === undefined ? kit.makeBuilder(1).finish() :
        build(path.resolve(directory, plan.occluders));
      const frame = capture(world, row, kit);
      camera = api.perspectiveCamera(frame.camera, placement);
      if (plan.occluders !== undefined) depth = frame.depth;
    }
    return { id: row.id, camera, ...(depth && { occluderDepth: depth }),
      ...(row.depthBias !== undefined && { depthBias: row.depthBias }), ...(row.openings && { openings: row.openings }) };
  });
}

module.exports = { read, depthFile, exportDepth, capture };
