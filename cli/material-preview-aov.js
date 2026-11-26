const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const PNG = require('./png.js');
const AOV = require('../src/material-preview-aov.js');

const writers = { unorm8:'writeUInt8', unorm16:'writeUInt16LE', float32:'writeFloatLE', float64:'writeDoubleLE' };

function publish(bytes, files) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = 'samples/' + sha256 + '.js';
  if (!files.has(file)) {
    const data = deflateSync(bytes, { level:3 }).toString('base64');
    files.set(file, 'InkMaterialSamples.receive("' + sha256 + '","' + data + '");\n');
  }
  return { file, sha256, bytes:bytes.length };
}

function mapSamples({ raster:{ data }, descriptor }, files) {
  const [,size] = AOV.encodings[descriptor.precision];
  const binary = Buffer.alloc(data.length * size), write = writers[descriptor.precision];
  for (let i=0; i<data.length; i++) binary[write](data[i],i*size);
  return { descriptor, samples:publish(binary,files) };
}

function screenSamples(frame, regionById, files, visit) {
  const { w,h,passes } = frame, bytes = Buffer.alloc(w*h*AOV.stride), tallies = new Array(regionById.size).fill(0);
  let near = Infinity, far = -Infinity;
  for (let p=0; p<w*h; p++) {
    const index = regionById.get(passes.materials[passes.materialId[p]]), depth = passes.depth[p];
    if (index === undefined || !passes.surfaceUVValid[p] || !Number.isFinite(depth)) continue;
    const u = passes.surfaceUV[p*2], v = passes.surfaceUV[p*2+1], at = p*AOV.stride;
    bytes[at] = index + 1;
    bytes.writeFloatLE(u,at+1);
    bytes.writeFloatLE(v,at+5);
    bytes.writeFloatLE(depth,at+9);
    bytes.writeFloatLE(passes.surfaceCoverage[p],at+13);
    near = Math.min(near,depth);
    far = Math.max(far,depth);
    tallies[index]++;
    visit(p,index,u,v);
  }
  return { tallies, screen:publish(bytes,files), depthRange:Number.isFinite(near) ? [near,far] : null };
}

function displaySamples(png, files) {
  const {data}=PNG.raster(png);
  return publish(data,files);
}

module.exports = { mapSamples,screenSamples,displaySamples };
