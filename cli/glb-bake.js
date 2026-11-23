// Rasterize source appearance into the finished atlas, with padding for texture filtering.
const png = require('./png');
const { area2 } = require('./glb-uv');
const { idOK } = require('./material-projection.js');

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const byte = value => Math.round(clamp(value) * 255);
const sRGB = v => byte(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;

function opaquePigment(texture) {
  if (!texture) return undefined;
  if (texture.bytes && texture.mimeType && texture.mimeType !== 'image/png')
    throw new TypeError('Material baking needs PNG or decoded pigment on opaque meshes');
  const decoded = texture.bytes ? png.raster(texture.bytes) : null;
  const {width:w,height:h,channels=4,pixels} = texture;
  const width=decoded?.w??w,height=decoded?.h??h,data=decoded?.data??pixels,max=decoded?.max??255,stride=decoded?4:channels;
  if (![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096) || ![3,4].includes(stride) ||
      !ArrayBuffer.isView(data) || data.length!==width*height*stride)
    throw new TypeError('Material baking needs a valid pigment texture');
  if(stride===4)for(let i=3;i<data.length;i+=4)if(data[i]!==max)
    throw new TypeError('Registered pigment textures need opaque texels');
  return ([u,v], tint) => {
    const p=(Math.min(height-1,Math.floor(v*height))*width+Math.min(width-1,Math.floor(u*width)))*stride;
    return tint.map((value,c)=>value*linear(data[p+c]/max));
  };
}

function bake(mesh, faces, uvs, normals, size, padding, { V }, { registered = false, projection, chartBake } = {}) {
  const count = size * size, covered = new Uint8Array(count);
  if(projection && count*projection.views>64000000)throw new RangeError('Paint views exceed the projected texel budget');
  const { previous, state, dirty, reproject } = chartBake || {};
  const owners = previous?.owners ?? (registered && new Uint32Array(count));
  const stamp = previous?.paint ?? (projection && new Float32Array(count * 4));
  const pixels = previous?.pixels ?? {
    base: new Uint8Array(count * 3), normal: new Uint8Array(count * 3),
    surface: new Uint8Array(count * 3), emission: new Uint8Array(count * 3)
  };
  const names = mesh.maskNames ?? [];
  if (registered && (!Array.isArray(names) || !Array.from(names).every(idOK)))
    throw new TypeError('Material mask names must be lowercase IDs');
  const masks = new Map(), pigment = registered && mesh.materials.map(material=>opaquePigment(material.texture));
  const paintMasks = new Set(state?.paintMasks);
  if (registered) {
    const authored=new Set([...names,...mesh.materials.flatMap(layer=>Object.keys(layer.masks??{}))]);
    for (const name of paintMasks) {
      if (authored.has(name)) throw new Error('Material mask ID is reserved for an approved view: '+name);
      authored.add(name);
    }
    if(authored.size>24 || count*authored.size>64000000 || [...authored].some(id=>!idOK(id)))
      throw new RangeError('Material masks exceed the atlas mask budget or have an invalid ID');
    for(const name of authored)masks.set(name,previous?.masks.get(name) ?? new Uint8Array(count));
  }
  let used = 0, strength = previous?.strength ?? 1, normalUsed = false, emissiveUsed = false, surfaceUsed = false;
  const hot = previous ? null : new Float32Array(count * 3), mats = mesh.materials;
  // Freeze all reused texels, including gutters. Dirty triangles can only
  // write the footprint slots they owned in the saved atlas.
  if (previous) for (let i = 0; i < count; i++) {
    if (owners[i] && !dirty.has(owners[i]-1)) covered[i] = 1;
  }
  for (const [f, face] of faces.entries()) {
    const chart = state?.faceCharts[f], project = projection && reproject.has(chart);
    if (previous && !dirty.has(chart)) continue;
    const t = uvs[f].map(p => p.map(x => x * size)), [a, b, c] = t, det = area2(a, b, c);
    if (Math.abs(det) < 1e-16) throw new Error('Cannot bake a degenerate UV triangle');
    const [pa, pb, pc] = face.map(i => mesh.points[i]);
    const ab = V.sub(pb, pa), ac = V.sub(pc, pa);
    const front = project && V.norm(V.cross(ab,ac));
    const tint = registered && mesh.colors && face.map(i=>mesh.colors[i]);
    const [na, nb, nc] = mesh.cornerNormals?.[f] || face.map(i => normals[i]), normAB = V.sub(nb, na), normAC = V.sub(nc, na);
    const tangent = V.mul(V.sub(V.mul(ab, c[1] - a[1]), V.mul(ac, b[1] - a[1])), 1 / det);
    const bitangent = V.mul(V.sub(V.mul(ac, b[0] - a[0]), V.mul(ab, c[0] - a[0])), 1 / det);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const x1 = Math.min(size, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y1 = Math.min(size, Math.ceil(Math.max(a[1], b[1], c[1])));
    const slot = mesh.faceMaterials?.[f] ?? 0, fallback = mats[slot];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const q = [x + 0.5, y + 0.5], u = area2(a, q, c) / det, v = area2(a, b, q) / det;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      const i = x + y * size;
      if (previous && (owners[i] !== chart+1 || !previous.footprint[i])) continue;
      const interior = Math.min(u, v, 1 - u - v) > 1e-7;
      if (covered[i] === 2 && interior) throw new Error('UV islands overlap in the texture bake');
      if (covered[i]) continue;
      covered[i] = interior ? 2 : 1;
      if (registered) owners[i] = chart + 1;
      used++;
      const n = V.norm(V.mad(V.mad(na, normAB, u), normAC, v));
      const p = V.mad(V.mad(pa, ab, u), ac, v);
      const material = mesh.sampleSurface?.(p, n, f) || fallback;
      let color = material.color || [0.45, 0.45, 0.45];
      const emission = material.emission || [0, 0, 0];
      const roughness = material.roughness ?? 0.8, metallic = material.metallic ?? 0;
      const authoredNormal = material.normal;
      if (registered) {
        if(!Array.isArray(color)||color.length!==3||!Array.from(color).every(v=>Number.isFinite(v)&&v>=0&&v<=1) ||
          !Array.isArray(emission)||emission.length!==3||!Array.from(emission).every(v=>Number.isFinite(v)&&v>=0) ||
          ![roughness,metallic].every(v=>Number.isFinite(v)&&v>=0&&v<=1) ||
          authoredNormal && (!Array.isArray(authoredNormal)||authoredNormal.length!==3||
            !Array.from(authoredNormal).every(Number.isFinite)||Math.hypot(...authoredNormal)===0))
          throw new TypeError('Registered material samples need valid linear RGB, normals and surface channels');
        if(previous) for(const [name,layer] of masks) {
          if(project || !paintMasks.has(name))layer[i]=0;
        }
        for (const [name,value] of Object.entries(material.masks??{})) {
          if(!masks.has(name) || paintMasks.has(name) || !Number.isFinite(value)||value<0||value>1)
            throw new TypeError('Expected a declared mask with weight in [0, 1]: '+name);
          masks.get(name)[i]=byte(value);
        }
        if(pigment[slot])color=pigment[slot](a.map((n,k)=>clamp((n+u*(b[k]-n)+v*(c[k]-n))/size)),color);
        if(tint)color=color.map((value,k)=>value*(tint[0][k]*(1-u-v)+tint[1][k]*u+tint[2][k]*v));
        if(project){
          const weights=Object.create(null);
          projection.sample(p,front,f,weights,stamp,i*4);
          for(const [name,value] of Object.entries(weights))masks.get(name)[i]=byte(value);
        }
        if(stamp && stamp[i*4+3])color=color.map((value,k)=>value*(1-stamp[i*4+3])+stamp[i*4+k]);
      }
      const source = authoredNormal ? (registered ? V.norm(authoredNormal) : authoredNormal) : n;
      const tx = V.norm(V.mad(tangent, n, -V.dot(tangent, n)), V.perp(n));
      const ty = V.mul(V.cross(n, tx), V.dot(V.cross(n, tx), bitangent) < 0 ? -1 : 1);
      const yNormal = [V.dot(source, tx), V.dot(source, ty), V.dot(source, n)];
      const at = i * 3;
      pixels.base.set(color.map(sRGB), at);
      pixels.normal.set(yNormal.map(value => byte(0.5 + 0.5 * value)), at);
      pixels.surface.set([255, byte(roughness), byte(metallic)], at);
      if(hot)hot.set(emission,at);
      else {
        if(emission.some(value=>value>strength))
          throw new RangeError('Chart rebake emission exceeds the saved scale. Export a new full baseline.');
        pixels.emission.set(emission.map(value=>sRGB(Math.fround(value)/strength)),at);
      }
      normalUsed ||= V.dist(source, n) > 0.001;
      emissiveUsed ||= emission.some(value => value > 0);
      surfaceUsed ||= roughness !== 0.8 || metallic !== 0;
      strength = Math.max(strength, ...emission);
    }
  }
  if (!used && !previous) throw new Error('Texture bake found no surface in the UV atlas');
  if (!registered && !normalUsed) delete pixels.normal;
  if (!registered && !surfaceUsed) delete pixels.surface;
  if (!registered && !emissiveUsed) delete pixels.emission;
  else if(hot && emissiveUsed)for (let i = 0; i < hot.length; i++) pixels.emission[i] = sRGB(hot[i] / strength);
  const footprint = registered && (previous?.footprint ?? Uint8Array.from(covered,n=>n?255:0));
  const layers = Object.values(pixels);
  // Expand a texel at a time, using only data from the previous pass.
  // During a rebake, expansion stays inside the chart's saved gutter.
  let front = [];
  for (let i = 0; i < count; i++) if (covered[i] && (!previous || footprint[i] && dirty.has(owners[i]-1)) &&
    ((i % size > 0 && !covered[i - 1]) || (i % size < size - 1 && !covered[i + 1]) ||
    (i >= size && !covered[i - size]) || (i < count - size && !covered[i + size]))) front.push(i);
  const copy = (i, j, next) => {
    if (covered[j] || previous && owners[j] !== owners[i]) return;
    if (registered) owners[j] = owners[i];
    covered[j] = 1;
    next.push(j);
    for (const layer of layers) {
      for (let k = 0; k < 3; k++) layer[j * 3 + k] = layer[i * 3 + k];
    }
    for (const layer of masks.values()) layer[j]=layer[i];
  };
  for (let step = 0; step < padding && front.length; step++) {
    const next = [];
    for (const i of front) {
      if (i % size > 0) copy(i, i - 1, next);
      if (i % size < size - 1) copy(i, i + 1, next);
      if (i >= size) copy(i, i - size, next);
      if (i < count - size) copy(i, i + size, next);
    }
    front = next;
  }
  const textures = Object.fromEntries(Object.entries(pixels).map(([key, data]) => [key, png.encode(size, size, data)]));
  const registeredMaps = registered && {
    roughness:png.encodeGray(size,size,Uint8Array.from(covered,(_n,i)=>pixels.surface[i*3+1])),
    coverage:png.encodeGray(size,size,footprint),
    masks:Object.fromEntries(Array.from(masks,([name,data])=>[name,png.encodeGray(size,size,data)]))
  };
  const coverage = previous ? footprint.reduce((n,value)=>n+Number(value!==0),0)/count : used/count;
  return { textures, strength, coverage, registeredMaps, owners, stamp, sampledTexels:used };
}

module.exports = bake;
