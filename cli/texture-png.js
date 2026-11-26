const { deflateSync, inflateSync } = require('node:zlib');
const PNG = require('./png.js');
const Bytes = require('../src/png-bytes.js');
const C = require('./texture-common.js');

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const chunk = (tag, data) => Buffer.from(Bytes.chunk(tag, data));
const layout = { 0:1, 2:3, 3:3, 4:2, 6:4 };

function metadata(file, allowAnimation) {
  const bytes = C.input(file);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) throw new TypeError('Not a PNG file');
  let at = 8, seenData = false, dataEnded = false, ended = false;
  const tags = new Map();
  const unique = new Set(['IHDR', 'PLTE', 'tRNS', 'iCCP', 'sRGB', 'cHRM', 'gAMA', 'cICP', 'mDCV', 'cLLI', 'IEND']);
  while (at < bytes.length) {
    const prefix = C.slice(bytes, at, 8), size = prefix.readUInt32BE(0), key = prefix.toString('ascii', 4);
    const data = C.slice(bytes, at + 8, size), checksum = C.slice(bytes, at + size + 8, 4).readUInt32BE();
    if (!/^[A-Za-z]{4}$/.test(key) || Bytes.crc32(bytes.subarray(at + 4, at + size + 8)) !== checksum)
      throw new RangeError('Invalid PNG chunk checksum or name for ' + key);
    if (tags.has('PLTE') && ['cICP','mDCV','cLLI'].includes(key) ||
        (at === 8) !== (key === 'IHDR') || unique.has(key) && tags.has(key) ||
        (key === 'IDAT' && dataEnded) || (seenData && ['PLTE','tRNS','iCCP','sRGB','cHRM','gAMA','cICP','mDCV','cLLI'].includes(key)))
      throw new TypeError('Invalid PNG chunk order');
    if (!allowAnimation && ['acTL','fcTL','fdAT'].includes(key)) throw new TypeError('Use a bitmap sequence for animated texture frames');
    if (key[0] === key[0].toUpperCase() && !['IHDR','PLTE','IDAT','IEND'].includes(key))
      throw new TypeError('Unsupported PNG critical chunk ' + key);
    if (key === 'IDAT') seenData = true;
    else if (seenData) dataEnded = true;
    if (unique.has(key)) tags.set(key, data);
    at += size + 12;
    if (key === 'IEND') {
      if (size || at !== bytes.length) throw new TypeError('Invalid PNG end chunk');
      ended = true;
      break;
    }
  }
  if (!seenData || !ended) throw new TypeError('PNG texture needs complete image data');
  const header = tags.get('IHDR');
  if (header.length !== 13) throw new TypeError('Invalid PNG IHDR length');
  const { w: width, h: height, bitDepth: storedDepth } = PNG.nativeLayout(bytes);
  const color = header[9], bitDepth = storedDepth === 16 ? 16 : 8;
  const transparency = tags.get('tRNS');
  if (transparency && (color === 0 ? transparency.length !== 2 : color === 2 ? transparency.length !== 6 : color !== 3))
    throw new TypeError('Invalid PNG transparency samples');
  const channels = layout[color] + Number(transparency !== undefined);
  C.extent(width, height, 4 * bitDepth / 8);
  const profile = {};
  const gamma = tags.get('gAMA'), chroma = tags.get('cHRM'), iccp = tags.get('iCCP'), srgb = tags.get('sRGB');
  if (gamma) {
    if (gamma.length !== 4) throw new TypeError('Invalid PNG gamma');
    profile.gamma = gamma.readUInt32BE() / 100000;
  }
  if (chroma) {
    if (chroma.length !== 32) throw new TypeError('Invalid PNG chromaticities');
    profile.chromaticities = [2,3,4,5,6,7,0,1].map(index=>chroma.readUInt32BE(index*4)/100000);
  }
  if (srgb) {
    if (srgb.length !== 1) throw new TypeError('Invalid PNG sRGB intent');
    profile.srgb = srgb[0];
  }
  if (iccp) {
    const end = iccp.indexOf(0);
    if (end < 1 || end > 79 || iccp[end+1] !== 0) throw new TypeError('Invalid PNG ICC chunk');
    profile.name = iccp.toString('latin1', 0, end);
    profile.icc = C.icc(inflateSync(iccp.subarray(end+2), { maxOutputLength: C.maxProfile })).toString('base64');
  }
  const cicp=tags.get('cICP'), mastering=tags.get('mDCV'), levels=tags.get('cLLI');
  if (cicp) {
    if(cicp.length!==4||cicp[3]>1) throw new TypeError('Invalid PNG cICP chunk');
    profile.cicp={primaries:cicp[0],transfer:cicp[1],matrix:cicp[2],fullRange:Boolean(cicp[3])};
  }
  if (mastering) {
    if(mastering.length!==24) throw new TypeError('Invalid PNG mDCV chunk');
    profile.mastering={chromaticities:Array.from({length:8},(_,i)=>mastering.readUInt16BE(i*2)/50000),
      maxNits:mastering.readUInt32BE(16)/10000,minNits:mastering.readUInt32BE(20)/10000};
  }
  if (levels) {
    if(levels.length!==8) throw new TypeError('Invalid PNG cLLI chunk');
    profile.lightLevels={maxCLL:levels.readUInt32BE(0)/10000,maxFALL:levels.readUInt32BE(4)/10000};
  }
  C.profileMode(C.profile(profile).bytes,channels);
  const wide = profile.chromaticities?.every((n,i)=>Math.abs(n-C.p3[i])<1e-5);
  return { bytes, width, height, channels, bitDepth, profile, alpha: C.alphaMode(channels),
    ...(profile.gamma === 1 && { colorSpace:wide?'display-p3-linear':'srgb-linear' }) };
}

function read(file, { layoutOnly = false, allowAnimation = false } = {}) {
  const { bytes, ...info } = metadata(file, allowAnimation);
  if (layoutOnly) return info;
  const rgba = PNG.raster(bytes), { width, height, channels, bitDepth } = info;
  const Type = C.sampleType(bitDepth), max = bitDepth === 16 ? 65535 : 255;
  if (channels === 4 && rgba.max === max) return { ...info, data:rgba.data };
  const data = new Type(width * height * channels);
  for (let p=0; p<width*height; p++) for (let c=0; c<channels; c++) {
    const lane = channels === 2 && c === 1 ? 3 : c;
    data[p*channels+c] = Math.round(rgba.data[p*4+lane] * max / rgba.max);
  }
  return { ...info, data };
}

function write(image, value) {
  const { width, height, channels, data, depth } = C.checkedRaster(image);
  if (depth === 32) throw new TypeError('PNG texture needs integer samples');
  C.alphaMode(channels, image.alpha);
  if (image.alpha === 'premultiplied') throw new TypeError('PNG texture needs straight alpha');
  const { bytes:icc, name, srgb, chromaticities, gamma, cicp, mastering, lightLevels, whiteLuminance, ocioColorSpace } = C.profile(value);
  if (whiteLuminance!==undefined||ocioColorSpace!==undefined)
    throw new TypeError('Scene-linear luminance and named working spaces use OpenEXR metadata');
  C.profileMode(icc,channels);
  if (chromaticities?.some(n=>n<0||n>1)) throw new RangeError('PNG chromaticities need normalized coordinates');
  const header = Buffer.alloc(13), color = {1:0,2:4,3:2,4:6}[channels], bps = depth/8;
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  const tags = [];
  if (icc) tags.push(chunk('iCCP',Buffer.concat([Buffer.from((name ?? 'ICC Profile') + '\0\0', 'latin1'), deflateSync(icc)])));
  if (srgb !== undefined) tags.push(chunk('sRGB',Buffer.from([srgb])));
  if (gamma !== undefined) {
    const value = Buffer.alloc(4);
    value.writeUInt32BE(Math.round(gamma*100000));
    tags.push(chunk('gAMA',value));
  }
  if (chromaticities) {
    const value = Buffer.alloc(32);
    [6,7,0,1,2,3,4,5].forEach((i,n)=>value.writeUInt32BE(Math.round(chromaticities[i]*100000),4*n));
    tags.push(chunk('cHRM',value));
  }
  if (cicp) tags.push(chunk('cICP',Buffer.from([cicp.primaries,cicp.transfer,cicp.matrix,Number(cicp.fullRange)])));
  if (mastering) {
    const bytes=Buffer.alloc(24);
    mastering.chromaticities.forEach((v,i)=>bytes.writeUInt16BE(Math.round(v*50000),2*i));
    bytes.writeUInt32BE(Math.round(mastering.maxNits*10000),16);
    bytes.writeUInt32BE(Math.round(mastering.minNits*10000),20);
    tags.push(chunk('mDCV',bytes));
  }
  if (lightLevels) {
    const bytes=Buffer.alloc(8);
    bytes.writeUInt32BE(Math.round(lightLevels.maxCLL*10000),0);
    bytes.writeUInt32BE(Math.round(lightLevels.maxFALL*10000),4);
    tags.push(chunk('cLLI',bytes));
  }
  const raw = depth === 16 ? Buffer.alloc(data.length * 2) : data;
  if (depth === 16) for (let i=0; i<data.length; i++) raw.writeUInt16BE(data[i],2*i);
  const bytes=Buffer.concat([signature,chunk('IHDR',header),...tags,
    chunk('IDAT',deflateSync(Bytes.scanlines(width,height,raw,channels*bps))),chunk('IEND',Buffer.alloc(0))]);
  if(bytes.length>C.maxBytes)throw new RangeError('PNG export exceeds its byte budget');
  return bytes;
}
module.exports = { read, write };
