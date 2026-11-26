/* Resample a typed image in one pass, retaining its encoding and material contract. */
const TypedImageSpatial = ({ requireImage, validImage, grayDescriptor, descriptor, wrap, storage, pack, integerMax, alphaAt, convertColor, dimensions, fields }) => {
  const maxBytes = 192 * 1024 * 1024;
  const edges = ['clamp', 'wrap', 'mirror', 'transparent'];
  const finite = Number.isFinite;
  const unit = n => Math.max(0, Math.min(1, n));
  const optionsFor = {
    transform: ['units', 'matrix', 'rotation', 'scale', 'offset', 'pivot'],
    crop: ['units', 'rect'],
    symmetry: ['axis', 'side', 'pivot'],
    polar: ['mode', 'center', 'radius', 'rotation'],
    perspective: ['units', 'corners', 'clip']
  };

  function workingSamples(spec, data, channels) {
    const color = spec.intent === 'color';
    const working = color && !spec.colorSpace.endsWith('-linear') ? spec.colorSpace + '-linear' : spec.colorSpace;
    const convert = color && working !== spec.colorSpace;
    const readColor = convert && convertColor(spec, working), encodeColor = convert && ColorSpace.prepare(working,
      { space: spec.colorSpace, outOfRange: spec.domain === 'unit' ? 'clamp' : 'preserve' });
    const max = integerMax(spec.precision) || 1, alpha = spec.alpha !== 'none', count = alpha ? channels - 1 : channels;
    const rgb = new Float64Array(3), encoded = new Float64Array(3);

    function read(i, out, weight) {
      const coverage = readColor ? readColor(data, i, rgb) : alpha ? data[i + count] / max : 1;
      const gain = weight * (spec.alpha === 'premultiplied' && !convert ? 1 : coverage);
      for (let c = 0; c < count; c++) out[c] += gain * (readColor ? rgb[c] : data[i + c] / max);
      if (alpha) out[count] += weight * coverage;
    }

    function write(samples, i, output) {
      const coverage = alpha ? unit(samples[count]) : 1;
      if (alpha) output[i + count] = pack(coverage, spec, true, 'clamp');
      if (alpha && !output[i + count]) return;
      if (encodeColor) {
        const association = spec.alpha === 'premultiplied' ? coverage : 1;
        for (let c = 0; c < 3; c++) rgb[c] = samples[c] / coverage;
        encodeColor(rgb, encoded);
        for (let c = 0; c < 3; c++) {
          // The transfer function maps its unit endpoint to exactly one.
          output[i + c] = pack((rgb[c] >= 1 ? 1 : encoded[c]) * association, spec, false, 'clamp');
        }
      } else {
        const divisor = spec.alpha === 'straight' ? coverage : 1;
        for (let c = 0; c < count; c++) output[i + c] = pack(samples[c] / divisor, spec, false, 'clamp');
      }
    }

    return { read, write };
  }

  function boxLevel(source, width, height, channels) {
    const data = new Float64Array(width * height * channels);
    const sx = source.width / width, sy = source.height / height, sum = new Float64Array(channels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const left = x * sx, right = (x + 1) * sx, top = y * sy, bottom = (y + 1) * sy;
      sum.fill(0);
      for (let j = Math.floor(top); j < Math.min(source.height, Math.ceil(bottom)); j++)
        for (let i = Math.floor(left); i < Math.min(source.width, Math.ceil(right)); i++) {
          const weight = (Math.min(right, i + 1) - Math.max(left, i)) / sx *
            ((Math.min(bottom, j + 1) - Math.max(top, j)) / sy);
          source.accumulate((j * source.width + i) * channels, sum, weight);
        }
      data.set(sum, (y * width + x) * channels);
    }
    return { width, height, accumulate(i, out, weight) {
      for (let c = 0; c < channels; c++) out[c] += data[i + c] * weight;
    } };
  }

  const maxMip = grid => Math.floor(Math.log2(Math.max(grid.width, grid.height)));
  const mipExtent = (grid, index) => ({width:Math.max(1,grid.width >> index),height:Math.max(1,grid.height >> index)});
  const mipBytes = ({width,height},channels) => width * height * channels * Float64Array.BYTES_PER_ELEMENT;

  function mipChain(origin, channels, reserve) {
    const levels = [origin];
    return index => {
      while (levels.length <= index) {
        const extent = mipExtent(origin,levels.length);
        reserve?.(mipBytes(extent,channels));
        levels.push(boxLevel(levels.at(-1),extent.width,extent.height,channels));
      }
      return levels[index];
    };
  }

  function sampler({ width, height, accumulate }, channels, filter, ax, ay) {
    function tap(x, y, weight, out) {
      if (!(weight > 0)) return;
      const u = ax(x, width), v = ay(y, height);
      if (u >= 0 && v >= 0) accumulate((v * width + u) * channels, out, weight, x, y);
    }
    if (filter === 'nearest') return (u, v, weight, out) => tap(Math.floor(u * width), Math.floor(v * height), weight, out);
    return (u, v, weight, out) => {
      const x = u * width - .5, y = v * height - .5;
      const left = Math.floor(x), top = Math.floor(y), s = x - left, t = y - top;
      tap(left, top, weight * (1 - s) * (1 - t), out);
      tap(left + 1, top, weight * s * (1 - t), out);
      tap(left, top + 1, weight * (1 - s) * t, out);
      tap(left + 1, top + 1, weight * s * t, out);
    };
  }

  function borders(border, fallback) {
    if (typeof border !== 'string' && !fields(border, ['u', 'v'])) throw new RangeError('Invalid image border policy');
    const { u = fallback.u, v = fallback.v } = typeof border === 'string' ? { u: border, v: border } : border;
    if (!edges.includes(u) || !edges.includes(v)) throw new RangeError('Unknown image border policy');
    return { u, v };
  }

  const createCache = () => ({ entries:new WeakMap(), bytes:0 });
  function entry(source, cache) {
    if (!source || typeof source !== 'object') return null;
    if (cache.entries.has(source)) return cache.entries.get(source);
    const spec = source.descriptor;
    const type = spec?.intent === 'color' ? 'colorImage' : grayDescriptor(spec) ? 'grayImage' : null;
    const value = type && validImage(source) ? { type } : null;
    cache.entries.set(source,value);
    return value;
  }

  function readersFor(source, type, cache) {
    const { raster:{width,height,data,channels:stride},descriptor:spec } = source;
    const color = type === 'colorImage', channels = color ? 4 : 1;
    const divisor = integerMax(spec.precision) || 1;
    const rgb = [0,0,0], readColor = color && convertColor(spec,'srgb-linear');
    const accumulate = color ? (i,out,weight) => {
      const at = i / channels * stride;
      if (!alphaAt(data,at,spec)) return;
      const weightedAlpha = readColor(data,at,rgb) * weight;
      for (let c = 0; c < 3; c++) out[c] += weightedAlpha * rgb[c];
      out[3] += weightedAlpha;
    } : (i,out,weight)=>{ out[0] += (data[i] / divisor) * weight; };
    const level = mipChain({width,height,accumulate},channels,bytes=>{
      if (cache.bytes + bytes > maxBytes) throw new RangeError('Function texture mips exceed the working memory budget');
      cache.bytes += bytes;
    });
    const readers = new Map();
    return (index,filter,u,v)=>{
      const key = index+'/'+filter+'/'+u+'/'+v;
      if (!readers.has(key))
        readers.set(key,sampler(level(index),channels,filter,TextureAddress.axis(u),TextureAddress.axis(v)));
      return readers.get(key);
    };
  }

  // Bring large UVs back into a range where a texel-scaled coordinate remains meaningful.
  function boundedCoordinate(n, mode) {
    if (mode === 'wrap') return Math.abs(n) <= 2 ? n : n % 1;
    if (mode === 'mirror') return Math.abs(n) <= 2 ? n : n % 2;
    if (mode === 'clamp') return unit(n);
    return Math.max(-1,Math.min(2,n));
  }

  function samplePoint(source, type, uv, options = {}, cache = createCache()) {
    const texture = entry(source,cache);
    if (texture?.type !== type) throw new TypeError('Expected a typed '+(type === 'colorImage' ? 'color' : 'grayscale')+' texture');
    if (!Array.isArray(uv) || uv.length !== 2 || !finite(uv[0]) || !finite(uv[1]))
      throw new TypeError('Function texture sampling needs two finite UV coordinates');
    if (!fields(options,['filter','wrapU','wrapV','mip','mipFilter']))
      throw new TypeError('Unknown function texture sampling option');
    const spec = source.descriptor;
    const { filter:requestedFilter='image',wrapU='image',wrapV='image',mip=0,mipFilter='linear' } = options;
    const filter = requestedFilter === 'image' ? spec.sampling : requestedFilter;
    if (!['nearest','linear'].includes(filter) || !finite(mip) || mip < 0 || !['nearest','linear'].includes(mipFilter))
      throw new RangeError('Invalid function texture filter or mip choice');
    const {u,v} = borders({u:wrapU === 'image' ? undefined : wrapU,v:wrapV === 'image' ? undefined : wrapV},spec.tiling);
    const lod = Math.min(mip,maxMip(source.raster));
    const base = mipFilter === 'nearest' ? Math.round(lod) : Math.floor(lod), mix = mipFilter === 'nearest' ? 0 : lod-base;
    const s = boundedCoordinate(uv[0],u), t = boundedCoordinate(uv[1],v);
    const color = type === 'colorImage', sum = new Float64Array(color ? 4 : 1);
    texture.readers ??= readersFor(source,type,cache);
    texture.readers(base,filter,u,v)(s,t,1-mix,sum);
    if (mix) texture.readers(base+1,filter,u,v)(s,t,mix,sum);
    if (!color) return spec.domain === 'unit' ? unit(sum[0]) : sum[0];
    const alpha = sum[3];
    return alpha ? [sum[0]/alpha,sum[1]/alpha,sum[2]/alpha,unit(alpha)] : [0,0,0,0];
  }

  const textureSampling = Object.freeze({
    createCache,
    valid:(type,source,cache)=>entry(source,cache)?.type === type,
    sampleColor:(source,uv,options,cache)=>samplePoint(source,'colorImage',uv,options,cache),
    sampleGray:(source,uv,options,cache)=>samplePoint(source,'grayImage',uv,options,cache)
  });

  function footprint(map, source, target, unwrapU) {
    const before = new Float64Array(2), after = new Float64Array(2);
    const dx = new Float64Array(2), dy = new Float64Array(2);
    function angularDifference(delta) { return unwrapU ? delta - Math.round(delta) : delta; }
    function derivative(u, v, du, dv, center, result) {
      const a = map(u - du, v - dv, before, false), b = map(u + du, v + dv, after, false);
      const ax = a ? angularDifference(center[0] - before[0]) * source.width : 0;
      const ay = a ? (center[1] - before[1]) * source.height : 0;
      const bx = b ? angularDifference(after[0] - center[0]) * source.width : 0;
      const by = b ? (after[1] - center[1]) * source.height : 0;
      const takeBefore = ax * ax + ay * ay > bx * bx + by * by;
      result[0] = takeBefore ? ax : bx;
      result[1] = takeBefore ? ay : by;
    }
    return (u, v, center) => {
      derivative(u, v, 1 / target.width, 0, center, dx);
      derivative(u, v, 0, 1 / target.height, center, dy);
      const a = dx[0] ** 2 + dx[1] ** 2, b = dy[0] ** 2 + dy[1] ** 2, cross = dx[0] * dy[0] + dx[1] * dy[1];
      return .5 * Math.log2(Math.max(1, (a + b + Math.hypot(a - b, 2 * cross)) * .5));
    };
  }

  // A registered material layer supplies its own sample decoder and coverage lane.
  function mappedSampler(image, lanes, { filter = image.descriptor.sampling, border = {} }, read) {
    if (!['nearest', 'linear'].includes(filter)) throw new RangeError('Invalid material layer filter');
    const { width, height, channels } = image.raster;
    const { u, v } = borders(border, image.descriptor.tiling);
    const reflected = (coordinate, size, mode) => mode === 'mirror' && Math.abs(Math.floor(coordinate / size) % 2) === 1 ? -1 : 1;
    const sample = sampler({ width, height, accumulate(i, out, weight, x, y) {
      read(i / lanes * channels, out, weight, reflected(x, width, u), reflected(y, height, v));
    } }, lanes, filter, TextureAddress.axis(u), TextureAddress.axis(v));
    return (uv, out) => {
      out.fill(0);
      sample(boundedCoordinate(uv[0], u), boundedCoordinate(uv[1], v), 1, out);
      return out;
    };
  }

  function resample(source, options, name, optionKeys, prepare, cropGeometry) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    if (!fields(options, ['width', 'height', 'border', 'filter', 'mip', 'mipBias', ...optionKeys]))
      throw new TypeError('Unknown image ' + name + ' option');
    const { channels, data: original } = grid;
    const crop = cropGeometry?.(grid, options);
    const span = crop ? crop.span : [1, 1];
    const { width = Math.max(1, Math.round(grid.width * span[0])),
      height = Math.max(1, Math.round(grid.height * span[1])),
      filter = spec.sampling, mip = 'none', mipBias = 0, border = {} } = options;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !dimensions({ width, height }))
      throw new RangeError('Image transform extent exceeds the raster budget');
    const [left, top] = crop ? crop.cropOrigin : [0, 0];
    const scale = [grid.width * span[0] / width, grid.height * span[1] / height];
    const pivot = grid.pivot && [(grid.pivot[0] - left * grid.width) / scale[0],
      (grid.pivot[1] - top * grid.height) / scale[1]];
    if (scale.some(n => !(n > 0)) || pivot && !pivot.every(finite)) throw new RangeError('Image crop grid is degenerate');
    const pixelPitchMm = spec.pixelPitchMm?.map((pitch, index) => pitch * scale[index]);
    const target = descriptor(grid, { ...spec, pixelPitchMm });
    const auto = mip === 'nearest' || mip === 'linear', fixed = finite(mip) && mip >= 0;
    if (!['nearest', 'linear'].includes(filter) || !auto && mip !== 'none' && !fixed ||
        !finite(mipBias) || Math.abs(mipBias) > 16 || !auto && mipBias !== 0)
      throw new RangeError('Invalid image filter or mip policy');
    const maxLevel = maxMip(grid);
    const requested = auto ? maxLevel : Math.min(maxLevel, fixed ? mip : 0);
    let bytes = width * height * channels * storage[spec.precision].BYTES_PER_ELEMENT;
    for (let i = 1; i <= Math.ceil(requested); i++) bytes += mipBytes(mipExtent(grid,i),channels);
    if (bytes > maxBytes) throw new RangeError('Image transform exceeds its working memory budget');
    const geometry = crop || prepare(grid, options, { width, height });
    const { maps = [geometry.map], angularU = false, combine = 'average' } = geometry;
    const { u, v } = borders(border, { ...spec.tiling, ...(angularU && { u: 'wrap' }) });
    const ax = TextureAddress.axis(u), ay = TextureAddress.axis(v);
    const lodAt = auto && maxLevel ? maps.map(map => footprint(map, grid, { width, height }, angularU)) : null;
    const { read, write } = workingSamples(spec, original, channels);
    const level = mipChain({width:grid.width,height:grid.height,accumulate:read},channels);
    const readers = [];
    function sampleLevel(index, uv, gain, out) {
      readers[index] ??= sampler(level(index), channels, filter, ax, ay);
      readers[index](uv[0], uv[1], gain, out);
    }

    const data = new storage[spec.precision](width * height * channels);
    const uv = new Float64Array(2), sum = new Float64Array(channels);
    function sample(s, t, path, i = -1) {
      if (!maps[path](s, t, uv)) {
        if (i < 0) sum.fill(0);
        return;
      }
      let lod = lodAt ? Math.max(0, Math.min(maxLevel, lodAt[path](s, t, uv) + mipBias)) : requested;
      // Cancel round-off in an otherwise exact automatic pixel-to-texel footprint.
      if (lodAt && Math.abs(lod - Math.round(lod)) < 1e-10) lod = Math.round(lod);
      const base = mip === 'nearest' ? Math.round(lod) : Math.floor(lod);
      const mix = mip === 'nearest' ? 0 : lod - base;
      if (i >= 0 && filter === 'nearest' && base === 0 && !mix) {
        const sx = ax(Math.floor(uv[0] * grid.width), grid.width), sy = ay(Math.floor(uv[1] * grid.height), grid.height);
        if (sx >= 0 && sy >= 0) {
          const start = (sy * grid.width + sx) * channels;
          for (let c = 0; c < channels; c++) data[i + c] = original[start + c];
        }
      } else {
        sum.fill(0);
        sampleLevel(base, uv, 1 - mix, sum);
        if (mix) sampleLevel(base + 1, uv, mix, sum);
        if (i >= 0) write(sum, i, data);
      }
    }
    const multi = maps.length > 1, combined = new Float64Array(channels);
    const merge = combine === 'min' ? Math.min : combine === 'max' ? Math.max : (a, b) => a + b / maps.length;
    const initial = combine === 'min' ? Infinity : combine === 'max' ? -Infinity : 0;
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i += channels) {
      const s = (x + .5) / width, t = (y + .5) / height;
      if (!multi) sample(s, t, 0, i);
      else {
        combined.fill(initial);
        for (let path = 0; path < maps.length; path++) {
          sample(s, t, path);
          for (let c = 0; c < channels; c++) combined[c] = merge(combined[c], sum[c]);
        }
        write(combined, i, data);
      }
    }
    return wrap({ width, height, channels, data, pivot }, target);
  }

  const spatial = Object.freeze(Object.fromEntries(Object.entries(optionsFor).map(([name, keys]) => [name, (source, options = {}) =>
    resample(source, options, name, keys, TypedImageSpatialGeometry[name],
      name === 'crop' ? TypedImageSpatialGeometry.crop : undefined)])));
  return { spatial, resample, sampler, borders, workingSamples, textureSampling, mappedSampler };
};
