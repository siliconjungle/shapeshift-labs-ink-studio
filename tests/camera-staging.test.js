const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('..');
const { render } = require('../cli/render.js');
const { cameraReview } = require('../cli/camera-review.js');
const api = load(), K = api.KIT, staging = K.cameraStaging;

test('millimeter lenses and wrapped orbit constraints survive blending and constrain avoidance', () => {
  const program = K.cameraRig.compile({
    shots: { wide: { yaw: 3.05, pitch: .2, dist: 8, focalLength: 30, sensorHeight: 20 },
      tight: { yaw: -3.12, pitch: -.8, dist: 3, focalLength: 48 } },
    sequence: [{ time: 0, shot: 'wide' }, { time: 1, shot: 'tight', blend: 1 }],
    orbit: { yaw: [2.9,3.3], pitch: [-.2,.4], distance: [4,7] },
    avoidance: { yawOffsets: [-.7] }
  });
  assert.equal(program.sample(0).camera.fov, 2*Math.atan(10/30));
  assert.equal(program.sample(0).camera.dist, 7);
  assert.equal(program.sample(2).camera.yaw, -3.12);
  assert.equal(program.sample(2).camera.pitch, -.2);
  assert.equal(program.sample(2).camera.dist, 4);
  const blended = program.sample(1.5).camera;
  assert(blended.yaw > 3.05 && blended.yaw < 3.3);
  assert.equal(blended.sensorHeight, 22);
  let attempts = 0;
  const result = program.sample(0, { occlusion: () => { attempts++; return .8; } });
  assert.equal(attempts, 1);
  assert.equal(result.camera.dist, 4);
  assert.equal(result.avoidance.occluded, true);
  assert.throws(() => K.cameraRig.compile({ shots: { x: { fov: 1, focalLength: 35 } } }), /invalid shot/);
  assert.throws(() => staging.orbit({ yaw: [3,-3] }), /yaw/);
});

test('focus bands preserve depth boundaries, alpha, sharp gaps and resolved colors', () => {
  const rgb = Uint8Array.from([255, 0, 0, 0, 60, 30, 0, 180, 90, 0, 60, 30, 255, 255, 0]);
  const alpha = Uint8Array.from([255, 255, 255, 255, 0]);
  const frame = { rgb, alpha, w: 5, h: 1 };
  const settings = staging.prepare({ depthOfField: [{ depth: [6,11], radius: 2 }] });
  const depth = Float32Array.from([18,24,24,24,Infinity]);
  const soft = staging.focus(frame, depth, settings.depthOfField, 16);
  assert.deepEqual(soft.rgb, Uint8Array.from([255, 0, 0, 0, 100, 50, 0, 100, 50, 0, 100, 50, 255, 255, 0]));
  assert.equal(soft.alpha, alpha);
  assert.equal(soft.focusPixels, 3);
  const resolv = staging.focus(frame, depth, settings.depthOfField, 16, true);
  assert.deepEqual(resolv.rgb.subarray(3,12), Uint8Array.from([0, 60, 30, 0, 60, 30, 0, 60, 30]));
  assert.throws(() => staging.prepare({ depthOfField: [
    { depth: [1,4], radius: 1 }, { depth: [3,6], radius: 2 }
  ] }), /overlap/);
});

test('camera review measures the rendered crop and keeps diagnostic passes and guides optional', () => {
  const B = api.makeBuilder(1,[0x1d2631,0xf6c36f]);
  const S = K.sculpt(api.makeSculpt(B));
  S.ball([0,0,0], .66, { r: [1], materialId: 'surface' }, { objectId: 'subject', res: .08 });
  S.bake();
  const world = B.finish({ cam: { target: [0,0,0], yaw: 0, pitch: 0, dist: 5, sway: 0 } });
  world.look = { cameraStaging: { guides: { safe: [.15,.08], center: true },
    subjects: [{ id: 'landmark', select: { object: 'subject' }, minHeight: 12 }] } };
  K.cameraRig.bind(world, K.cameraRig.compile({
    shots: { a: { target: [0,0,0], focalLength: 28 }, b: { target: [-1.38,0,0], focalLength: 45 } },
    sequence: [{ time: 0, shot: 'a' }, { time: .2, shot: 'b', blend: .8 }]
  }));
  const options = { w: 56, h: 36, px: 1, raw: true };
  const base = render(world, { ...options, cameraStaging: false });
  const normal = render(world, options);
  assert.deepEqual(normal.rgb, base.rgb);
  assert.equal(normal.passes, undefined);
  const guide = render(world, { ...options, cameraGuides: true });
  assert.notDeepEqual(guide.rgb, normal.rgb);
  const { image, report } = cameraReview(world, { width:56, height:36, from:0, to:1, frames:2, view:{ raw:true } });
  assert.equal(image.w, 112);
  assert.equal(report.flagCount, 1);
  assert.equal(report.frames[0].ok, true);
  assert(report.frames[1].subjects[0].issues.includes('touches-crop'));
  const off = render(world, { ...options, t:1, target:[-20,0,0] });
  assert.deepEqual(off.cameraStaging.subjects[0].issues, ['not-visible']);
});
