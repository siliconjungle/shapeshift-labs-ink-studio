/* Settings and row identities for causal native-pixel boundary decisions. */
const LivePixelBoundaries = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const limits = { temporal:[0,2,.9], spatial:[0,1,.35], depthPixels:[.05,4,.9],
    maxMotion:[.25,16,3], maxGap:[.001,2,.2] };
  const maxPixels = 65536, maxRows = 262144;
  const plans = new WeakSet();

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (plans.has(value)) return value;
    if (!value || Object.getPrototypeOf(value)!==Object.prototype ||
        Object.keys(value).some(key=>key!=='features' && key!=='bounds' && !Object.hasOwn(limits,key)))
      throw new TypeError('Expected live pixel boundary settings with named features');
    const {features,bounds}=value, ids=new Set();
    if (!Array.isArray(features)||!features.length||features.length>32)
      throw new RangeError('Live pixel boundaries need 1–32 named features');
    const named=Array.from(features, feature=>{
      if (!selectors.name(feature?.id)||ids.has(feature.id))
        throw new TypeError('Live pixel boundary features need distinct named IDs');
      ids.add(feature.id);
      return Object.freeze({id:feature.id,select:selectors.prepare(feature.select)});
    });
    if (bounds!==undefined && (!Array.isArray(bounds)||bounds.length!==4||
        !Array.from(bounds).every(Number.isSafeInteger)||bounds[0]<0||bounds[1]<0||
        bounds[2]<1||bounds[3]<1||bounds[2]*bounds[3]>maxPixels))
      throw new RangeError('Live pixel boundary bounds need a native pixel rectangle');
    const controls={};
    for (const [key,[lo,hi,fallback]] of Object.entries(limits)) {
      const n=value[key]===undefined ? fallback : value[key];
      if (!Number.isFinite(n)||n<lo||n>hi) throw new RangeError('Invalid live pixel boundary '+key);
      controls[key]=n;
    }
    const config={features:Object.freeze(named),bounds:bounds && Object.freeze(bounds.slice()),...controls};
    const plan=Object.freeze({...config,key:JSON.stringify(config)});
    plans.add(plan);
    return plan;
  }

  function region(plan,w,h) {
    const [x,y,width,height]=plan.bounds??[0,0,w,h];
    if (w*h>maxPixels || x+width>w || y+height>h)
      throw new RangeError('Live pixel boundaries need an in-grid region on a grid of at most '+maxPixels+' pixels');
    return [x,h-y-height,width,height];
  }

  // Overlapping selectors have authored priority. Adjacent dabs that describe
  // one feature share its ID. Remaining layers use their own semantic identity.
  function memberships(world,plan) {
    if (world.count>maxRows) throw new RangeError('Live pixel boundaries support at most '+maxRows+' splat rows');
    const index=selectors.index(world), groups=new Map(), cached=new Map();
    const result=new Float32Array(world.count), selected=new Uint32Array(plan.features.length);
    for (let i=0;i<world.count;i++) {
      const target=index.row(i);
      if (!cached.has(target)) {
        const slot=target.mediumKind==='glass' ? -2 : plan.features.findIndex(item=>selectors.matches(item.select,target));
        if (slot>=0) cached.set(target,slot+1);
        else if (slot===-2) cached.set(target,0);
        else {
          const key=JSON.stringify([target.object??target.entity,target.part,target.material,target.surface]);
          if (!groups.has(key)) groups.set(key,-2-groups.size);
          cached.set(target,groups.get(key));
        }
      }
      const id=result[i]=cached.get(target);
      if (id>0) selected[id-1]++;
    }
    return {groups:result,selected};
  }

  return Object.freeze({prepare,region,memberships});
})();
