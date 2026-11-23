const CurveLod = require('../src/curve-lod.js');

function prepare(value) {
  if (value === undefined || value === false) return {};
  if (!value || Object.getPrototypeOf(value)!==Object.prototype ||
      Object.keys(value).some(key=>key!=='maxSpans' && key!=='maxLayers'))
    throw new TypeError('Live sun strandShadows needs maxSpans or maxLayers');
  const {maxSpans,maxLayers} = value;
  if (maxSpans!==undefined && (!Number.isSafeInteger(maxSpans) || maxSpans<0) ||
      maxLayers!==undefined && (!Number.isSafeInteger(maxLayers) || maxLayers<1 || maxLayers>64))
    throw new RangeError('Live sun strandShadows needs a nonnegative span target and 1 to 64 retained layers');
  return {...(maxSpans!==undefined && {maxSpans}),...(maxLayers!==undefined && {maxLayers})};
}

function plan(world, camera, detailed, bounds, {maxSpans}, {data, positionAt, scaleAt, proxyAt} = {}) {
  const stats = {detailSpans:detailed.size, submittedSpans:detailed.size, proxySpans:0,
    grouped:0, spanTarget:maxSpans ?? null, overTarget:Math.max(0,detailed.size-(maxSpans ?? Infinity))};
  if (!stats.overTarget || !proxyAt || CurveLod.posedParts(world)) return {submit:detailed.values(),stats};
  const measure = CurveLod.measureGroup(world,camera,{data,positionAt,scaleAt,shadow:true,
    alphaAt:i=>detailed.get(i)?.opacity ?? 0});
  const options = [];
  for (const {shadow:group} of world.curveLod ?? []) {
    if (!group?.opacity) continue;
    const [first,end] = group.proxy;
    const count = group.detail.reduce((total,[start,end])=>total+end-start,0);
    if (end-first>=count || !measure(group,i=>first<=i && i<end || detailed.has(i),Infinity,group.maxError)) continue;
    const spans = [];
    for (let i=first;i<end;i++) {
      const span=proxyAt(i,group.opacity);
      if (!span || span.bounds[0]<bounds[0] || span.bounds[1]<bounds[1] ||
          span.bounds[2]>bounds[2] || span.bounds[3]>bounds[3]) break;
      spans.push(span);
    }
    if (spans.length===end-first) options.push({group,spans,saved:count-spans.length,first});
  }
  options.sort((a,b)=>b.saved-a.saved || a.first-b.first);
  for (const {group,spans,saved,first} of options) {
    if (stats.submittedSpans<=maxSpans) break;
    for (const [start,end] of group.detail) for (let i=start;i<end;i++) detailed.delete(i);
    for (const [index,span] of spans.entries()) detailed.set(first+index,span);
    stats.submittedSpans-=saved;
    stats.proxySpans+=spans.length;
    stats.grouped++;
  }
  stats.overTarget=Math.max(0,stats.submittedSpans-maxSpans);
  return {submit:detailed.values(),stats};
}

module.exports = {prepare,plan};
