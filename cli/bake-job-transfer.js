const Grid=require('./uv-bake-grid.js');
const Surface = require('./bake-job-surface.js');
const EXR = require('./texture-exr.js');
const PNG = require('./texture-png.js');
const Address = require('../src/texture-address.js');
const { srgb } = require('./texture-common.js');
const { readTexture } = require('./texture-files.js');
const bake = require('./glb-bake.js');
const { tileKey, tileLabel } = require('./material-preview-geometry.js');

const name = 'texture-transfer';
const supported = ['pigment', 'opacity', 'roughness', 'metalness', 'emission', name];
const linkedFields = ['textureInput','sourceUV','sourceChannel','sourceAlpha','sourcePrecision','sourceColorSpace','filter','address'];
const policies = ['alphaPolicy','alphaCutoff'];
const colorMap = map => ['pigment','emission'].includes(map);
const withAlpha = map => colorMap(map) || map === 'opacity';
const fields = map => supported.includes(map) ?
  ['encoding', ...linkedFields, ...(withAlpha(map) ? policies : [])] : [];
const clamp = n => Math.max(0,Math.min(1,n));
const toLinear = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const toSrgb = n => n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055;
const precisions = ['native','unorm8','unorm16','float16','float32'];
const alphaModes = ['auto','straight','premultiplied'];
const alphaPolicies = ['preserve','ignore','cutout'];

function settings(map, options) {
  if (!fields(map).some(key => Object.hasOwn(options,key))) return {};
  const {
    textureInput, encoding = textureInput ? 'png16' : 'png8',
    sourceUV = 0, sourceChannel = map === 'opacity' ? 'a' : 'r',
    sourceAlpha = 'auto', sourcePrecision = 'native', sourceColorSpace = 'auto',
    filter = 'linear', address = 'clamp', alphaPolicy = 'preserve', alphaCutoff
  } = options;
  if (!Surface.encodings.includes(encoding) ||
      (textureInput === undefined ? linkedFields.some(key => Object.hasOwn(options,key)) || map === name :
        typeof textureInput !== 'string' || !textureInput.length) ||
      !Number.isInteger(sourceUV) || sourceUV < 0 || sourceUV > 31 ||
      !['r','g','b','a'].includes(sourceChannel) || colorMap(map) && options.sourceChannel !== undefined ||
      !['auto','srgb','srgb-linear'].includes(sourceColorSpace) || !colorMap(map) && options.sourceColorSpace !== undefined ||
      !alphaModes.includes(sourceAlpha) || !colorMap(map) && options.sourceAlpha !== undefined ||
      !precisions.includes(sourcePrecision) || !['nearest','linear'].includes(filter) ||
      !['clamp','wrap','mirror'].includes(address) || !alphaPolicies.includes(alphaPolicy) ||
      (alphaCutoff !== undefined && (alphaPolicy !== 'cutout' || !Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1)))
    throw new RangeError('Texture transfer needs compatible source, alpha, channel, precision and encoding settings');
  return { encoding, transfer: {
    ...(textureInput && { textureInput, sourceUV, sourcePrecision, filter, address,
      ...(colorMap(map) ? { sourceAlpha, sourceColorSpace } : { sourceChannel }) }),
    ...(withAlpha(map) && { alphaPolicy, ...(alphaPolicy === 'cutout' && { alphaCutoff: alphaCutoff ?? .5 }) })
  } };
}

function policy(value, config) {
  if (config.alphaPolicy === 'ignore') return 1;
  if (config.alphaPolicy === 'cutout') return Number(value >= config.alphaCutoff);
  return value;
}

function inputs(library, onInput) {
  const readers = new Map();
  let cachedPixels = 0;
  function load(file, config, isColor, isOpacity) {
    const key = JSON.stringify([file,config,isColor,isOpacity]);
    if (readers.has(key)) return readers.get(key);
    onInput(file);
    const raw = readTexture(file);
    const { data, width, height, channels, bitDepth, alpha, encoding } = raw, pixels = width * height;
    if (pixels > 4e6) throw new RangeError('Texture transfer inputs are limited to four million texels per file');
    const precision = (encoding === 'exr' || data instanceof Float32Array ? 'float' : 'unorm') + bitDepth;
    if (config.sourcePrecision !== 'native' && config.sourcePrecision !== precision)
      throw new RangeError('Texture input ' + config.textureInput + ' is ' + precision + ' and the map expects ' + config.sourcePrecision);
    const maximum = data instanceof Uint16Array ? 65535 : data instanceof Uint8Array ? 255 : 1;
    const space = config.sourceColorSpace === 'auto' ?
      (raw.colorSpace ?? (encoding === 'exr' || maximum === 1 ? 'srgb-linear' : 'srgb')) : config.sourceColorSpace;
    const profile = raw.profile ?? {};
    const otherPrimaries = profile.chromaticities?.some((n,i)=>Math.abs(n-srgb[i])>1e-4);
    const ambiguousProfile = config.sourceColorSpace === 'auto' &&
      (profile.icc || otherPrimaries || profile.gamma && !profile.srgb && Math.abs(profile.gamma-1)>1e-4 &&
        Math.abs(profile.gamma-.45455)>1e-4);
    if (isColor && (ambiguousProfile || !['srgb','srgb-linear'].includes(space)))
      throw new RangeError('Convert texture input ' + config.textureInput + ' to sRGB primaries or assign its source color space');
    const association = config.sourceAlpha === 'auto' ? alpha : config.sourceAlpha;
    const alphaLane = alpha === 'none' ? -1 : channels - 1, colorLanes = channels - Number(alphaLane >= 0);
    const scalarLane = 'rgb'.indexOf(config.sourceChannel);
    if (isColor ? colorLanes === 2 : colorLanes > 1 && scalarLane >= colorLanes)
      throw new RangeError('Texture input '+config.textureInput+' lacks the requested channels');
    const packed = new Float32Array(pixels * 4);
    const encoded = (i,lane) => data[i*channels+lane]/maximum;
    for (let i = 0; i < pixels; i++) {
      const at = i * 4;
      const a = alphaLane < 0 ? 1 : encoded(i,alphaLane);
      if ((isColor || config.sourceChannel === 'a') && (!Number.isFinite(a) || a < 0 || a > 1))
        throw new RangeError('Texture alpha needs samples in [0, 1]');
      if (isColor) {
        const disregard = config.alphaPolicy === 'ignore';
        const gain = disregard ? (association === 'premultiplied' ? a > 0 ? 1 / a : 0 : 1) :
          association === 'premultiplied' ? Number(a > 0) : a;
        for (let k = 0; k < 3; k++) {
          const value = encoded(i,colorLanes === 1 ? 0 : k);
          packed[at+k] = (space === 'srgb' ? toLinear(value) : value) * gain;
        }
        packed[at+3] = disregard ? 1 : a;
      } else {
        const value = scalarLane < 0 ? a : encoded(i,colorLanes === 1 ? 0 : scalarLane);
        if (isOpacity && (!Number.isFinite(value) || value < 0 || value > 1))
          throw new RangeError('Opacity input needs samples in [0, 1]');
        packed[at] = value;
      }
    }
    const sample = Address.sampler(packed,width,height,Address.settings({filter:config.filter,edge:config.address}));
    const reader = { sample, precision, ...(isColor && { space, association: alphaLane < 0 ? 'none' : association }) };
    while (readers.size && (readers.size >= 8 || cachedPixels + pixels > 8e6)) {
      const oldest = readers.keys().next().value;
      cachedPixels -= readers.get(oldest).pixels;
      readers.delete(oldest);
    }
    readers.set(key,{...reader,pixels});
    cachedPixels += pixels;
    return reader;
  }
  return (config,map) => {
    const source = library.get(config.textureInput);
    const sampled = new Map(), buffer = [0,0,0,0], color = colorMap(map);
    let activeKey, sample;
    return {
      sample(u,v) {
        const tile = source.tiles && [Math.floor(u),Math.floor(v)];
        const key = tile ? tileKey(tile) : 'single';
        if (activeKey!==key) {
          const file = source.file ?? source.tiles.get(key);
          if (!file) throw new RangeError('Texture input ' + config.textureInput + ' has no source tile ' + tileLabel(tile));
          const {sample:read,precision,space,association} = load(file,config,color,map==='opacity');
          sampled.set(key,{precision,space,association});
          activeKey=key;
          sample=read;
        }
        sample(tile ? u-tile[0] : u,tile ? v-tile[1] : v,buffer);
        if (color) {
          const a = buffer[3], gain = a > 0 ? 1 / a : 0;
          for (let c = 0; c < 3; c++) buffer[c] *= gain;
          buffer[3] = policy(a,config);
        } else if (map === 'opacity') buffer[0] = policy(buffer[0],config);
        return buffer;
      },
      report: () => ({
        input: config.textureInput, uvSet: config.sourceUV, filter: config.filter, address: config.address,
        sources: [...sampled.entries()].map(([tile,{precision,space,association}]) =>
          ({ tile, precision, ...(space && { colorSpace: space, alpha: association }) }))
      })
    };
  };
}

function capture(task, linked) {
  const {map,settings} = task, {transfer}=settings, size=Grid.rasterGrid(settings), color = colorMap(map);
  const count = Grid.count(size), channels = color ? 4 : 1;
  const data = new Float32Array(count * channels);
  const reader = transfer.textureInput && linked(transfer,map);
  return {
    data, channels,
    forFace(row) {
      if (!reader) return;
      const corners = row.charts[transfer.sourceUV];
      if (!corners) throw new RangeError('Texture input ' + transfer.textureInput + ' needs TEXCOORD_' + transfer.sourceUV +
        ' on submesh '+row.i);
      const [a,b,c] = corners;
      return (point,pixel) => {
        const [,w1,w2] = row.weights(point);
        const result = reader.sample(a[0]+w1*(b[0]-a[0])+w2*(c[0]-a[0]),a[1]+w1*(b[1]-a[1])+w2*(c[1]-a[1]));
        for (let k = 0; k < channels; k++) data[pixel*channels+k] = result[k];
      };
    },
    material(material,pixel) {
      if (reader) return;
      if (color) {
        const rgb = map === 'pigment' ? material.color : material.emission;
        data.set(rgb,pixel*4);
        data[pixel*4+3] = policy(material.opacity,transfer);
      } else {
        data[pixel] = map === 'opacity' ? policy(material.opacity,transfer) :
          map === 'roughness' ? material.roughness : material.metallic;
      }
    },
    copy(from,to) {
      for (let k = 0; k < channels; k++) data[to*channels+k] = data[from*channels+k];
    },
    report() {
      return { ...(reader ? reader.report() : { input: 'material', sources: [] }),
        ...(transfer.sourceChannel && { channel: transfer.sourceChannel }),
        ...(withAlpha(map) && { alphaPolicy: transfer.alphaPolicy,
          ...(transfer.alphaCutoff !== undefined && { alphaCutoff: transfer.alphaCutoff }) }) };
    }
  };
}

function deliver(task, target, raster) {
  const {map,settings} = task, size=Grid.rasterGrid(settings), {encoding}=settings;
  const color = colorMap(map), alpha = color ? 'straight' : 'none', { data, channels } = target;
  const output = { kind: 'texture-transfer', intent: color ? 'color' : map === name ? 'data' : 'mask',
    encoding, bitDepth: Surface.depth(encoding),
    ...(color && { colorSpace: encoding === 'exr' ? 'srgb-linear' : 'srgb', alpha }) };
  let clipped = 0, min=Infinity, max=-Infinity;
  const pixels = (type,maximum) => type.from(data,(value,i) => {
    const n = color && i%channels<3 ? toSrgb(value) : value;
    const view = map===name && encoding==='exr' && (min<0||max>1) ?
      raster.owners[i] ? (max===min?.5:(n-min)/(max-min)) : 0 : n;
    return Math.round(clamp(view)*maximum);
  });
  for (const [i,value] of data.entries()) {
    if (!Number.isFinite(value)) throw new RangeError('Texture transfer samples exceed float32 precision');
    if (raster.owners[Math.floor(i/channels)]) {
      if (encoding !== 'exr' && (value < 0 || value > 1)) clipped++;
      if(map===name) { min=Math.min(min,value); max=Math.max(max,value); }
    }
    if (output.intent === 'mask' && (value < 0 || value > 1)) throw new RangeError('Material mask needs [0, 1] data');
  }
  function png(depth) {
    const data = depth===16 ? pixels(Uint16Array,65535) : pixels(Uint8Array,255);
    return PNG.write({...Grid.dimensions(size),channels,data,alpha},color ? {srgb:0} : undefined);
  }
  const report = { ...target.report(), clipped, ...(min!==Infinity&&{range:[min,max]}) };
  const info = { output, textureTransfer: report, texels: raster.sampledTexels, coverage: raster.coverage,
    ...(raster.cageBake && !task.settings.transfer.textureInput && { projection: raster.cageBake }) };
  if (encoding !== 'exr') return { ...info, bytes: png(output.bitDepth) };
  const keys = color ? ['R','G','B','A'] : ['Y'];
  const planes = Object.fromEntries(keys.map((key,c)=>[key,Float32Array.from({length:Grid.count(size)},(_,i)=>data[i*channels+c])]));
  return { ...info, bytes: EXR.write({...Grid.dimensions(size),planes,alpha}), preview: png(8) };
}

function render(tasks, library, onInput, K) {
  const linked = inputs(library,onInput), groups = new Map(), byTask = new Map();
  for (const task of tasks) {
    if (!task.settings.transfer) continue;
    const {authored,tile,settings} = task, size=Grid.rasterGrid(settings), {padding}=settings;
    const key = JSON.stringify([authored.id,tile.tile,size,padding]);
    if (!groups.has(key)) groups.set(key,{ tasks: [] });
    const group = groups.get(key);
    group.tasks.push(task);
    byTask.set(task,group);
  }
  return task => {
    const group = byTask.get(task);
    if (!group.rows) {
      const { selection,tile,cast,settings } = task, size=Grid.rasterGrid(settings), {padding}=settings;
      group.rows = new Map(group.tasks.map(member=>[member,capture(member,linked)]));
      const channels = [...group.rows.values()];
      const native = group.tasks.filter(member=>!member.settings.transfer.textureInput).map(member=>group.rows.get(member));
      const visibility = {
        forFace(f) {
          const row=selection.metadata[tile.source[f]];
          const samples = channels.map(channel=>channel.forFace(row)).filter(Boolean);
          return (point,_normal,pixel)=>{for(const sample of samples)sample(point,pixel);};
        },
        ...(native.length&&{material:(material,pixel)=>{for(const target of native)target.material(material,pixel);}}),
        copy(from,to) { for (const channel of channels) channel.copy(from,to); }
      };
      const cage = native.length ? cast?.(tile,size) : undefined;
      const {owners,sampledTexels,coverage,cageBake} = bake(tile.mesh,tile.faces,tile.uvs,tile.normals,size,padding,K,
        {registered:true,sourceFaces:tile.source,chartBake:{state:{faceCharts:tile.faces.map(()=>0)},visibility,cage}});
      group.raster={owners,sampledTexels,coverage,cageBake};
    }
    const result=deliver(task,group.rows.get(task),group.raster);
    group.rows.delete(task);
    if (!group.rows.size) delete group.raster;
    return result;
  };
}

module.exports = { name, fields, settings, render };
