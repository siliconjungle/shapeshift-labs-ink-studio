/* Curve detail settings and row-range remapping for native world assembly. */
const CurveLod = (() => {
  const kernel = typeof CurveSplat === 'undefined' ? require('./curve-splat.js') : CurveSplat;
  const detailWeight = typeof StableDetail === 'undefined' ? require('./stable-detail.js').weight : StableDetail.weight;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const number = (value, lo, hi) => Number.isFinite(value) && lo <= value && value <= hi;
  function check(ok, message) {
    if (!ok) throw new RangeError('Curve LOD: ' + message);
  }
  function range(value, name) {
    check(Array.isArray(value) && value.length === 2 && number(value[0], 0, 16) &&
      number(value[1], 0, 16) && value[0] < value[1], name + ' needs two increasing art-pixel thresholds in [0, 16]');
    return value.slice();
  }
  function prepare(value) {
    if (value === undefined || value === false) return;
    if (value === true) value = { simplify: [.16, .38] };
    check(record(value) && Object.keys(value).every(key => key === 'simplify' || key === 'aggregate'),
      'expected simplify or aggregate settings');
    const simplify = value.simplify === false || value.simplify === undefined ? undefined : range(value.simplify, 'simplification');
    const aggregate = value.aggregate;
    if (aggregate === undefined || aggregate === false) return simplify ? { simplify } : undefined;
    check(record(aggregate) && Object.keys(aggregate).every(key =>
      ['transition', 'pitch', 'width', 'color', 'opacity', 'samples', 'coverage'].includes(key)), 'invalid aggregate settings');
    const { pitch, width, color, opacity, samples = 24, transition = [.48, 1.35] } = aggregate;
    check((pitch === undefined || number(pitch, 1e-6, 1e5)) &&
      (width === undefined || number(width, 2e-6, 200)) &&
      (opacity === undefined || number(opacity, 0, 1)) && Number.isSafeInteger(samples) && samples >= 4 && samples <= 64,
    'invalid aggregate pitch, width, opacity or sample count');
    let coverage;
    if (aggregate.coverage !== undefined) {
      const value = aggregate.coverage === true ? {} : aggregate.coverage;
      check(record(value) && Object.keys(value).every(key => key === 'width' || key === 'spacing') &&
        pitch === undefined && aggregate.transition === undefined,
      'coverage needs width and spacing ranges instead of an aggregate pitch or transition');
      coverage = { width: range(value.width ?? [.45,.85], 'strand width'),
        spacing: range(value.spacing ?? [.42,.85], 'strand spacing') };
    }
    return { simplify, aggregate: { pitch, width, color, opacity, samples, coverage,
      transition: range(transition, 'aggregate transition') } };
  }

  function remap(records, indexAt) {
    if (!records?.length) return [];
    function span([first, end]) {
      const start = indexAt(first);
      if (start === undefined) return;
      for (let i = first + 1; i < end; i++) if (indexAt(i) !== start + i - first) return;
      return [start, start + end - first];
    }
    return records.flatMap(({ simplify, runs, aggregate, shadow }) => {
      const kept = runs.map(span).filter(Boolean);
      function remapGroup(group) {
        if (!group) return;
        const proxy = span(group.proxy), detail = group.detail.map(span);
        if (proxy && detail.every(Boolean)) return { ...group, proxy, detail };
      }
      const coarse = remapGroup(aggregate), caster = remapGroup(shadow);
      return kept.length || coarse || caster ? [{ simplify, runs: kept, aggregate: coarse, shadow: caster }] : [];
    });
  }

  const length = (a,b) => Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const lerp = (a,b,t) => a.map((v,k)=>v+(b[k]-v)*t);

  function measureGroup(world, camera, { data, positionAt, scaleAt, alphaAt, forbidden, shadow = false }) {
    const { view, near, ortho, focal, artScale = 1 } = camera;
    const magnification = focal / artScale;
    const stations = world.curveStations;
    const patternStride = world.curvePattern && (typeof CurvePattern === 'undefined' ? require('./curve-pattern.js') : CurvePattern).stride;
    const viewPoint = p => [0,1,2].map(k=>view[k]*p[0]+view[k+4]*p[1]+view[k+8]*p[2]+view[k+12]);
    const rayStretch = p => Math.hypot(1,p[0]/p[2],p[1]/p[2]);
    function span(i) {
      const at = i*16, station = i*kernel.stationStride, total = stations?.[station+3];
      if (!(total > 0) || !(stations[station+2] > stations[station+1])) return;
      const row = kernel.roundSpan(data,at,scaleAt?.(i) ?? 1,positionAt?.(i) ?? data.subarray(at,at+3));
      if (!row) return;
      // Covariance carries an unoriented axis. The station restores path order.
      let { from,to } = row;
      if (from.reduce((sum,v,k)=>sum+(to[k]-v)*stations[station+4+k],0) < 0) [from,to] = [to,from];
      return { from:viewPoint(from),to:viewPoint(to),radius:row.radius*(shadow ? row.support : 1),
        start:stations[station+1]/total,end:stations[station+2]/total };
    }
    return (group, compatible, widthLimit, spacingLimit) => {
      const [first,end] = group.proxy, guide = [];
      let widthPx=0, spacingPx=0;
      for (let i=first; i<end; i++) {
        const section = compatible(i) && span(i);
        if (!section || Math.abs(section.start-(guide.at(-1)?.end ?? 0))>1e-8) return;
        guide.push(section);
      }
      if (!(guide.at(-1)?.end >= 1-1e-8)) return;
      for (const [start,end] of group.detail) {
        let cursor=0, covered=0;
        for (let i=start; i<end; i++) {
          const at = i*16;
          if (!compatible(i) || forbidden?.(i) || world.curveTiming?.[i*kernel.timingStride] ||
              world.curvePattern?.[i*patternStride] || kernel.clipPlanes(world.curveClips,i,[0,0,0],1) ||
              (!shadow && !kernel.hardGroup(data[at+15])) ||
              (alphaAt?.(i) ?? data[at+3]) <= 0) return;
          const fine = span(i);
          if (!fine || Math.abs(fine.start-covered)>1e-8) return;
          covered = fine.end;
          const depth = Math.min(-fine.from[2],-fine.to[2]) - fine.radius;
          if (depth < near) return;
          const widthScale = ortho ? 1 : Math.max(rayStretch(fine.from),rayStretch(fine.to))/depth;
          widthPx = Math.max(widthPx,2*fine.radius*magnification*widthScale);
          if (widthPx >= widthLimit) return;
          while (cursor+1 < guide.length && guide[cursor].end <= fine.start) cursor++;
          // Compare every breakpoint of both piecewise-linear paths. This
          // bounds a local hole by twice the largest offset from the guide.
          for (let j=cursor; j<guide.length; j++) {
            const coarse = guide[j];
            let offset=0, nearDepth=Infinity, stretch=1;
            for (const arc of [Math.max(fine.start,coarse.start),Math.min(fine.end,coarse.end)]) {
              const a = lerp(fine.from,fine.to,(arc-fine.start)/(fine.end-fine.start));
              const b = lerp(coarse.from,coarse.to,(arc-coarse.start)/(coarse.end-coarse.start));
              nearDepth = Math.min(nearDepth,-a[2]-fine.radius,-b[2]-coarse.radius);
              if (nearDepth < near) return;
              offset = Math.max(offset,length(a,b));
              if (!ortho) stretch = Math.max(stretch,rayStretch(a),rayStretch(b));
            }
            const radiusChange = coarse.radius-fine.radius;
            const deviation = Math.max(offset,shadow ? Math.abs(radiusChange) : radiusChange);
            spacingPx = Math.max(spacingPx,2*magnification*deviation*(ortho ? 1 : stretch/nearDepth));
            if (spacingPx >= spacingLimit) return;
            if (coarse.end >= fine.end-1e-9) break;
          }
        }
        if (covered < 1-1e-8) return;
      }
      return [widthPx,spacingPx];
    };
  }

  const posedParts = world => world.anim?.rig || world.anim?.bones || world.reconstructionPose;
  function coverageFrame(world, camera, options) {
    const records = world.curveLod?.filter(row=>row.aggregate?.coverage);
    if (!records?.length || posedParts(world)) return;
    const {keep, partitionAt, report} = options;
    const protection = (typeof ProtectedLOD === 'undefined' ? require('./protected-lod.js') : ProtectedLOD).active(world, options.protectedLOD);
    const measure = measureGroup(world,camera,options);
    const hidden = new Set(), opacity = new Map(), codes = new Map();
    const stats = { groups:0, grouped:0, blending:0, individual:0, proxySpans:0, replacedSpans:0 };
    const decisions = report && [];
    for (const { aggregate } of records) {
      const [first,end] = aggregate.proxy;
      if (!aggregate.opacity || !keep(first)) continue;
      stats.groups++;
      const code = partitionAt?.(first) ?? 0, {width,spacing} = aggregate.coverage;
      const measured = measure(aggregate,i=>keep(i) && (partitionAt?.(i) ?? 0) === code,width[1],spacing[1]);
      const requested = measured ? Math.round(16*Math.max(detailWeight(width,measured[0]),detailWeight(spacing,measured[1]))) : 16;
      const {object,part} = aggregate;
      const features = requested < 16 && protection?.features(object, part, 'strand');
      const step = features ? 16 : requested;
      decisions?.push({object,part,group:first,grouped:1-step/16,
        ...(features && {reason:'protected-feature',features,requestedGrouped:1-requested/16})});
      if (step === 16) { stats.individual++; continue; }
      stats[step ? 'blending' : 'grouped']++;
      stats.proxySpans += end-first;
      for (let i=first; i<end; i++) {
        opacity.set(i,aggregate.opacity);
        if (step) codes.set(i,-step);
      }
      for (const [start,until] of aggregate.detail) {
        if (!step) stats.replacedSpans += until-start;
        for (let i=start; i<until; i++) {
          if (step) codes.set(i,step);
          else hidden.add(i);
        }
      }
    }
    report?.(decisions);
    return { hidden, opacity, codes, stats };
  }

  function visible(code,x,y) {
    const rank=4*(2*((x^y)&1)+(y&1))+2*(((x^y)>>1)&1)+((y>>1)&1);
    return code > 0 ? rank < code : rank >= -code;
  }
  const glsl = `
bool strandVisible(int code, vec2 at) {
  ivec2 p=ivec2(floor(at))&ivec2(3);
  int a=p.x^p.y;
  int rank=4*(2*(a&1)+(p.y&1))+2*((a>>1)&1)+((p.y>>1)&1);
  return code>0 ? rank<code : rank>=-code;
}
`;
  return Object.freeze({ prepare, remap, coverageFrame, measureGroup, posedParts, visible, glsl });
})();
if (typeof module !== 'undefined') module.exports = CurveLod;
