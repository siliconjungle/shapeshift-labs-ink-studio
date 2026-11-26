// PNG output supports RGB8, RGBA8, indexed colour and grayscale.
const zlib = require('zlib'),
  fs = require('fs');
const PNGBytes = require('../src/png-bytes.js');
const PNGRaster = require('../src/png-raster.js');
const PixelColors = require('../src/pixel-raster-colors.js');
const chunk = (type, data) => Buffer.from(PNGBytes.chunk(type, data));
const scanlines = (w, h, pixels, channels) =>
  zlib.deflateSync(PNGBytes.scanlines(w, h, pixels, channels), { level: 6 });
function withAlpha(rgb, alpha) {
  if (rgb.length !== alpha.length * 3) throw new Error('PNG alpha count does not match its shape');
  const rgba = new Uint8Array(alpha.length * 4);
  for (let p = 0; p < alpha.length; p++) {
    rgba[p*4] = rgb[p*3];
    rgba[p*4+1] = rgb[p*3+1];
    rgba[p*4+2] = rgb[p*3+2];
    rgba[p*4+3] = alpha[p];
  }
  return rgba;
}
function header(w, h, bits, color) {
  const hd = Buffer.alloc(13);
  hd.writeUInt32BE(w, 0);
  hd.writeUInt32BE(h, 4);
  hd[8] = bits;
  hd[9] = color;
  return hd;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function image(hd, compressed, density, srgb = false) {
  return Buffer.concat([signature, chunk('IHDR', hd), ...(srgb ? [chunk('sRGB', Buffer.from([0]))] : []),
    ...(density ? [chunk('pHYs', density)] : []),
    chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}
function encode(w, h, pixels, channels = 3, { srgb = false } = {}) {
  if (![3,4].includes(channels)) throw new Error('PNG pixel count does not match its shape');
  return image(header(w, h, 8, channels === 4 ? 6 : 2), scanlines(w, h, pixels, channels), undefined, srgb);
}
function encodeGray(w, h, values) {
  if (values instanceof Uint16Array) {
    const bytes = Buffer.alloc(values.length * 2);
    for (let i = 0; i < values.length; i++) bytes.writeUInt16BE(values[i], i * 2);
    return image(header(w, h, 16, 0), scanlines(w, h, bytes, 2));
  }
  return image(header(w, h, 8, 0), scanlines(w, h, values, 1));
}
function encodeMaterial(width, height, pixels, channels, pixelsPerMeter) {
  const color = { 1: 0, 3: 2, 4: 6 }[channels];
  if (color === undefined || !(pixels instanceof Uint8Array || pixels instanceof Uint16Array))
    throw new TypeError('Material PNG needs an 8- or 16-bit scalar, RGB or RGBA raster');
  let density;
  if (pixelsPerMeter !== undefined) {
    if (pixelsPerMeter.length !== 2 || pixelsPerMeter.some(value => !Number.isInteger(value) || value < 1 || value > 0xffffffff))
      throw new RangeError('Material PNG pixel density exceeds the physical density range');
    density = Buffer.alloc(9);
    density.writeUInt32BE(pixelsPerMeter[0], 0);
    density.writeUInt32BE(pixelsPerMeter[1], 4);
    density[8] = 1;
  }

  const bytesPerSample = pixels.BYTES_PER_ELEMENT;
  let samples = pixels;
  if (bytesPerSample === 2) {
    samples = Buffer.alloc(pixels.length * 2);
    for (let i = 0; i < pixels.length; i++) samples.writeUInt16BE(pixels[i], i * 2);
  }
  return image(header(width, height, 8 * bytesPerSample, color),
    scanlines(width, height, samples, channels * bytesPerSample), density);
}

function write(file, w, h, rgb, alpha) {
  fs.writeFileSync(file, alpha ? encode(w, h, withAlpha(rgb, alpha), 4) : encode(w, h, rgb));
}
function encodeIndexed(w, h, slots, palette) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 ||
      !Array.isArray(slots) || slots.length !== w*h || !Array.isArray(palette) ||
      !palette.length || palette.length > 256)
    throw new Error('Indexed PNG needs dimensions, one slot per pixel and 1–256 RGB entries');
  const table = Buffer.from(Array.from(palette,color=>{
    if (!Array.isArray(color) || color.length !== 3 ||
        !Array.from(color).every(n=>Number.isInteger(n) && n>=0 && n<=255))
      throw new Error('Indexed PNG palette entries must be RGB bytes');
    return color;
  }).flat());
  const holes = slots.includes(null), empty = palette.length;
  if (holes && empty === 256) throw new Error('Indexed PNG needs a free slot for transparency');
  const pixels = Uint8Array.from(slots, slot=>{
    if (slot === null) return empty;
    if (!Number.isInteger(slot) || slot < 0 || slot >= palette.length)
      throw new Error('Indexed PNG pixel references a missing palette slot');
    return slot;
  });
  const alpha = holes ? Buffer.alloc(empty + 1, 255) : null;
  if (holes) alpha[empty] = 0;
  const colors = holes ? Buffer.concat([table, Buffer.alloc(3)]) : table;
  return Buffer.concat(PNGBytes.indexed(w, h, colors, alpha, scanlines(w, h, pixels, 1)));
}
function writeIndexed(file, w, h, slots, palette) {
  fs.writeFileSync(file, encodeIndexed(w, h, slots, palette));
}
function decode(file,capturePalette,layoutOnly) {
  const bytes = file instanceof Uint8Array ? file : fs.readFileSync(file);
  const reader = PNGRaster.decode(bytes,capturePalette,layoutOnly), first = reader.next();
  if (first.done) return first.value;
  const { parts,scanlineSize } = first.value;
  return reader.next(zlib.inflateSync(Buffer.concat(parts),{ maxOutputLength:scanlineSize })).value;
}
function paintRaster(file) {
  const source = decode(file,'paint');
  if (source.ink) {
    const width = source.w ?? source.value.width, height = source.h ?? source.value.height;
    source.ink = zlib.inflateSync(source.ink,{ maxOutputLength:PixelColors.metadataLimit(width*height) });
  }
  return PixelColors.decode(source);
}
function encodePaint(raster,mode) {
  const { width,height,channels,pixels,colors,alpha,ink } = PixelColors.encode(raster,mode);
  const raw = scanlines(width,height,pixels,channels);
  const metadata = zlib.deflateSync(ink);
  return Buffer.concat(channels === 1 ? PNGBytes.indexed(width,height,colors,alpha,raw,metadata)
    : PNGBytes.rgba(width,height,raw,metadata));
}
function raster(file) { return decode(file, false); }
function layout(file, indexed = false) { return decode(file, indexed ? 'indices' : false, true); }
function nativeLayout(file) { return decode(file, 'native', true); }
function sheetRaster(file) { return decode(file, 'sheet'); }
function tilesetRaster(file) { return decode(file, 'tileset'); }
function indexedRaster(file) { return decode(file, 'indices'); }
function paletteSource(file) { return decode(file, true); }
function read(file) {
  const { w, h, data, max } = raster(file);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(data[Math.floor(i / 3) * 4 + i % 3] * 255 / max);
  return { w, h, rgb };
}
function packFrame({ w, h, rgb, alpha }) {
  const channels = alpha ? 4 : 3, hd = header(w, h, 8, alpha ? 6 : 2);
  return { header: hd, compressed: scanlines(w, h, alpha ? withAlpha(rgb, alpha) : rgb, channels) };
}

function packRGBA({ width, height, data }) {
  return { header: header(width, height, 8, 6), compressed: scanlines(width, height, data, 4) };
}

function encodeFrame(frame) {
  return image(frame.header, frame.compressed);
}

function animationDelay(fps) {
  if (typeof fps === 'number') return { numerator: 1, denominator: fps };
  const { numerator, denominator } = fps;
  if (![numerator, denominator].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 65535))
    throw new RangeError('APNG frame delay needs positive 16-bit integers. Choose a representable rate or export numbered frames.');
  return { numerator: denominator, denominator: numerator };
}

// The numbered PNG frames and APNG share their compressed image data.
function encodeAnimation(frames, fps, { holds, loop = true } = {}) {
  const hd = frames[0].header, delay = animationDelay(fps);
  if (typeof loop !== 'boolean' || holds !== undefined && (!Array.isArray(holds) || holds.length !== frames.length ||
      !Array.from(holds).every(hold => Number.isSafeInteger(hold) && hold >= 1 && hold * delay.numerator <= 65535)))
    throw new RangeError('APNG needs one representable positive hold per frame and a loop switch');
  const ac = Buffer.alloc(8);
  ac.writeUInt32BE(frames.length, 0);
  ac.writeUInt32BE(loop ? 0 : 1, 4);
  const out = [signature, chunk('IHDR', hd), chunk('acTL', ac)];
  let seq = 0;
  frames.forEach((frame, i) => {
    if (!hd.equals(frame.header)) throw new Error('Animated PNG frames need the same dimensions and channels');
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0);
    hd.copy(fc, 4, 0, 8);
    fc.writeUInt16BE(delay.numerator * (holds?.[i] ?? 1), 20);
    fc.writeUInt16BE(delay.denominator, 22);
    out.push(chunk('fcTL', fc));
    const z = frame.compressed;
    if (i === 0) out.push(chunk('IDAT', z));
    else {
      const sq = Buffer.alloc(4);
      sq.writeUInt32BE(seq++, 0);
      out.push(chunk('fdAT', Buffer.concat([sq, z])));
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}
// Read the full-canvas RGB frames written by Ink's sweep encoder.
function readFullFrameAnimation(file, { w, h, count, fps }) {
  const fail = () => { throw new Error('Expected an Ink sweep clip with matching frames, dimensions, and cadence'); };
  if (![w,h,count,fps].every(Number.isSafeInteger) || w < 1 || h < 1 || count < 1 || count > 120 ||
      fps < 1 || fps > 120 || w * h * count > 64e6 || fs.statSync(file).size > 1024 + count * (4 * w * h + 128)) fail();
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, signature.length).equals(signature)) fail();
  let offset = signature.length, seq = 0;
  function take(type, length) {
    if (offset + 12 > bytes.length || bytes.toString('ascii', offset + 4, offset + 8) !== type) fail();
    const size = bytes.readUInt32BE(offset);
    if (size !== (length ?? size) || offset + size + 12 > bytes.length) fail();
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    offset += size + 12;
    return data;
  }
  const hd = take('IHDR', 13);
  if (!hd.equals(header(w, h, 8, 2)) || take('acTL', 8).readUInt32BE(0) !== count) fail();
  const frames = [];
  for (let i = 0; i < count; i++) {
    const control = take('fcTL', 26);
    if (control.readUInt32BE(0) !== seq++ || !control.subarray(4,12).equals(hd.subarray(0,8)) ||
        control.readUInt32BE(12) || control.readUInt32BE(16) || control.readUInt16BE(20) !== 1 ||
        control.readUInt16BE(22) !== fps || control[24] || control[25]) fail();
    let compressed = take(i === 0 ? 'IDAT' : 'fdAT');
    if (i) {
      if (compressed.length <= 4 || compressed.readUInt32BE(0) !== seq++) fail();
      compressed = compressed.subarray(4);
    }
    if (!compressed.length) fail();
    frames.push({ header: hd, compressed });
  }
  take('IEND', 0);
  if (offset !== bytes.length) fail();
  return frames;
}

function animate(file, frames, fps) {
  fs.writeFileSync(file, encodeAnimation(frames.map(packFrame), fps));
}
module.exports = { paintRaster, encodePaint, encode, encodeGray, encodeMaterial, encodeIndexed, write, writeIndexed,
  read, raster, layout, nativeLayout, sheetRaster, tilesetRaster, indexedRaster, paletteSource,
  animate, packFrame, packRGBA, encodeFrame, encodeAnimation, readFullFrameAnimation, animationDelay };
