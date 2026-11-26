/* Composite typed material maps in UV space while retaining each destination grid. */
const TypedMaterialLayering = ({ fields, record, valid, validGray, descriptor, wrap, storage, pack, integerMax,
  convertColor, mappedSampler, borders, normals }) => {
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const clamp = n => Math.min(1, Math.max(0, n));
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const flat = [0, 0, 1];
  const normalSpace = spec => spec.normalSpace ?? 'tangent';
  const unitChannel = name => !['baseColor', 'emission', 'height', 'normal', 'flow'].includes(name);
  const neutral = name => ['roughness', 'ao', 'opacity'].includes(name) ? 1 : 0;

  function settings(options) {
    if (!fields(options, ['opacity', 'defaultMode', 'channels', 'transform', 'maskSpace', 'height']))
      throw new TypeError('Unknown material layer option');
    const { opacity = 1, defaultMode = 'blend', channels = {}, transform = {}, maskSpace = 'layer', height = null } = options;
    if (!unit(opacity) || !['blend', 'keep'].includes(defaultMode) || !['layer', 'base'].includes(maskSpace) ||
        !record(channels) ||
        !fields(transform, ['matrix', 'rotation', 'scale', 'offset', 'pivot', 'filter', 'border']))
      throw new TypeError('Invalid material layer opacity, channel rules, mask space or UV transform');
    const { filter, border, ...affine } = transform;
    if (filter !== undefined && !['linear', 'nearest'].includes(filter))
      throw new RangeError('Material layer filter must be nearest or linear');
    if (border !== undefined) borders(border, { u: 'clamp', v: 'clamp' });
    const geometry = TypedImageSpatialGeometry.transform({ width: 1, height: 1 }, { ...affine, units: 'normalized' });
    const [a, b, c, d] = geometry.linear, determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || !determinant) throw new RangeError('Degenerate material UV transform');
    return { opacity, defaultMode, channels, maskSpace, sampling: { filter, border }, geometry,
      inverse: [d / determinant, -b / determinant, -c / determinant, a / determinant], height };
  }

  function typed(image, name) {
    if (!valid(image)) throw new TypeError('Material layer map ' + name + ' needs a typed image. Use image.declare.');
    return image;
  }

  function ruleFor(name, overrides, fallback, space) {
    if (!fields(overrides, ['mode', 'opacity'])) throw new TypeError('Invalid material rule for ' + name);
    const normal = name === 'normal';
    const { mode = fallback === 'keep' ? 'keep' : normal ? space === 'world' ? 'lerp' : 'rnm' : 'copy',
      opacity = 1 } = overrides;
    const validMode = normal ? ['rnm', 'whiteout', 'lerp'].includes(mode) && (space !== 'world' || mode === 'lerp') :
      Object.hasOwn(RasterBlendModes, mode);
    if (mode !== 'keep' && !validMode || !unit(opacity)) throw new RangeError('Invalid material blend mode or opacity for ' + name);
    return { mode, opacity };
  }

  function values(image, name, space) {
    const { descriptor: spec, raster: { channels, data } } = image;
    if (spec.intent === 'color') return convertColor(spec, space);
    if (name === 'normal') {
      const read = normals.reader(image);
      return (data, i, out) => {
        const alpha = read(i / channels, out);
        return spec.alpha === 'none' ? 1 : alpha;
      };
    }
    const divisor = integerMax(spec.precision) || 1;
    if ((unitChannel(name) || name === 'flow') && (spec.units !== 'unitless' || spec.alpha !== 'none') ||
        name === 'flow' && integerMax(spec.precision))
      throw new TypeError('Material layer ' + name + ' needs unitless data with the expected encoding');
    return (_data, i, out) => {
      for (let c = 0; c < channels; c++) {
        const n = data[i + c] / divisor;
        if (unitChannel(name) && !unit(n)) throw new RangeError('Material layer ' + name + ' samples must be in [0, 1]');
        out[c] = n;
      }
      return 1;
    };
  }

  function sampleLayer(image, name, space, sampling) {
    const color = image.descriptor.intent === 'color', normal = name === 'normal';
    const signedXY = name === 'flow' || normal && image.descriptor.normalSpace !== 'world';
    const axes = color || normal ? 3 : image.raster.channels;
    const read = values(image, name, space), decoded = new Float64Array(axes);
    const data = image.raster.data;
    const sample = mappedSampler(image, axes + 2, sampling, (i, sum, weight, mirrorU, mirrorV) => {
      const coverage = weight * read(data, i, decoded);
      if (signedXY) {
        decoded[0] *= mirrorU;
        decoded[1] *= mirrorV;
      }
      for (let c = 0; c < axes; c++) sum[c] += decoded[c] * coverage;
      sum[axes] += coverage;
      sum[axes + 1] += weight;
    });
    const out = new Float64Array(axes + 2);
    return uv => {
      sample(uv, out);
      if (out[axes]) for (let c = 0; c < axes; c++) out[c] /= out[axes];
      return out;
    };
  }

  function heightGate(options, base, layer, sampling) {
    if (options === null) return null;
    if (!fields(options, ['bias', 'offset', 'softness'])) throw new TypeError('Unknown material height option');
    const { bias = 0, offset = 0, softness = 0 } = options;
    if (![bias, offset, softness].every(Number.isFinite) || softness < 0)
      throw new RangeError('Material height needs finite bias and offset and nonnegative softness');
    const back = typed(base.height?.raster, 'base height');
    const front = typed(layer.height?.raster, 'layer height');
    if (back.descriptor.units !== front.descriptor.units) throw new TypeError('Material heights must use matching units');
    const below = sampleLayer(back, 'height', null, { border: 'clamp' });
    const above = sampleLayer(front, 'height', null, sampling);
    return { offset, weight(uv, sourceUV) {
      const high = above(sourceUV);
      if (!high[1]) return 0;
      const difference = high[0] + offset - below(uv)[0] + bias;
      if (!Number.isFinite(difference)) throw new RangeError('Material height difference exceeds its numeric range');
      return RasterHeightWeight(difference, softness);
    } };
  }

  function composite(name, back, front, rule, settings, mask, height) {
    const reference = back ?? front, { raster: grid, descriptor: from } = reference;
    const { width, height: rows } = grid, normal = name === 'normal', color = from.intent === 'color';
    const frontSpec = front.descriptor;
    if (from.units !== frontSpec.units || normal && normalSpace(from) !== normalSpace(frontSpec))
      throw new TypeError('Material layer ' + name + ' needs matching units or normal space');
    const coverage = color || normal;
    const spec = descriptor(grid, from), { alpha } = spec;
    const stride = grid.channels, axes = coverage ? 3 : stride;
    const linear = color && (from.colorSpace.endsWith('-linear') ? from.colorSpace : from.colorSpace + '-linear');
    const encodeColor = color && ColorSpace.prepare(linear, spec.colorSpace);
    const read = back && values(back, name, linear);
    const sample = sampleLayer(front, name, linear, settings.sampling);
    const data = new storage[spec.precision](grid.data.length);
    const uv = new Float64Array(2), sourceUV = new Float64Array(2), previous = new Float64Array(axes), rgb = [0, 0, 0];
    const [a, b, c, d] = settings.inverse, [f, g, h, j] = settings.geometry.linear;
    const mode = RasterBlendModes[rule.mode], rgba = alpha !== 'none';
    const neutralValue = neutral(name);
    for (let y = 0, p = 0; y < rows; y++) for (let x = 0; x < width; x++, p++) {
      const i = p * stride;
      uv[0] = (x + .5) / width;
      uv[1] = (y + .5) / rows;
      let strength = 0, layer;
      if (settings.geometry.map(uv[0], uv[1], sourceUV)) {
        layer = sample(sourceUV);
        if (layer[axes]) {
          let gate = 1;
          if (mask) {
            const inLayer = settings.maskSpace === 'layer';
            const [amount, , bounds] = mask(inLayer ? sourceUV : uv);
            gate = clamp(amount) * (inLayer ? Math.min(1, bounds / layer[axes + 1]) : clamp(bounds));
          }
          strength = clamp(layer[axes]) * gate * settings.opacity * rule.opacity;
          if (strength && height) strength *= height.weight(uv, sourceUV);
        }
      }
      if (!strength && back) {
        for (let k = 0; k < stride; k++) data[i + k] = grid.data[i + k];
        continue;
      }

      const oldAlpha = read ? read(grid.data, i, previous) : rgba ? 0 : 1;
      if (!read) previous.fill(neutralValue);
      const outAlpha = oldAlpha + strength * (1 - oldAlpha);
      if (normal) {
        const basis = read && oldAlpha ? previous : flat;
        if (strength && normalSpace(spec) === 'tangent') {
          const nx = layer[0], ny = layer[1];
          layer[0] = a * nx - c * ny;
          layer[1] = -b * nx + d * ny;
        }
        const direction = strength ? normals.mixVectors(basis, layer, rule.mode, outAlpha ? strength / outAlpha : 0) : flat;
        const fourth = rgba ? outAlpha : stride === 4 && back ? grid.data[i + 3] / (integerMax(spec.precision) || 1) : 1;
        normals.encode(spec, data, p, direction, fourth);
      } else if (color) {
        for (let k = 0; k < 3; k++) {
          const value = strength ? layer[k] : 0;
          const blended = strength && oldAlpha ? mode(previous[k], value) : value;
          const target = spec.domain === 'unit' && strength ? clamp(blended) : blended;
          rgb[k] = !outAlpha ? 0 : (previous[k] * oldAlpha * (1 - strength) +
            strength * (value * (1 - oldAlpha) + target * oldAlpha)) / outAlpha;
        }
        encodeColor(rgb, rgb);
        if (rgba) data[i + 3] = pack(outAlpha, spec, true, 'clamp');
        const gain = alpha === 'premultiplied' ? data[i + 3] ? outAlpha : 0 : 1;
        for (let k = 0; k < 3; k++) data[i + k] = pack(gain ? rgb[k] * gain : 0, spec, false, 'clamp');
      } else {
        if (strength && name === 'flow') {
          const u = layer[0], v = layer[1];
          layer[0] = f * u + g * v;
          layer[1] = h * u + j * v;
        }
        for (let k = 0; k < axes; k++) {
          const old = previous[k];
          const value = strength ? mode(old, layer[k] + (name === 'height' ? height?.offset ?? 0 : 0)) : old;
          const next = strength ? mix(old, unitChannel(name) ? clamp(value) : value, strength) : old;
          data[i + k] = pack(next, spec, false, 'error');
        }
      }
    }
    return wrap({ ...grid, data }, spec);
  }

  return (base, layer, options, mask) => {
    const config = settings(options);
    for (const name of Object.keys(config.channels)) {
      if (!Object.hasOwn(layer, name) && !Object.hasOwn(base, name))
        throw new RangeError('Material rule names an unknown map ' + name);
    }
    let sampleMask = null;
    if (mask !== null) {
      if (!validGray(mask) || mask.descriptor.alpha !== 'none')
        throw new TypeError('Material layer mask needs a typed unitless grayscale image');
      sampleMask = sampleLayer(mask, 'mask.layer', null, config.maskSpace === 'layer' ? config.sampling : {});
    }
    const gate = heightGate(config.height, base, layer, config.sampling);
    const maps = {}, metadata = {};
    for (const [name, row] of Object.entries(layer)) {
      const primary = base[name]?.raster;
      const normalSpace = (primary ?? row.raster).descriptor?.normalSpace;
      const explicit = Object.hasOwn(config.channels, name);
      const rule = ruleFor(name, explicit ? config.channels[name] : {}, explicit ? 'blend' : config.defaultMode, normalSpace);
      if (!config.opacity || !rule.opacity || rule.mode === 'keep') continue;
      if (base[name]?.metadata.texCoord !== undefined && row.metadata.texCoord !== undefined &&
          base[name].metadata.texCoord !== row.metadata.texCoord)
        throw new TypeError('Material layer map ' + name + ' uses different UV sets');
      const back = primary && typed(primary, name);
      const front = typed(row.raster, name);
      maps[name] = composite(name, back, front, rule, config, sampleMask, gate);
      if (!back) metadata[name] = row.metadata;
    }
    // Validate explicit rules for base-only channels even though no foreground can modify those maps.
    for (const name of Object.keys(config.channels)) if (!Object.hasOwn(layer, name))
      ruleFor(name, config.channels[name], 'blend', base[name].raster.descriptor?.normalSpace);
    return { maps, metadata };
  };
};
