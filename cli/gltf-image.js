const PNG = require('./png.js');

module.exports = function decodeGltfImage(bytes, mime) {
  if (mime !== 'image/png') throw Error('Supply decodeImage to import embedded JPEG images');
  const { w:width, h:height, data, max } = PNG.raster(Buffer.from(bytes));
  return { width, height, pixels:max === 255 ? data : Uint8Array.from(data,v=>Math.round(v*255/max)) };
};
