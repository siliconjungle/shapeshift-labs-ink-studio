/* Shared material defaults used by the graph runtime and authoring surfaces. */
const MaterialBaseSettings = (() => {
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const edges = ['clamp', 'transparent', 'wrap', 'mirror'];
  const positiveInteger = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;

  function fields(value, keys, label) {
    if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
      throw new TypeError('Invalid material base ' + label);
  }

  function resolve(source = {}, { seed: defaultSeed = 0 } = {}) {
    fields(source, ['size', 'output', 'pixelSizeMm', 'pixelRatio', 'tiling', 'seed'], 'settings');
    const { size = {}, output = {}, pixelSizeMm = 1, pixelRatio = [1, 1], tiling = {}, seed = defaultSeed } = source;
    fields(size, ['width', 'height', 'lock'], 'output size');
    fields(output, ['format', 'bitDepth'], 'output format');
    fields(tiling, ['u', 'v'], 'tiling');
    const { width = 256, height = 256, lock = false } = size;
    if (!positiveInteger(width, 8192) || !positiveInteger(height, 8192) || typeof lock !== 'boolean' ||
        width * (lock ? width : height) > 16777216)
      throw new RangeError('Material base size exceeds the raster budget or has an invalid lock');
    const { format = 'png', bitDepth = format === 'png' ? 8 : undefined } = output;
    if (format === 'png' ? ![8, 16].includes(bitDepth) : format !== 'json' || bitDepth !== undefined)
      throw new TypeError('Material base output needs PNG at 8 or 16 bits, or JSON');
    if (!Number.isFinite(pixelSizeMm) || pixelSizeMm <= 0 || !Array.isArray(pixelRatio) || pixelRatio.length !== 2 ||
        !positiveInteger(pixelRatio[0], 65535) || !positiveInteger(pixelRatio[1], 65535))
      throw new RangeError('Material base needs positive millimeters and a positive integer X:Y pixel ratio');
    const { u = 'wrap', v = 'wrap' } = tiling;
    if (!edges.includes(u) || !edges.includes(v)) throw new TypeError('Invalid per-axis material base tiling');
    if (!Number.isSafeInteger(seed)) throw new TypeError('Material base seed must be a safe integer');

    const settings = { size: { width, height: lock ? width : height, lock },
      output: { format, ...(bitDepth !== undefined && { bitDepth }) }, pixelSizeMm, pixelRatio: pixelRatio.slice(),
      tiling: { u, v }, seed };
    if (measure(settings).pixelsPerMeter.some(value => !positiveInteger(value, 0xffffffff)))
      throw new RangeError('Material base pixel pitch exceeds the supported physical density range');
    return settings;
  }

  function measure({ size, pixelSizeMm, pixelRatio }) {
    const pitchY = pixelSizeMm * (pixelRatio[1] / pixelRatio[0]);
    return {
      pixelPitchMm: [pixelSizeMm, pitchY],
      physicalSizeMm: [size.width * pixelSizeMm, size.height * pitchY],
      pixelsPerMeter: [Math.round(1000 / pixelSizeMm), Math.round(1000 / pitchY)]
    };
  }

  return Object.freeze({ resolve, measure });
})();
if (typeof module !== 'undefined') module.exports = MaterialBaseSettings;
