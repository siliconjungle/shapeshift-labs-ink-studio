import { captureTransparency } from './selective-transparency.mjs';

export const sortTile = 256;
const lanes = sortTile / 2;

const camera = (ray, local) => /* wgsl */ `
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
  ${ray ? "rayX: vec4f, rayY: vec4f, rayZ: vec4f," : ""}
  ${local ? "localDepth: vec4f," : ""}
}
@group(0) @binding(0) var<uniform> camera: Camera;
`;

// One reservation per workgroup in the shared visible list. The source index
// stays with the key so scheduling cannot change the order of equal depths.
const perspective = local => /* wgsl */ `
fn limits(x: f32, z: f32, variance: f32, crossTerm: f32, zz: f32, focal: f32) -> vec2f {
  let a = z*z - 9.0*zz;
  let b = x*z - 9.0*crossTerm;
  let halfWidth = sqrt(max(0.0,9.0*(z*z*variance-2.0*z*x*crossTerm+x*x*zz-9.0*(variance*zz-crossTerm*crossTerm))));
  return (b+vec2f(-halfWidth,halfWidth))*focal/a;
}
fn whiten(cov: mat3x3f) -> mat3x3f {
  let eps = max(max(cov[0].x,cov[1].y),max(cov[2].z,1e-30))*1e-7;
  let a = sqrt(max(cov[0].x,eps));
  let b = cov[0].y/a;
  let c = cov[0].z/a;
  let d = sqrt(max(cov[1].y-b*b,eps));
  let e = (cov[1].z-b*c)/d;
  let f = sqrt(max(cov[2].z-c*c-e*e,eps));
  return mat3x3f(vec3f(a,b,c),vec3f(0,d,e),vec3f(0,0,f));
}
fn perspectiveEllipse(center: vec3f, cov: mat3x3f, variance: f32, rgb: u32, alpha: f32) -> Ellipse {
  let viewport = camera.viewport.xy;
  let focal = camera.viewport.z;
  let blur = variance*pow(center.z/focal,2.0);
  let L = whiten(cov+mat3x3f(vec3f(blur,0,0),vec3f(0,blur,0),vec3f(0)));
  let c = L*transpose(L);
  var lo = -viewport;
  var hi = viewport;
  if (center.z - 3.0*sqrt(c[2].z) > camera.clip.x) {
    let x = limits(center.x,center.z,c[0].x,c[0].z,c[2].z,focal);
    let y = limits(center.y,center.z,c[1].y,c[1].z,c[2].z,focal);
    lo = max(lo,vec2f(x.x,y.x));
    hi = min(hi,vec2f(x.y,y.y));
  }
  var empty: Ellipse;
  if (any(hi <= lo)) { return empty; }
  let a = L[0].x;
  let b = L[0].y;
  let c0 = L[0].z;
  let d = L[1].y;
  let e = L[1].z;
  let f = L[2].z;
  let x = vec3f(1.0/a,0,0);
  let y = vec3f(-b/(a*d),1.0/d,0);
  let z = vec3f((b*e-c0*d)/(a*d*f),-e/(d*f),1.0/f);
  let halfWidth = (hi-lo)*.5;
  return Ellipse((hi+lo)*.5,vec2f(halfWidth.x,0),vec2f(0,halfWidth.y),rgb,alpha,
    vec4f(x,dot(x,center)),vec4f(y,dot(y,center)),vec4f(z,dot(z,center))${local ? ",vec4f(0)" : ""});
}
`;

export const projectionShader = (ray = false, local = false) => camera(ray,local) + (ray ? perspective(local) : '') + /* wgsl */ `
struct Point {
  position: vec4f,
  covariance0: vec4f,
  covariance1: vec4f,
  extra: vec4f,
}
struct Chunk {
  identity: vec4u,
  points: array<Point>,
}
@group(0) @binding(1) var<storage, read> chunk: Chunk;
@group(0) @binding(2) var<storage, read_write> ellipses: array<Ellipse>;
@group(0) @binding(3) var<storage, read_write> keys: array<vec4u>;
@group(0) @binding(4) var<storage, read_write> draw: array<atomic<u32>, 4>;
var<workgroup> visible: atomic<u32>;
var<workgroup> first: u32;

fn project(index: u32, xyz: vec3f, depth: f32) -> Ellipse {
  var ellipse: Ellipse;
  if (index >= chunk.identity.z || !(depth >= camera.clip.x && depth <= camera.clip.y)) { return ellipse; }
  let point = chunk.points[index];
  let compensated = camera.clip.w > 0.0;
  let minimum = select(0.004, 0.0000152587890625, compensated);
  if (point.position.w < minimum) { return ellipse; }
  let viewport = camera.viewport.xy;
  let focal = camera.viewport.z;
  let perspective = camera.viewport.w == 0.0;
  let pixelScale = select(focal, focal / depth, perspective);
  let center = xyz.xy * pixelScale;
  let right = vec3f(camera.view[0].x, camera.view[1].x, camera.view[2].x);
  let up = vec3f(camera.view[0].y, camera.view[1].y, camera.view[2].y);
  let back = vec3f(camera.view[0].z, camera.view[1].z, camera.view[2].z);
  // Bound the perspective Jacobian at the screen edges while keeping the true center for culling.
  let rawSlope = xyz.xy / depth;
  let slope = select(clamp(rawSlope, -1.3 * viewport / focal, 1.3 * viewport / focal), rawSlope, compensated ${ray ? '|| perspective' : ''});
  let jx = pixelScale * (right + select(vec3f(0), back * slope.x, perspective));
  let jy = pixelScale * (up + select(vec3f(0), back * slope.y, perspective));
  let a = point.covariance0.xyz;
  let b = point.covariance1.xyz;
  let covariance = mat3x3f(a, vec3f(a.y, b.x, b.y), vec3f(a.z, b.y, b.z));
  let covX = covariance * jx;
  let covY = covariance * jy;
  let rawXX = dot(jx, covX);
  let xy = dot(jy, covX);
  let rawYY = dot(jy, covY);
  let variance = select(.3,camera.clip.z,camera.clip.z >= 0.0);
  let det = max(0.0,rawXX*rawYY - xy*xy);
  let change = variance * (max(0.0,rawXX+rawYY) + variance);
  var alpha = point.position.w;
  if (compensated && change > 0.0) { alpha *= sqrt(det/(det+change)); }
  if (!(alpha >= minimum)) { return ellipse; }
  let style = select(0u,u32(point.covariance1.w),chunk.identity.y != 0u);
  let rgb = u32(point.covariance0.w) | (style << 24u);
  let reach = select(3.0,point.extra.x,style > 0u);
  ${ray ? `
  if (perspective && style == 0u) {
    let basis = mat3x3f(right,up,-back);
    return perspectiveEllipse(vec3f(xyz.xy,depth),transpose(basis)*covariance*basis,variance,rgb,alpha);
  }` : ''}
  let xx = rawXX + variance;
  let yy = rawYY + variance;
  if (!(xx > 0.0 && yy > 0.0)) { return ellipse; }
  let extent = reach * sqrt(vec2f(xx, yy));
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
  ${local ? `
  let axial = covariance * -back;
  let xxz = dot(jx,axial);
  let yyz = dot(jy,axial);
  let slopeZ = vec2f(yy*xxz-xy*yyz,xx*yyz-xy*xxz)/(major*minor);
  let depthModel = vec4f(select(slopeZ,vec2f(0),style > 0u),3.0*sqrt(max(0.0,dot(-back,axial))),depth);
  ` : ''}
  return Ellipse(center, reach * sqrt(major) * axis,
    reach * sqrt(minor) * vec2f(-axis.y, axis.x), rgb, alpha${ray ? ',vec4f(0),vec4f(0),vec4f(0)' : ''}${local ? ',depthModel' : ''});
}

@compute @workgroup_size(${lanes})
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { atomicStore(&visible, 0u); }
  workgroupBarrier();
  var xyz: vec3f;
  if (id.x < chunk.identity.z) { xyz = (camera.view * vec4f(chunk.points[id.x].position.xyz, 1.0)).xyz; }
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
    keys[slot] = vec4u(bitcast<u32>(depth), chunk.identity.x, id.x, slot);
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
  return a.x > b.x || (a.x == b.x && (a.y < b.y || (a.y == b.y && a.z < b.z)));
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

export const rasterShader = (ray = false, local = false) => camera(ray,local) + (local ? captureTransparency : '') + /* wgsl */ `
@group(0) @binding(1) var<storage, read> ellipses: array<Ellipse>;
@group(0) @binding(2) var<storage, read> keys: array<vec4u>;
struct Footprints {
  parameters: array<vec4f, 128>,
  distance: array<f32>,
}
@group(0) @binding(3) var<storage, read> footprints: Footprints;

fn footprintCoverage(style: u32, p: vec2f) -> f32 {
  let slot = style - 1u;
  let base = slot * 16384u;
  let q = clamp((p / 3.0 + .5) * 127.0,vec2f(0),vec2f(127));
  let lo = vec2u(floor(q));
  let hi = min(lo+1u,vec2u(127u));
  let top = mix(footprints.distance[base+lo.y*128u+lo.x],footprints.distance[base+lo.y*128u+hi.x],fract(q.x));
  let bottom = mix(footprints.distance[base+hi.y*128u+lo.x],footprints.distance[base+hi.y*128u+hi.x],fract(q.x));
  let distance = select(mix(top,bottom,fract(q.y)),max(abs(p.x),abs(p.y))-1.0,any(abs(p)>vec2f(1.5)));
  let softness = footprints.parameters[slot*2u+1u].x;
  if (softness == 0.0) { return select(0.0,1.0,distance<=0.0); }
  return 1.0-smoothstep(-softness,softness,distance);
}
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  ${ray || local ? '@location(2) @interpolate(flat) slot: u32,' : ''}
  ${local ? '@location(3) @interpolate(flat) rank: u32,' : ''}
  @location(4) @interpolate(flat) style: u32,
}

@vertex
fn vertex(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let slot = keys[instance].w;
  let ellipse = ellipses[slot];
  let uv = vec2f(f32(id & 1u), f32(id >> 1u)) * 2.0 - 1.0;
  let position = (ellipse.center + uv.x * ellipse.axisX + uv.y * ellipse.axisY) / camera.viewport.xy;
  let color = unpack4x8unorm(ellipse.rgb);
  let style = ellipse.rgb >> 24u;
  var sampleUV = uv;
  if (style != 0u) {
    let parameters = footprints.parameters[(style-1u)*2u];
    let reach = footprints.parameters[(style-1u)*2u+1u].y / 1.1774100225;
    let projected = reach * (uv.x*normalize(ellipse.axisX)+uv.y*normalize(ellipse.axisY));
    sampleUV = vec2f(dot(parameters.xy,projected),dot(parameters.zw,projected));
  }
  return Vertex(vec4f(position, 0.0, 1.0), sampleUV, vec4f(color.rgb, ellipse.alpha)${ray || local ? ",slot" : ""}${local ? ",instance" : ""},style);
}

@fragment
fn fragment(input: Vertex) -> @location(0) vec4f {
  var power = -4.5 * dot(input.uv,input.uv);
  ${local ? `
  let sample = ellipses[input.slot];
  let screenOffset = vec2f(input.position.x-camera.viewport.x,camera.viewport.y-input.position.y)-sample.center;
  var localDepth = sample.localDepth.w +
    clamp(dot(screenOffset,sample.localDepth.xy),-sample.localDepth.z,sample.localDepth.z);
  ` : ''}
  ${ray ? `
  if (camera.viewport.w == 0.0 && input.style == 0u) {
    let ellipse = ellipses[input.slot];
    let pixel = vec2f(input.position.x-camera.viewport.x,camera.viewport.y-input.position.y);
    let ray = vec3f(pixel/camera.viewport.z,1);
    let r = vec3f(dot(ellipse.rayX.xyz,ray),dot(ellipse.rayY.xyz,ray),dot(ellipse.rayZ.xyz,ray));
    let p = vec3f(ellipse.rayX.w,ellipse.rayY.w,ellipse.rayZ.w);
    let depth = clamp(dot(r,p)/dot(r,r),camera.clip.x,camera.clip.y);
    ${local ? "localDepth = depth;" : ""}
    let delta = p-r*depth;
    power = -.5*dot(delta,delta);
  }` : ''}
  let minimum = select(0.004,0.0000152587890625,camera.clip.w > 0.0);
  var coverage = exp(power);
  if (input.style != 0u) {
    coverage = footprintCoverage(input.style,input.uv);
  } else if (power < -4.5) { discard; }
  let alpha = min(0.99,input.color.a*coverage);
  if (alpha < minimum) { discard; }
  ${local ? 'captureLocal(vec2u(input.position.xy),input.rank,max(camera.clip.x,localDepth),input.color.rgb,alpha);' : ''}
  return vec4f(input.color.rgb * alpha, alpha);
}
`;

export const resolveShader = /* wgsl */ `
@group(0) @binding(0) var draw: texture_2d<f32>;

@vertex
fn vertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let quad = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(quad[id],0,1);
}

@fragment
fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  return textureLoad(draw,vec2i(pixel.xy),0);
}
`;
