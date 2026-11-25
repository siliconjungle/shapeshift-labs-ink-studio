'use strict';

const R = require('./render.js');
const { viewSettings } = require('./mesh-native-view.js');

const viewFields = ['w', 'h', 'px', 't', 'raw', 'camera', 'cameraShot', 'cameraTime', 'lockCamera', 'yaw', 'pitch',
  'dist', 'target', 'ortho', 'projection', 'zoom', 'cameraOrbitOffset', 'fov', 'focalLength', 'sensorHeight',
  'focusDistance', 'lensScale', 'composition'];

function transformView(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !viewFields.includes(key)) ||
      value.px !== undefined && value.px !== 1 ||
      value.lockCamera !== undefined && typeof value.lockCamera !== 'boolean' ||
      value.cameraTime !== undefined && (!Number.isFinite(value.cameraTime) || value.cameraTime < 0))
    throw new TypeError('Use a native camera view with px 1 and explicit camera settings');
  return { ...value, ...viewSettings(value, false), px: 1 };
}

function captureTransformCamera(editor, view, kit) {
  const { w, h, t } = view, world = editor.build({ time: t });
  require('./diarama-pose.js').pose(world, t, { kit, maxSteps: 7200 });
  let camera;
  R.render(world, { ...view, composite: false, renderGraph: false, renderGrid: false, inspection: false,
    shutter: false, cameraGuides: false, ...R.cameraCapture(null, raster => {
      if (raster.width === w && raster.height === h) {
        const { right, up, back } = kit.CameraLens.fromView(raster.view);
        camera = { right, up, back };
      }
    }) });
  if (!camera) throw new RangeError('Camera-space edits need a matching native-grid camera sample');
  return camera;
}

module.exports = { transformView, captureTransformCamera };
