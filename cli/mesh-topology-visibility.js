'use strict';

const { render, cameraCapture } = require('./render.js');

function captureMeshTopologyVisibility(world, object, view = {}) {
  const part = Object.hasOwn(world?.topologyMeshes ?? {}, object) && world.topologyMeshes[object];
  if (!part?.mesh) throw new RangeError('Choose an editable scene mesh object for visibility capture');
  const { w = 160, h = 96, px = 1, t = world.lookSnapshot?.time ?? 0 } = view;
  if (![w, h].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1024) || px !== 1 || !Number.isFinite(t) || t < 0)
    throw new RangeError('Mesh visibility needs a native art grid up to 1024 × 1024, px 1 and a finite scene time');
  const kit = require('..').load();
  require('./diarama-pose.js').pose(world, t, { kit, maxSteps: 7200 });
  let camera;
  const frame = render(world, { ...view, w, h, t, px: 1, passes: ['sourceSurface'],
    composite: false, renderGraph: false, renderGrid: false, inspection: false, shutter: false, cameraGuides: false,
    ...cameraCapture(null, (raster, sample) => {
      if (raster.width === w && raster.height === h) camera = { ...raster, focal: sample.focal };
    }) });
  if (!camera || frame.w !== w || frame.h !== h)
    throw new Error('Mesh visibility needs matching native camera and source surface passes');
  return { frame, visibility: kit.KIT.meshTopology.captureVisibility(part.mesh, frame, camera) };
}

module.exports = { captureMeshTopologyVisibility };
