/* Reusable room rigs carry the light environment and the camera as one revisioned value. */
const LightingRoomRig = (() => {
  const format = 'ink-studio/lighting-room-rig';
  const presets = Object.freeze({
    'neutral-softbox': 'Neutral softboxes',
    'neutral-even': 'Neutral even field',
    'neutral-raking': 'Neutral raking strip'
  });
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
  const range = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  const vector = (value, size, low, high) => Array.isArray(value) && value.length === size &&
    Array.from(value).every(n => range(n,low,high));
  const name = value => typeof value === 'string' && value.length <= 140 && value.trim().length && !/[\x00-\x1f]/.test(value);
  const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,63}$/i.test(value);

  function prepare(input, validateImage) {
    if (!fields(input, ['format','version','id','label','environment','camera']) ||
        input.format !== format || input.version !== 1 || !id(input.id) || !name(input.label))
      throw new TypeError('Expected a named version 1 lighting room rig');
    const environment = input.environment ?? {}, camera = input.camera ?? {};
    if (!fields(environment, ['source','rotation','exposureEV','background']) ||
        !fields(camera, ['yaw','pitch','distance','focalLength','sensorHeight','target','framing','projection','exposureEV']))
      throw new TypeError('Invalid lighting room source or camera properties');
    const { source = 'neutral-softbox', rotation = 0, exposureEV = 0, background = false } = environment;
    if (typeof source === 'string' ? !Object.hasOwn(presets, source) : !record(source))
      throw new TypeError('Choose a neutral room or embed a valid HDRI');
    if (typeof source !== 'string') validateImage?.(source);
    const { yaw = -18, pitch = 12, distance = 4.35, focalLength = 34, sensorHeight = 24,
      target = [0,0,0], framing = [.5,.5], projection = 'perspective', exposureEV: cameraEV = 0 } = camera;
    if (!range(rotation,-360,360) || !range(exposureEV,-12,12) || typeof background !== 'boolean' ||
        !range(yaw,-360,360) || !range(pitch,-88,88) || !range(distance,.3,80) || !range(focalLength,10,240) ||
        !range(sensorHeight,12,42) || !vector(target,3,-4,4) || !vector(framing,2,.05,.95) ||
        !['perspective','orthographic'].includes(projection) || !range(cameraEV,-12,12))
      throw new RangeError('Lighting room exposure, orientation or camera is outside its supported range');
    return { format, version:1, id:input.id, label:input.label, environment:{ source, rotation, exposureEV, background },
      camera:{ yaw, pitch, distance, focalLength, sensorHeight, target:target.slice(), framing:framing.slice(),
        projection, exposureEV:cameraEV } };
  }

  function builtin(preset) {
    return prepare({ format, version: 1, id: preset, label: presets[preset],
      environment: { source: preset }, camera: {} });
  }

  return Object.freeze({ format, presets, prepare, builtin, id, name });
})();
if (typeof module !== 'undefined') module.exports = LightingRoomRig;
