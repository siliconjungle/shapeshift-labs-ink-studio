/* Saved relief choices for a single asset revision and native camera range. */
(function (K) {
  const format='ink-studio/relief-approval';
  const tiers=Object.freeze(['geometry','normal','painted']);
  const axes=Object.freeze(['distance','yaw','pitch','projectedHeight','screenX','screenY']);
  const {clone,freeze}=K.procedural.data;
  const cache=new WeakMap();
  const name=value=>TargetSelectors.name(value);
  const finite=Number.isFinite;
  const interval=value=>Array.isArray(value)&&value.length===2&&Array.from(value).every(finite)&&value[0]<=value[1];
  const size=value=>Number.isSafeInteger(value)&&value>0&&value<=4096;
  const sameGrid=(a,b)=>a.width===b.width&&a.height===b.height&&a.ortho===b.ortho;
  const key=({id,objectId,partId,revision})=>JSON.stringify([id,objectId,partId??null,revision]);
  const tolerance=(lo,hi)=>1e-5*Math.max(1,Math.abs(lo),Math.abs(hi));
  const inside=(n,[lo,hi])=>n>=lo-tolerance(lo,hi)&&n<=hi+tolerance(lo,hi);
  const overlaps=(a,b)=>a[0]<=b[1]+tolerance(a[0],b[1])&&b[0]<=a[1]+tolerance(b[0],a[1]);

  function prepare(source) {
    if (source===undefined || source===false) return;
    if (cache.has(source)) return cache.get(source);
    if (source?.format!==format||source.version!==1||!Array.isArray(source.choices)||
        !source.choices.length||source.choices.length>128)
      throw new TypeError('Expected a version 1 relief approval with up to 128 choices');
    const choices=new Map();
    for (const row of clone(source.choices)) {
      const {asset,range,tier,evidence}=row??{};
      if (!name(asset?.id)||!name(asset.objectId)||!(asset.partId===null||name(asset.partId))||
          typeof asset.revision!=='string'||!/^r[0-9a-z]+$/.test(asset.revision)||
          !name(range?.id)||!size(range.width)||!size(range.height)||typeof range.ortho!=='boolean'||
          !axes.every(axis=>interval(range[axis]))||range.distance[0]<=0||range.projectedHeight[0]<=0||
          !tiers.includes(tier)||!evidence||!/^[0-9a-f]{64}$/.test(evidence.sha256)||
          !Number.isSafeInteger(evidence.frames)||evidence.frames<2)
        throw new TypeError('Invalid relief approval asset, camera range, tier or review evidence');
      const id=key(asset), same=choices.get(id)??[];
      if (same.some(other=>range.id===other.range.id||tier!==other.tier&&sameGrid(range,other.range)&&
          axes.every(axis=>overlaps(range[axis],other.range[axis]))))
        throw new RangeError('Duplicate or conflicting relief camera ranges for '+asset.id);
      same.push(freeze(row));
      choices.set(id,same);
    }
    const approval=Object.freeze({choose(asset,camera){
      return choices.get(key(asset))?.find(({range})=>sameGrid(range,camera)&&axes.every(axis=>inside(camera[axis],range[axis])));
    }});
    cache.set(source,approval);
    return approval;
  }

  K.procedural.lod.reliefApproval=Object.freeze({format,tiers,axes,prepare});
})(KIT);
