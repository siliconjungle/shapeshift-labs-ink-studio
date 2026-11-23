import * as shared from '../selective-transparency.js';

export const transparencySettings = shared.default ?? globalThis[Symbol.for('ink-studio.selective-transparency')];
const counterNames = ['culledFragments','overlapPixels','crossingPixels','sortedPixels',
  'layerBudgetPixels','fragmentBudgetPixels','pixelBudgetPixels'];

function bindings(group, maskAccess, recordsAccess) {
  return /* wgsl */ `
struct LocalOrder {
  rect: vec4u,
  grid: vec4u, // allocated pixels, layers, tile size, tile columns
  cut: vec4f, // color threshold, depth bias, opaque input, diagnostics
  background: vec4f,
}
@group(${group}) @binding(0) var<uniform> localOrder: LocalOrder;
@group(${group}) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(${group}) @binding(2) var<storage, ${recordsAccess}> records: array<vec4u>;
@group(${group}) @binding(3) var<storage, ${maskAccess}> counters: array<atomic<u32>>;
@group(${group}) @binding(4) var opaqueSurface: texture_2d<f32>;

fn localPixel(pixel: vec2u) -> u32 {
  if (any(pixel < localOrder.rect.xy) || any(pixel >= localOrder.rect.xy + localOrder.rect.zw)) {
    return 0xffffffffu;
  }
  let within = pixel - localOrder.rect.xy;
  return within.y * localOrder.rect.z + within.x;
}
fn recordStat(pixel: vec2u, channel: u32) {
  if (localOrder.cut.w > 0.5) {
    let tile = pixel / localOrder.grid.z;
    atomicAdd(&counters[(tile.y * localOrder.grid.w + tile.x) * ${counterNames.length}u + channel],1u);
  }
}
fn backdrop(pixel: vec2u) -> vec4f {
  if (localOrder.cut.z > 0.5) {
    let opaque = textureLoad(opaqueSurface,vec2i(pixel),0);
    if (opaque.a > 0.0) { return vec4f(opaque.rgb,1.0); }
  }
  return localOrder.background;
}
`;
}

export const captureTransparency = bindings(1, 'read_write', 'read_write') + /* wgsl */ `
fn captureLocal(pixel: vec2u, rank: u32, depth: f32, rgb: vec3f, alpha: f32) {
  if (localOrder.cut.z > 0.5) {
    let opaque = textureLoad(opaqueSurface,vec2i(pixel),0).a;
    if (opaque > 0.0 && depth > opaque + localOrder.cut.y) {
      recordStat(pixel,0u);
      discard;
    }
  }
  let index = localPixel(pixel);
  if (index != 0xffffffffu) {
    let slot = atomicAdd(&counts[index],1u);
    if (index < localOrder.grid.x && slot < localOrder.grid.y) {
      records[index * localOrder.grid.y + slot] =
        vec4u(rank,bitcast<u32>(depth),pack4x8unorm(vec4f(rgb,1.0)),bitcast<u32>(alpha));
    }
  }
}
`;

const vertex = /* wgsl */ `
@vertex
fn vertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let points = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(points[id],0,1);
}
`;

const baseShader = vertex + bindings(0, 'read_write', 'read_write') + /* wgsl */ `
@fragment
fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return backdrop(vec2u(position.xy));
}
`;

const resolveShader = vertex + bindings(0, 'read_write', 'read_write') + /* wgsl */ `
@group(0) @binding(5) var centerColor: texture_2d<f32>;

fn precedes(a: vec4u,b: vec4u) -> bool {
  return a.y>b.y || (a.y==b.y && a.x<b.x);
}
fn colorDistance(a: vec3f,b: vec3f) -> f32 {
  let delta = abs(a-b);
  return max(delta.x,max(delta.y,delta.z));
}

@fragment
fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(position.xy);
  let center = textureLoad(centerColor,vec2i(pixel),0);
  let index = localPixel(pixel);
  if (index == 0xffffffffu) { return center; }
  let count = atomicLoad(&counts[index]);
  if (count < 2u) { return center; }
  recordStat(pixel,1u);
  if (index >= localOrder.grid.x) { recordStat(pixel,6u); return center; }
  if (count > localOrder.grid.y) { recordStat(pixel,4u); return center; }
  var stack: array<vec4u,8>;
  let base = index*localOrder.grid.y;
  var bound = 0.0;
  // Fragments can execute in any order. The raster instance rank is the
  // painter order and the depth key is the order at this pixel.
  for (var i=0u; i<count; i++) {
    let a = records[base+i];
    stack[i] = a;
    for (var j=0u; j<i; j++) {
      let b = stack[j];
      if (a.y != b.y && (a.x < b.x) != precedes(a,b)) {
        bound += bitcast<f32>(a.w)*bitcast<f32>(b.w)*
          colorDistance(unpack4x8unorm(a.z).rgb,unpack4x8unorm(b.z).rgb);
      }
    }
  }
  if (bound <= 0.0 || bound < localOrder.cut.x) { return center; }
  recordStat(pixel,2u);
  for (var i=1u; i<count; i++) {
    let next = stack[i];
    var j = i;
    while (j > 0u && precedes(next,stack[j-1u])) {
      stack[j] = stack[j-1u];
      j -= 1u;
    }
    stack[j] = next;
  }
  var color = backdrop(pixel).rgb;
  for (var i=0u; i<count; i++) {
    let layer = stack[i];
    color = mix(color,unpack4x8unorm(layer.z).rgb,bitcast<f32>(layer.w));
  }
  if (colorDistance(center.rgb,color) <= localOrder.cut.x) { return center; }
  recordStat(pixel,3u);
  return vec4f(color,1.0);
}
`;

export async function createSelectiveDraw(device, format, affineSource, exactSource) {
  const u = GPUBufferUsage, stage = GPUShaderStage.FRAGMENT;
  const fragmentEntries = [
    { binding:0, visibility:stage, buffer:{type:'uniform'} },
    { binding:1, visibility:stage, buffer:{type:'storage'} },
    { binding:2, visibility:stage, buffer:{type:'storage'} },
    { binding:3, visibility:stage, buffer:{type:'storage'} },
    { binding:4, visibility:stage, texture:{sampleType:'unfilterable-float'} }
  ];
  const inputLayout = device.createBindGroupLayout({ entries:fragmentEntries });
  const resolveLayout = device.createBindGroupLayout({ entries:[
    ...fragmentEntries, { binding:5, visibility:stage, texture:{sampleType:'unfilterable-float'} }
  ] });
  const drawLayout = device.createBindGroupLayout({ entries:[
    {binding:0,visibility:GPUShaderStage.VERTEX|stage,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.VERTEX|stage,buffer:{type:'read-only-storage'}},
    {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}
  ] });
  const blend = { srcFactor:'one', dstFactor:'one-minus-src-alpha', operation:'add' };
  function pipeline(label, code, layouts, target, blended = false) {
    const module = device.createShaderModule({ label, code });
    return device.createRenderPipelineAsync({ label,
      layout:device.createPipelineLayout({bindGroupLayouts:layouts}),
      vertex:{module,entryPoint:'vertex'},
      fragment:{module,entryPoint:'fragment',targets:[{format:target,
        ...(blended && { blend:{color:blend,alpha:blend} }) }]},
      primitive:{topology:blended ? 'triangle-strip' : 'triangle-list'}
    });
  }
  const [affine, exact, base, resolve] = await Promise.all([
    pipeline('Selective affine transparency',affineSource,[drawLayout,inputLayout],'rgba16float',true),
    pipeline('Selective ray transparency',exactSource,[drawLayout,inputLayout],'rgba16float',true),
    pipeline('Opaque transparency backdrop',baseShader,[inputLayout],'rgba16float'),
    pipeline('Selective crossing resolve',resolveShader,[resolveLayout],format)
  ]);
  const gpuBuffer = (label,size,usage) => device.createBuffer({label,size,usage});
  const params = gpuBuffer('Selective transparency settings',64,u.UNIFORM|u.COPY_DST);
  const emptySurface = device.createTexture({size:[1,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});
  const unused = emptySurface.createView();
  let memory, geometry;
  const maxBytes = Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize);

  function closeMemory() {
    for (const value of memory?.owned ?? []) value.destroy();
  }
  function prepare(width, height, settings, opaque, background, reads) {
    if (opaque && (opaque.format !== 'rgba32float' || opaque.width !== width || opaque.height !== height ||
        opaque.dimension !== '2d' || opaque.depthOrArrayLayers !== 1 || opaque.sampleCount !== 1 ||
        !(opaque.usage & GPUTextureUsage.TEXTURE_BINDING)))
      throw new TypeError('Opaque transparency surface needs a sampled RGBA32F texture at the art-grid size');
    const rect = transparencySettings.bounds(settings.region,width,height);
    const pixels = rect[2]*rect[3], slots = Math.min(pixels,settings.maxPixels,Math.floor(maxBytes/(16*settings.layers)));
    const columns = Math.ceil(width/settings.tileSize), rows = Math.ceil(height/settings.tileSize);
    const statBytes = columns*rows*counterNames.length*4;
    if (Math.max(statBytes,pixels*4) > maxBytes) throw new RangeError('Selective transparency exceeds the WebGPU storage limit');
    const key = [width,height,pixels,slots,settings.layers,columns,rows].join('/');
    if (key !== memory?.key) {
      closeMemory();
      const counts = gpuBuffer('Selective pixel counts',pixels*4,u.STORAGE|u.COPY_DST);
      const records = gpuBuffer('Selective local layers',slots*settings.layers*16,u.STORAGE);
      const stats = gpuBuffer('Selective transparency tiles',statBytes,u.STORAGE|u.COPY_DST|u.COPY_SRC);
      const scene = device.createTexture({size:[width,height],format:'rgba16float',
        usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
      memory = { key, counts,records,stats,scene,view:scene.createView(),owned:[counts,records,stats,scene] };
    }
    const {counts,records,stats,view} = memory;
    const buffer = new ArrayBuffer(64);
    new Uint32Array(buffer,0,8).set([...rect,slots,settings.layers,settings.tileSize,columns]);
    new Float32Array(buffer,32).set([settings.colorDelta,settings.depthBias,+!!opaque,+reads,...background]);
    device.queue.writeBuffer(params,0,buffer);
    const resources = [{buffer:params},{buffer:counts},{buffer:records},{buffer:stats},opaque?.createView({mipLevelCount:1}) ?? unused];
    const entries = values => values.map((resource,binding)=>({resource,binding}));
    const rasterBindings = device.createBindGroup({layout:inputLayout,entries:entries(resources)});
    const finishBindings = device.createBindGroup({layout:resolveLayout,entries:entries([...resources,view])});

    function draw(encoder, workspace, camera, target, rasterTimes, finishTimes) {
      if (geometry?.keys !== workspace.keys) {
        geometry = {keys:workspace.keys,binding:device.createBindGroup({layout:drawLayout,
          entries:entries([{buffer:camera},{buffer:workspace.ellipses},{buffer:workspace.keys}]) })};
      }
      encoder.clearBuffer(counts);
      if (reads) encoder.clearBuffer(stats);
      const raster = encoder.beginRenderPass({label:'Capture visible transparency',...rasterTimes,
        colorAttachments:[{view,clearValue:background,loadOp:'clear',storeOp:'store'}]});
      if (opaque) {
        raster.setPipeline(base);
        raster.setBindGroup(0,rasterBindings);
        raster.draw(3);
      }
      raster.setPipeline(workspace.ray ? exact : affine);
      raster.setBindGroup(0,geometry.binding);
      raster.setBindGroup(1,rasterBindings);
      raster.drawIndirect(workspace.draw,0);
      raster.end();
      const output = encoder.beginRenderPass({label:'Resolve selective crossings',...finishTimes,
        colorAttachments:[{view:target,loadOp:'clear',storeOp:'store'}]});
      output.setPipeline(resolve);
      output.setBindGroup(0,finishBindings);
      output.draw(3);
      output.end();
    }

    function read(bytes, offset) {
      const values = new Uint32Array(bytes,offset,statBytes/4);
      const receipt = transparencySettings.report(settings,width,height,{capturePixels:slots});
      for (let i=0;i<values.length;i++) {
        if (!values[i]) continue;
        const tile = Math.floor(i/counterNames.length);
        receipt.record((tile%columns)*settings.tileSize,Math.floor(tile/columns)*settings.tileSize,
          counterNames[i%counterNames.length],values[i]);
      }
      return receipt.finish();
    }

    return { draw, read, stats, statBytes };
  }
  return { prepare, dispose() { closeMemory(); params.destroy(); emptySurface.destroy(); } };
}
