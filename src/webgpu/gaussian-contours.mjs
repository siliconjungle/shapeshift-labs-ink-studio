const shader = /* wgsl */ `
struct Palette {
  settings: vec4f,
  colors: array<vec4f,64>,
  mapped: array<vec4f,64>,
}
@group(0) @binding(0) var high: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_2d<f32>;
@group(0) @binding(2) var native: texture_2d<f32>;
@group(0) @binding(3) var<uniform> pal: Palette;
@group(0) @binding(4) var nativeDepth: texture_2d<f32>;
const weights = vec3f(.30,.55,.15);
const bayer = array<f32,16>(0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
fn nearest(c: vec3f, solid: bool) -> u32 {
  let count = u32(pal.settings.x);
  var best = select(0u,1u,solid && count > 1u);
  var distance = 1e9;
  for (var i = best; i < count; i++) {
    let delta = c - pal.colors[i].xyz;
    let d = dot(delta * delta,weights);
    if (d < distance) { best = i; distance = d; }
  }
  return best;
}
fn pixelAt(p: vec2i) -> vec2i {
  return clamp(p, vec2i(0), vec2i(textureDimensions(depth)) - 1);
}
fn pixelDepth(p: vec2i) -> f32 {
  var result = 1.0;
  for (var i = 0i; i < 4; i++) {
    // Sample bottom first to preserve WebGL's ordering when votes tie.
    result = min(result,textureLoad(depth,pixelAt(p*2+vec2i(i&1,1-(i>>1))),0).r);
  }
  return result;
}
@vertex fn vertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((id << 1u) & 2u),f32(id & 2u));
  return vec4f(corner*2.0-1.0,0.0,1.0);
}
@fragment fn fragment(@builtin(position) xy: vec4f) -> @location(0) vec4f {
  let p = vec2i(xy.xy);
  var mask = 0u;
  for (var i = 0i; i < 4; i++) {
    if (textureLoad(depth,pixelAt(p*2+vec2i(i&1,1-(i>>1))),0).r < .995) { mask |= 1u << u32(i); }
  }
  if (mask != 0u && (mask != 15u || max(max(pixelDepth(p-vec2i(1,0)),pixelDepth(p+vec2i(1,0))),
    max(pixelDepth(p-vec2i(0,1)),pixelDepth(p+vec2i(0,1)))) >= .995)) {
    var labels = array<i32,4>(-1,-1,-1,-1);
    for (var i = 0; i < 4; i++) {
      if ((mask & (1u << u32(i))) != 0u) {
        labels[i] = i32(nearest(textureLoad(high,pixelAt(p*2+vec2i(i&1,1-(i>>1))),0).rgb,true));
      }
    }
    var best = 0i; var score = 0i;
    for (var i = 0; i < 4; i++) {
      if (labels[i] < 0) { continue; }
      var count = 0i;
      for (var j = 0; j < 4; j++) { if (labels[i] == labels[j]) { count++; } }
      if (count > score) { best = labels[i]; score = count; }
    }
    let body = pal.mapped[best].xyz;
    let raw = body * .64;
    let ink = min(vec3f(1),raw * max(1.0,.12 / max(dot(raw,weights),.001)));
    return vec4f(mix(pal.mapped[0].xyz,mix(body,ink,.65),f32(countOneBits(mask))*.25),1);
  }
  let bottomUp = i32(textureDimensions(native).y) - 1 - p.y;
  let noise = ((bayer[(p.x&3) + ((bottomUp&3)<<2)] + .5) / 16.0 - .5) * pal.settings.y;
  var color = textureLoad(native,p,0).rgb;
  if (pal.settings.z > 0.0) {
    let offsets = array<vec2i,8>(vec2i(2,0),vec2i(-2,0),vec2i(0,2),vec2i(0,-2),
      vec2i(1,1),vec2i(-1,1),vec2i(1,-1),vec2i(-1,-1));
    let size = vec2i(textureDimensions(nativeDepth))-1;
    let center = textureLoad(nativeDepth,p,0).r;
    var occlusion = 0.0;
    for (var i = 0u; i < 8u; i++) {
      let neighbor = textureLoad(nativeDepth,clamp(p+offsets[i],vec2i(0),size),0).r;
      let near = (center-neighbor)/pal.settings.w;
      if (near > .08 && near < 3.0) { occlusion += min(1.0,near); }
    }
    color *= 1.0-pal.settings.z*min(1.0,occlusion/4.0);
  }
  let pColor = clamp(color + noise,vec3f(0),vec3f(1));
  return vec4f(pal.mapped[nearest(pColor,false)].xyz,1);
}
`;

export async function createGaussianContourResolve(device, { format = 'rgba8unorm' } = {}) {
  if (!device?.createRenderPipelineAsync || !globalThis.GPUTextureUsage)
    throw new TypeError('A WebGPU device is required');
  const module = device.createShaderModule({ label: 'Gaussian contour palette resolve', code: shader });
  const pipeline = await device.createRenderPipelineAsync({
    label: 'Gaussian contour palette resolve',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertex' },
    fragment: { module, entryPoint: 'fragment', targets: [{ format }] }
  });
  const maxColors = 64;
  const bytes = new Float32Array(4 + 8 * maxColors);
  const palette = device.createBuffer({ label: 'Contour palette', size: bytes.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let current, disposed = false;

  return {
    resolve(output, { high, depth, native, nativeDepth }, { colors, grade, dither = .35, ao = 0, reach = 1 } = {}) {
      if (disposed) throw new Error('Gaussian contour resolve is disposed');
      if (!output?.createView || output.format !== format || output.dimension !== '2d' || output.depthOrArrayLayers !== 1 ||
          output.sampleCount !== 1 || !(output.usage & GPUTextureUsage.RENDER_ATTACHMENT))
        throw new TypeError('Supply a single-sampled render target in the contour resolve format');
      const { width, height } = output;
      const sampledAt = (texture, scale) => texture?.createView && texture.width === width * scale &&
        texture.height === height * scale && texture.dimension === '2d' && texture.depthOrArrayLayers === 1 &&
        texture.sampleCount === 1 && (texture.usage & GPUTextureUsage.TEXTURE_BINDING);
      if (!sampledAt(high, 2) || !sampledAt(depth, 2) || !sampledAt(native, 1) || !sampledAt(nativeDepth, 1) ||
          depth.format !== 'rgba8unorm' || nativeDepth.format !== 'rgba8unorm' || output === native || output === nativeDepth)
        throw new TypeError('Supply sampled native and double-resolution color and RGBA8 depth textures');
      const count = Math.min(colors?.length ?? 0, maxColors);
      if (!count || ![dither, ao, reach].every(Number.isFinite) || reach <= 0 ||
          (grade && grade.length < count * 3))
        throw new TypeError('Supply a palette, optional RGB grading, and finite contour resolve settings');

      bytes.set([count, dither, ao, reach]);
      for (let i = 0; i < count; i++) {
        const hex = colors[i], base = i * 4 + 4, mapped = base + maxColors * 4;
        bytes.set([(hex >>> 16 & 255) / 255, (hex >>> 8 & 255) / 255, (hex & 255) / 255], base);
        for (let rgb = 0; rgb < 3; rgb++) bytes[mapped + rgb] = grade ? grade[i * 3 + rgb] : bytes[base + rgb];
      }
      const textures = [high, depth, native, nativeDepth];
      if (!current || textures.some((texture, i) => texture !== current.textures[i])) {
        const [highView, depthView, nativeView, nativeDepthView] = textures.map(texture => texture.createView({ mipLevelCount: 1 }));
        const entries = [highView, depthView, nativeView, { buffer: palette }, nativeDepthView]
          .map((resource, binding) => ({ resource, binding }));
        current = { textures, bindings: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }) };
      }
      device.queue.writeBuffer(palette, 0, bytes);
      const encoder = device.createCommandEncoder({ label: 'Resolve Gaussian contours' });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: output.createView({ mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, current.bindings);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      palette.destroy();
    }
  };
}
