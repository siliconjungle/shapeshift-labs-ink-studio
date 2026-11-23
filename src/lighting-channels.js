/* Shot-level transfer curves and receiver rules for separate lighting signals. */
const LightingChannels = (() => {
  const Curves = typeof ColorCurves === 'undefined' ? require('./color-curves.js') : ColorCurves;
  const Color = typeof ColorSpace === 'undefined' ? require('./color-space.js') : ColorSpace;
  const Shadow = typeof ShadowArt === 'undefined' ? require('./shadow-art.js') : ShadowArt;
  const Targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const linear = Color.prepare('srgb','srgb-linear'), srgb = Color.prepare('srgb-linear','srgb');
  const names=['key','sky','bounce','emission','shadow'];
  const empty={};
  const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const range=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const vector=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(Number.isFinite);
  const luma=([r,g,b])=>.2126*r+.7152*g+.0722*b;
  const clamp=n=>Math.max(0,Math.min(1,n));

  function ramp(raw, name) {
    const shadow=name==='shadow', limit=shadow?1:64;
    if(raw===false)return shadow ? ()=>1 : ()=>[0,0,0];
    if(!fields(raw,shadow?['stops','interpolation']:['stops','interpolation','gain','tint']))
      throw new TypeError('Invalid '+name+' lighting ramp');
    const { stops, interpolation, gain=1, tint }=raw;
    if(!range(gain,0,8)||tint!==undefined&&(typeof tint!=='string'||!/^#[0-9a-f]{6}$/i.test(tint))||
        interpolation!==undefined&&!Curves.modes.includes(interpolation))
      throw new RangeError('Invalid '+name+' lighting gain, tint or interpolation');
    let sample;
    if(stops!==undefined) {
      if(!Array.isArray(stops)||stops.length<2||stops.length>16||
          !Array.from(stops).every(row=>Array.isArray(row)&&row.length===2&&row.every(n=>range(n,0,limit))) ||
          stops[0][0]!==0||(!shadow&&stops[0][1]!==0)||shadow&&stops.at(-1)[0]!==1)
        throw new RangeError('Invalid '+name+' lighting ramp stops');
      sample=Curves.scalar({stops,interpolation},shadow);
    }
    if(shadow) {
      if(!sample)throw new TypeError('A shadow ramp needs visibility stops from 0 to 1');
      return sample;
    }
    const color=tint===undefined ? [1,1,1] : linear([1,3,5].map(i=>parseInt(tint.slice(i,i+2),16)/255));
    return rgb=>{
      const input=luma(rgb), scale=(sample && input>0 ? sample(input)/input : 1)*gain;
      return rgb.map((value,i)=>value*scale*color[i]);
    };
  }

  function list(value, name, read) {
    if(value===undefined||value===false)return [];
    if(!Array.isArray(value)||value.length>32)throw new RangeError(name+' needs up to 32 rules');
    return Array.from(value,read);
  }

  function prepare({channels,shadeNormals,shadowBands,spill}) {
    if(channels!==undefined && channels!==false && !fields(channels,names))
      throw new TypeError('Use key, sky, bounce, emission or shadow lighting channels');
    const curves=Object.fromEntries(Object.entries(channels||{}).map(([name,value])=>[name,ramp(value,name)]));
    const normals=list(shadeNormals,'Shot shading normals',row=>{
      if(!fields(row,['select','normal','strength'])||!vector(row.normal)||!Number.isFinite(Math.hypot(...row.normal))||
          Math.hypot(...row.normal)<1e-8||!range(row.strength??1,0,1))
        throw new RangeError('Shot shading normals need a target, a nonzero XYZ normal and optional strength 0–1');
      const length=Math.hypot(...row.normal);
      return {select:Targets.prepare(row.select),normal:row.normal.map(n=>n/length),strength:row.strength??1};
    });
    const bands=list(shadowBands,'Shot shadow bands',row=>{
      if(!fields(row,['select','bias','steps'])||!range(row.bias??0,-1,1)||
          row.steps!==undefined&&(!Number.isInteger(row.steps)||!range(row.steps,2,16)))
        throw new RangeError('Shot shadow bands need a target, bias −1–1 and optional 2–16 steps');
      return {select:Targets.prepare(row.select),bias:row.bias??0,steps:row.steps};
    });
    const ids=new Set();
    const spillRows=list(spill,'Shot spill',row=>{
      if(!fields(row,['id','receive','bounds','gain'])||!Targets.name(row.id)||ids.has(row.id)||!range(row.gain??1,0,4))
        throw new RangeError('Shot spill needs a unique emitter ID and optional gain 0–4');
      ids.add(row.id);
      const {bounds}=row;
      if(bounds!==undefined&&(!fields(bounds,['min','max','feather'])||!vector(bounds.min)||!vector(bounds.max)||
          bounds.min.some((n,i)=>n>=bounds.max[i])||!range(bounds.feather??0,0,400)))
        throw new RangeError('Shot spill bounds need ordered XYZ coordinates and optional feather');
      return [row.id,{receive:Shadow.prepare({receive:row.receive})?.receive,gain:row.gain??1,
        ...(bounds&&{bounds:{min:bounds.min.slice(),max:bounds.max.slice(),feather:bounds.feather??0}})}];
    });
    return Object.keys(curves).length||normals.length||bands.length||spillRows.length ?
      {curves,normals,bands,spill:new Map(spillRows)} : null;
  }

  function bind(art,world) {
    if(!art)return;
    const {curves,normals,bands,spill}=art, targets=Targets.index(world), cache=new WeakMap();
    function target(row) {
      return row && typeof row==='object' ? row : row>=0 ? targets.row(row) : empty;
    }
    function matches(row) {
      const subject=target(row);
      if(!cache.has(subject))cache.set(subject,{
        normals:normals.filter(rule=>Targets.matches(rule.select,subject)),
        band:bands.findLast(rule=>Targets.matches(rule.select,subject))
      });
      return cache.get(subject);
    }
    return {curves,
      ...(normals.length&&{normal(row,base){
        let n=base;
        for(const {normal,strength} of matches(row).normals) {
          if(!strength)continue;
          n=n.map((value,i)=>value+(normal[i]-value)*strength);
          const length=Math.hypot(...n);
          n=length>1e-8 ? n.map(value=>value/length) : base;
        }
        return n;
      }}),
      ...(bands.length&&{band(row,value){
        const band=matches(row).band;
        if(!band)return value;
        const adjusted=clamp(value-band.bias), steps=band.steps&&band.steps-1;
        return steps ? Math.round(adjusted*steps)/steps : adjusted;
      }}),
      ...(spill.size&&{spill(light,row,point){
        const rule=spill.get(light.id);
        if(!rule)return 1;
        if(!Shadow.allows(rule.receive,target(row)))return 0;
        if(!rule.bounds)return rule.gain;
        const {min,max,feather}=rule.bounds;
        const edge=Math.min(...point.map((n,i)=>Math.min(n-min[i],max[i]-n)));
        if(edge<0)return 0;
        const t=feather ? clamp(edge/feather) : 1;
        return rule.gain*t*t*(3-2*t);
      }})
    };
  }

  function emission(curve,rgb) {
    return srgb(curve(linear(rgb.map(clamp)))).map(clamp);
  }

  function indirect(curves,sky,bounce) {
    const a=curves?.sky ? curves.sky(sky) : sky;
    const b=curves?.bounce ? curves.bounce(bounce) : bounce;
    return a.map((v,i)=>v+b[i]);
  }

  return Object.freeze({prepare,bind,emission,indirect});
})();
if (typeof module !== 'undefined') module.exports = LightingChannels;
