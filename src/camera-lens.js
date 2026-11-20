/* Shared lens and subject-plane composition math for script, Node and ESM hosts. */
const CameraLens = (() => {
  const defaultFov = (38 * Math.PI) / 180,
    defaultSensorHeight = 24;
  const finite = Number.isFinite;
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Camera lens: ' + message);
  };
  const fovOK = fov => finite(fov) && fov > 0 && fov < Math.PI;
  function fieldOfView(focalLength, sensorHeight = defaultSensorHeight) {
    check(
      finite(focalLength) && focalLength > 0 && finite(sensorHeight) && sensorHeight > 0,
      'focal length and sensor height must be positive millimeters'
    );
    const fov = 2 * Math.atan(sensorHeight / 2 / focalLength);
    check(fovOK(fov), 'lens must have a representable vertical field of view');
    return fov;
  }
  function focalLength(fov, sensorHeight = defaultSensorHeight) {
    check(fovOK(fov) && finite(sensorHeight) && sensorHeight > 0, 'invalid field of view or sensor height');
    const mm = sensorHeight / 2 / Math.tan(fov / 2);
    check(finite(mm) && mm > 0, 'lens must have a representable focal length');
    return mm;
  }
  function resolve(base = {}, override = {}) {
    const sensorHeight = override.sensorHeight ?? base.sensorHeight ?? defaultSensorHeight;
    check(finite(sensorHeight) && sensorHeight > 0, 'sensor height must be positive millimeters');
    if (override.fov !== undefined && override.focalLength !== undefined)
      check(
        Math.abs(override.fov - fieldOfView(override.focalLength, sensorHeight)) < 1e-10,
        'choose field of view or focal length'
      );
    const sourceFov =
      base.fov ?? (base.focalLength !== undefined ? fieldOfView(base.focalLength, base.sensorHeight) : defaultFov);
    let fov = override.fov ?? sourceFov;
    if (override.focalLength !== undefined) fov = fieldOfView(override.focalLength, sensorHeight);
    else if (override.sensorHeight !== undefined && override.fov === undefined)
      fov = fieldOfView(focalLength(sourceFov, base.sensorHeight), sensorHeight);
    check(fovOK(fov), 'vertical field of view must be in (0, pi)');
    const focusDistance = override.focusDistance ?? base.focusDistance;
    check(
      focusDistance === undefined || (finite(focusDistance) && focusDistance > 0),
      'focus distance must be positive'
    );
    return {
      fov,
      sensorHeight,
      focalLength: focalLength(fov, sensorHeight),
      ...(focusDistance !== undefined && { focusDistance })
    };
  }
  function view(base = {}, ...layers) {
    let out = { target: [0, 0, 0], dist: 12, yaw: 0, pitch: 0, ...base, ...resolve(base) };
    for (const layer of layers)
      if (layer) {
        const lens = resolve(out, layer);
        out = { ...out, ...layer, ...lens };
        if (layer.projection !== undefined && layer.ortho === undefined)
          out.ortho = layer.projection === 'orthographic';
      }
    if (out.ortho === undefined) out.ortho = out.projection === 'orthographic';
    check(
      Array.isArray(out.target) &&
        out.target.length === 3 &&
        out.target.every(finite) &&
        [out.yaw, out.pitch, out.dist].every(finite) &&
        out.dist > 0,
      'finite target, orbit and positive distance required'
    );
    out.target = out.target.slice();
    if (out.composition !== undefined) out.composition = composition(out.composition).slice();
    return out;
  }
  function composition(at) {
    check(
      Array.isArray(at) && at.length === 2 && at.every(x => finite(x) && x >= 0 && x <= 1),
      'composition is a normalized screen point [u,v]'
    );
    return at;
  }
  function target(camera, aspect) {
    check(finite(aspect) && aspect > 0, 'aspect must be positive');
    if (!camera.composition) return camera.target;
    const [u, v] = composition(camera.composition),
      h = camera.dist * Math.tan(camera.fov / 2),
      sy = Math.sin(camera.yaw),
      cy = Math.cos(camera.yaw),
      sp = Math.sin(camera.pitch),
      cp = Math.cos(camera.pitch),
      right = [cy, 0, -sy],
      up = [-sp * sy, cp, -sp * cy],
      x = (0.5 - u) * 2 * h * aspect,
      y = (v - 0.5) * 2 * h;
    return camera.target.map((n, i) => n + right[i] * x + up[i] * y);
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function pose(value) {
    const valid = v => Array.isArray(v) && v.length === 3 && v.every(finite);
    check(
      value && [value.eye, value.right, value.up, value.back].every(valid),
      'pose requires a finite eye and camera axes'
    );
    const axes = [value.right, value.up, value.back];
    check(
      axes.every(axis => Math.abs(dot(axis, axis) - 1) < 1e-4) &&
        Math.abs(dot(axes[0], axes[1])) < 1e-4 &&
        Math.abs(dot(axes[0], axes[2])) < 1e-4 &&
        Math.abs(dot(axes[1], axes[2])) < 1e-4 &&
        dot(cross(axes[0], axes[1]), axes[2]) > 0.9999,
      'pose axes must be right-handed and orthonormal'
    );
    return Object.fromEntries(['eye', 'right', 'up', 'back'].map(key => [key, value[key].slice()]));
  }
  function fromView(v) {
    check(v && v.length === 16 && Array.from(v).every(finite), 'view matrix must be finite');
    return pose({
      eye: [
        -(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]),
        -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]),
        -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14])
      ],
      right: [v[0], v[4], v[8]],
      up: [v[1], v[5], v[9]],
      back: [v[2], v[6], v[10]]
    });
  }
  function matrix(value) {
    const { eye, right, up, back } = pose(value);
    return [
      right[0],
      up[0],
      back[0],
      0,
      right[1],
      up[1],
      back[1],
      0,
      right[2],
      up[2],
      back[2],
      0,
      -dot(right, eye),
      -dot(up, eye),
      -dot(back, eye),
      1
    ];
  }
  function listenerPose(value, setback = 0) {
    check(finite(setback), 'camera setback must be finite');
    const out = pose(value);
    out.eye = out.eye.map((n, i) => n - out.back[i] * setback);
    return out;
  }
  function applyMotion(value, motion, { setback = 0 } = {}) {
    const original = listenerPose(value, setback),
      translation = motion.translation ?? [0, 0, 0],
      rotation = motion.rotation ?? [0, 0, 0];
    check(
      [translation, rotation].every(v => Array.isArray(v) && v.length === 3 && v.every(finite)),
      'camera motion requires finite world translation and rotation vectors'
    );
    const radians = Math.hypot(...rotation);
    check(finite(radians), 'rotation magnitude must be finite');
    const axis = radians ? rotation.map(v => v / radians) : [0, 0, 1],
      c = Math.cos(radians),
      s = Math.sin(radians);
    function turn(v) {
      const sideways = cross(axis, v),
        parallel = dot(axis, v) * (1 - c);
      return v.map((n, i) => n * c + sideways[i] * s + axis[i] * parallel);
    }
    const back = turn(original.back);
    return {
      eye: original.eye.map((n, i) => n + translation[i] + back[i] * setback),
      right: turn(original.right),
      up: turn(original.up),
      back
    };
  }
  return Object.freeze({
    defaultFov,
    defaultSensorHeight,
    fieldOfView,
    focalLength,
    resolve,
    view,
    composition,
    target,
    pose,
    fromView,
    matrix,
    listenerPose,
    applyMotion
  });
})();
if (typeof module !== 'undefined') module.exports = CameraLens;
else globalThis[Symbol.for('ink-studio.camera-lens')] = CameraLens;
