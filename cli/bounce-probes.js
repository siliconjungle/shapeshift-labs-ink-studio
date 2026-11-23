const BounceProbes = require('../src/bounce-probes.js');
const ColorSpace = require('../src/color-space.js');
const ShadowArt = require('../src/shadow-art.js');
const SkyEnvironment = require('../src/sky-environment.js');
const ShotLighting = require('../src/shot-lighting.js');
const linear = ColorSpace.prepare('srgb','srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear','srgb');
const bakes = new WeakMap();

function create(world, override, sky, sun, source = world, options = {}) {
  const authored = world.bounceProbes ?? source.bounceProbes;
  const value = override === true ? authored : override ?? authored;
  let settings = BounceProbes.prepare(value);
  if (!settings?.probes.length || !settings.strength) return null;
  if (!settings.format) {
    const key = JSON.stringify(settings), cached = bakes.get(source);
    settings = cached?.key === key ? cached.bake : require('../index.js').load().KIT.bounceProbes.bake(source,value);
    bakes.set(source,{ key,bake:settings });
  }

  const kit = require('../index.js').load().KIT;
  const receive = ShadowArt.bind(settings, world, 'receive');
  const { pointIndex } = kit.procedural.spatial;
  const update = settings.dynamic && options.dynamic !== false ? kit.bounceProbes.update(world, settings, options) : null;
  const sites = update?.probes ?? settings.probes;
  const { samples,strength,bounceStrength,skyStrength } = settings;
  const bounceScale=options.bounceScale??1;
  const weight = 4*Math.PI/samples;
  const skySamples = BounceProbes.directions(samples).map(({direction,basis})=>{
    const upper=direction[1]>=0;
    const incoming=sky ? linear(upper ? SkyEnvironment.scattering(sky,direction) : sky.ground) :
      upper ? sun?.sky : sun?.ground;
    return { basis,color:skyStrength && incoming?.some(Boolean) ? incoming.map(n=>n*skyStrength) : null };
  });
  const index = pointIndex(sites.map(probe=>{
    const bounce=probe.coefficients.map(n=>n*bounceStrength*bounceScale), sky=new Array(27).fill(0);
    const { at,radius } = probe;
    for (let i=0;i<samples;i++) {
      const {basis,color}=skySamples[i];
      if (color && probe.open[i]) BounceProbes.project(sky,basis,color,weight*probe.open[i]);
    }
    const extent={ min:at.map(n=>n-radius), max:at.map(n=>n+radius) };
    return { bounds:extent, probe,bounce,sky };
  }));

  function sample(point, normal) {
    let mix=0,total=0, basis;
    const bounce=[0,0,0], sky=[0,0,0], rgb=[0,0,0];
    index(point,({probe,bounce:surfaceSH,sky:skySH})=>{
      const amount=BounceProbes.influence(probe,point);
      if (!amount) return;
      basis ??= BounceProbes.basis(normal);
      mix=Math.max(mix,amount);
      const distance=Math.hypot(point[0]-probe.at[0],point[1]-probe.at[1],point[2]-probe.at[2])/probe.radius;
      const weight=amount/(.12+distance*distance);
      total+=weight;
      for (let i=0;i<9;i++) for (let c=0;c<3;c++) {
        const q=i*3+c, scale=basis[i]*weight;
        bounce[c]+=scale*surfaceSH[q];
        sky[c]+=scale*skySH[q];
      }
    });
    if(!total)return null;
    for(let c=0;c<3;c++){
      rgb[c]=Math.max(0,(bounce[c]+sky[c])/total);
      bounce[c]=Math.max(0,bounce[c]/total);
      sky[c]=Math.max(0,sky[c]/total);
    }
    mix*=strength;
    return {mix,rgb,bounce,sky,bounceLevel:mix*(.2126*bounce[0]+.7152*bounce[1]+.0722*bounce[2])};
  }

  function shade(point, normal, rgb, fog, fogMix = 0, albedo) {
    const local = sample(point,normal);
    if (!local?.rgb.some(Boolean) || fogMix>=1) return rgb;
    const surface = fogMix ? rgb.map((n,k)=>Math.max(0,Math.min(1,(n-fog[k]*fogMix)/(1-fogMix)))) : rgb;
    const diffuse=linear(surface);
    const reflectance=albedo ? linear(albedo) : diffuse;
    const shaded=srgb(diffuse.map((n,k)=>Math.min(1,n+reflectance[k]*local.rgb[k]*local.mix)));
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  }

  return { sample, shade, receives: i => !receive || receive(i),
    receivesSurface:target=>Boolean(settings.geometry)&&ShadowArt.allows(settings.receive,target),
    ...(settings.dynamic && { stats: { sites: sites.length, updated: update?.updated ?? [], rays: update?.rays ?? 0 } }) };
}

function createBounceProbeSampler(world, { bounceProbes, sky, sun, shotLighting, time=0 } = {}) {
  const rig=ShotLighting.frame(world.shotLighting,shotLighting,time);
  const sampler=create(world,bounceProbes,sky,sun,world,{dynamic:false,bounceScale:rig?.bounceScale});
  const vector=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(Number.isFinite);
  return (point,normal)=>{
    const length=vector(normal)?Math.hypot(...normal):0;
    if(!vector(point)||!length)throw new TypeError('Probe sampling needs an XYZ point and a nonzero XYZ normal');
    return sampler?.sample(point,normal.map(n=>n/length))??null;
  };
}

module.exports = { create, createBounceProbeSampler };
