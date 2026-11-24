const CameraLens = require('../src/camera-lens.js');
const ColorSpace = require('../src/color-space.js');
const Optical = require('../src/optical-materials.js');
const {sampleFrames} = require('./art-passes.js');
const Selectors = require('../src/target-selectors.js');
const RowAssets = require('./render-row-assets.js');
const {transportFor} = require('./sdf-path-trace.js');

const format = 'ink-studio/traced-lighting';
const linear = ColorSpace.prepare('srgb','srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear','srgb');

function bake(world, options, camera, {samples=32,bounces=2,spacing=.075,seed=1,select,posed=false}={}) {
  if (!Number.isSafeInteger(samples) || samples<4 || samples>512 ||
      !Number.isSafeInteger(bounces) || bounces<1 || bounces>6 ||
      !Number.isSafeInteger(seed) || seed<0 || seed>0xffffffff ||
      !Number.isFinite(spacing) || spacing<.008 || spacing>4 || typeof posed!=='boolean')
    throw new RangeError('Invalid traced lighting bake settings');
  const identity=RowAssets.signature(world);
  const {KIT}=require('../index.js').load();
  if (posed && world.anim?.bones) {
    const rest=world.rest ?? world.data;
    world=KIT.viewPoses.frame(world,{...CameraLens.fromView(camera.view),ortho:camera.ortho},
      {enabled:options.viewPoses!==false,headless:true});
    if (!world.rest) world={...world,rest,data:KIT.bones.posed({data:rest,anim:world.anim})};
  }
  const frames=sampleFrames(world,options.t ?? 0);
  const transport=transportFor(world,options,camera,{bounces,epsilon:.001,steps:160,posed});
  const labels=Selectors.index(world), selectors=select===undefined ? [] : (Array.isArray(select) ? select : [select]).map(Selectors.prepare);
  const sites=new Map(), data=world.data;
  for (let i=0;i<world.count;i++) {
    const q=i*16;
    if (!transport.rows[i] || data[q+3]<1 || Math.round(data[q+11]) & (15|16|32|64|256|8704|32768) ||
        world.opticalSplats?.[i*Optical.STRIDE+3]) continue;
    const target=labels.row(i);
    if (selectors.length && !selectors.some(selector=>Selectors.matches(selector,target))) continue;
    const point=Array.from(data.subarray(q,q+3)), normal=frames(i).normal;
    if (!normal || Math.hypot(...normal)<.5) continue;
    const key=JSON.stringify([target.object,target.material,...point.map(n=>Math.floor(n/spacing)),
      ...normal.map(n=>Math.round(n*1.5))]);
    if (!sites.has(key)) {
      if ((sites.size+1)*samples>3e6) throw new RangeError('Traced lighting exceeds 3 million receiver rays');
      sites.set(key,{ids:[],rgb:transport.irradiance(point,normal,samples,seed^Math.imul(sites.size+1,0x9e3779b1))});
    }
    sites.get(key).ids.push(i);
  }
  if (!sites.size) throw new RangeError('Traced lighting needs retained opaque receivers that match the selection');
  const entries=[...sites.values()].filter(site=>Math.max(...site.rgb)>1e-6);
  return {format,version:1,signature:identity,rows:world.count,time:options.t ?? 0,
    settings:{samples,bounces,spacing,seed,select,posed},entries,
    stats:{sites:sites.size,litSites:entries.length,...transport.stats}};
}

const checked=new WeakMap();

function prepare(world, value) {
  if (value===undefined || value===false) return null;
  const {asset,strength=1}=value?.asset ? value : {asset:value};
  RowAssets.validate(world,asset,format);
  if (!Number.isFinite(strength) || strength<0 || strength>8)
    throw new RangeError('Traced lighting strength must be in 0–8');
  if (!checked.has(asset)) {
    if (!Array.isArray(asset.entries)) throw new TypeError('Traced lighting needs receiver entries');
    const rows=new Array(world.count);
    for (const entry of asset.entries) {
      if (!Array.isArray(entry?.rgb) || entry.rgb.length!==3 || entry.rgb.some(n=>!Number.isFinite(n) || n<0) ||
          !Array.isArray(entry.ids)) throw new RangeError('Invalid traced lighting receiver entry');
      for (const i of entry.ids) {
        if (!Number.isSafeInteger(i) || i<0 || i>=world.count || rows[i])
          throw new RangeError('Invalid or duplicate traced lighting receiver');
        rows[i]=entry.rgb.slice();
      }
    }
    checked.set(asset,rows);
  }
  const rows=checked.get(asset);
  if (!strength) return null;
  return {
    at:i=>rows[i],
    add(i,rgb,albedo,fog,fogMix=0) {
      const incoming=rows[i];
      if (!incoming) return rgb;
      const visibility=1-fogMix, pigment=linear(albedo ?? rgb);
      const base=linear(rgb.map((v,c)=>Math.max(0,v-(fog?.[c] ?? 0)*fogMix)/Math.max(1e-8,visibility)));
      return srgb(base.map((n,c)=>n+pigment[c]*incoming[c]*strength))
        .map((n,c)=>n*visibility+(fog?.[c] ?? 0)*fogMix);
    },
    strength
  };
}

module.exports = {bake,prepare};
