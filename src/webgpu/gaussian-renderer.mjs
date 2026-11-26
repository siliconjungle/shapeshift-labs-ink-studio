import { gaussianFilter } from '../webgl/gaussian-filter.mjs';
import { createSelectiveDraw, transparencySettings } from './selective-transparency.mjs';
import { makeCamera } from '../webgl/view.mjs';
import { sortTile, projectionShader, dispatchShader, sortingShader, rasterShader, resolveShader } from './gaussian-shaders.mjs';

const wordBytes = 4;
const splatBytes = 16 * wordBytes;
const ellipseBytes = 8 * wordBytes, rayEllipseBytes = 20 * wordBytes;
const keyBytes = 4 * wordBytes;
const drawBytes = 4 * wordBytes;
export const gaussianChunkBytes = count => count * splatBytes + 4 * wordBytes;
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
  const blend = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
  function drawPipeline(label, module, targetFormat, translucent) {
    return device.createRenderPipelineAsync({
      label, layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: targetFormat,
        ...(translucent && { blend: { color: blend, alpha: blend } }) }] },
      primitive: { topology: translucent ? 'triangle-strip' : 'triangle-list' }
    });
  }

  const affineModule = shader('Gaussian ellipse raster', rasterShader());
  const exactModule = shader('Gaussian ray raster', rasterShader(true));
  const affinePipelines = Promise.all([
    drawPipeline('Gaussian back-to-front blend', affineModule, format, true),
    format !== 'rgba16float' && drawPipeline('Gaussian filtered blend', affineModule, 'rgba16float', true)
  ]);
  const exactPipelines = Promise.all([
    drawPipeline('Gaussian ray blend', exactModule, format, true),
    format !== 'rgba16float' && drawPipeline('Gaussian filtered ray blend', exactModule, 'rgba16float', true)
  ]);
  const [projection, rayProjection, localProjection, localRayProjection, prepare, seed, crossTile, finishTile,
    affineDraw, exactDraw, resolve, selectiveDraw] = await Promise.all([
    compute('Gaussian project and compact', shader('Gaussian projection', projectionShader())),
    compute('Gaussian ray bounds and compact', shader('Gaussian ray projection', projectionShader(true))),
    compute('Selective affine projection', shader('Selective affine bounds', projectionShader(false,true))),
    compute('Selective ray projection', shader('Selective ray bounds', projectionShader(true,true))),
    compute('Gaussian indirect counts', shader('Gaussian dispatch', dispatchShader)),
    compute('Gaussian sort tile', sortModule, 'seed', sorterPipelineLayout),
    compute('Gaussian compare across tiles', sortModule, 'crossTile', sorterPipelineLayout),
    compute('Gaussian finish tile', sortModule, 'finishTile', sorterPipelineLayout),
    affinePipelines, exactPipelines,
    format !== 'rgba16float' && drawPipeline('Gaussian float output', shader('Gaussian float resolve', resolveShader), format, false),
    createSelectiveDraw(device,format,rasterShader(false,true),rasterShader(true,true))
  ]);
  const sorter = { seed, crossTile, finishTile };
  const buffer = (label, size, usage, mappedAtCreation = false) =>
    device.createBuffer({ label, size, usage, mappedAtCreation });
  const camera = buffer('Gaussian camera', cameraBytes, usage.UNIFORM | usage.COPY_DST);
  const query = timed ? device.createQuerySet({ type: 'timestamp', count: 6 }) : null;
  const resolved = timed ? buffer('Gaussian resolved timestamps', timestampBytes, usage.QUERY_RESOLVE | usage.COPY_SRC) : null;
  const uniform = new Float32Array(cameraBytes / wordBytes);
  let scene, work, accumulation, disposed = false, cloudUpload = emptyUpload;
  const chunks = new Map(), atlases = new Map();
  const emptyAtlas=buffer('Empty Gaussian footprint atlas',(64*8+4)*4,usage.STORAGE);

  const maxStorage = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  const maxSplats = Math.min(4_000_000, Math.floor((maxStorage - gaussianChunkBytes(0)) / splatBytes),
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

  function createFootprintAtlas(styles,api) {
    assertOpen();
    if (!Array.isArray(styles) || styles.length>64 || !api?.prepare || !api.field || api.resolution!==128)
      throw new TypeError('Gaussian footprint atlas needs 128² profiles from the Ink toolkit');
    const data=new Float32Array(64*8+Math.max(4,styles.length*128*128));
    for (const [i,style] of styles.entries()) if (style) {
      const p=api.prepare(style);
      if (!p || p.depth==='plane') throw new TypeError('Gaussian streaming needs center-depth footprints');
      data.set([...p.matrix,p.softness,p.reach,0,0],i*8);
      data.set(api.field(p),64*8+i*128*128);
    }
    const atlas=buffer('Gaussian footprint profiles',data.byteLength,usage.STORAGE|usage.COPY_DST);
    try {
      queue.writeBuffer(atlas,0,data);
      const handle=Object.freeze({bytes:data.byteLength,dispose() {
        if (atlases.delete(handle)) atlas.destroy();
      }});
      atlases.set(handle,atlas);
      return handle;
    } catch (error) {
      atlas.destroy();
      throw error;
    }
  }

  function uploadChunk(data, { order = 0, footprints = false, capacity = data?.length / 16 } = {}) {
    assertOpen();
    const count = data?.length / 16;
    if (!(data instanceof Float32Array) || !Number.isInteger(count) || count < 1 ||
        !Number.isInteger(order) || order < 0 || order > 0xffffffff || typeof footprints !== 'boolean' ||
        !Number.isInteger(capacity) || capacity < count)
      throw new TypeError('Supply packed Gaussian records and an unsigned chunk order');
    if (capacity > maxSplats)
      throw new RangeError('Gaussian cloud exceeds this WebGPU device limit of ' + maxSplats + ' splats');
    const bytes = gaussianChunkBytes(capacity);
    const points = buffer('Gaussian resident chunk', bytes, usage.STORAGE | usage.COPY_DST);
    try {
      const began = performance.now();
      queue.writeBuffer(points, 0, Uint32Array.of(order, Number(footprints), count, 0));
      queue.writeBuffer(points, gaussianChunkBytes(0), data);
      const cpuMs = performance.now() - began;
      const slot = { points, footprints, capacity, count };
      const handle = Object.freeze({ get count() { return slot.count; }, order, bytes, cpuMs, dispose() {
        if (chunks.delete(handle)) points.destroy();
      } });
      chunks.set(handle, slot);
      return handle;
    } catch (error) {
      points.destroy();
      throw error;
    }
  }

  function updateChunk(handle, data) {
    assertOpen();
    const slot = chunks.get(handle);
    const count = data?.length / 16;
    if (!slot || !(data instanceof Float32Array) || !Number.isInteger(count) || count > slot.capacity)
      throw new TypeError('Supply packed Gaussian records that fit the resident allocation');
    if (count) queue.writeBuffer(slot.points, gaussianChunkBytes(0), data);
    if (count !== slot.count) queue.writeBuffer(slot.points, 8, Uint32Array.of(count));
    slot.count = count;
    return data.byteLength;
  }

  function setWorld(world) {
    assertOpen();
    const { count, data } = world ?? {};
    if (!Number.isInteger(count) || data?.length !== count * 16)
      throw new TypeError('Supply a packed Gaussian world from gaussianSplatWorld');
    const handle = uploadChunk(data);
    scene?.handle.dispose();
    scene = { world, handle };
    cloudUpload = { bytes: data.byteLength, cpuMs: handle.cpuMs };
    return { ...cloudUpload };
  }

  function workFor(count, ray, local) {
    const stride = (ray ? rayEllipseBytes : ellipseBytes) + (local ? 16 : 0);
    const maxRecords = Math.floor(maxStorage / stride);
    if (count > maxRecords) throw new RangeError('Gaussian projection exceeds the device workspace limit');
    const capacity = sortCapacity(Math.max(count, 1));
    if (work?.capacity >= capacity && work.ray === ray && work.local === local) return work;
    const owned = [];
    let bytes = 0;
    function allocate(label, size, usage, mapped) {
      const value = buffer(label, size, usage, mapped);
      owned.push(value);
      bytes += size;
      return value;
    }
    const destroy = () => owned.forEach(value => value.destroy());
    try {
      const stages = stagesFor(capacity);
      const dispatchCount = Math.log2(capacity / sortTile) + 1;
      const ellipses = allocate('Gaussian visible ellipses', Math.min(capacity,maxRecords) * stride, usage.STORAGE);
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
      const drawModes = ray ? exactDraw : affineDraw;
      const next = {
        capacity, bytes, ray, local, draw, dispatch, stages, destroy, keys, ellipses,
        prepare: group(prepare, draw, dispatch),
        sort: group(seed, keys, draw, { buffer: settings, size: 16 }),
        drawModes
      };
      for (const chunk of chunks.values()) chunk.projection = undefined;
      work?.destroy();
      work = next;
      return next;
    } catch (error) {
      destroy();
      throw error;
    }
  }

  function floatTarget(width, height) {
    if (accumulation?.texture.width === width && accumulation.texture.height === height) return accumulation;
    const texture = device.createTexture({ label: 'Gaussian compensated color',
      size: [width,height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const view = texture.createView();
    const binding = device.createBindGroup({ layout: resolve.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: view }] });
    accumulation?.texture.destroy();
    accumulation = { texture, view, binding };
    return accumulation;
  }

  function timestamps(profile, index) {
    return profile && query ? {
      timestampWrites: { querySet: query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 }
    } : {};
  }

  async function readProfile(staging, report, selective) {
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
      return { ...report, visible, culled: report.input - visible, sortCapacity: sortCapacity(visible), gpuMs,
        ...(selective && { transparencyReport:selective.read(bytes,(timed?timestampBytes:0)+wordBytes) }) };
    } finally {
      staging.destroy();
    }
  }

  function renderChunks(target, world, handles, frame = {}, upload = emptyUpload) {
    assertOpen();
    if (!Array.isArray(handles)) throw new TypeError('Expected an array of resident Gaussian chunks');
    const atlas = frame.footprintAtlas===undefined ? emptyAtlas : atlases.get(frame.footprintAtlas);
    if (!atlas) throw new TypeError('Draw needs a resident footprint atlas from this renderer');
    let input = 0;
    const orders = new Set();
    for (const handle of handles) {
      if (!chunks.has(handle) || orders.has(handle.order))
        throw new TypeError('Draw chunks must be resident on this renderer with unique order IDs');
      if (chunks.get(handle).footprints && atlas===emptyAtlas)
        throw new TypeError('Drawing custom footprints needs their atlas');
      orders.add(handle.order);
      input += handle.count;
    }
    if (input > maxSplats) throw new RangeError('Draw exceeds this WebGPU Gaussian renderer’s splat limit');
    if (!target?.createView || target.format !== format || target.dimension !== '2d' || target.sampleCount !== 1 ||
        target.depthOrArrayLayers !== 1 || !(target.usage & GPUTextureUsage.RENDER_ATTACHMENT)) {
      throw new TypeError('Supply a single-sampled 2D render target in the renderer format');
    }
    const { width, height } = target;
    const setting = gaussianFilter.prepare(frame.gaussianFilter ?? world.look?.gaussianFilter);
    const view = makeCamera(world, frame, width, height);
    const ray = setting?.ray === true && !view.ortho;
    const local = (frame.splatOrder ?? world.look?.splatOrder) === 'selective';
    const workspace = workFor(input, ray, local);
    const { draw, dispatch, stages } = workspace;
    const project = local ? (ray ? localRayProjection : localProjection) : (ray ? rayProjection : projection);
    const [r,g,b] = frame.background ?? world.bg;
    const background = [r/255,g/255,b/255,1];
    if (local && frame.opaqueSurface === target)
      throw new TypeError('Use a separate texture for the opaque transparency surface');
    const selective = local ? selectiveDraw.prepare(width,height,
      transparencySettings.prepare(frame.selectiveTransparency ?? world.look?.selectiveTransparency),
      frame.opaqueSurface,background,!!frame.profile) : null;
    uniform.set(view.view);
    uniform.set([width / 2, height / 2, height / (2 * view.tangent), +view.ortho, view.clipNear, view.clipFar, setting?.variance ?? -1, +(setting?.compensated ?? false)], 16);
    const time = performance.now();
    queue.writeBuffer(camera, 0, uniform);
    const cameraUpload = { bytes: cameraBytes, cpuMs: performance.now() - time };

    const encoder = device.createCommandEncoder({ label: 'Gaussian visibility and draw' });
    encoder.clearBuffer(draw);
    const visibility = encoder.beginComputePass({ label: 'Project and cull', ...timestamps(frame.profile, 0) });
    visibility.setPipeline(project);
    for (const handle of handles) {
      if (!handle.count) continue;
      const chunk = chunks.get(handle);
      chunk.projection ??= group(project, camera, chunk.points, workspace.ellipses, workspace.keys, draw);
      visibility.setBindGroup(0, chunk.projection);
      visibility.dispatchWorkgroups(Math.ceil(handle.count / (sortTile / 2)));
    }
    visibility.setPipeline(prepare);
    visibility.setBindGroup(0, workspace.prepare);
    visibility.dispatchWorkgroups(1);
    visibility.end();

    const sort = encoder.beginComputePass({ label: 'Sort visible depths', ...timestamps(frame.profile, 2) });
    stages.forEach(({ entry, width }, i) => {
      sort.setPipeline(sorter[entry]);
      sort.setBindGroup(0, workspace.sort, [i * alignment]);
      sort.dispatchWorkgroupsIndirect(dispatch, Math.log2(width / sortTile) * dispatchBytes);
    });
    sort.end();

    const output = target.createView({ mipLevelCount: 1 });
    if (selective) {
      const rasterTimes = frame.profile && query ? {timestampWrites:{querySet:query,beginningOfPassWriteIndex:4}} : {};
      const finishTimes = frame.profile && query ? {timestampWrites:{querySet:query,endOfPassWriteIndex:5}} : {};
      selective.draw(encoder,workspace,camera,atlas,output,rasterTimes,finishTimes);
    } else {
      const floating = setting?.compensated && resolve ? floatTarget(width,height) : null;
      const pass = encoder.beginRenderPass({
        label: 'Rasterize visible ellipses', ...timestamps(frame.profile, 4),
        colorAttachments: [{
          view: floating?.view ?? output, clearValue: background,
          loadOp: 'clear', storeOp: 'store'
        }]
      });
      if (workspace.atlas!==atlas) {
        workspace.atlas=atlas;
        workspace.raster=group(workspace.drawModes[0],camera,workspace.ellipses,workspace.keys,atlas);
        workspace.floating=workspace.drawModes[1]&&group(workspace.drawModes[1],camera,workspace.ellipses,workspace.keys,atlas);
      }
      pass.setPipeline(workspace.drawModes[floating ? 1 : 0]);
      pass.setBindGroup(0, floating ? workspace.floating : workspace.raster);
      pass.drawIndirect(draw, 0);
      pass.end();
      if (floating) {
        const finish = encoder.beginRenderPass({ label: 'Resolve Gaussian float color',
          colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store' }] });
        finish.setPipeline(resolve);
        finish.setBindGroup(0, floating.binding);
        finish.draw(3);
        finish.end();
      }

    }

    let staging;
    if (frame.profile) {
      const offset = timed ? timestampBytes : 0;
      staging = buffer('Gaussian profile readback', offset + wordBytes + (selective?.statBytes ?? 0), usage.COPY_DST | usage.MAP_READ);
      if (timed) {
        encoder.resolveQuerySet(query, 0, 6, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, staging, 0, timestampBytes);
      }
      encoder.copyBufferToBuffer(draw, wordBytes, staging, offset, wordBytes);
      if (selective) encoder.copyBufferToBuffer(selective.stats,0,staging,offset+wordBytes,selective.statBytes);
    }
    queue.submit([encoder.finish()]);
    const report = { input, cloudUpload: { ...upload }, cameraUpload, workBytes: workspace.bytes,
      ...(setting && { gaussianFilter: setting }), ...(local && { transparencyUniformBytes:64 }) };
    return staging ? readProfile(staging, report, selective) : report;
  }

  function render(target, frame = {}) {
    assertOpen();
    if (!scene) throw new Error('Load a Gaussian world before rendering');
    const result = renderChunks(target, scene.world, [scene.handle], frame, cloudUpload);
    cloudUpload = emptyUpload;
    return result;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const handle of chunks.keys()) handle.dispose();
    for (const handle of atlases.keys()) handle.dispose();
    emptyAtlas.destroy();
    work?.destroy();
    accumulation?.texture.destroy();
    selectiveDraw.dispose();
    camera.destroy();
    query?.destroy();
    resolved?.destroy();
  }
  return Object.freeze({ setWorld, render, uploadChunk, updateChunk, createFootprintAtlas, renderChunks, dispose, format, maxSplats, timestamps: timed });
}
