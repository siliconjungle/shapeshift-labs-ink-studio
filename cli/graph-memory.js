/* Follow raster shapes through compiled graph bindings without evaluating nodes. */
const rasterKind = Symbol('estimated raster');
const integer = n => Number.isSafeInteger(n) && n > 0;
const own = Object.hasOwn;

function raster(width, height, channels = 4, sampleBytes = 1, bounds = false) {
  if (!integer(width) || !integer(height) || !integer(channels) || !integer(sampleBytes)) return;
  const bytes = width * height * channels * sampleBytes;
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Estimated raster size exceeds the integer range');
  return { [rasterKind]: true, width, height, channels, sampleBytes, bytes, ...(bounds && { bounds: true }) };
}

function estimateGraphMemory({ graph, groups, assets, overrides, kit, hostOperations }) {
  const { pixelEffects, raster: api } = kit.KIT.procedural;
  const nodes = [], unresolved = [], literals = new WeakMap(), buffers = new Set();
  const external = new Map(), custom = new Set(hostOperations);
  let retained = 0, peak = 0, upperBound = false;
  const reserve = bytes => { retained += bytes; peak = Math.max(peak, retained); };

  function input(value) {
    if (!value || typeof value !== 'object') return value;
    if (literals.has(value)) return literals.get(value);
    if (integer(value.width) && integer(value.height) && (Array.isArray(value.data) || ArrayBuffer.isView(value.data))) {
      const { width, height, data } = value, count = value.channels ?? data.length / (width * height);
      const info = raster(width, height, count, data.BYTES_PER_ELEMENT ?? 8);
      if (info) {
        const key = data.buffer ?? data;
        if (!buffers.has(key)) reserve(data.buffer?.byteLength ?? info.bytes);
        buffers.add(key);
        literals.set(value, info);
        return info;
      }
    }
    if (ArrayBuffer.isView(value)) return undefined;
    const copy = Array.isArray(value) ? [] : Object.create(null);
    literals.set(value, copy);
    for (const [name, child] of Object.entries(value)) copy[name] = input(child);
    return copy;
  }

  for (const [name, { format, value, type }] of assets) {
    if (format === 'indexed-png') {
      const index = raster(value.value.width, value.value.height, 1);
      const alpha = raster(index.width, index.height, 1);
      external.set(name, { value: index, alpha });
      reserve(index.bytes + alpha.bytes);
    } else if (type === 'raster') {
      const info = raster(value.width, value.height, value.channels ?? 4, value.data?.BYTES_PER_ELEMENT ?? 1);
      external.set(name, { value: info });
      if (info) reserve(info.bytes);
    }
  }

  function ordered(scope) { return scope.order.map(id => scope.nodes[id]); }
  // Literal and input rasters already exist when graph evaluation starts.
  for (const scope of [graph, ...Object.values(groups)]) {
    for (const setting of Object.values(scope.inputs)) input(setting.default);
    for (const node of ordered(scope)) for (const { source } of Object.values(node.inputs))
      if (source.kind === 'value') input(source.value);
    for (const source of Object.values(scope.outputs)) if (source.kind === 'value') input(source.value);
  }
  const parameters = Object.fromEntries(Object.entries(graph.inputs).map(([name, setting]) =>
    [name, input(own(overrides, name) ? overrides[name] : setting.default)]));
  const initialBytes = retained;

  function image(value, scratchBytes = 0) {
    return value ? { outputs: { value }, resultBytes: value.bytes, scratchBytes } : undefined;
  }

  function operation(op, args) {
    const { source, width, height, options } = args;
    switch (op) {
      case 'add': case 'multiply': case 'lessThan': {
        const { a, b } = args;
        const value = Number.isFinite(a) && Number.isFinite(b) ? op === 'add' ? a + b : op === 'multiply' ? a * b : a < b : undefined;
        return { outputs: { value } };
      }
      case 'time': case 'random': return { outputs: {} };
      case 'data.typed': return { outputs: { value: args.value } };
      case 'data.record': return { outputs: { value: args } };
      case 'data.get': return { outputs: { value: args.record?.[args.key] } };
      case 'data.collect':
        return { outputs: { value: Array.isArray(args.keys) ? args.keys.map(key => args.source?.[key]) : undefined } };
      case 'pngAsset': case 'rasterAsset': case 'indexedPngAsset': {
        const outputs = external.get(args.name);
        return outputs && { outputs };
      }
      case 'raster.canvas': return image(raster(width, height));
      case 'draw.render': {
        const value = raster(width, height);
        return value && image(value, width * height * 20 + width * 4);
      }
      case 'raster.stack': case 'raster.depth': case 'raster.height': {
        const value = raster(width, height);
        if (!value) return;
        if (op === 'raster.stack') return image(value, 32);
        const level = raster(width, height, 1, 8);
        return { outputs: { value, [op.slice(7)]: level }, resultBytes: value.bytes + level.bytes, scratchBytes: 32 };
      }
      case 'raster.rgba': case 'raster.channel': case 'color.rasterToLinear': case 'color.rasterToDisplay':
      case 'raster.crop': case 'raster.resize': {
        if (!source?.[rasterKind]) return;
        const resize = op === 'raster.crop' || op === 'raster.resize';
        if (resize && !options) return;
        const channels = op === 'raster.rgba' ? 4 : op === 'raster.channel' ? 1 : source.channels;
        const sampleBytes = op === 'raster.channel' ? 8 : op === 'color.rasterToLinear' ? 4 :
          resize && source.sampleBytes !== 1 ? 8 : 1;
        const shape = raster(resize ? options.width : source.width, resize ? options.height : source.height, channels,
          sampleBytes, source.bounds && !resize);
        return image(shape, op === 'raster.crop' && shape ? shape.width * channels * source.sampleBytes : 0);
      }
      case 'fx.kernelBlur': case 'fx.pathBlur': {
        if (!source?.[rasterKind] || source.bounds || !options || op === 'fx.pathBlur' && !args.path) return;
        const plan = op === 'fx.kernelBlur' ? pixelEffects.planKernelBlur(source, options) :
          pixelEffects.planPathBlur(source, args.path, options);
        return { ...image(raster(source.width, source.height), plan.scratchBytes), detail: plan };
      }
      case 'raster.pack': {
        if (!Array.isArray(args.sprites) || !options || args.sprites.some(sprite =>
          !(sprite?.source ?? sprite)?.[rasterKind] || (sprite?.source ?? sprite).bounds ||
          Object.values(sprite?.maps ?? {}).some(map => !map?.[rasterKind] || map.bounds))) return;
        const plan = api.planPack(args.sprites, options);
        return { outputs: { value: raster(plan.width, plan.height, 4, 1, plan.bounds) },
          resultBytes: plan.resultBytes, scratchBytes: plan.scratchBytes, detail: plan };
      }
      case 'sdf.shape': return { outputs: {} };
      case 'sdf.render': case 'scene.render': {
        if (!options) return;
        const value = raster(options.width ?? 128, options.height ?? 128);
        if (!value) return;
        const frameBytes = value.width * value.height * (op === 'sdf.render' ? 43 + Number(!!options.transparent) : 3);
        return { outputs: { value }, resultBytes: value.bytes + frameBytes,
          ...(op === 'scene.render' && { reason: 'Native scene passes, geometry and renderer scratch depend on the scene' }) };
      }
    }
  }

  function evaluate(scope, values, prefix) {
    const result = new Map();
    function resolve(source) {
      if (source.kind === 'value') return input(source.value);
      if (source.kind === 'input') return values[source.id];
      if (source.kind === 'node') return result.get(source.id)?.[source.port];
    }
    for (const id of scope.order) {
      const node = scope.nodes[id], path = prefix + id;
      const args = Object.fromEntries(Object.entries(node.inputs).map(([name, { source }]) => [name, resolve(source)]));
      let next;
      if (node.groupPath && node.group === undefined)
        next = { outputs: evaluate(groups[node.groupPath], args, path + '/') };
      else if (!custom.has(node.op)) {
        try { next = operation(node.op, args); }
        catch (error) { throw new Error('Graph memory preflight at ' + path + ': ' + error.message, { cause: error }); }
      }
      result.set(id, next?.outputs);
      const { resultBytes = 0, scratchBytes = 0, detail, reason } = next ?? { reason: 'Operation or input shape is not modeled' };
      if (reason) unresolved.push({ node: path, op: node.op, reason });
      upperBound ||= !!detail?.bounds;
      reserve(resultBytes);
      peak = Math.max(peak, retained + scratchBytes);
      if (resultBytes || scratchBytes || reason)
        nodes.push({ node: path, op: node.op, resultBytes, scratchBytes, retainedBytes: retained, ...(detail && { detail }) });
    }
    return Object.fromEntries(Object.entries(scope.outputs).map(([name, source]) => [name, resolve(source)]));
  }

  evaluate(graph, parameters, '');
  return { scope: 'cold serial graph raster buffers', complete: !unresolved.length, upperBound, initialBytes,
    peakBytes: unresolved.length ? null : peak, knownPeakBytes: peak, retainedBytes: retained, nodes, unresolved };
}

module.exports = { estimateGraphMemory };
