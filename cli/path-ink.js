const Selectors = require('../src/target-selectors.js');
const {dot,linear} = require('./sdf-reference-field.js');

function record(value,keys,label) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(key=>!keys.includes(key)))
    throw new TypeError('Invalid '+label);
}

function number(value,min,max,label) {
  if (!Number.isFinite(value) || value<min || value>max)
    throw new RangeError(label+' must be between '+min+' and '+max);
  return value;
}

function pigment(value) {
  if (typeof value!=='string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw new TypeError('Path ink colors need #rrggbb');
  return linear(value.slice(1).match(/../g).map(n=>parseInt(n,16)/255));
}

const brightness = ([r,g,b]) => .2126*r+.7152*g+.0722*b;
const features = ['silhouette','seam','crease'];
const directions = ['camera','reflection','transmission'];

function prepare(definition) {
  if (definition===undefined || definition===false) return null;
  record(definition,['rules','reflectors'],'path ink settings');
  const {rules=[],reflectors=[]}=definition;
  if (!Array.isArray(rules) || rules.length>32 || !Array.isArray(reflectors) || reflectors.length>32)
    throw new RangeError('Use up to 32 path ink rules and 32 reflecting surfaces');
  const ids=new Set();
  const styles=Array.from(rules,rule=>{
    record(rule,['id','via','select','interface','depth','palette','stops','ambient','ink'],'path ink rule');
    const {id,via,select,interface:origin,depth=8,palette,stops,ambient=.14,ink}=rule;
    if (typeof id!=='string' || !id.trim() || id.length>128 || ids.has(id) || !directions.includes(via) ||
        origin && via==='camera' || !Number.isSafeInteger(depth) || depth<1 || depth>12)
      throw new TypeError('Path ink rules need distinct IDs, a route and 1–12 permitted optical events');
    ids.add(id);
    if (!Array.isArray(palette) || palette.length<1 || palette.length>12)
      throw new RangeError('Path ink palettes need 1–12 ordered swatches');
    const colors=Array.from(palette,pigment);
    const thresholds=stops ?? colors.slice(1).map((_,i)=>(i+1)/colors.length);
    if (!Array.isArray(thresholds) || thresholds.length!==colors.length-1)
      throw new RangeError('Path ink stops need one threshold between each pair of swatches');
    const levels=Array.from(thresholds,(value,i)=>{
      number(value,0,8,'Path ink stop');
      if (i && value<=thresholds[i-1]) throw new RangeError('Path ink stops must increase');
      return value;
    });
    let line;
    if (ink!==undefined) {
      record(ink,['color','width','features','crease'],'path ink line');
      const {color,width=.8,features:enabled=features,crease=48}=ink;
      if (!Array.isArray(enabled) || !enabled.length || enabled.some(key=>!features.includes(key)))
        throw new TypeError('Path ink lines need silhouette, seam or crease features');
      line={color:pigment(color),width:number(width,.25,2,'Path ink width'),features:new Set(enabled),
        cosine:Math.cos(number(crease,15,150,'Path ink crease')*Math.PI/180)};
    }
    return {id,via,select:select===undefined ? null : Selectors.prepare(select),
      origin:origin===undefined ? null : Selectors.prepare(origin),depth,colors,levels,
      ambient:number(ambient,0,2,'Path ink ambient'),line};
  });
  const mirrors=Array.from(reflectors,mirror=>{
    record(mirror,['select','reflectance','roughness','tint'],'path ink reflector');
    const {select,reflectance=1,roughness=0,tint='#ffffff'}=mirror;
    return {select:Selectors.prepare(select),reflectance:number(reflectance,0,1,'Reflectance'),
      roughness:number(roughness,0,.45,'Reflection roughness'),tint:pigment(tint)};
  });
  const targets=new WeakMap(), reflectorsByTarget=new WeakMap();
  function target(hit) {
    let materials=targets.get(hit.owner);
    if (!materials) targets.set(hit.owner,materials=new WeakMap());
    if (!materials.has(hit.material)) {
      const {owner,material}=hit;
      materials.set(material,{object:owner.renderOwner,entity:owner.renderOwner,
        ...(owner.tag && {tags:[owner.tag]}),...owner.renderTarget,material:material.materialId ?? owner.mat.materialId,
        surface:material.surfaceId ?? material.surface?.id ?? owner.renderTarget?.surface});
    }
    return materials.get(hit.material);
  }
  function mirror(hit) {
    if (!mirrors.length || hit.profile.glass) return null;
    const site=target(hit);
    if (!reflectorsByTarget.has(site))
      reflectorsByTarget.set(site,mirrors.find(rule=>Selectors.matches(rule.select,site)) ?? null);
    return reflectorsByTarget.get(site);
  }
  function style(hit,events) {
    if (!styles.length) return;
    const site=target(hit);
    return styles.find(rule=>events.length<=rule.depth && (!rule.select || Selectors.matches(rule.select,site)) &&
      (rule.via==='camera' ? !events.length : events.some(event=>event.kind===rule.via &&
        (!rule.origin || Selectors.matches(rule.origin,target(event.hit))))));
  }
  function sameObject(a,b) {
    const x=target(a),y=target(b);
    return x.object!==undefined || x.entity!==undefined ?
      x.object===y.object && x.entity===y.entity && x.part===y.part : a.owner===b.owner;
  }
  function feature(hit,other,line) {
    const {features:enabled,cosine}=line;
    if (!other) return enabled.has('silhouette');
    const same=sameObject(hit,other);
    if (!same) {
      // A nearer object owns its own edge. The far surface keeps its fill.
      return enabled.has('silhouette') && other.t >= hit.t-1e-4;
    }
    if (enabled.has('seam') && (target(hit).material ?? hit.owner.mat)!==(target(other).material ?? other.owner.mat))
      return true;
    return enabled.has('crease') && dot(hit.normal,other.normal)<cosine && other.t>=hit.t-1e-4;
  }
  return {mirror,style,feature};
}

function color(style,light) {
  const tone=brightness(light);
  const index=style.levels.findIndex(level=>tone<level);
  return style.colors[index<0 ? style.colors.length-1 : index];
}

module.exports={prepare,color};
