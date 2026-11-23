import { makeCamera } from '../webgl/view.mjs';
import { sortTile, projectionShader, dispatchShader, sortingShader, rasterShader } from './gaussian-shaders.mjs';

const wordBytes = 4;
const splatBytes = 16 * wordBytes;
const ellipseBytes = 8 * wordBytes;
const keyBytes = 4 * wordBytes;
const drawBytes = 4 * wordBytes;
const dispatchBytes = 3 * wordBytes;
const cameraBytes = 24 * wordBytes;
const timestampBytes = 6 * 8;
const emptyUpload = Object.freeze({ bytes: 0, cpuMs: 0 });

function sortCapacity(count) {
  return count ? Math.max(sortTile, 2 ** Math.ceil(Math.log2(count))) : 0;
}

function stagesFor(capacity) {
  const stages = [{ entry: 'seed', width: sortTile, stride: 0 }];
  for (let width = sortTile * 2; width <= capacity; width *= 2) {
    for (let stride = width / 2; stride >= sortTile; stride /= 2) {
      stages.push({ entry: 'crossTile', width, stride });
    }
    stages.push({ entry: 'finishTile', width, stride: 0 });
  }
  return stages;
}

export async function createGaussianSplatRenderer(device, { format = 'rgba8unorm' } = {}) {
  if (!device?.createComputePipelineAsync || !globalThis.GPUBufferUsage)
    throw new TypeError('A WebGPU device is required');
  const usage = GPUBufferUsage;
  const { limits, queue } = device;
  const timed = device.features.has('timestamp-query');
  const alignment = Math.max(16, limits.minUniformBufferOffsetAlignment);
  const sorterLayout = device.createBindGroupLayout({
    label: 'Gaussian sort bindings',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }
    ]
  });
  const sorterPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [sorterLayout] });
  const shader = (label, code) => device.createShaderModule({ label, code });
  function compute(label, module, entryPoint = 'main', layout = 'auto') {
    return device.createComputePipelineAsync({ label, layout, compute: { module, entryPoint } });
  }
  const sortModule = shader('Gaussian depth merge', sortingShader);
  const rasterModule = shader('Gaussian ellipse raster', rasterShader);
  const blend = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
  const [projection, prepare, seed, crossTile, finishTile, raster] = await Promise.all([
    compute('Gaussian project and compact', shader('Gaussian projection', projectionShader)),
    compute('Gaussian indirect counts', shader('Gaussian dispatch', dispatchShader)),
    compute('Gaussian sort tile', sortModule, 'seed', sorterPipelineLayout),
    compute('Gaussian compare across tiles', sortModule, 'crossTile', sorterPipelineLayout),
    compute('Gaussian finish tile', sortModule, 'finishTile', sorterPipelineLayout),
    device.createRenderPipelineAsync({
      label: 'Gaussian back-to-front blend',
      layout: 'auto',
      vertex: { module: rasterModule, entryPoint: 'vertex' },
      fragment: { module: rasterModule, entryPoint: 'fragment', targets: [{ format, blend: { color: blend, alpha: blend } }] },
      primitive: { topology: 'triangle-strip' }
    })
  ]);
  const sorter = { seed, crossTile, finishTile };
  const buffer = (label, size, usage, mappedAtCreation = false) =>
    device.createBuffer({ label, size, usage, mappedAtCreation });
  const camera = buffer('Gaussian camera', cameraBytes, usage.UNIFORM | usage.COPY_DST);
  const query = timed ? device.createQuerySet({ type: 'timestamp', count: 6 }) : null;
  const resolved = timed ? buffer('Gaussian resolved timestamps', timestampBytes, usage.QUERY_RESOLVE | usage.COPY_SRC) : null;
  const uniform = new Float32Array(cameraBytes / wordBytes);
  let scene, disposed = false, cloudUpload = emptyUpload;

  const maxStorage = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  const maxSplats = Math.min(4_000_000, Math.floor(maxStorage / splatBytes),
    limits.maxComputeWorkgroupsPerDimension * (sortTile / 2));

  function assertOpen() {
    if (disposed) throw new Error('Gaussian renderer is disposed');
  }
  function group(pipeline, ...buffers) {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((entry, binding) => ({ binding, resource: entry.buffer ? entry : { buffer: entry } }))
    });
  }

  function setWorld(world) {
    assertOpen();
    const { count, data } = world ?? {};
    if (!(data instanceof Float32Array) || !Number.isInteger(count) || count < 1 || data.length !== count * 16)
      throw new TypeError('Supply a packed Gaussian world from gaussianSplatWorld');
    if (count > maxSplats)
      throw new RangeError('Gaussian cloud exceeds this WebGPU device limit of ' + maxSplats + ' splats');

    const owned = [];
    function allocate(label, size, usage, mapped) {
      const value = buffer(label, size, usage, mapped);
      owned.push(value);
      return value;
    }
    const destroy = () => owned.forEach(value => value.destroy());
    try {
      const capacity = sortCapacity(count);
      const stages = stagesFor(capacity);
      const dispatchCount = Math.log2(capacity / sortTile) + 1;
      const points = allocate('Gaussian imported records', data.byteLength, usage.STORAGE | usage.COPY_DST);
      const ellipses = allocate('Gaussian visible ellipses', count * ellipseBytes, usage.STORAGE);
      const keys = allocate('Gaussian depth order', capacity * keyBytes, usage.STORAGE);
      const draw = allocate('Gaussian draw arguments', drawBytes,
        usage.STORAGE | usage.INDIRECT | usage.COPY_DST | usage.COPY_SRC);
      const dispatch = allocate('Gaussian sort dispatch arguments', dispatchCount * dispatchBytes, usage.STORAGE | usage.INDIRECT);
      const settings = allocate('Gaussian merge spans', stages.length * alignment, usage.UNIFORM, true);
      const params = new Uint32Array(settings.getMappedRange());
      stages.forEach(({ width, stride }, i) => {
        params.set([width, stride], i * alignment / wordBytes);
      });
      settings.unmap();

      const next = {
        world, draw, dispatch, stages, destroy,
        projection: group(projection, camera, points, ellipses, keys, draw),
        prepare: group(prepare, draw, dispatch),
        sort: group(seed, keys, draw, { buffer: settings, size: 16 }),
        raster: group(raster, camera, ellipses, keys)
      };
      const began = performance.now();
      queue.writeBuffer(points, 0, data);
      cloudUpload = { bytes: data.byteLength, cpuMs: performance.now() - began };
      scene?.destroy();
      scene = next;
      return { ...cloudUpload };
    } catch (error) {
      destroy();
      throw error;
    }
  }

  function timestamps(profile, index) {
    return profile && query ? {
      timestampWrites: { querySet: query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 }
    } : {};
  }

  async function readProfile(staging, report) {
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const bytes = staging.getMappedRange();
      const visible = new Uint32Array(bytes, timed ? timestampBytes : 0, 1)[0];
      let gpuMs = null;
      if (timed) {
        const ticks = new BigUint64Array(bytes, 0, 6);
        const ms = at => Number(ticks[at + 1] - ticks[at]) / 1e6;
        gpuMs = { projectionCull: ms(0), sorting: ms(2), raster: ms(4) };
      }
      return { ...report, visible, culled: report.input - visible, sortCapacity: sortCapacity(visible), gpuMs };
    } finally {
      staging.destroy();
    }
  }

  function render(target, frame = {}) {
    assertOpen();
    if (!scene) throw new Error('Load a Gaussian world before rendering');
    if (!target?.createView || target.format !== format || target.dimension !== '2d' || target.sampleCount !== 1 ||
        target.depthOrArrayLayers !== 1 || !(target.usage & GPUTextureUsage.RENDER_ATTACHMENT)) {
      throw new TypeError('Supply a single-sampled 2D render target in the renderer format');
    }
    const { width, height } = target;
    const { world, draw, dispatch, stages } = scene;
    const view = makeCamera(world, frame, width, height);
    uniform.set(view.view);
    uniform.set([width / 2, height / 2, height / (2 * view.tangent), +view.ortho, view.clipNear, view.clipFar], 16);
    const time = performance.now();
    queue.writeBuffer(camera, 0, uniform);
    const cameraUpload = { bytes: cameraBytes, cpuMs: performance.now() - time };

    const encoder = device.createCommandEncoder({ label: 'Gaussian visibility and draw' });
    encoder.clearBuffer(draw);
    const visibility = encoder.beginComputePass({ label: 'Project and cull', ...timestamps(frame.profile, 0) });
    visibility.setPipeline(projection);
    visibility.setBindGroup(0, scene.projection);
    visibility.dispatchWorkgroups(Math.ceil(world.count / (sortTile / 2)));
    visibility.setPipeline(prepare);
    visibility.setBindGroup(0, scene.prepare);
    visibility.dispatchWorkgroups(1);
    visibility.end();

    const sort = encoder.beginComputePass({ label: 'Sort visible depths', ...timestamps(frame.profile, 2) });
    stages.forEach(({ entry, width }, i) => {
      sort.setPipeline(sorter[entry]);
      sort.setBindGroup(0, scene.sort, [i * alignment]);
      sort.dispatchWorkgroupsIndirect(dispatch, Math.log2(width / sortTile) * dispatchBytes);
    });
    sort.end();

    const [r, g, b] = frame.background ?? world.bg;
    const pass = encoder.beginRenderPass({
      label: 'Rasterize visible ellipses', ...timestamps(frame.profile, 4),
      colorAttachments: [{
        view: target.createView({ mipLevelCount: 1 }), clearValue: { r: r / 255, g: g / 255, b: b / 255, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }]
    });
    pass.setPipeline(raster);
    pass.setBindGroup(0, scene.raster);
    pass.drawIndirect(draw, 0);
    pass.end();

    let staging;
    if (frame.profile) {
      const offset = timed ? timestampBytes : 0;
      staging = buffer('Gaussian profile readback', offset + wordBytes, usage.COPY_DST | usage.MAP_READ);
      if (timed) {
        encoder.resolveQuerySet(query, 0, 6, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, staging, 0, timestampBytes);
      }
      encoder.copyBufferToBuffer(draw, wordBytes, staging, offset, wordBytes);
    }
    queue.submit([encoder.finish()]);
    const report = { input: world.count, cloudUpload: { ...cloudUpload }, cameraUpload };
    cloudUpload = emptyUpload;
    return staging ? readProfile(staging, report) : report;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene?.destroy();
    camera.destroy();
    query?.destroy();
    resolved?.destroy();
  }
  return Object.freeze({ setWorld, render, dispose, format, maxSplats, timestamps: timed });
}
