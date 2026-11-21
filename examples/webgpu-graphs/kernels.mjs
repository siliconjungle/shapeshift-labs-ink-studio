export const textureWidth = 480;
export const textureHeight = 324;
export const gridSize = 129;

export const generateTexture = `
struct Settings { time: f32, amount: f32, aspect: f32, unused: f32 }
@group(0) @binding(0) var<uniform> params: Settings;
@group(0) @binding(1) var outImage: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outImage);
  if (any(id.xy >= size)) { return; }
  var p = (vec2f(id.xy) + .5) / vec2f(size) * 2.0 - 1.0;
  p.x *= f32(size.x) / f32(size.y);
  let t = params.time * .33;
  let r = length(p + vec2f(.35 * sin(t), -.23));
  let s = length(p - vec2f(.55, .18 * cos(t * 1.7)));
  let wave = sin(r * 28.0 - 3.0 * t) + sin(s * 23.0 + 2.2 * t);
  let contour = 1.0 - smoothstep(.035, .17, abs(wave - .55));
  let ridge = .5 + .5 * sin(wave * 2.8 - p.x * 2.4);
  let ink = mix(vec3f(.025, .058, .107), vec3f(.10, .51, .60), pow(ridge, 1.7));
  let light = contour * mix(vec3f(.16, .80, .80), vec3f(.91, .74, .51), smoothstep(-.5, .85, p.x));
  let grain = fract(sin(dot(vec2f(id.xy), vec2f(12.9898, 78.233))) * 43758.5453);
  textureStore(outImage, vec2i(id.xy), vec4f(ink * (0.89 + .15 * grain) + .82 * light, 1));
}`;

export const filterTexture = `
struct Settings { time: f32, amount: f32, aspect: f32, unused: f32 }
@group(0) @binding(0) var<uniform> params: Settings;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var result: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(source);
  if (any(id.xy >= size)) { return; }
  let p = vec2i(id.xy);
  let shift = i32(params.amount * 19.0 * sin(f32(p.y) * .085 + params.time));
  let lo = vec2i(0);
  let hi = vec2i(size) - 1;
  let r = textureLoad(source, clamp(p + vec2i(shift, 0), lo, hi), 0).r;
  let g = textureLoad(source, p, 0).g;
  let b = textureLoad(source, clamp(p - vec2i(shift, 0), lo, hi), 0).b;
  textureStore(result, p, vec4f(r, g, b, 1));
}`.trim();

export const generateMesh = `
@group(0) @binding(0) var<storage, read_write> surface: array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = ${gridSize}u;
  if (id.x >= n*n) { return; }
  let u = f32(id.x % n) / f32(n - 1);
  let v = f32(id.x / n) / f32(n - 1);
  surface[id.x] = vec4f(u, v, 0, 1);
}`;

export const shapeMesh = `
struct Settings { time: f32, amount: f32, aspect: f32, unused: f32 }
@group(0) @binding(0) var<uniform> params: Settings;
@group(0) @binding(1) var<storage, read> surface: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> shaped: array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&surface)) { return; }
  let uv = surface[id.x].xy;
  let u = uv.x * 6.2831853;
  let v = uv.y * 2.0 - 1.0;
  let curve = u + v * (.95 + params.amount);
  let t = params.time * .55;
  let ripple = sin(7.0 * u + v * 4.0 - t * 2.3) * cos(v * 3.14159);
  let r = .34 + .42 * (1.0 - v * v) + ripple * (.055 + .060 * params.amount);
  shaped[id.x] = vec4f(r * cos(curve), v * .68 + .087 * sin(4.0 * curve + t), r * sin(curve), ripple);
}`;

export const presentTexture = `
@group(0) @binding(0) var image: texture_2d<f32>;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return textureLoad(image, vec2i(p.xy), 0);
}`;

export const presentMesh = `
struct Settings { time: f32, amount: f32, aspect: f32, unused: f32 }
struct Output { @builtin(position) position: vec4f, @location(0) color: vec3f }
@group(0) @binding(0) var<uniform> params: Settings;
@group(0) @binding(1) var<storage,read> shaped: array<vec4f>;
@group(0) @binding(2) var art: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) index: u32) -> Output {
  let n = ${gridSize}u;
  let p = shaped[index];
  let u = f32(index % n) / f32(n-1);
  let v = f32(index / n) / f32(n-1);
  let spin = params.time * .34 + .5;
  let c = cos(spin);
  let s = sin(spin);
  let x = p.x * c - p.z * s;
  let z = p.x * s + p.z * c;
  let y = p.y * .94 - z * .34;
  let depth = p.y * .34 + z * .94;
  let extent = textureDimensions(art);
  let sampleAt = vec2i(vec2f(u, v) * vec2f(extent - 1u));
  let sampleColor = textureLoad(art, sampleAt, 0).rgb;
  let glow = pow(.5 + .5 * p.w, 2.2);
  let light = .50 + .50 * max(0.0, .6 - depth);
  let color = mix(vec3f(.025, .28, .34), vec3f(.59, .89, .78), glow) * light;
  var out: Output;
  out.position = vec4f(x * 1.16 / params.aspect, y * 1.16, depth * .35 + .5, 1);
  out.color = color * .79 + sampleColor * .39;
  return out;
}
@fragment
fn fs(input: Output) -> @location(0) vec4f {
  return vec4f(input.color, 1);
}`;
