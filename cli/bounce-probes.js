const BounceProbes = require('../src/bounce-probes.js');
const ColorSpace = require('../src/color-space.js');
const ShadowArt = require('../src/shadow-art.js');
const SkyEnvironment = require('../src/sky-environment.js');
const ShotLighting = require('../src/shot-lighting.js');
const Channels = require('../src/lighting-channels.js');
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
  const bounceScale=options.bounceScale??1, curves=options.lighting?.curves;
  const split=Boolean(curves?.sky||curves?.bounce||options.splitHemispheres);
  const weight = 4*Math.PI/samples;
  const skySamples = BounceProbes.directions(samples).map(({direction,basis})=>{
    const upper=direction[1]>=0;
    const incoming=sky ? linear(upper ? SkyEnvironment.scattering(sky,direction) : sky.ground) :
      upper ? sun?.sky : sun?.ground;
    return { basis,upper,color:skyStrength && incoming?.some(Boolean) ? incoming.map(n=>n*skyStrength) : null };
  });
  const index = pointIndex(sites.map(probe=>{
    const bounce=probe.coefficients.map(n=>n*bounceStrength*bounceScale), sky=new Array(27).fill(0);
    const ground=split ? new Array(27).fill(0) : null;
    const { at,radius } = probe;
    for (let i=0;i<samples;i++) {
      const {basis,color,upper}=skySamples[i];
      if (color && probe.open[i]) BounceProbes.project(!upper&&ground?ground:sky,basis,color,weight*probe.open[i]);
    }
    const extent={ min:at.map(n=>n-radius), max:at.map(n=>n+radius) };
    return { bounds:extent, probe,bounce,sky,ground };
  }));

  function sample(point, normal) {
    let mix=0,total=0, basis;
    const bounce=[0,0,0], sky=[0,0,0], rgb=[0,0,0], ground=split?[0,0,0]:null;
    index(point,({probe,bounce:surfaceSH,sky:skySH,ground:groundSH})=>{
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
        if(ground)ground[c]+=scale*groundSH[q];
      }
    });
    if(!total)return null;
    for(let c=0;c<3;c++){
      rgb[c]=Math.max(0,(bounce[c]+sky[c]+(ground?.[c]??0))/total);
      bounce[c]=Math.max(0,bounce[c]/total);
      sky[c]=Math.max(0,sky[c]/total);
      if(ground)ground[c]=Math.max(0,ground[c]/total);
    }
    mix*=strength;
    return {mix,rgb,bounce,sky,...(ground&&{ground}),bounceLevel:mix*(.2126*bounce[0]+.7152*bounce[1]+.0722*bounce[2])};
  }

  function shade(point, normal, rgb, fog, fogMix = 0, albedo) {
    const local = sample(point,normal);
    if(!local || fogMix>=1)return rgb;
    const energy=curves?.sky||curves?.bounce ? Channels.indirect(curves,
      local.sky.map(n=>n*local.mix),local.bounce.map((n,c)=>(n+local.ground[c])*local.mix)) : local.rgb.map(n=>n*local.mix);
    if(!energy.some(Boolean))return rgb;
    const surface = fogMix ? rgb.map((n,k)=>Math.max(0,Math.min(1,(n-fog[k]*fogMix)/(1-fogMix)))) : rgb;
    const diffuse=linear(surface);
    const reflectance=albedo ? linear(albedo) : diffuse;
    const shaded=srgb(diffuse.map((n,k)=>Math.min(1,n+reflectance[k]*energy[k])));
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  }

  return { sample, shade, receives: i => !receive || receive(i),
    receivesSurface:target=>Boolean(settings.geometry)&&ShadowArt.allows(settings.receive,target),
    ...(settings.dynamic && { stats: { sites: sites.length, updated: update?.updated ?? [], rays: update?.rays ?? 0 } }) };
}

function createBounceProbeSampler(world, { bounceProbes, sky, sun, shotLighting, time=0 } = {}) {
  const rig=ShotLighting.frame(world.shotLighting,shotLighting,time);
  const curves=rig?.art?.curves;
  const sampler=create(world,bounceProbes,sky,sun,world,{
    dynamic:false,bounceScale:rig?.bounceScale,splitHemispheres:curves?.sky||curves?.bounce
  });
  const vector=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(Number.isFinite);
  return (point,normal)=>{
    const length=vector(normal)?Math.hypot(...normal):0;
    if(!vector(point)||!length)throw new TypeError('Probe sampling needs an XYZ point and a nonzero XYZ normal');
    const result=sampler?.sample(point,normal.map(n=>n/length));
    if(!result || !(curves?.sky||curves?.bounce))return result??null;
    const {mix}=result, grade=(curve,rgb)=>curve ? curve(rgb.map(n=>n*mix)).map(n=>n/mix) : rgb;
    const sky=grade(curves.sky,result.sky), bounce=grade(curves.bounce,result.bounce.map((n,c)=>n+result.ground[c]));
    return {mix,sky,bounce,rgb:Channels.indirect(null,sky,bounce),
      bounceLevel:mix*(.2126*bounce[0]+.7152*bounce[1]+.0722*bounce[2])};
  };
}

module.exports = { create, createBounceProbeSampler };
