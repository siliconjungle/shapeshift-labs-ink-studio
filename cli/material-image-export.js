const PNG = require('./png.js');
const Base = require('../src/material-base-settings.js');

function png(P, image, base) {
  const { bitDepth } = base.output, { raster, descriptor } = image;
  const { width, height, channels, data } = raster;
  let samples;
  if (descriptor.intent === 'color') {
    samples = P.graphImages.displaySamples(image, bitDepth).data;
  } else {
    if (descriptor.intent === 'height' || ![1, 3, 4].includes(channels) || descriptor.alpha === 'premultiplied')
      throw new TypeError('Export height, two-channel or premultiplied non-color images as material JSON');
    const maximum = 2 ** bitDepth - 1;
    const sourceMaximum = { unorm8: 255, unorm16: 65535 }[descriptor.precision] ?? 1;
    const Type = bitDepth === 8 ? Uint8Array : Uint16Array;
    samples = Type.from(data, (sample, i) => {
      const alpha = descriptor.alpha !== 'none' && i % channels === channels - 1;
      const normalized = descriptor.domain === 'signed-unit' && !alpha ? (sample + 1) / 2 : sample / sourceMaximum;
      if (normalized < 0 || normalized > 1)
        throw new RangeError('Material PNG needs normalized samples. Export physical or HDR data as material JSON');
      return Math.round(normalized * maximum);
    });
  }
  return PNG.encodeMaterial(width, height, samples, channels, Base.measure(base).pixelsPerMeter);
}

module.exports = { png };
