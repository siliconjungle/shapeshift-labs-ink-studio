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
const materialBakes = new WeakSet();

function prepareMaterial(sample, fallback) {
  if (rgbColor(sample)) sample = { pigment:sample };
  if (!sample || Object.getPrototypeOf(sample)!==Object.prototype ||
      Object.keys(sample).some(key=>!['pigment','normal','roughness','metalness','emission'].includes(key)))
    throw new TypeError('Texel materials need pigment, normal, roughness, metalness or emission');
  const {pigment, normal, roughness, metalness, emission} = sample;
  const vector=normal===undefined ? fallback : normal;
  const validVector=(Array.isArray(vector) || ArrayBuffer.isView(vector)) && vector.length===3 && Array.from(vector).every(Number.isFinite);
  const length=validVector ? Math.hypot(...vector) : 0;
  if (pigment!==undefined && !rgbColor(pigment) || emission!==undefined && !rgbColor(emission) ||
      roughness!==undefined && (!Number.isFinite(roughness) || roughness<0 || roughness>1) ||
      metalness!==undefined && (!Number.isFinite(metalness) || metalness<0 || metalness>1) ||
      vector!==undefined && (!length || !Number.isFinite(length)))
    throw new RangeError('Texel material needs RGB24 colors, a nonzero XYZ normal and roughness and metalness in [0,1]');
  if (fallback && pigment===undefined) throw new TypeError('A baked texel material needs pigment');
  return {pigment,emission,metalness,roughness:roughness ?? (fallback ? .65 : undefined),
    normal:validVector ? Array.from(vector,n=>n/length) : undefined};
}

function writeMaterial(bake, id, {pigment, normal, roughness, metalness, emission}) {
  if (pigment!==undefined) bake.rgba.set([pigment>>16,pigment>>8&255,pigment&255,255],id*4);
  if (normal) bake.normal.set([...normal.map(n=>128+Math.round(127*n)),255],id*4);
  if (roughness!==undefined) bake.roughness[id]=Math.round(255*roughness);
  if (metalness!==undefined) bake.metalness[id]=Math.round(255*metalness);
  if (emission!==undefined) bake.emission.set([emission>>16,emission>>8&255,emission&255],id*3);
}

/** Edit addressed cells atomically while retaining the original clipped mesh and IDs. */
export function editObjectTexels(bake, edits) {
  if (!materialBakes.has(bake) || !Array.isArray(edits) || edits.length>bake.cells.length)
    throw new TypeError('Edit a relightable object texel bake with a bounded list of cell edits');
  if (!edits.length) return bake;
  const result={...bake,rgba:bake.rgba.slice(),normal:bake.normal.slice(),
    roughness:bake.roughness.slice(),metalness:bake.metalness.slice(),emission:bake.emission.slice()};
  const ids=new Set();
  for (const {id,...sample} of edits) {
    if (!Number.isSafeInteger(id) || !bake.cells[id] || ids.has(id))
      throw new RangeError('Each texel edit needs a distinct occupied cell ID');
    ids.add(id);
    writeMaterial(result,id,prepareMaterial(sample));
  }
  materialBakes.add(result);
  return result;
}

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
export function bakeObjectTexels(mesh, { origin = [0,0,0], resolution = 16, paint, material, fallback = 0x202020 } = {}) {
  const { points, triangles } = mesh ?? {};
  const relightable=material!==undefined;
  if (!points || points.length < 9 || points.length % 3 || points.length > 12288 ||
      !Array.from(points).every(Number.isFinite) || !triangles?.length || triangles.length % 3 ||
      triangles.length > 12288 || Array.from(triangles).some(i => !Number.isInteger(i) || i<0 || i>=points.length/3) ||
      !Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite) ||
      !Number.isInteger(resolution) || resolution < 1 || resolution > 64 ||
      (relightable ? typeof material!=='function' || paint!==undefined : typeof paint!=='function') ||
      !rgbColor(fallback) && typeof fallback !== 'function')
    throw new TypeError('Object texels need a triangle mesh, center, resolution from 1–64 and one paint or material sampler');
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
  const count = resolution*resolution, height = resolution*2+1;
  const width = Math.max(resolution*3,relightable ? Math.ceil(source.length/(1024-height+1)) : 0);
  const rgba = new Uint8Array(width*height*4), result = { points:[], triangles:[] };
  const texels = [], fallbackByTriangle = new Map(), samples=relightable && new Map();
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
    if (relightable) {
      if (!fallbackByTriangle.has(tri.index)) {
        const pixel=width*resolution*2+fallbackByTriangle.size;
        const location={id:pixel,triangle:tri.index,point:add(scale(add(add(tri.a,tri.b),tri.c),1/3),origin),
          normal:[...tri.normal],fallback:true};
        const value=typeof fallback==='function' ? fallback(tri.index,[...tri.normal],{
          ...location,point:[...location.point],normal:[...location.normal]}) : fallback;
        samples.set(pixel,{location,value:prepareMaterial(value,tri.normal)});
        fallbackByTriangle.set(tri.index,pixel);
      }
      return fallbackByTriangle.get(tri.index);
    }
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
      const location={point:add(hit.point,origin),normal:[...hit.surface.normal],triangle:hit.surface.index,face,x,y};
      if (relightable) {
        const value=material({...location,id:pixel,point:[...location.point],normal:[...location.normal]});
        samples.set(pixel,{location,value:prepareMaterial(value,location.normal)});
      }
      else put(pixel,paint(location));
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
  const rows=Math.max(1,Math.ceil((relightable ? fallbackByTriangle.size : fallbacks.size)/width));
  const fullHeight=resolution*2+rows;
  const pixels=fullHeight===height ? rgba : new Uint8Array(width*fullHeight*4);
  if (pixels!==rgba) pixels.set(rgba);
  for (const [color,pixel] of fallbacks) {
    if (!rgbColor(color)) throw new TypeError('Object texel fallback must be a packed RGB swatch');
    pixels.set([color>>16,color>>8&255,color&255,255],pixel*4);
  }
  const uvs = texels.flatMap(i => [(i%width)/(width-1), Math.floor(i/width)/(fullHeight-1)]);
  const bake={...result,uvs,width,height:fullHeight,rgba:pixels,missing,resolution};
  if (relightable) {
    const count=width*fullHeight, cells=Array(count).fill(null);
    Object.assign(bake,{normal:new Uint8Array(count*4),roughness:new Uint8Array(count),
      metalness:new Uint8Array(count),emission:new Uint8Array(count*3)});
    for (const [id,{location,value}] of samples) {
      const {point,normal,...address}=location;
      cells[id]=Object.freeze({...address,id,point:Object.freeze(point),normal:Object.freeze(normal)});
      writeMaterial(bake,id,value);
    }
    bake.cells=Object.freeze(cells);
    materialBakes.add(bake);
  }
  return bake;
}
