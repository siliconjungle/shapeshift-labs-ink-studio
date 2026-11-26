/* Non-destructive, linear and floating-point painting for graph material packets. */
(function (K) {
  const P = K.procedural, { fields, name, num, tuple, projectors, coverage } = MaterialPaintStrokes;
  const format = 'ink-studio/material-paint', version = 1;
  const maxStrokes = 4096, maxTouched = 1e6, maxWork = 32e6;
  const layerKeys = ['id', 'channel', 'label', 'visible', 'locked', 'opacity', 'blend', 'mask', 'strokes'];
  const strokeKeys = ['space', 'chart', 'samples', 'brush', 'value', 'colorSpace', 'mode', 'opacity',
    'selection', 'symmetry', 'flow', 'velocity', 'speed'];
  const blends = { normal: RasterBlendModes.copy, multiply: RasterBlendModes.multiply,
    screen: RasterBlendModes.screen, overlay: RasterBlendModes.overlay, add: RasterBlendModes.add };
  const integerMax = precision => precision === 'unorm8' ? 255 : precision === 'unorm16' ? 65535 : 0;
  const unit = n => Math.max(0, Math.min(1, n));
  const has = Object.hasOwn;
  const record = P.graphTypes.validator('record');

  function validate(document) {
    if (!fields(document, ['format', 'version', 'layers', 'canvases', 'charts']) || document.format !== format ||
        document.version !== version || !Array.isArray(document.layers) || document.layers.length > 64 ||
        document.canvases !== undefined && !record(document.canvases) || document.charts !== undefined && !record(document.charts))
      throw new TypeError('Expected a version 1 material paint document with up to 64 layers');
    let count = 0;
    const ids = new Set();
    for (const layer of document.layers) {
      if (!fields(layer, layerKeys) || !name(layer.id) || ids.has(layer.id) || !name(layer.channel) ||
          layer.label !== undefined && (typeof layer.label !== 'string' || layer.label.length > 120) ||
          layer.visible !== undefined && typeof layer.visible !== 'boolean' ||
          layer.locked !== undefined && typeof layer.locked !== 'boolean' ||
          !num(layer.opacity ?? 1, 0, 1) || !has(blends, layer.blend ?? 'normal') ||
          layer.mask !== undefined && !name(layer.mask) || !Array.isArray(layer.strokes))
        throw new TypeError('Material paint layers need unique IDs, channels and valid layer settings');
      ids.add(layer.id);
      count += layer.strokes.length;
      if (count > maxStrokes) throw new RangeError('Material paint exceeds its stroke budget');
      for (const stroke of layer.strokes) {
        if (!fields(stroke, strokeKeys) || !['paint', 'erase'].includes(stroke.mode ?? 'paint') ||
            !num(stroke.opacity ?? 1, 0, 1) || stroke.flow !== undefined && !name(stroke.flow) ||
            stroke.speed !== undefined && (stroke.velocity !== 'stroke' || !num(stroke.speed, 0, 1000)))
          throw new TypeError('Invalid material paint stroke');
      }
    }
    for (const [channel, target] of Object.entries(document.canvases ?? {})) {
      if (!name(channel) || !fields(target, ['precision', 'colorSpace']) ||
          target.precision !== undefined && !['unorm8', 'unorm16', 'float32', 'float64'].includes(target.precision) ||
          target.colorSpace !== undefined && !['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'].includes(target.colorSpace))
        throw new TypeError('Material paint canvas settings need an image precision or working color space');
    }
    return document;
  }

  function canvas(channel, image, diagnostics) {
    if (image?.format !== P.graphImages.format)
      throw new TypeError('Material paint needs a typed image for ' + channel + '. Use image.declare.');
    const { raster: grid, descriptor: spec } = image, { width, height, data, channels } = grid;
    const color = spec.intent === 'color', normal = spec.intent === 'normal', flow = channel === 'flow';
    const integer = integerMax(spec.precision), divisor = integer || 1;
    if (flow && integer) throw new TypeError('Material flow painting needs a signed floating-point data canvas');
    const carriesAlpha = spec.alpha !== 'none', size = color || normal ? 3 : channels, premultiplied = spec.alpha === 'premultiplied';
    const linear = color && (spec.colorSpace.endsWith('-linear') ? spec.colorSpace : spec.colorSpace + '-linear');
    const decode = color && ColorSpace.prepare(spec.colorSpace, linear);
    const encode = color && ColorSpace.prepare(linear, spec.colorSpace);
    const signed = normal && spec.normalOrientation === 'directx' ? -1 : 1;
    const pixels = new Map();
    function read(p) {
      const cached = pixels.get(p);
      if (cached) return cached;
      const i = p * channels, a = carriesAlpha ? data[i + size] / divisor : 1;
      const gain = divisor * (premultiplied ? a : 1), value = new Array(size + 1);
      for (let c = 0; c < size; c++) {
        const sample = gain ? data[i + c] / gain : 0;
        value[c] = normal && integer ? (gain ? 2 * sample - 1 : Number(c === 2)) : sample;
      }
      if (decode) decode(value, value);
      if (normal) value[1] *= signed;
      value[size] = a;
      return value;
    }
    function stampValue(stroke) {
      if (stroke.mode === 'erase') return null;
      if (flow && stroke.velocity !== undefined && stroke.value === undefined && stroke.colorSpace === undefined) return null;
      if (stroke.velocity !== undefined || !color && stroke.colorSpace !== undefined)
        throw new TypeError('Brush velocity applies to flow and color interpretation applies to color');
      const value = typeof stroke.value === 'number' ? [stroke.value] : stroke.value;
      const vector = tuple(value, size) || (color || normal) && tuple(value, size + 1);
      const alpha = value?.[size] ?? 1;
      if (!vector || !num(alpha, 0, 1))
        throw new TypeError('Brush value must match the component count of ' + channel);
      let result = value.slice(0, size);
      if (flow && Math.hypot(...result) > 1000) throw new RangeError('Painted flow speed exceeds 1000 UV units per second');
      if (color) {
        const from = stroke.colorSpace ?? spec.colorSpace;
        if (typeof from !== 'string') throw new TypeError('Brush color space needs a color encoding name');
        const transfer = ColorSpace.prepare({ space: from, outOfRange: from.endsWith('-linear') ? 'preserve' : 'error' }, linear);
        result = transfer(result);
      }
      if (normal) {
        if (result.some(n => !num(n, -1, 1)) || Math.hypot(...result) < 1e-9)
          throw new RangeError('Painted normals need a nonzero signed unit vector');
        result = normalize(result);
      }
      if (!color && !normal && !flow && channel !== 'height' && result.some(n => !num(n, 0, 1)))
        throw new RangeError('Painted scalar material controls use values in [0,1]');
      return [...result, alpha];
    }
    function finish() {
      let output, changed = 0, minX = width, minY = height, maxX = -1, maxY = -1;
      const owners = diagnostics && [], clips = diagnostics && [];
      for (const [p, row] of pixels) {
        const i = p * channels, a = row[size];
        const alpha = integer ? Math.round(unit(a) * divisor) : spec.precision === 'float32' ? Math.fround(unit(a)) : unit(a);
        const vector = normal ? normalize(row.slice(0, 3)) : encode ? encode(row) : row;
        const encoded = new Array(channels);
        let clippedLow = Infinity, clippedHigh = -Infinity;
        for (let c = 0; c < size; c++) {
          const value = normal ? vector[c] * (c === 1 ? signed : 1) : vector[c];
          const sample = normal && integer ? (value + 1) / 2 : value;
          const associated = premultiplied ? (alpha ? sample * a : 0) : sample;
          const resolved = spec.domain === 'unit' ? unit(associated) : associated;
          if (diagnostics && Math.abs(resolved - associated) > 1e-7) {
            clippedLow = Math.min(clippedLow, associated);
            clippedHigh = Math.max(clippedHigh, associated);
          }
          encoded[c] = integer ? Math.round(resolved * divisor) : spec.precision === 'float32' ? Math.fround(resolved) : resolved;
          if (!Number.isFinite(encoded[c])) throw new RangeError('Material paint sample exceeds canvas precision in ' + channel);
        }
        if (carriesAlpha) encoded[size] = alpha;
        else if (channels > size) encoded[size] = data[i + size];
        if (diagnostics && row.layer !== undefined && clippedLow !== Infinity)
          clips.push([p, row.layer, clippedLow, clippedHigh]);
        if (encoded.every((n, c) => n === data[i + c])) continue;
        if (diagnostics && row.layer !== undefined) owners.push([p, row.layer]);
        output ??= data.slice();
        output.set(encoded, i);
        const x = p % width, y = Math.floor(p / width);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        changed++;
      }
      return { image: output ? P.graphImages.declare({ ...grid, data: output }, spec) : image, changed,
        dirty: changed ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : null,
        ...(diagnostics && (owners.length || clips.length) && { diagnostic: {
          owners: owners.sort((a, b) => a[0] - b[0]), clips
        } }) };
    }
    return { width, height, size, pixels, read, finish, color, linear, flow, carriesAlpha,
      mirror: flow || normal && spec.normalSpace !== 'world', stampValue, image };
  }

  function normalize(vector) {
    const length = Math.hypot(...vector);
    return length > 1e-12 ? vector.map(n => n / length) : [0, 0, 1];
  }

  function apply(source, document, { masks = {}, charts = {}, flows = {}, diagnostics = false } = {}) {
    if (!P.materialChannels.valid(source)) throw new TypeError('Material paint needs a material channel packet');
    validate(document);
    if (![masks, charts, flows].every(record) || Object.keys(masks).length > 64 ||
        Object.keys(charts).length + Object.keys(document.charts ?? {}).length > 64 || Object.keys(flows).length > 32)
      throw new TypeError('Material paint needs bounded named masks, charts and flow fields');
    for (const [id, image] of Object.entries(masks)) {
      if (!name(id) || !P.graphImages.valid(image, 'mask'))
        throw new TypeError('Graph paint masks need named typed mask images');
    }
    const chartMap = projectors({ ...document.charts, ...charts });
    const flowMap = new Map(Object.entries(flows).map(([id, asset]) => [id, FlowMap.open(asset).planar({ bounds: [0, 0, 1, 1] })]));
    const active = new Map();
    let work = 0, touched = 0;
    function charge(n) {
      if ((work += n) > maxWork) throw new RangeError('Material paint exceeds its preview work budget');
    }
    function load(name) {
      if (!active.has(name)) {
        const input = P.materialChannels.channel(source, name).raster, settings = document.canvases?.[name];
        const image = settings ? P.graphImages.convert(input, {
          intent: input.descriptor?.intent, layout: input.descriptor?.layout, ...settings
        }) : input;
        const value = canvas(name, image, diagnostics);
        active.set(name, { ...value, converted: image !== input });
      }
      return active.get(name);
    }
    for (const name of Object.keys(document.canvases ?? {})) load(name);

    function aligned(image, width, height, label) {
      if (image.width !== width || image.height !== height)
        throw new RangeError(label + ' must match the channel extent');
      return image;
    }

    function layerGate(id, width, height) {
      if (id === undefined) return () => 1;
      if (has(masks, id)) {
        const { data } = aligned(masks[id].raster, width, height, 'Graph paint mask ' + id);
        const scale = integerMax(masks[id].descriptor.precision) || 1;
        return p => unit(data[p] / scale);
      }
      const state = load(id);
      if (state.size !== 1 || !['data', 'mask'].includes(state.image.descriptor.intent) ||
          state.image.descriptor.units !== 'unitless')
        throw new TypeError('Material paint masks need normalized scalar maps');
      aligned(state, width, height, 'Material paint mask ' + id);
      return p => unit(state.read(p)[0]);
    }

    function selection(target, query) {
      if (query === undefined) return;
      const { width, height } = target;
      charge(width * height);
      const display = target.color && ColorSpace.prepare(target.linear, { space: 'srgb', outOfRange: 'clamp' });
      const pack = n => Math.round(unit(n) * 255);
      const read = p => {
        const value = target.read(p), color = display ? display(value) : [value[0], value[0], value[0]];
        return (pack(color[0]) << 24) | (pack(color[1]) << 16) | (pack(color[2]) << 8) | pack(value[target.size]);
      };
      return PixelSelections.mask(width, height, query, read, undefined, rule => {
        if (rule.type !== 'channel' || !rule.channel) throw new TypeError('Use a material channel name for a paint range selection');
        const other = aligned(load(rule.channel), width, height, 'Paint selection channel');
        const lane = rule.component ?? 0;
        if (lane >= other.size) throw new RangeError('Selection component is outside the paint channel layout');
        return p => {
          const n = other.read(p)[lane];
          return n >= rule.range[0] && n <= rule.range[1];
        };
      }, undefined, true);
    }

    const reports = [];
    for (const [index, layer] of document.layers.entries()) {
      try {
        const target = load(layer.channel), { width, height, size, mirror, pixels } = target;
        if (layer.visible === false || layer.opacity === 0 || !layer.strokes.length) continue;
        const gate = layerGate(layer.mask, width, height), plane = new Map();
        for (const stroke of layer.strokes) {
          const opacity = stroke.opacity ?? 1, erase = stroke.mode === 'erase', value = target.stampValue(stroke);
          if (!target.flow && stroke.velocity !== undefined) throw new TypeError('Paint velocity only applies to the flow channel');
          const grid = PixelPaintTools.drawingGrid(width, height, stroke.symmetry, true);
          const selected = selection(target, stroke.selection), dabs = new Map();
          coverage(stroke, grid, chartMap, flowMap, (p, weight, sx, sy, rate) => {
            if (selected && !selected[p]) return;
            const a = weight * opacity * (value?.[size] ?? 1);
            if (!a || (dabs.has(p) && dabs.get(p).a >= a)) return;
            if (!dabs.has(p) && dabs.size >= maxTouched) throw new RangeError('Material paint stroke touches too many texels');
            dabs.set(p, { a, sx, sy, rate });
          }, charge);
          for (const [p, { a, sx, sy, rate }] of dabs) {
            const prev = plane.get(p);
            if (erase && !prev) continue;
            const result = prev ?? new Array(size + 1).fill(0), remain = 1 - a;
            const color = rate ?? value;
            for (let c = 0; c < size; c++) {
              const sign = mirror ? c === 0 ? sx : c === 1 ? sy : 1 : 1;
              result[c] = result[c] * remain + (erase ? 0 : color[c] * sign * a);
            }
            result[size] = result[size] * remain + (erase ? 0 : a);
            if (result[size] > 1e-12) plane.set(p, result);
            else plane.delete(p);
            if (plane.size > maxTouched) throw new RangeError('Material paint layer touches too many texels');
          }
        }
        let changed = 0;
        for (const [p, front] of plane) {
          const alpha = front[size] * (layer.opacity ?? 1) * gate(p);
          if (!alpha) continue;
          const back = target.read(p), b = back[size], out = b + alpha * (1 - b);
          const mix = blends[layer.blend ?? 'normal'], row = new Array(size + 1);
          for (let c = 0; c < size; c++) {
            const f = front[c] / front[size];
            row[c] = (back[c] * b * (1 - alpha) + alpha * (f * (1 - b) + mix(back[c], f) * b)) / out;
          }
          row[size] = target.carriesAlpha ? out : 1;
          if (!pixels.has(p) && ++touched > maxTouched) throw new RangeError('Material paint session touches too many texels');
          if (diagnostics) row.layer = row.some((n, c) => n !== back[c]) ? index : back.layer;
          pixels.set(p, row);
          changed++;
        }
        reports.push({ id: layer.id, channel: layer.channel, strokes: layer.strokes.length, covered: changed });
      } catch (error) {
        if (diagnostics && error instanceof Error && Object.isExtensible(error))
          error.graphMaterialLayer = { id: layer.id, label: layer.label ?? layer.id, channel: layer.channel };
        throw error;
      }
    }
    const maps = {}, report = {}, evidence = {};
    for (const [channel, target] of active) {
      const { image, changed, dirty, diagnostic } = target.finish();
      if (diagnostic) evidence[channel] = diagnostic;
      if (changed || target.converted) maps[channel] = image;
      report[channel] = { changed, dirty, width: target.width, height: target.height, precision: image.descriptor.precision };
    }
    return { value: Object.keys(maps).length ? P.materialChannels.replace(source, maps) : source,
      report: { channels: report, layers: reports, work, ...(diagnostics && Object.keys(evidence).length && {
        diagnostics: { layers: document.layers.map(({ id, label }) => ({ id, label: label ?? id })), channels: evidence }
      }) } };
  }

  function create(source, document = { format, version, layers: [] }, options) {
    const past = [], future = [], limit = 64;
    let saved = P.data.freeze(P.data.clone(document)), result = apply(source, saved, options), revision = 0;
    function commit(next) {
      const prepared = apply(source, next, options);
      past.push(saved);
      if (past.length > limit) past.shift();
      future.length = 0;
      saved = P.data.freeze(next);
      result = prepared;
      revision++;
      return result;
    }
    function edit(id, change) {
      const index = saved.layers.findIndex(layer => layer.id === id);
      if (index < 0) throw new RangeError('Unknown material paint layer ' + id);
      const layers = saved.layers.slice();
      layers[index] = change(layers[index]);
      return commit({ ...saved, layers });
    }
    function travel(from, to) {
      if (!from.length) return false;
      const next = from.at(-1), prepared = apply(source, next, options);
      to.push(saved);
      from.pop();
      saved = next;
      result = prepared;
      revision++;
      return true;
    }
    return Object.freeze({
      addLayer(layer) { return commit({ ...saved, layers: [...saved.layers, { strokes: [], ...P.data.clone(layer) }] }); },
      editLayer(id, patch) {
        if (!fields(patch, ['label', 'visible', 'locked', 'opacity', 'blend', 'mask']))
          throw new TypeError('Invalid material paint layer edit');
        return edit(id, layer => {
          const next = { ...layer, ...P.data.clone(patch) };
          if (patch.mask === null) delete next.mask;
          return next;
        });
      },
      moveLayer(id, index) {
        const from = saved.layers.findIndex(layer => layer.id === id);
        if (from < 0 || !Number.isSafeInteger(index) || index < 0 || index >= saved.layers.length)
          throw new RangeError('Choose an existing layer and a valid stack index');
        const layers = saved.layers.slice();
        layers.splice(index, 0, layers.splice(from, 1)[0]);
        return commit({ ...saved, layers });
      },
      stroke(id, value) {
        return edit(id, layer => {
          if (layer.locked || layer.visible === false)
            throw new RangeError('Material paint layer ' + id + (layer.locked ? ' is locked' : ' is hidden'));
          return { ...layer, strokes: [...layer.strokes, P.data.clone(value)] };
        });
      },
      preview: () => result,
      snapshot: () => P.data.clone(saved),
      undo: () => travel(past, future),
      redo: () => travel(future, past),
      history: () => ({ revision, undo: past.length, redo: future.length })
    });
  }

  const optional = { type: 'record', default: {} };
  const operation = {
    description: 'Apply an editable stroke and layer session to native typed material maps.',
    inputs: { source: 'materialChannels', session: 'record', masks: optional, charts: optional, flows: optional },
    outputs: { value: 'materialChannels', report: 'record' },
    run({ source, session, ...options }, { materialDiagnostics = false } = {}) {
      return apply(source, session, { ...options, diagnostics: materialDiagnostics });
    }
  };
  P.materialPaint = Object.freeze({ format, version, create, apply, operations: Object.freeze({ 'material.paint': operation }) });
})(KIT);
