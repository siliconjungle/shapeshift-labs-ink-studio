const AreaLights=require('../src/area-lights.js'),Cookies=require('../src/light-cookies.js');
const ColorSpace = require('../src/color-space.js');
const { spotWeight } = require('../src/volume-light.js');
const { slab } = require('../src/scene-optics.js');
const linear = ColorSpace.prepare('srgb','srgb-linear');
const ShotLighting = require('../src/shot-lighting.js');
const ShadowArt = require('../src/shadow-art.js');
const TargetSelectors = require('../src/target-selectors.js');
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
      if ((light.shape === 'disk' ? u*u+v*v>1 : light.shape==='line'? Math.hypot(Math.max(0,Math.abs(u)*light.half[0]-Math.max(0,light.half[0]-light.half[1])),v*light.half[1])>light.half[1] : Math.max(Math.abs(u),Math.abs(v))>1) || clip && !clip(point)) continue;
      const transmission=light.cookie?Cookies.sample(light.cookie.image,(u+1)/2,(1-v)/2):[1,1,1];
      const color = light.rgb.map((n,k)=>n*Math.min(1,light.intensity)*transmission[k]);
      hits[p] = { p,z,position:point,objectPosition:point,normal:light.normal,alpha:1,
        surface:true,emission:color,color };
      nearest = z;
      any = true;
    }
  }
  return any ? hits : null;
}

const {staticSources,occludes}=AreaLights;

function createLighting(lights, world, data, alpha, { spots = [], shadow, cutoutShadow, shot, art, spill = [], derived = [], shadowSettings } = {}) {
  const active = lights.filter(light=>light.intensity>0).map(light=>({
    ...light, extent:Math.hypot(...light.half), tint:linear(light.rgb)
  }));
  const projectors = spots.map(light => ({ ...light, tint:linear(light.rgb) }));
  const spillLights=spill.filter(light=>light.intensity>0);
  const finishSpills = spillLights.filter(light => light.paintedFinish);
  const rig = ShotLighting.bind(shot, world, data, alpha, art, shadowSettings);
  if (!active.length && !spillLights.length && !projectors.length && !rig) return null;
  const sources = active.some(light=>light.shadows) || spillLights.some(light=>light.shadows) || (!shadow && spots.some(light=>light.castsShadow))
    ? staticSources(world,data,alpha,derived,shadowSettings) : [];
  const areaShadow = sources.length || cutoutShadow ? (origin, direction, stop) =>
    cutoutShadow?.(origin, direction, stop) || occludes(sources, origin, direction, stop) : null;
  const cache = [];
  const inkControls = world.renderMetadata?.inkControls;
  const targets = shadowSettings?.objects && TargetSelectors.index(world);
  const receivesShadow = row => !targets || ShadowArt.objectAllows(shadowSettings,'receive',
    row && typeof row==='object' ? row : Number.isInteger(row) && row>=0 ? targets.row(row) : {});
  function spillAt(lights, point, normal, row, bias, suppression) {
    const emitted = [0,0,0], weight = 1 - (suppression ?? (Number.isInteger(row) ? inkControls?.[row*4+3] : undefined) ?? 0);
    if (!lights.length || !weight) return emitted;
    AreaLights.evaluate(lights, point, normal, emitted, {shadow:receivesShadow(row) ? areaShadow : undefined,biasNormal:bias,
      contribution:art?.spill && ((light,at)=>art.spill(light,row,at))});
    return (art?.curves.emission?.(emitted) ?? emitted).map(n=>n*weight);
  }

  function evaluate(point, normal, row, biasNormal, specular, spillSuppression) {
    const rgb=[0,0,0];
    const shadeNormal=art?.normal?.(row,normal) ?? normal, bias=biasNormal??normal;
    AreaLights.evaluate(active,point,shadeNormal,rgb,{shadow:receivesShadow(row) ? areaShadow : undefined,biasNormal:bias,specular});
    if (spillLights.length) {
      const emitted=spillAt(spillLights,point,shadeNormal,row,bias,spillSuppression);
      for(let c=0;c<3;c++)rgb[c]+=emitted[c];
    }
    for (const light of projectors) {
      const offset = light.at.map((value,k) => value-point[k]), distance = Math.hypot(...offset);
      if (distance <= spotBias || distance >= light.radius) continue;
      const direction = offset.map(value => value/distance);
      const receive = dot(shadeNormal,direction);
      if (receive <= 0) continue;
      const weight = spotWeight(light,direction);
      if (!weight) continue;
      if (light.castsShadow && receivesShadow(row) && (shadow || sources.length || cutoutShadow)) {
        const origin = point.map((value,k) => value+(biasNormal??normal)[k]*spotBias);
        const ray = light.at.map((value,k) => value-origin[k]), stop = Math.hypot(...ray);
        if (stop > spotBias) {
          const toLight = ray.map(value => value/stop);
          if (cutoutShadow?.(origin,toLight,stop-spotBias)) continue;
          if (shadow ? shadow(...origin,toLight,stop) : occludes(sources,origin,toLight,stop-spotBias)) continue;
        }
      }
      const level = light.surfaceIntensity*weight*receive*(1-distance/light.radius)**2;
      const projected=light.cookie?.rgb?light.cookie.rgb(direction):[1,1,1];
      for (let c=0;c<3;c++) rgb[c]+=light.tint[c]*level*projected[c];
    }
    if (!rig) return rgb.map(n => 1 + n);
    const additional = [0, 0, 0];
    const retention = rig.sample(row, point, normal, additional, bias);
    return rgb.map((n, c) => (n + additional[c] + retention) * rig.exposure);
  }

  function shade(pixel, point, normal, rgb, fog, fogMix = 0, row, biasNormal, spillSuppression) {
    const previous = cache[pixel];
    let light;
    if (previous && previous.row === row && previous.spillSuppression === spillSuppression && point.every((n,k)=>Math.abs(n-previous.point[k])<1e-6) &&
        normal.every((n,k)=>Math.abs(n-previous.normal[k])<1e-6) &&
        (biasNormal===previous.biasNormal || biasNormal&&previous.biasNormal&&
          biasNormal.every((n,k)=>Math.abs(n-previous.biasNormal[k])<1e-6))) light=previous.light;
    else {
      light=evaluate(point,normal,row,biasNormal,undefined,spillSuppression);
      cache[pixel]={point,normal,biasNormal,light,row,spillSuppression};
    }
    if (light.every(n => n === 1) || fogMix>=1) return rgb;
    const surface = fogMix ? rgb.map((n,k)=>clamp((n-fog[k]*fogMix)/(1-fogMix))) : rgb;
    const shaded = ShotLighting.shade(surface, light);
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  }
  shade.scanSurface = (point,normal,row,biasNormal,view,roughness,strength) => {
    const highlight=[0,0,0];
    const gain=evaluate(point,normal,row,biasNormal,{view,roughness,strength,out:highlight});
    return {irradiance:gain.map(n=>n-1),highlight};
  };
  shade.receives = row => active.length > 0 || spillLights.length > 0 || projectors.length > 0 || rig?.receives(row);
  if (finishSpills.length) shade.finishSpill = (point, normal, color, row, suppression) => {
    const added = spillAt(finishSpills, point, art?.normal?.(row,normal) ?? normal, row, normal, suppression);
    return added.some(Boolean) ? ShotLighting.shade(color, added.map(n=>1+n)) : color;
  };
  return shade;
}

function sceneOccluder(world, data, alpha, derived) {
  const sources = staticSources(world, data, alpha, derived);
  return sources.length ? (origin, direction, distance) => occludes(sources, origin, direction, distance) : null;
}

module.exports = { rasterize, createLighting, sceneOccluder };
