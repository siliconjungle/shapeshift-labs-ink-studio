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
  return Object.freeze({
    defaultFov,
    defaultSensorHeight,
    fieldOfView,
    focalLength,
    resolve,
    view,
    composition,
    target
  });
})();
if (typeof module !== 'undefined') module.exports = CameraLens;
else globalThis[Symbol.for('ink-studio.camera-lens')] = CameraLens;
