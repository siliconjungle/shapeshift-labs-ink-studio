const textureBytes = new Map([
  ['rgba8unorm', 4], ['rgba16float', 8], ['rgba32float', 16], ['r32float', 4]
]);
const modes = new Map([
  ['read-buffer', 'buffer'], ['write-buffer', 'buffer'], ['uniform', 'buffer'],
  ['read-texture', 'texture'], ['write-texture', 'texture']
]);
const writeModes = new Set(['write-buffer', 'write-texture']);
const align = (n, alignment) => Math.ceil(n / alignment) * alignment;
const positive = n => Number.isSafeInteger(n) && n > 0;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const bytesOf = data => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('GPU data must be an ArrayBuffer or a typed array');
};

function inspectGraph(definition) {
  if (!record(definition?.resources) || !Array.isArray(definition.nodes))
    throw new TypeError('Expected GPU graph resources and nodes');
  const resources = new Map(Object.entries(definition.resources).map(([name, spec]) => {
    if (!name || !record(spec)) throw new TypeError('Invalid GPU resource: ' + name);
    if (spec.type === 'buffer' && positive(spec.size) && spec.size % 4 === 0)
      return [name, { type: spec.type, size: spec.size }];
    if (spec.type === 'texture' && positive(spec.width) && positive(spec.height) && textureBytes.has(spec.format))
      return [name, { type: spec.type, width: spec.width, height: spec.height, format: spec.format }];
    throw new TypeError('Invalid GPU resource dimensions or format: ' + name);
  }));
  const nodes = new Map(), writers = new Map();
  for (const input of definition.nodes) {
    const { id, shader, bindings, workgroups, entryPoint = 'main' } = input ?? {};
    if (typeof id !== 'string' || !id || nodes.has(id) || typeof shader !== 'string' || !shader.trim() ||
        typeof entryPoint !== 'string' || !entryPoint || !Array.isArray(bindings) || !Array.isArray(workgroups) ||
        workgroups.length < 1 || workgroups.length > 3 || !workgroups.every(positive))
      throw new TypeError('Invalid GPU graph node: ' + id);
    const seen = new Set();
    const ports = bindings.map(port => {
      const { resource, mode } = port ?? {};
      if (!resources.has(resource) || resources.get(resource).type !== modes.get(mode) || seen.has(resource))
        throw new TypeError('Invalid GPU binding in ' + id + ': ' + resource);
      seen.add(resource);
      if (writeModes.has(mode)) {
        if (writers.has(resource)) throw new Error('GPU resource has multiple writers: ' + resource);
        writers.set(resource, id);
      }
      return { resource, mode };
    });
    if (!ports.some(port => writeModes.has(port.mode))) throw new Error('GPU node requires an output: ' + id);
    nodes.set(id, { id, shader, entryPoint, bindings: ports, workgroups: [...workgroups] });
  }

  const visiting = new Set(), done = new Set(), order = [], dependencies = new Map();
  for (const node of nodes.values()) {
    dependencies.set(node.id, node.bindings
      .filter(port => !writeModes.has(port.mode) && writers.has(port.resource))
      .map(port => writers.get(port.resource)));
  }
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('Cycle in GPU graph at ' + id);
    visiting.add(id);
    for (const dependency of dependencies.get(id)) visit(dependency);
    visiting.delete(id);
    done.add(id);
    order.push(nodes.get(id));
  }
  for (const id of nodes.keys()) visit(id);
  return { resources, writers, order, dependencies };
}

export function planWebGPUGraph(definition) {
  const { order, writers } = inspectGraph(definition);
  return { order: order.map(node => node.id), outputs: Object.fromEntries(writers) };
}

function layoutEntry(spec, mode, binding) {
  const visibility = GPUShaderStage.COMPUTE;
  switch (mode) {
    case 'read-texture':
      return { binding, visibility, texture: { sampleType: 'unfilterable-float' } };
    case 'write-texture':
      return { binding, visibility, storageTexture: { access: 'write-only', format: spec.format } };
    case 'uniform':
      return { binding, visibility, buffer: { type: 'uniform' } };
    default:
      return { binding, visibility, buffer: { type: mode === 'read-buffer' ? 'read-only-storage' : 'storage' } };
  }
}

function allocate(device, name, spec) {
  const { maxBufferSize, maxTextureDimension2D } = device.limits;
  if (spec.type === 'buffer') {
    if (spec.size > maxBufferSize) throw new RangeError('GPU buffer exceeds device limit: ' + name);
    const usage = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM |
      GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.INDIRECT;
    return device.createBuffer({ label: name, size: spec.size, usage });
  }
  if (Math.max(spec.width, spec.height) > maxTextureDimension2D)
    throw new RangeError('GPU texture exceeds device limit: ' + name);
  const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING;
  return device.createTexture({ label: name, size: [spec.width, spec.height], format: spec.format, usage });
}

async function validated(device, operation) {
  device.pushErrorScope('validation');
  let result;
  try {
    result = operation();
  } finally {
    const error = await device.popErrorScope();
    if (error) throw new Error('WebGPU graph validation: ' + error.message);
  }
  return result;
}

async function compile(device, node, resources, handles) {
  if (node.workgroups.some(n => n > device.limits.maxComputeWorkgroupsPerDimension))
    throw new RangeError('GPU dispatch exceeds device limit: ' + node.id);
  const module = device.createShaderModule({ label: node.id, code: node.shader });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length)
    throw new Error('WGSL ' + node.id + ': ' + errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));

  const entries = node.bindings.map(({ resource, mode }, binding) => layoutEntry(resources.get(resource), mode, binding));
  const { groupLayout, layout } = await validated(device, () => {
    const groupLayout = device.createBindGroupLayout({ label: node.id, entries });
    return { groupLayout, layout: device.createPipelineLayout({ bindGroupLayouts: [groupLayout] }) };
  });
  const pipeline = await device.createComputePipelineAsync({
    label: node.id, layout, compute: { module, entryPoint: node.entryPoint }
  });
  const bindGroup = await validated(device, () => device.createBindGroup({
    label: node.id, layout: groupLayout, entries: node.bindings.map(({ resource }, binding) => ({
      binding, resource: resources.get(resource).type === 'buffer'
        ? { buffer: handles.get(resource) }
        : handles.get(resource).createView()
    }))
  }));
  return { pipeline, bindGroup };
}

export async function createWebGPUGraph(device, definition) {
  const { resources, writers, order, dependencies } = inspectGraph(definition);
  if (!device?.createComputePipelineAsync || !device.pushErrorScope || !globalThis.GPUBufferUsage)
    throw new TypeError('A WebGPU device is required');
  const handles = new Map(), passes = new Map();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const handle of handles.values()) handle.destroy();
    handles.clear();
    passes.clear();
  }
  try {
    await validated(device, () => {
      for (const [name, spec] of resources) handles.set(name, allocate(device, name, spec));
    });
    for (const node of order) passes.set(node.id, await compile(device, node, resources, handles));
  } catch (error) {
    dispose();
    throw error;
  }
  function resource(name, type) {
    if (disposed) throw new Error('GPU graph is disposed');
    const spec = resources.get(name);
    if (!spec || type && spec.type !== type) throw new TypeError('Unknown or incompatible GPU resource: ' + name);
    return spec;
  }
  function encode(encoder, outputs) {
    if (disposed) throw new Error('GPU graph is disposed');
    let selected;
    if (outputs !== undefined) {
      if (!Array.isArray(outputs)) throw new TypeError('Expected an array of GPU output resource names');
      selected = new Set();
      function select(id) {
        if (id === undefined || selected.has(id)) return;
        selected.add(id);
        for (const dependency of dependencies.get(id)) select(dependency);
      }
      for (const name of outputs) {
        resource(name);
        select(writers.get(name));
      }
    }
    for (const node of order) {
      if (selected && !selected.has(node.id)) continue;
      const { pipeline, bindGroup } = passes.get(node.id);
      const pass = encoder.beginComputePass({ label: node.id });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(...node.workgroups);
      pass.end();
    }
  }
  async function readback(size, copy) {
    if (size > device.limits.maxBufferSize) throw new RangeError('GPU readback size exceeds device limit');
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder();
      copy(encoder, staging);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      return new Uint8Array(staging.getMappedRange().slice(0));
    } finally {
      staging.destroy();
    }
  }
  return {
    encode,
    run(outputs) {
      const encoder = device.createCommandEncoder();
      encode(encoder, outputs);
      device.queue.submit([encoder.finish()]);
    },
    get(name) {
      resource(name);
      return handles.get(name);
    },
    writeBuffer(name, data, offset = 0) {
      const { size } = resource(name, 'buffer'), bytes = bytesOf(data);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 4 || bytes.length % 4 || offset + bytes.length > size)
        throw new RangeError('GPU buffer writes must be aligned and within the buffer');
      device.queue.writeBuffer(handles.get(name), offset, bytes);
    },
    writeTexture(name, data) {
      const { width, height, format } = resource(name, 'texture'), bytes = bytesOf(data);
      const bytesPerRow = width * textureBytes.get(format);
      if (bytes.length !== bytesPerRow * height) throw new RangeError('GPU texture data size does not match its format and dimensions');
      device.queue.writeTexture({ texture: handles.get(name) }, bytes, { bytesPerRow }, [width, height]);
    },
    readBuffer(name) {
      const { size } = resource(name, 'buffer'), buffer = handles.get(name);
      return readback(size, (encoder, staging) => encoder.copyBufferToBuffer(buffer, 0, staging, 0, size));
    },
    async readTexture(name) {
      const { width, height, format } = resource(name, 'texture'), texture = handles.get(name);
      const rowSize = width * textureBytes.get(format), bytesPerRow = align(rowSize, 256);
      const bytes = await readback(bytesPerRow * height, (encoder, buffer) =>
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]));
      if (rowSize === bytesPerRow) return bytes;
      const packed = new Uint8Array(rowSize * height);
      for (let y = 0; y < height; y++) packed.set(bytes.subarray(y * bytesPerRow, y * bytesPerRow + rowSize), y * rowSize);
      return packed;
    },
    dispose
  };
}
