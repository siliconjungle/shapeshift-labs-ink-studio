'use strict';

const PNG = require('./png.js');
const R = require('./render.js');

function viewSettings({ w = 160, h = 112, t = 0, camera, raw = true, materials } = {}, standalone) {
  if (![w, h].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1024) || !Number.isFinite(t) || t < 0 ||
      typeof raw !== 'boolean' || materials !== undefined && (!standalone || !Array.isArray(materials)))
    throw new RangeError('Mesh view needs a native grid up to 1024 × 1024 and optional standalone materials');
  return { w, h, t, camera, raw, materials };
}

function worldFor(document, view, { KIT, makeBuilder }, reference = document) {
  const [entry] = KIT.authoring.meshTopologyScene.prepare({ workpiece: { document, materials: view.materials } });
  const bounds = KIT.procedural.spatial.boxOf(reference.vertices.map(row => row.position));
  const target = KIT.V.lerp(bounds.min, bounds.max, .5);
  const span = Math.max(...KIT.V.sub(bounds.max, bounds.min));
  return makeBuilder(23, [0x14242e]).finish({ meshes: [entry[1].mesh], dither: 0,
    radius: Math.max(5, span), cam: { target, dist: Math.max(.01, span * 2.05), yaw: -.48, pitch: .37, ortho: true } });
}

function render(world, view, toolkit, channels = ['geometricNormal']) {
  require('./diarama-pose.js').pose(world, view.t, { kit: toolkit, maxSteps: 7200 });
  const frame = R.render(world, { w: view.w, h: view.h, t: view.t, px: 1, camera: view.camera,
    raw: view.raw, passes: ['depth', ...channels], renderGrid: false, shutter: false, cameraGuides: false });
  if (frame.w !== view.w || frame.h !== view.h || frame.passes?.depth?.length !== view.w * view.h ||
      channels.some(channel => frame.passes?.[channel]?.length !== view.w * view.h * (channel==='materialId' ? 1 : 3)))
    throw new RangeError('Mesh preview needs a matching native-grid depth and color capture');
  return frame;
}

const cover = (frame, i) => Number.isFinite(frame.passes.depth[i]);
function normalRaster(frame, channel = 'geometricNormal') {
  const rgb = new Uint8Array(frame.rgb.length), normal = frame.passes[channel];
  for (let i = 0; i < frame.w * frame.h; i++) {
    if (!cover(frame, i)) rgb.set([20, 36, 46], i * 3);
    else for (let k = 0; k < 3; k++) {
      const at = i * 3 + k;
      rgb[at] = Math.round(Math.max(0, Math.min(255, 127.5 + normal[at] * 127.5)));
    }
  }
  return { w: frame.w, h: frame.h, rgb };
}

function normalImage(frame, channel) {
  const { w, h, rgb } = normalRaster(frame, channel);
  return PNG.encode(w, h, rgb);
}

module.exports = { viewSettings, worldFor, render, cover, normalImage, normalRaster };
