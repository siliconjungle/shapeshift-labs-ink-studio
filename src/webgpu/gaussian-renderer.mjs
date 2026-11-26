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

export async function createGaussianSplatRenderer(device, { format = 'rgba8unorm', pointAdapter, contours = pointAdapter?.contours ?? false } = {}) {
  if (!device?.createComputePipelineAsync || !globalThis.GPUBufferUsage)
    throw new TypeError('A WebGPU device is required');
  const usage = GPUBufferUsage;
  const { limits, queue } = device;
  const adapterBytes = pointAdapter?.bytes ?? 0;
  const adapterTextures = pointAdapter?.textureViews ?? [];
  if (pointAdapter && (typeof pointAdapter.shader !== 'string' || !Number.isInteger(adapterBytes) ||
      adapterBytes < 0 || adapterBytes % wordBytes || adapterBytes > limits.maxUniformBufferBindingSize ||
      (adapterBytes && typeof pointAdapter.uniforms !== 'function') || !Array.isArray(adapterTextures) ||
      adapterTextures.length > limits.maxSampledTexturesPerShaderStage || adapterTextures.some(view => !view) ||
      (pointAdapter.variance !== undefined &&
        (!Number.isFinite(pointAdapter.variance) || pointAdapter.variance < 0 || pointAdapter.variance > 4))))
    throw new TypeError('Gaussian point adapters need WGSL and matching uniform data and texture views');
  const adapterBindings = adapterTextures.map((resource, index) => ({ binding: index + 6, resource }));
  const artCamera = Boolean(contours || pointAdapter);
  const uniformBytes = cameraBytes + (artCamera ? 16 : 0);
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
  function drawPipeline(label, module, targetFormat, translucent, grid) {
    const contour = grid !== undefined;
    const constants = contour ? { nativeGrid: +grid } : undefined;
    return device.createRenderPipelineAsync({
      label, layout: 'auto',
      vertex: { module, entryPoint: 'vertex', constants },
      fragment: { module, entryPoint: 'fragment', constants, targets: [{ format: targetFormat,
        ...(translucent && { blend: { color: blend, alpha: blend } }) }, ...(contour ?
          [{ format: 'rgba8unorm', blend: { color: blend, alpha: blend } }] : [])] },
      primitive: { topology: translucent ? 'triangle-strip' : 'triangle-list' }
    });
  }

  const affineModule = shader('Gaussian ellipse raster', rasterShader(false, false, false, artCamera));
  const exactModule = shader('Gaussian ray raster', rasterShader(true, false, false, artCamera));
  const contourModule = contours && shader('Gaussian contour raster', rasterShader(false, false, true));
  const affinePipelines = Promise.all([
    drawPipeline('Gaussian back-to-front blend', affineModule, format, true),
    format !== 'rgba16float' && drawPipeline('Gaussian filtered blend', affineModule, 'rgba16float', true)
  ]);
  const exactPipelines = Promise.all([
    drawPipeline('Gaussian ray blend', exactModule, format, true),
    format !== 'rgba16float' && drawPipeline('Gaussian filtered ray blend', exactModule, 'rgba16float', true)
  ]);
  const contourPipelines = contours && Promise.all([
    drawPipeline('Gaussian supersampled contours', contourModule, format, true, false),
    drawPipeline('Gaussian native contours', contourModule, format, true, true)
  ]);
  const projectPipeline = (label, ray, local, contour) =>
    compute(label, shader(label, projectionShader(ray, local, contour, pointAdapter, artCamera)));
  const [projection, rayProjection, localProjection, localRayProjection, prepare, seed, crossTile, finishTile,
    affineDraw, exactDraw, resolve, selectiveDraw, contourProject, contourDraw] = await Promise.all([
    projectPipeline('Gaussian project and compact', false, false, false),
    projectPipeline('Gaussian ray bounds and compact', true, false, false),
    projectPipeline('Selective affine projection', false, true, false),
    projectPipeline('Selective ray projection', true, true, false),
    compute('Gaussian indirect counts', shader('Gaussian dispatch', dispatchShader)),
    compute('Gaussian sort tile', sortModule, 'seed', sorterPipelineLayout),
    compute('Gaussian compare across tiles', sortModule, 'crossTile', sorterPipelineLayout),
    compute('Gaussian finish tile', sortModule, 'finishTile', sorterPipelineLayout),
    affinePipelines, exactPipelines,
    format !== 'rgba16float' && drawPipeline('Gaussian float output', shader('Gaussian float resolve', resolveShader), format, false),
    createSelectiveDraw(device, format, rasterShader(false, true, false, artCamera), rasterShader(true, true, false, artCamera)),
    contours && projectPipeline('Gaussian high and native projection', false, false, true),
    contourPipelines
  ]);
  const sorter = { seed, crossTile, finishTile };
  const buffer = (label, size, usage, mappedAtCreation = false) =>
    device.createBuffer({ label, size, usage, mappedAtCreation });
  const camera = buffer('Gaussian camera', uniformBytes, usage.UNIFORM | usage.COPY_DST);
  const adapterUniforms = adapterBytes && buffer('Gaussian point adapter', adapterBytes, usage.UNIFORM | usage.COPY_DST);
  const query = timed ? device.createQuerySet({ type: 'timestamp', count: contours ? 8 : 6 }) : null;
  const resolved = timed ? buffer('Gaussian resolved timestamps', contours ? timestampBytes + 16 : timestampBytes,
    usage.QUERY_RESOLVE | usage.COPY_SRC) : null;
  const uniform = new Float32Array(uniformBytes / wordBytes);
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
      entries: buffers.map((entry, binding) => entry.resource === undefined
        ? { binding, resource: entry.buffer ? entry : { buffer: entry } } : entry)
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

  function workFor(count, ray, local, contour) {
    const stride = (ray ? rayEllipseBytes : ellipseBytes) + (local ? 16 : 0) + (contour ? 24 : 0);
    const maxRecords = Math.floor(maxStorage / stride);
    if (count > maxRecords) throw new RangeError('Gaussian projection exceeds the device workspace limit');
    const capacity = sortCapacity(Math.max(count, 1));
    if (work?.capacity >= capacity && work.ray === ray && work.local === local && work.contour === contour) return work;
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
      const drawModes = contour ? contourDraw : ray ? exactDraw : affineDraw;
      const next = {
        capacity, bytes, ray, local, contour, draw, dispatch, stages, destroy, keys, ellipses,
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

  async function readProfile(staging, report, selective, timestampCount) {
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const bytes = staging.getMappedRange();
      const offset = timestampCount * 8;
      const visible = new Uint32Array(bytes, offset, 1)[0];
      let gpuMs = null;
      if (timed) {
        const ticks = new BigUint64Array(bytes, 0, timestampCount);
        const ms = at => Number(ticks[at + 1] - ticks[at]) / 1e6;
        gpuMs = { projectionCull: ms(0), sorting: ms(2), raster: ms(4) };
        if (timestampCount === 8) {
          gpuMs.highRaster = ms(4);
          gpuMs.nativeRaster = ms(6);
          gpuMs.raster = Number(ticks[7] - ticks[4]) / 1e6;
        }
      }
      return { ...report, visible, culled: report.input - visible, sortCapacity: sortCapacity(visible), gpuMs,
        ...(selective && { transparencyReport: selective.read(bytes, offset + wordBytes) }) };
    } finally {
      staging.destroy();
    }
  }

  function validTarget(texture, expectedFormat) {
    return texture?.createView && texture.format === expectedFormat && texture.dimension === '2d' &&
      texture.sampleCount === 1 && texture.depthOrArrayLayers === 1 && (texture.usage & GPUTextureUsage.RENDER_ATTACHMENT);
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
    if (!validTarget(target, format)) {
      throw new TypeError('Supply a single-sampled 2D render target in the renderer format');
    }
    const { width, height } = target;
    const { depth, nativeColor, nativeDepth } = frame;
    const contour = nativeColor !== undefined || nativeDepth !== undefined;
    if (contour && !contours) throw new TypeError('Enable contours when creating the Gaussian renderer');
    if (contour && (!validTarget(depth, 'rgba8unorm') || !validTarget(nativeDepth, 'rgba8unorm') ||
        !validTarget(nativeColor, format) || depth.width !== width || depth.height !== height ||
        nativeColor.width * 2 !== width || nativeColor.height * 2 !== height ||
        nativeDepth.width !== nativeColor.width || nativeDepth.height !== nativeColor.height ||
        new Set([target, depth, nativeColor, nativeDepth]).size !== 4))
      throw new TypeError('Contours need distinct color and RGBA8 depth targets at native and double resolution');
    const filter = frame.gaussianFilter ?? world.look?.gaussianFilter;
    const setting = gaussianFilter.prepare(filter);
    const view = makeCamera(world, frame, contour ? nativeColor.width : width, contour ? nativeColor.height : height);
    const ray = setting?.ray === true && !view.ortho;
    const local = (frame.splatOrder ?? world.look?.splatOrder) === 'selective';
    if (contour && (ray || local || setting?.compensated))
      throw new TypeError('Contours use affine projection with center-depth ordering and uncompensated coverage');
    const workspace = workFor(input, ray, local, contour);
    const { draw, dispatch, stages } = workspace;
    const project = contour ? contourProject : local ? (ray ? localRayProjection : localProjection) : (ray ? rayProjection : projection);
    const [r,g,b] = frame.background ?? world.bg;
    const background = [r/255,g/255,b/255,1];
    if (local && frame.opaqueSurface === target)
      throw new TypeError('Use a separate texture for the opaque transparency surface');
    const selective = local ? selectiveDraw.prepare(width,height,
      transparencySettings.prepare(frame.selectiveTransparency ?? world.look?.selectiveTransparency),
      frame.opaqueSurface,background,!!frame.profile) : null;
    uniform.set(view.view);
    const variance = contour ? filter?.variance ?? pointAdapter?.variance ?? .15 : setting?.variance ?? -1;
    uniform.set([width / 2, height / 2, height / (2 * view.tangent), +view.ortho, view.clipNear, view.clipFar,
      variance, +(setting?.compensated ?? false)], 16);
    if (artCamera) {
      const [near, far] = view.depthRange;
      const art = frame.art ?? [0, near, Math.max(far - near, .00001), 0];
      if (art.length !== 4 || !Array.from(art).every(Number.isFinite) || art[2] <= 0)
        throw new TypeError('Gaussian art uniforms need four finite numbers and a positive depth span');
      uniform.set(art, 24);
    }
    const adapterData = adapterUniforms && pointAdapter.uniforms(frame);
    if (adapterUniforms && (!ArrayBuffer.isView(adapterData) || adapterData.byteLength !== adapterBytes))
      throw new TypeError('Gaussian point adapter returned the wrong uniform byte length');
    const time = performance.now();
    queue.writeBuffer(camera, 0, uniform);
    if (adapterUniforms) queue.writeBuffer(adapterUniforms, 0, adapterData);
    const cameraUpload = { bytes: uniformBytes, cpuMs: performance.now() - time };

    const encoder = device.createCommandEncoder({ label: 'Gaussian visibility and draw' });
    encoder.clearBuffer(draw);
    const visibility = encoder.beginComputePass({ label: 'Project and cull', ...timestamps(frame.profile, 0) });
    visibility.setPipeline(project);
    for (const handle of handles) {
      if (!handle.count) continue;
      const chunk = chunks.get(handle);
      chunk.projection ??= group(project, camera, chunk.points, workspace.ellipses, workspace.keys, draw,
        ...(adapterUniforms ? [adapterUniforms] : []), ...adapterBindings);
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
    } else if (contour) {
      if (workspace.atlas !== atlas) {
        workspace.atlas = atlas;
        workspace.contourBindings = workspace.drawModes.map(mode => group(mode, camera, workspace.ellipses, workspace.keys, atlas));
      }
      const drawGrid = (color, depthTarget, grid) => {
        const pass = encoder.beginRenderPass({
          label: grid ? 'Rasterize native contours' : 'Rasterize supersampled contours',
          ...timestamps(frame.profile, 4 + grid * 2),
          colorAttachments: [
            { view: color, clearValue: background, loadOp: 'clear', storeOp: 'store' },
            { view: depthTarget.createView({ mipLevelCount: 1 }), clearValue: [1, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }
          ]
        });
        pass.setPipeline(workspace.drawModes[grid]);
        pass.setBindGroup(0, workspace.contourBindings[grid]);
        pass.drawIndirect(draw, 0);
        pass.end();
      };
      drawGrid(output, depth, 0);
      drawGrid(nativeColor.createView({ mipLevelCount: 1 }), nativeDepth, 1);
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
    const timestampCount = timed ? (contour ? 8 : 6) : 0;
    if (frame.profile) {
      const offset = timestampCount * 8;
      staging = buffer('Gaussian profile readback', offset + wordBytes + (selective?.statBytes ?? 0), usage.COPY_DST | usage.MAP_READ);
      if (timed) {
        encoder.resolveQuerySet(query, 0, timestampCount, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, staging, 0, offset);
      }
      encoder.copyBufferToBuffer(draw, wordBytes, staging, offset, wordBytes);
      if (selective) encoder.copyBufferToBuffer(selective.stats,0,staging,offset+wordBytes,selective.statBytes);
    }
    queue.submit([encoder.finish()]);
    const report = { input, cloudUpload: { ...upload }, cameraUpload, workBytes: workspace.bytes,
      ...(setting && { gaussianFilter: setting }), ...(local && { transparencyUniformBytes:64 }) };
    return staging ? readProfile(staging, report, selective, timestampCount) : report;
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
    if (adapterUniforms) adapterUniforms.destroy();
    query?.destroy();
    resolved?.destroy();
  }
  return Object.freeze({ setWorld, render, uploadChunk, updateChunk, createFootprintAtlas, renderChunks, dispose, format, maxSplats, timestamps: timed });
}
