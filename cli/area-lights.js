const ColorSpace = require('../src/color-space.js');
const { spotWeight } = require('../src/volume-light.js');
const { slab } = require('../src/scene-optics.js');
const linear = ColorSpace.prepare('srgb','srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear','srgb');
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const clamp = n => Math.max(0,Math.min(1,n));
const spotBias = .025;

function rasterize(lights, { w, h, rayAt, near, capture, clip }) {
  const visible = lights.filter(light => light.intensity && (capture ? light.reflection : light.visible));
  if (!visible.length) return null;
  const hits = new Array(w*h);
  let any = false;
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const {origin,direction,axial} = rayAt(x+.5,y+.5);
    let nearest = Infinity;
    for (const light of visible) {
      const facing = dot(light.normal,direction);
      if (Math.abs(facing)<1e-8 || (!light.twoSided && facing>=0)) continue;
      const distance = light.at.reduce((sum,n,k)=>sum+(n-origin[k])*light.normal[k],0)/facing;
      const z = distance*axial;
      if (z<near || z>=nearest) continue;
      const point = origin.map((n,k)=>n+distance*direction[k]);
      const delta = point.map((n,k)=>n-light.at[k]);
      const u = dot(delta, light.u)/light.half[0], v = dot(delta, light.v)/light.half[1];
      if ((light.shape === 'disk' ? u*u+v*v>1 : Math.max(Math.abs(u),Math.abs(v))>1) || clip && !clip(point)) continue;
      const color = light.rgb.map(n=>n*Math.min(1,light.intensity));
      hits[p] = { p,z,position:point,objectPosition:point,normal:light.normal,alpha:1,
        surface:true,emission:color,color };
      nearest = z;
      any = true;
    }
  }
  return any ? hits : null;
}

function staticSources(world, data, alpha) {
  const sources = [], boned = new Set(world.anim?.boned ?? []), backdrop = new Set(world.back ?? []);
  const owned = world.anim?.geometryOwned;
  for (const source of world.renderSdfs ?? []) {
    if (!(source.rows instanceof Map) || !source.rows.size || !source.bounds || typeof source.distance !== 'function') continue;
    let current = true;
    for (const ranges of source.rows.values()) for (const [start,end,points] of ranges) {
      if (end>world.count) current = false;
      for (let i=start;i<end && current;i++) {
        const q=i*16, k=(i-start)*3;
        current = !owned?.[i] && data[q]===points[k] && data[q+1]===points[k+1] && data[q+2]===points[k+2] && alpha[i]>=1 && !backdrop.has(i) &&
          !(Math.round(data[q+11]) & (15 | 512 | 32768)) && !boned.has(i) && !world.anim?.rig?.bid?.[i];
      }
    }
    if (current) sources.push(source);
  }
  return sources;
}

function occludes(sources, origin, direction, stop) {
  for (const source of sources) {
    const { min,max } = source.bounds, interval = [0,stop];
    if (!slab(interval,origin[0],direction[0],min[0],max[0]) ||
        !slab(interval,origin[1],direction[1],min[1],max[1]) ||
        !slab(interval,origin[2],direction[2],min[2],max[2])) continue;
    let depth = interval[0];
    for (let step=0;step<96 && depth<interval[1];step++) {
      const x=origin[0]+depth*direction[0], y=origin[1]+depth*direction[1], z=origin[2]+depth*direction[2];
      const d=source.distance(x,y,z);
      if (!Number.isFinite(d)) break;
      if (d<.0015 && (!source.accepts || source.accepts(x,y,z))) return true;
      depth += Math.max(.004, d*.8);
    }
  }
  return false;
}

function createLighting(lights, world, data, alpha, { spots = [], shadow } = {}) {
  const active = lights.filter(light=>light.intensity>0).map(light=>({
    ...light, extent:Math.hypot(...light.half), tint:linear(light.rgb)
  }));
  const projectors = spots.map(light => ({ ...light, tint:linear(light.rgb) }));
  if (!active.length && !projectors.length) return null;
  const sources = active.some(light=>light.shadows) || (!shadow && spots.some(light=>light.castsShadow))
    ? staticSources(world,data,alpha) : [];
  const cache = [];

  function evaluate(point, normal) {
    const rgb=[0,0,0];
    for (const light of active) {
      if (Math.hypot(point[0]-light.at[0],point[1]-light.at[1],point[2]-light.at[2]) >= light.radius+light.extent) continue;
      const origin = point.map((n,k)=>n+normal[k]*light.bias);
      let total=0, lit=0;
      for (const sample of light.points) {
        const offset = sample.map((n,k)=>n-point[k]), distance=Math.hypot(...offset);
        if (!(distance>light.bias && distance<light.radius)) continue;
        const direction = offset.map(n=>n/distance);
        const facing = -dot(direction,light.normal), receive = dot(normal,direction);
        const amount = Math.max(0,receive)*Math.max(0,light.twoSided ? Math.abs(facing) : facing)*(1-distance/light.radius)**2;
        if (!amount) continue;
        total += amount;
        if (light.shadows && sources.length) {
          const delta = sample.map((n,k)=>n-origin[k]), range = Math.hypot(...delta);
          if (range > light.bias && occludes(sources,origin,delta.map(n=>n/range),range-light.bias)) continue;
        }
        lit += amount;
      }
      if (!total) continue;
      const steps = light.shadowSteps && light.shadowSteps-1;
      const visibility = steps ? Math.round(steps*lit/total)/steps : lit/total;
      const level = total*visibility*light.intensity/light.points.length;
      for (let c=0;c<3;c++) rgb[c]+=light.tint[c]*level;
    }
    for (const light of projectors) {
      const offset = light.at.map((value,k) => value-point[k]), distance = Math.hypot(...offset);
      if (distance <= spotBias || distance >= light.radius) continue;
      const direction = offset.map(value => value/distance);
      const receive = dot(normal,direction);
      if (receive <= 0) continue;
      const weight = spotWeight(light,direction);
      if (!weight) continue;
      if (light.castsShadow && (shadow || sources.length)) {
        const origin = point.map((value,k) => value+normal[k]*spotBias);
        const ray = light.at.map((value,k) => value-origin[k]), stop = Math.hypot(...ray);
        if (stop > spotBias) {
          const toLight = ray.map(value => value/stop);
          if (shadow ? shadow(...origin,toLight,stop) : occludes(sources,origin,toLight,stop-spotBias)) continue;
        }
      }
      const level = light.surfaceIntensity*weight*receive*(1-distance/light.radius)**2;
      for (let c=0;c<3;c++) rgb[c]+=light.tint[c]*level;
    }
    return rgb;
  }

  return function shade(pixel, point, normal, rgb, fog, fogMix = 0) {
    const previous = cache[pixel];
    let light;
    if (previous && point.every((n,k)=>Math.abs(n-previous.point[k])<1e-6) &&
        normal.every((n,k)=>Math.abs(n-previous.normal[k])<1e-6)) light=previous.light;
    else {
      light=evaluate(point,normal);
      cache[pixel]={point,normal,light};
    }
    if (!light.some(Boolean) || fogMix>=1) return rgb;
    const surface = fogMix ? rgb.map((n,k)=>clamp((n-fog[k]*fogMix)/(1-fogMix))) : rgb;
    const shaded = srgb(linear(surface).map((n,k)=>Math.min(1,n*(1+light[k]))));
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  };
}

function sceneOccluder(world, data, alpha) {
  const sources = staticSources(world, data, alpha);
  return sources.length ? (origin, direction, distance) => occludes(sources, origin, direction, distance) : null;
}

module.exports = { rasterize, createLighting, sceneOccluder };
