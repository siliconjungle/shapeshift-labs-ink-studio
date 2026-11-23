export const sortTile = 256;
const lanes = sortTile / 2;

const camera = /* wgsl */ `
struct Camera {
  view: mat4x4f,
  viewport: vec4f, // half width, half height, focal length in pixels, orthographic flag
  clip: vec4f,
}
struct Ellipse {
  center: vec2f,
  axisX: vec2f,
  axisY: vec2f,
  rgb: u32,
  alpha: f32,
}
@group(0) @binding(0) var<uniform> camera: Camera;
`;

// One reservation per workgroup in the shared visible list. The source index
// stays with the key so scheduling cannot change the order of equal depths.
export const projectionShader = camera + /* wgsl */ `
struct Point {
  position: vec4f,
  covariance0: vec4f,
  covariance1: vec4f,
  extra: vec4f,
}
@group(0) @binding(1) var<storage, read> points: array<Point>;
@group(0) @binding(2) var<storage, read_write> ellipses: array<Ellipse>;
@group(0) @binding(3) var<storage, read_write> keys: array<vec4u>;
@group(0) @binding(4) var<storage, read_write> draw: array<atomic<u32>, 4>;
var<workgroup> visible: atomic<u32>;
var<workgroup> first: u32;

fn project(index: u32, xyz: vec3f, depth: f32) -> Ellipse {
  var ellipse: Ellipse;
  if (index >= arrayLength(&points) || !(depth >= camera.clip.x && depth <= camera.clip.y)) { return ellipse; }
  let point = points[index];
  if (point.position.w < 0.004) { return ellipse; }
  let viewport = camera.viewport.xy;
  let focal = camera.viewport.z;
  let perspective = camera.viewport.w == 0.0;
  let pixelScale = select(focal, focal / depth, perspective);
  let center = xyz.xy * pixelScale;
  let right = vec3f(camera.view[0].x, camera.view[1].x, camera.view[2].x);
  let up = vec3f(camera.view[0].y, camera.view[1].y, camera.view[2].y);
  let back = vec3f(camera.view[0].z, camera.view[1].z, camera.view[2].z);
  // Bound the perspective Jacobian at the screen edges while keeping the true center for culling.
  let slope = clamp(xyz.xy / depth, -1.3 * viewport / focal, 1.3 * viewport / focal);
  let jx = pixelScale * (right + select(vec3f(0), back * slope.x, perspective));
  let jy = pixelScale * (up + select(vec3f(0), back * slope.y, perspective));
  let a = point.covariance0.xyz;
  let b = point.covariance1.xyz;
  let covariance = mat3x3f(a, vec3f(a.y, b.x, b.y), vec3f(a.z, b.y, b.z));
  let covX = covariance * jx;
  let covY = covariance * jy;
  let xx = dot(jx, covX) + 0.3;
  let xy = dot(jy, covX);
  let yy = dot(jy, covY) + 0.3;
  if (!(xx > 0.0 && yy > 0.0)) { return ellipse; }
  let extent = 3.0 * sqrt(vec2f(xx, yy));
  if (any(abs(center) - extent >= viewport)) { return ellipse; }
  let halfTrace = (xx + yy) * 0.5;
  let halfGap = length(vec2f((xx - yy) * 0.5, xy));
  let major = halfTrace + halfGap;
  let minor = (xx * yy - xy * xy) / major;
  if (!(minor > 0.0 && major < 1e18)) { return ellipse; }
  var axis = vec2f(1.0, 0.0);
  if (halfGap > 1e-12) {
    let axisA = vec2f(major - yy, xy);
    let axisB = vec2f(xy, major - xx);
    axis = normalize(select(axisB, axisA, xx >= yy));
  }
  return Ellipse(center, 3.0 * sqrt(major) * axis,
    3.0 * sqrt(minor) * vec2f(-axis.y, axis.x), u32(point.covariance0.w), point.position.w);
}

@compute @workgroup_size(${lanes})
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { atomicStore(&visible, 0u); }
  workgroupBarrier();
  var xyz: vec3f;
  if (id.x < arrayLength(&points)) { xyz = (camera.view * vec4f(points[id.x].position.xyz, 1.0)).xyz; }
  let depth = -xyz.z;
  let ellipse = project(id.x, xyz, depth);
  var offset = 0u;
  if (ellipse.alpha > 0.0) { offset = atomicAdd(&visible, 1u); }
  workgroupBarrier();
  if (lane == 0u) {
    let size = atomicLoad(&visible);
    if (size > 0u) { first = atomicAdd(&draw[1], size); }
  }
  workgroupBarrier();
  if (ellipse.alpha > 0.0) {
    let slot = first + offset;
    ellipses[slot] = ellipse;
    keys[slot] = vec4u(bitcast<u32>(depth), id.x, slot, 0u);
  }
}
`;

export const dispatchShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> draw: array<atomic<u32>, 4>;
@group(0) @binding(1) var<storage, read_write> dispatch: array<u32>;

@compute @workgroup_size(1)
fn main() {
  let count = atomicLoad(&draw[1]);
  atomicStore(&draw[0], 4u);
  var tiles = 0u;
  if (count > 0u) {
    let required = (count + ${sortTile - 1}u) / ${sortTile}u;
    tiles = 1u << (32u - countLeadingZeros(required - 1u));
  }
  for (var i = 0u; i < arrayLength(&dispatch) / 3u; i++) {
    dispatch[i * 3u] = select(0u, tiles, (1u << i) <= tiles);
    dispatch[i * 3u + 1u] = 1u;
    dispatch[i * 3u + 2u] = 1u;
  }
}
`;

export const sortingShader = /* wgsl */ `
struct Stage { span: u32, stride: u32, padding: vec2u }
@group(0) @binding(0) var<storage, read_write> keys: array<vec4u>;
@group(0) @binding(1) var<storage, read> draw: array<u32, 4>;
@group(0) @binding(2) var<uniform> stage: Stage;
var<workgroup> tile: array<vec4u, ${sortTile}>;

// Positive f32 depth has the same order as its unsigned bits. Empty lanes
// carry zero and sort behind every visible sample.
fn precedes(a: vec4u, b: vec4u) -> bool {
  return a.x > b.x || (a.x == b.x && a.y < b.y);
}
fn firstOfPair(thread: u32, stride: u32) -> u32 {
  return (thread / stride) * (stride * 2u) + thread % stride;
}
fn tileStep(base: u32, thread: u32, span: u32, stride: u32) {
  let lo = firstOfPair(thread, stride);
  let hi = lo + stride;
  let a = tile[lo];
  let b = tile[hi];
  let forward = ((base + lo) & span) == 0u;
  if (select(precedes(a, b), precedes(b, a), forward)) {
    tile[lo] = b;
    tile[hi] = a;
  }
}

@compute @workgroup_size(${lanes})
fn seed(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let base = group.x * ${sortTile}u;
  let second = lane + ${lanes}u;
  let count = draw[1];
  // The previous frame can have more visible splats. Always initialize padding.
  tile[lane] = select(vec4u(0u), keys[base + lane], base + lane < count);
  tile[second] = select(vec4u(0u), keys[base + second], base + second < count);
  workgroupBarrier();
  for (var span = 2u; span <= ${sortTile}u; span *= 2u) {
    for (var stride = span / 2u; stride > 0u; stride /= 2u) {
      tileStep(base, lane, span, stride);
      workgroupBarrier();
    }
  }
  keys[base + lane] = tile[lane];
  keys[base + second] = tile[second];
}

@compute @workgroup_size(${lanes})
fn crossTile(@builtin(global_invocation_id) id: vec3u) {
  let lo = firstOfPair(id.x, stage.stride);
  let hi = lo + stage.stride;
  let a = keys[lo];
  let b = keys[hi];
  let forward = (lo & stage.span) == 0u;
  if (select(precedes(a, b), precedes(b, a), forward)) {
    keys[lo] = b;
    keys[hi] = a;
  }
}

@compute @workgroup_size(${lanes})
fn finishTile(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let base = group.x * ${sortTile}u;
  let second = lane + ${lanes}u;
  tile[lane] = keys[base + lane];
  tile[second] = keys[base + second];
  workgroupBarrier();
  for (var stride = ${lanes}u; stride > 0u; stride /= 2u) {
    tileStep(base, lane, stage.span, stride);
    workgroupBarrier();
  }
  keys[base + lane] = tile[lane];
  keys[base + second] = tile[second];
}
`;

export const rasterShader = camera + /* wgsl */ `
@group(0) @binding(1) var<storage, read> ellipses: array<Ellipse>;
@group(0) @binding(2) var<storage, read> keys: array<vec4u>;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
}

@vertex
fn vertex(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let ellipse = ellipses[keys[instance].z];
  let uv = vec2f(f32(id & 1u), f32(id >> 1u)) * 2.0 - 1.0;
  let position = (ellipse.center + uv.x * ellipse.axisX + uv.y * ellipse.axisY) / camera.viewport.xy;
  let color = unpack4x8unorm(ellipse.rgb);
  return Vertex(vec4f(position, 0.0, 1.0), uv, vec4f(color.rgb, ellipse.alpha));
}

@fragment
fn fragment(input: Vertex) -> @location(0) vec4f {
  let radiusSquared = dot(input.uv, input.uv);
  let alpha = min(0.99, input.color.a * exp(-4.5 * radiusSquared));
  if (radiusSquared > 1.0 || alpha < 0.004) { discard; }
  return vec4f(input.color.rgb * alpha, alpha);
}
`;
