const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { upscale } = require('./render.js');
const { channels, strands, opaque, proxies, inkControls, sourceBindings } = require('../src/art-passes.js');
const { labels: inkLabels } = require('../src/art-ink.js');
const inkColors = [0, 0xf2ad77, 0x63bcc5, 0xab84d8, 0xf2e7c5, 0xe9647f, 0x90bd78];

const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
const idColor = id => Math.imul(id, 0x9e3779b1) & 0xffffff;

function labels(passes) {
  const legend = Object.fromEntries(['objects', 'materials', 'parts', 'strands', 'targets', 'paletteOwners', 'surfaceKinds'].flatMap(key => passes[key] ? [[key,
    passes[key].map((label, index) => ({ label, color: '#' + idColor(index).toString(16).padStart(6, '0') }))
  ]] : []));
  if (passes.inkMask) legend.inkMask = inkLabels.map((label,i) =>
    ({label,color:'#'+inkColors[i].toString(16).padStart(6,'0')}));
  return legend;
}

const environmentEncodings = {
  sky: 'RGB8 backdrop',
  fogTransmittance: 'RGB8 grayscale, white is full transmission',
  precipitation: 'RGBA8 straight alpha',
  reflections: 'RGB8 premultiplied reflected contribution',
  foregroundCoverage: 'RGB8 grayscale, white is full coverage',
  partId: 'RGB8 part legend color',
  partMotion: 'RGB8 preview, red and green encode signed XY at ±4 art pixels, black means invalid',
  previousDepth: 'RGB8 depth preview on the current art grid, black means invalid',
  partMotionValid: 'RGB8 grayscale, white is a valid previous sample',
  strandId: 'RGB8 strand legend color',
  strandDepth: 'RGB8 relative camera-axis depth, black means empty',
  strandCoverage: 'RGB8 grayscale, white is full visible strand coverage',
  strandTangent: 'RGB8 signed world tangent, decode as 2 * (RGB / 255) - 1',
  strandU: 'RGB8 normalized authored distance, black is the path start or empty',
  strandMotion: 'RGB8 preview, red and green encode signed XY at ±4 art pixels, black means invalid',
  strandMotionValid: 'RGB8 grayscale, white is a valid previous sample',
  proxyDepth: 'RGB8 relative camera-axis proxy depth, black means no proxy',
  proxyRejected: 'RGB8 heat map, black means no rejected splat fragments and gold means 63 or more',
  proxyRemovedCoverage: 'RGB8 grayscale combined opacity of rejected splat fragments',
  surfaceKind: 'RGB8 surface kind legend color',
  surfaceCoverage: 'RGB8 depth-owner coverage, white is full coverage',
  geometricNormal: 'RGB8 signed world-space normal, decode as 2 * (RGB / 255) - 1',
  shadingNormal: 'RGB8 signed world-space normal, decode as 2 * (RGB / 255) - 1',
  surfaceUV: 'RGB8 preview, red and green encode normalized UV, blue is validity',
  surfaceUVValid: 'RGB8 grayscale, white is a valid UV coordinate',
  surfaceMotion: 'RGB8 preview, red and green encode signed XY at ±4 art pixels, black means invalid',
  surfaceMotionValid: 'RGB8 grayscale, white is a valid previous sample',
  inkMask: 'RGB8 ink operation legend color',
  inkShadow: 'RGB8 grayscale cast shadow attenuation, white is fully shadowed',
  shadowBandBias: 'RGB8 signed bias from -1 to 1 with zero at middle gray',
  hatchWeight: 'RGB8 grayscale hatch weight, white is full strength',
  outlineWeight: 'RGB8 grayscale outline weight, white is full strength',
  lightSpillWeight: 'RGB8 grayscale spill receive weight, white is full strength',
  pigment: 'RGBA8 source pigment before lighting, transparent where there is no surface owner'
};

function environmentEncoding(passes) {
  const encodings = Object.fromEntries(Object.keys(environmentEncodings).filter(channel => passes[channel])
    .map(channel => [channel, environmentEncodings[channel]]));
  return Object.keys(encodings).length ? { encodings } : {};
}

function depthRange(data) {
  let near = Infinity, far = -Infinity;
  for (const depth of data) if (Number.isFinite(depth)) {
    near = Math.min(near, depth);
    far = Math.max(far, depth);
  }
  return Number.isFinite(near) ? { near, far } : null;
}

function encode(frame, channel) {
  if (channel === 'color') return { w:frame.w, h:frame.h, rgb: frame.rgb };
  const { passes } = frame, { w,h } = passes;
  const data = passes[channel];
  if (!data) throw new Error('The renderer did not supply the ' + channel + ' pass');
  const rgb = new Uint8Array(w * h * 3);
  const alpha = (channel === 'precipitation' || channel === 'pigment') && new Uint8Array(w * h);
  const isDepth = ['depth', 'emissionDepth', 'previousDepth', 'strandDepth', 'proxyDepth'].includes(channel);
  const depth = isDepth && depthRange(data);
  for (let p = 0; p < w * h; p++) {
    const q = p * 3;
    if (['coverage', 'protected', 'mask', 'fogTransmittance', 'foregroundCoverage', 'strandCoverage', 'strandU', 'surfaceCoverage',
      'proxyRemovedCoverage', 'inkShadow', 'hatchWeight', 'outlineWeight', 'lightSpillWeight'].includes(channel))
      rgb.fill(byte(data[p]), q, q + 3);
    else if (channel === 'shadowBandBias') rgb.fill(byte(data[p]*.5+.5),q,q+3);
    else if (['partMotionValid','strandMotionValid','surfaceUVValid','surfaceMotionValid'].includes(channel)) rgb.fill(data[p],q,q+3);
    else if (channel === 'proxyRejected') {
      const heat=Math.min(1,Math.log2(1+data[p])/6);
      rgb[q]=byte(Math.sqrt(heat));
      rgb[q+1]=byte(heat*.8);
    } else if (isDepth) {
      if (depth && Number.isFinite(data[p]))
        rgb.fill(byte(1 - .85 * (data[p] - depth.near) / (depth.far - depth.near || 1)), q, q + 3);
    } else if (['normal','strandTangent','geometricNormal','shadingNormal'].includes(channel)) {
      if (data[q] || data[q + 1] || data[q + 2])
        for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c] * .5 + .5);
    } else if (['motion','emissionMotion','partMotion','strandMotion','surfaceMotion'].includes(channel)) {
      if (channel === 'partMotion' && !passes.partMotionValid[p]) continue;
      if (channel === 'strandMotion' && !passes.strandMotionValid[p]) continue;
      if (channel === 'surfaceMotion' && !passes.surfaceMotionValid[p]) continue;
      rgb[q] = byte(.5 + data[p * 2] / 8);
      rgb[q + 1] = byte(.5 + data[p * 2 + 1] / 8);
    } else if (channel==='surfaceUV') {
      if (!passes.surfaceUVValid[p]) continue;
      rgb[q]=byte(data[p*2]); rgb[q+1]=byte(data[p*2+1]); rgb[q+2]=255;
    } else if (channel === 'pigment') {
      if (!data[p]) continue;
      const color=data[p]-1;
      rgb.set([color>>16,color>>8&255,color&255],q);
      alpha[p]=255;
    } else if (alpha) {
      const i = p * 4, a = data[i + 3];
      alpha[p] = byte(a);
      if (alpha[p]) for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[i + c] / a);
    } else if (channel === 'emission' || channel === 'sky' || channel === 'reflections') {
      for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c]);
    } else {
      const color = channel === 'inkMask' ? inkColors[data[p]] : idColor(data[p]);
      rgb[q] = color >> 16;
      rgb[q + 1] = color >> 8 & 255;
      rgb[q + 2] = color & 255;
    }
  }
  return { w, h, rgb, ...(alpha && {alpha}) };
}

function writePassData(passes, names, write) {
  const { w, h } = passes, files = {};
  for (const channel of names) {
    const data = passes[channel];
    if (!data) continue;
    const isId=data instanceof Uint32Array, isValid=data instanceof Uint8Array;
    const ext = isId ? 'u32le' : isValid ? 'u8' : 'f32le';
    const bytes = isValid ? Buffer.from(data) : Buffer.alloc(data.length * 4);
    if (!isValid) for (let i = 0; i < data.length; i++) {
      if (isId) bytes.writeUInt32LE(data[i], i * 4);
      else bytes.writeFloatLE(data[i], i * 4);
    }
    const file = write(channel, ext, bytes);
    files[channel] = { file, format: ext, components: data.length / (w * h) };
  }
  return { width: w, height: h, rows: 'top-down', files };
}

const writeStrandData=(passes,write)=>writePassData(passes,strands,write);

function writePasses(directory, frame, scale = 1) {
  const passes = frame.passes;
  const manifest = { width: frame.w, height: frame.h, scale, rows: 'top-down', files: {},
    ...(passes.w !== frame.w || passes.h !== frame.h ? {surfaceSize:[passes.w,passes.h]} : {}),
    ...environmentEncoding(passes) };
  if (passes.objects) manifest.objects = passes.objects;
  if (passes.materials) manifest.materials = passes.materials;
  if (passes.parts) manifest.parts = passes.parts;
  if (passes.strands) manifest.strands = passes.strands;
  if (passes.surfaceKinds) manifest.surfaceKinds=passes.surfaceKinds;
  if (passes.targets) manifest.targets = passes.targets;
  if (passes.paletteOwners) manifest.paletteOwners = passes.paletteOwners;
  manifest.legend = labels(passes);
  if (passes.depth || passes.emissionDepth) manifest.depth = depthRange(passes.depth || passes.emissionDepth);
  if (passes.strandDepth) manifest.strandDepth = depthRange(passes.strandDepth);
  fs.mkdirSync(directory, { recursive: true });
  for (const channel of ['color', ...channels]) {
    if (channel !== 'color' && (!passes[channel] || ['position','objectPosition'].includes(channel) || sourceBindings.includes(channel))) continue;
    const native = encode(frame, channel), image = scale === 1 ? native : upscale(native, scale);
    const file = channel + '.png';
    PNG.write(path.join(directory, file), image.w, image.h, image.rgb, image.alpha);
    manifest.files[channel] = file;
  }
  function writeData(channel,ext,bytes) {
    const file = channel + '.' + ext;
    fs.writeFileSync(path.join(directory, file), bytes);
    return file;
  }
  if (proxies.some(channel=>passes[channel])) {
    manifest.proxyData=writePassData(passes,proxies,writeData);
    if (passes.proxyDepth) manifest.proxyDepth=depthRange(passes.proxyDepth);
  }
  if (passes.sourceSurface || passes.sourceSplat) manifest.sourceBindings = {
    ...writePassData(passes,sourceBindings,writeData),surfaceSources:passes.surfaceSources,splatSources:passes.splatSources
  };
  if (passes.strands) manifest.strandData=writeStrandData(passes,writeData);
  if (inkControls.some(channel=>passes[channel])) manifest.inkControls=writePassData(passes,inkControls,writeData);
  if (passes.partId) manifest.partData=writePassData(passes,['partId'],writeData);
  if (['surfaceKind','surfaceCoverage','geometricNormal','shadingNormal','surfaceUV','surfaceUVValid','surfaceMotion','surfaceMotionValid']
      .some(channel=>passes[channel])) manifest.opaqueSurface=writePassData(passes,opaque,writeData);
  fs.writeFileSync(path.join(directory, 'passes.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { encode, labels, depthRange, environmentEncoding, writePasses, writeStrandData };
