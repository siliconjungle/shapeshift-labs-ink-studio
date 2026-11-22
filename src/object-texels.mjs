// The capture faces use local right and down axes, in atlas row order.
const faces = [
  [[1,0,0],[0,0,-1],[0,-1,0]], [[-1,0,0],[0,0,1],[0,-1,0]],
  [[0,1,0],[1,0,0],[0,0,1]], [[0,-1,0],[1,0,0],[0,0,-1]],
  [[0,0,1],[1,0,0],[0,-1,0]], [[0,0,-1],[-1,0,0],[0,-1,0]]
];
const sub = (a,b) => a.map((v,i) => v-b[i]);
const add = (a,b) => a.map((v,i) => v+b[i]);
const scale = (a,k) => a.map(v => v*k);
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rgbColor = x => Number.isInteger(x) && x >= 0 && x <= 0xffffff;

function clip(polygon, plane) {
  if (!polygon.length) return polygon;
  const result = [];
  let previous = polygon.at(-1), distance = dot(previous,plane);
  for (const point of polygon) {
    const next = dot(point,plane);
    if ((next > 0 && distance < 0) || (next < 0 && distance > 0))
      result.push(add(previous,scale(sub(point,previous),distance/(distance-next))));
    if (next >= 0) result.push(point);
    previous = point;
    distance = next;
  }
  return result;
}

function nearestHit(direction, triangles) {
  let depth = Infinity, surface;
  for (const tri of triangles) {
    const p = cross(direction,tri.ac), det = dot(tri.ab,p);
    if (Math.abs(det) < 1e-12) continue;
    const u = -dot(tri.a,p)/det;
    if (u < -1e-8 || u > 1+1e-8) continue;
    const q = cross(tri.a,tri.ab);
    const v = -dot(direction,q)/det, t = -dot(tri.ac,q)/det;
    if (v < -1e-8 || u+v > 1+1e-8 || t <= 0 || t >= depth) continue;
    depth = t;
    surface = tri;
  }
  return surface ? { surface, point:scale(direction,depth) } : undefined;
}

/**
 * Capture a fixed, object-local cubemap from an opaque triangle mesh. To
 * reconstruct each texel, clip the original triangles to its four rays.
 * Constant UVs attach the recovered cells to those exact triangles.
 */
export function bakeObjectTexels(mesh, { origin = [0,0,0], resolution = 16, paint, fallback = 0x202020 } = {}) {
  const { points, triangles } = mesh ?? {};
  if (!points || points.length < 9 || points.length % 3 || points.length > 12288 ||
      !Array.from(points).every(Number.isFinite) || !triangles?.length || triangles.length % 3 ||
      triangles.length > 12288 || Array.from(triangles).some(i => !Number.isInteger(i) || i<0 || i>=points.length/3) ||
      !Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite) ||
      !Number.isInteger(resolution) || resolution < 1 || resolution > 64 || typeof paint !== 'function' ||
      !rgbColor(fallback) && typeof fallback !== 'function')
    throw new TypeError('Object texels need a triangle mesh, center, resolution from 1–64 and a paint sampler');
  if (triangles.length*resolution*resolution > 3145728)
    throw new RangeError('Object texel capture exceeds the triangle sampling budget');

  const vertices = [];
  for (let i=0;i<points.length;i+=3) vertices.push(sub(Array.from(points.slice(i,i+3)),origin));
  const source = [];
  for (let i=0;i<triangles.length;i+=3) {
    const [a,b,c] = Array.from(triangles.slice(i,i+3),j => vertices[j]);
    const ab = sub(b,a), ac = sub(c,a), n = cross(ab,ac), size = Math.hypot(...n);
    if (size <= 1e-12) throw new RangeError('Object texels need non-degenerate triangles');
    const normal = scale(n,1/size), plane = dot(a,normal);
    if (Math.abs(plane) < 1e-8) throw new RangeError('The object texel probe must sit away from the mesh planes');
    source.push({a,b,c,ab,ac,normal,plane,index:i/3});
  }
  const count = resolution*resolution, width = resolution*3, height = resolution*2+1;
  const rgba = new Uint8Array(width*height*4), result = { points:[], triangles:[] };
  const texels = [], fallbackByTriangle = new Map();
  function put(pixel, color) {
    if (!rgbColor(color)) throw new TypeError('Object texel paint must return a packed RGB color');
    rgba.set([color>>16,color>>8&255,color&255,255],pixel*4);
  }
  function output(polygon, pixel) {
    const first = polygon[0];
    for (let i=1;i+1<polygon.length;i++) {
      const b=polygon[i], c=polygon[i+1];
      if (Math.hypot(...cross(sub(b,first),sub(c,first))) <= 1e-12) continue;
      if (result.triangles.length >= 600000) throw new RangeError('Object texels exceed the projected triangle budget');
      for (const point of [first,b,c]) {
        result.triangles.push(result.points.length/3);
        result.points.push(...add(point,origin));
        texels.push(pixel);
      }
    }
  }
  const cell = i => i/resolution*2-1;

  // Record uncovered pieces as regular geometry with an explicit fallback
  // swatch. Keep these pixels below the cubemap and deduplicate their colors.
  const fallbacks = new Map();
  function fallbackPixel(tri) {
    if (!fallbackByTriangle.has(tri.index))
      fallbackByTriangle.set(tri.index, typeof fallback === 'function' ? fallback(tri.index, [...tri.normal]) : fallback);
    const color = fallbackByTriangle.get(tri.index);
    if (!fallbacks.has(color)) fallbacks.set(color, width*resolution*2+fallbacks.size);
    return fallbacks.get(color);
  }
  let missing = 0;
  for (const [face,[forward,right,down]] of faces.entries()) {
    const x0=face%3*resolution, y0=Math.floor(face/3)*resolution, hits=Array(count);
    for (let y=0;y<resolution;y++) for (let x=0;x<resolution;x++) {
      const ray = add(forward,add(scale(right,cell(x+.5)),scale(down,cell(y+.5))));
      const hit=nearestHit(ray,source), pixel=(y+y0)*width+x+x0;
      if (!hit) { missing++; continue; }
      hits[y*resolution+x]=hit;
      put(pixel,paint({point:add(hit.point,origin),normal:[...hit.surface.normal],
        triangle:hit.surface.index,face,x,y}));
    }
    const horizontal = Array.from({length:resolution+1},(_,i) => sub(right,scale(forward,cell(i))));
    const vertical = Array.from({length:resolution+1},(_,i) => sub(down,scale(forward,cell(i))));
    for (const tri of source) {
      let polygon=[tri.a,tri.b,tri.c];
      for (const plane of [horizontal[0],scale(horizontal[resolution],-1),vertical[0],scale(vertical[resolution],-1)])
        polygon=clip(polygon,plane);
      if (polygon.length<3) continue;
      const ys=polygon.map(p=>dot(p,down)/dot(p,forward));
      const xs=polygon.map(p=>dot(p,right)/dot(p,forward));
      const index=v=>Math.max(0,Math.min(resolution-1,Math.floor((v+1)*.5*resolution)));
      for (let y=index(Math.min(...ys));y<=index(Math.max(...ys));y++) {
        const row=clip(clip(polygon,vertical[y]),scale(vertical[y+1],-1));
        if (row.length<3) continue;
        for (let x=index(Math.min(...xs));x<=index(Math.max(...xs));x++) {
          const patch=clip(clip(row,horizontal[x]),scale(horizontal[x+1],-1));
          if (patch.length<3) continue;
          const hit=hits[y*resolution+x];
          const visible=hit && Math.abs(dot(hit.point,tri.normal)-tri.plane)<=1e-7*(1+Math.abs(tri.plane));
          output(patch,visible ? (y+y0)*width+x+x0 : fallbackPixel(tri));
        }
      }
    }
  }
  // Compact the fallback swatches into as many extra atlas rows as needed.
  const rows=Math.max(1,Math.ceil(fallbacks.size/width)), fullHeight=resolution*2+rows;
  const pixels=fullHeight===height ? rgba : new Uint8Array(width*fullHeight*4);
  if (pixels!==rgba) pixels.set(rgba);
  for (const [color,pixel] of fallbacks) {
    if (!rgbColor(color)) throw new TypeError('Object texel fallback must be a packed RGB swatch');
    pixels.set([color>>16,color>>8&255,color&255,255],pixel*4);
  }
  const uvs = texels.flatMap(i => [(i%width)/(width-1), Math.floor(i/width)/(fullHeight-1)]);
  return { ...result, uvs, width, height:fullHeight, rgba:pixels, missing, resolution };
}
