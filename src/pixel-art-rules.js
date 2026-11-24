/* Author-facing pixel rules and their adapters to Ink's native look controls. */
const PixelArtRules = (() => {
  const craft = typeof PixelCraft === 'undefined' ? require('./pixel-craft.js') : PixelCraft;
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value,keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const pairKey = (a,b)=>a < b ? a+'/'+b : b+'/'+a;
  const kinds = Object.freeze({
    ...craft.kinds,
    ramp:{ label:'Unpermitted swatches',hint:'Use a swatch from the allowed ramps or author a scoped exception.' },
    outline:{ label:'Outline rules',hint:'Check whether this authored outline swatch belongs on this edge.' },
    dither:{ label:'Unpermitted dither pairs',hint:'Use an approved pair for this alternating patch.' },
    edge:{ label:'Edge coverage rules',hint:'Check the partial coverage against the asset’s hard edge rule.' }
  });
  const disabledLines = { silhouette:false,crease:false,boundary:false,shadowEdge:false,hatch:false };
  const hex = value=>value.color.toLowerCase();

  function prepare(definition,{ swatches,ramps = [],layers = [],frames = [],selections = [] }) {
    if (definition === undefined) return;
    if (!fields(definition,['version','profiles','bindings']) || definition.version !== 1 ||
        !Array.isArray(definition.profiles) || definition.profiles.length > 63 ||
        !Array.isArray(definition.bindings) || definition.bindings.length > 63)
      throw new TypeError('Art rules need version 1, profiles, and up to 63 bindings');
    const colors = new Map(swatches.map(row=>[row.id,hex(row)]));
    const rampMap = new Map(ramps.map(row=>[row.id,row.swatches]));
    const layerMap = new Map(layers.map(row=>[row.id,row.parent]));
    const saved = new Map(selections.map(row=>[row.id,row]));
    const profiles = new Map();
    for (const profile of definition.profiles) {
      if (!fields(profile,['id','ramps','outline','dither','edge','exceptions']) || !id(profile.id) || profiles.has(profile.id))
        throw new TypeError('Art rule profiles need unique IDs and known art rule fields');
      const { id:name,outline,dither,edge,exceptions = [] } = profile;
      const allowed = profile.ramps === undefined ? undefined : new Set();
      if (allowed) {
        if (!Array.isArray(profile.ramps) || !profile.ramps.length || new Set(profile.ramps).size !== profile.ramps.length ||
            !Array.from(profile.ramps).every(key=>rampMap.has(key)))
          throw new RangeError('Art rule '+name+' needs distinct known palette ramps');
        for (const ramp of profile.ramps) for (const swatch of rampMap.get(ramp)) allowed.add(swatch);
      }
      if (outline !== undefined && (!fields(outline,['mode','swatch','crease','boundary']) ||
          !['off','silhouette','selective'].includes(outline.mode) ||
          (outline.swatch !== undefined && !colors.has(outline.swatch)) ||
          ['crease','boundary'].some(key=>outline[key] !== undefined && (outline.mode !== 'selective' || typeof outline[key] !== 'boolean'))))
        throw new TypeError('Art rule '+name+' needs an outline mode and optional known swatch');
      let pairs;
      if (dither !== undefined) {
        if (!allowed || !fields(dither,['pattern','strength','pairs']) || !Array.isArray(dither.pairs) || dither.pairs.length > 256 ||
            !['none','checker','bayer','blue-noise'].includes(dither.pattern ?? 'bayer') ||
            (dither.strength !== undefined && !unit(dither.strength)))
          throw new TypeError('Art rule '+name+' needs permitted ramps and a dither pair list');
        pairs = new Set();
        const renderedPairs = new Set();
        for (const pair of dither.pairs) {
          if (!Array.isArray(pair) || pair.length !== 2 || !Array.from(pair).every(key=>allowed.has(key)) ||
              colors.get(pair[0]) === colors.get(pair[1]))
            throw new RangeError('Art rule '+name+' dither pairs need two different colors from permitted swatches');
          const key = pairKey(...pair), painted = pairKey(...pair.map(swatch=>colors.get(swatch)));
          if (pairs.has(key) || renderedPairs.has(painted)) throw new RangeError('Art rule '+name+' repeats a dither pair');
          pairs.add(key);
          renderedPairs.add(painted);
        }
      }
      if (edge !== undefined && (!fields(edge,['mode','strength']) || !['hard','area'].includes(edge.mode) ||
          edge.strength !== undefined && (edge.mode !== 'area' || !unit(edge.strength))))
        throw new TypeError('Art rule '+name+' needs hard or area edge treatment');
      if (!Array.isArray(exceptions) || exceptions.length > 128)
        throw new RangeError('Art rule '+name+' needs a list of up to 128 exceptions');
      const exceptionIds = new Set();
      for (const exception of exceptions) {
        if (!fields(exception,['id','check','reason','selection']) || !id(exception.id) || exceptionIds.has(exception.id) ||
            !Object.hasOwn(kinds,exception.check) || typeof exception.reason !== 'string' || !exception.reason.trim() ||
            exception.reason.length > 256 || exception.selection !== undefined && !saved.has(exception.selection))
          throw new TypeError('Art rule '+name+' exceptions need unique IDs, a known check, a reason and an optional saved selection');
        exceptionIds.add(exception.id);
      }
      if (!allowed && !outline && !edge && !exceptions.length) throw new TypeError('Art rule '+name+' has no rules or exceptions');
      profiles.set(name,{ ...profile,allowed,pairs });
    }
    const bindings = Array.from(definition.bindings,binding=>{
      if (!fields(binding,['profile','layer','frame','shot','select']) || !profiles.has(binding.profile) ||
          binding.layer !== undefined && !layerMap.has(binding.layer) ||
          binding.frame !== undefined && (!id(binding.frame) || !frames.includes(binding.frame)) ||
          binding.shot !== undefined && !id(binding.shot))
        throw new TypeError('Art rule bindings need a known profile and valid layer, frame, and shot scopes');
      if (binding.select !== undefined) {
        const select = selectors.prepare(binding.select);
        if (Object.hasOwn(select,'medium') || Object.hasOwn(select,'mediumKind'))
          throw new TypeError('Art rule selectors must address scene geometry');
      }
      return { ...binding,style:profiles.get(binding.profile) };
    });
    return { bindings,colors,layers:layerMap,selections:saved };
  }

  function matching(plan,{ frame,shot } = {}) {
    if (shot !== undefined && !id(shot)) throw new TypeError('An art shot needs a stable shot ID');
    return (plan?.bindings ?? []).filter(row=>(row.frame === undefined || row.frame === frame) &&
      (row.shot === undefined || row.shot === shot));
  }

  function resolve(plan,rows,layer) {
    const lineage = new Set();
    for (let key = layer; key !== undefined && key !== null; key = plan.layers.get(key)) lineage.add(key);
    // General rules apply before layer rules. Within either scope, shot rules apply last.
    const result = { profiles:[],exceptions:[] };
    for (const scoped of [false,true]) for (const shot of [false,true]) for (const row of rows) {
      if ((row.layer !== undefined) !== scoped || (row.shot !== undefined) !== shot ||
          (scoped && !lineage.has(row.layer)) || (!scoped && row.select)) continue;
      const style = row.style;
      result.profiles.push(style.id);
      if (style.allowed) result.palette = style;
      if (style.outline) result.outline = style.outline;
      if (style.edge) result.edge = style.edge;
      for (const exception of style.exceptions ?? [])
        result.exceptions.push({ ...exception,profile:style.id });
    }
    return result;
  }

  function describe(plan,options = {}) {
    const rows = matching(plan,options);
    const active = plan ? resolve(plan,rows,options.layer) : { profiles:[],exceptions:[] };
    const { palette,profiles,outline,edge,exceptions } = active;
    return { profiles, ...(palette && { ramps:palette.ramps,swatches:[...palette.allowed],dither:palette.dither ?? null }),
      ...(outline && { outline }),...(edge && { edge }),exceptions };
  }

  function scene(plan,options = {}) {
    const rows = matching(plan,options).filter(row=>row.select || row.layer === undefined);
    if (!plan || !rows.length) return {};
    const paletteConstraints = { targets:[] }, ink = { targets:[] }, edgeFilter = { rules:[] };
    for (const shot of [false,true]) for (const row of rows) {
      if ((row.shot !== undefined) !== shot) continue;
      const { style,select } = row;
      if (style.allowed) {
        const palette = [...new Set([...style.allowed].map(key=>plan.colors.get(key)))];
        if (palette.length > 48) throw new RangeError('Scene art rule '+style.id+' exceeds 48 output colors');
        const { dither } = style;
        const policy = { palette,assetId:style.id,...(dither && { dither:{
          pattern:dither.pattern ?? 'bayer',strength:dither.strength ?? 1,
          pairs:dither.pairs.map(pair=>({ colors:pair.map(key=>plan.colors.get(key)) }))
        } }) };
        if (select) paletteConstraints.targets.push({ select,...policy });
        else paletteConstraints.default = policy;
      }
      if (style.outline) {
        const { mode,swatch,crease = true,boundary = true } = style.outline;
        const lines = { ...disabledLines };
        if (mode !== 'off') lines.silhouette = swatch ? { color:plan.colors.get(swatch) } : true;
        if (mode === 'selective') { lines.crease = crease ? lines.silhouette : false; lines.boundary = boundary ? lines.silhouette : false; }
        if (select) ink.targets.push({ select,...lines });
        else Object.assign(ink,lines);
      }
      if (style.edge) {
        const strength = style.edge.mode === 'hard' ? 0 : style.edge.strength ?? 1;
        if (select) edgeFilter.rules.unshift({ select,strength });
        else edgeFilter.strength = strength;
      }
    }
    return { ...(paletteConstraints.default || paletteConstraints.targets.length ? { paletteConstraints } : {}),
      ...(ink.targets.length || ink.silhouette !== undefined ? { ink } : {}),
      ...(edgeFilter.rules.length || edgeFilter.strength !== undefined ? { edgeFilter } : {}) };
  }

  function applyLook(look,compiled) {
    const result = { ...look };
    if (compiled.paletteConstraints) {
      const before = look?.paletteConstraints, after = compiled.paletteConstraints;
      result.paletteConstraints = { ...before,...after,targets:[...(before?.targets ?? []),...after.targets] };
    }
    if (compiled.ink) {
      const before = look?.ink, after = compiled.ink;
      result.ink = { ...(!before && disabledLines),...before,...after,targets:[...(before?.targets ?? []),...after.targets] };
    }
    if (compiled.edgeFilter) {
      const before = look?.edgeFilter, after = compiled.edgeFilter;
      const strength = after.strength ?? before?.strength ?? (before === true || before && before.rules === undefined ? 1 : 0);
      result.edgeFilter = { strength,rules:[...after.rules,...(before?.rules ?? [])] };
    }
    return result;
  }

  function audit(raster,analysis,plan,options = {}) {
    const { width:w,height:h,slots,opacity,swatches,layerIds,owners,locks } = raster;
    const bindings = matching(plan,options);
    if (!bindings.some(row=>row.layer !== undefined || !row.select)) return analysis;
    const { mark,bg } = analysis.result;
    const styles = new Map(), adjacent = [[-1,0],[1,0],[0,-1],[0,1]];
    const point = (x,y)=>x < 0 || y < 0 || x >= w || y >= h ? -1 : y*w+x;
    const layerAt = p=>layerIds?.[owners?.[p]] ?? null;
    function owner(p) {
      const layer = options.layer ?? layerAt(p);
      if (layer !== null || !bg[p]) return layer;
      const adjacentLayers = new Set();
      for (const [dx,dy] of adjacent) {
        const q = point(p%w+dx,Math.floor(p/w)+dy);
        const nearby = q >= 0 && !bg[q] && layerAt(q);
        if (nearby) adjacentLayers.add(nearby);
      }
      return adjacentLayers.size === 1 ? [...adjacentLayers][0] : null;
    }
    function styleAt(p) {
      const layer = owner(p);
      if (!styles.has(layer)) styles.set(layer,resolve(plan,bindings,layer));
      return styles.get(layer);
    }
    const boundary = (p,key,style)=>adjacent.some(([dx,dy])=>{
      const q = point(p%w+dx,Math.floor(p/w)+dy);
      return q < 0 || bg[q] || styleAt(q)[key] !== style;
    });
    const flag = (kind,p)=>{
      mark[kind] ??= new Uint8Array(slots.length);
      mark[kind][p] = 1;
    };
    for (let p = 0; p < slots.length; p++) {
      if (bg[p]) continue;
      const style = styleAt(p), swatch = swatches[slots[p]];
      const { palette,outline,edge } = style;
      if (palette && !palette.allowed.has(swatch) && !(outline?.swatch === swatch && outline.mode !== 'off')) flag('ramp',p);
      if (outline?.swatch !== undefined && outline.swatch === swatch && (outline.mode === 'off' || outline.mode === 'silhouette' && !boundary(p,'outline',outline)))
        flag('outline',p);
      if (edge?.mode === 'hard' && opacity?.[p] < 255 && boundary(p,'edge',edge)) flag('edge',p);
      if (!palette?.pairs || p%w === w-1 || p+w >= slots.length) continue;
      const cells = [p,p+1,p+w,p+w+1];
      if (cells.some(q=>bg[q] || styleAt(q).palette !== palette)) continue;
      const other = swatches[slots[p+1]];
      if (swatch !== other && slots[p] === slots[p+w+1] && slots[p+1] === slots[p+w] &&
          (!palette.pairs.has(pairKey(swatch,other)) || palette.dither?.pattern === 'none' || palette.dither?.strength === 0))
        for (const q of cells) flag('dither',q);
    }
    const accepted = new Map(), selectionPixels = new Map(), counts = {};
    function allowed(exception,p) {
      if (!exception.selection) return true;
      if (!selectionPixels.has(exception.selection)) {
        const saved = plan.selections.get(exception.selection);
        const pixels = saved.frame === undefined || saved.frame === options.frame ? saved.pixels : [];
        selectionPixels.set(exception.selection,new Set(pixels.map(([x,y])=>y*w+x)));
      }
      return selectionPixels.get(exception.selection).has(p);
    }
    for (const [kind,flags] of Object.entries(mark)) {
      for (let p = 0; p < flags.length; p++) {
        if (!flags[p]) continue;
        const exception = styleAt(p).exceptions.findLast(row=>row.check === kind && allowed(row,p));
        if (!exception) continue;
        const key = exception.profile+'/'+exception.id;
        if (!accepted.has(key)) accepted.set(key,{ exception,pixels:[] });
        accepted.get(key).pixels.push(p);
        flags[p] = 0;
        counts[kind] = (counts[kind] ?? 0)+1;
      }
    }
    const diagnostics = craft.regions(mark,w,h,locks,owners,layerIds);
    if (accepted.size) {
      const flags = new Uint8Array(slots.length);
      for (const { exception,pixels } of accepted.values()) {
        for (const p of pixels) flags[p] = 1;
        for (const row of craft.regions({ [exception.check]:flags },w,h,locks,owners,layerIds,pixels))
          diagnostics.push({ ...row,editableRuns:[],exception });
        for (const p of pixels) flags[p] = 0;
      }
    }
    return { ...analysis,diagnostics,acceptedMarks:counts };
  }
  return Object.freeze({ kinds,prepare,describe,scene,applyLook,audit });
})();
if (typeof module !== 'undefined') module.exports = PixelArtRules;
