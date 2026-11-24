'use strict';

const ArtPasses = require('../src/art-passes.js');
const CanvasTransforms = require('../src/pixel-canvas-transforms.js');
const Protection = require('../src/pixel-protection.js');
const Sources = require('../src/pixel-source-bindings.js');
const Selections = require('../src/pixel-selections.js');
const { runs,visit,four,eight } = require('../src/pixel-paint-tools.js');
const { digest, isRevision } = require('./pixel-edit-revisions.js');
const { conflict } = require('./pixel-edit-preview.js');
const { minimumCoverage } = require('./pixel-selection-scope.js');

const types = new Map([
  ['shadow-cluster',['swatches','ramp','steps','range','at','connectivity']],
  ['one-pixel-gap',['axis','at']],
  ['protected-detail',['id','kind','at']],
  ['visible-part',['id','object','entity','at']],
  ['occluding-contributor',['binding','object','part','scope','at']]
]);
const reportLimit = 128;
const named = value => typeof value === 'string' && value.trim().length > 0;
const sceneChannels = ['coverage','depth','surfaceKind','position','objectId','partId',...ArtPasses.sourceBindings];
const partChannels = ['coverage','objectId','partId'];

function validation(width,height,query) {
  const { type,id,object,entity,part,at,scope } = query;
  if (Object.getPrototypeOf(query) !== Object.prototype ||
      Object.keys(query).some(key=>key !== 'type' && !types.get(type).includes(key)) ||
      [id,object,entity,part].some(value=>value !== undefined && !named(value)) ||
      (at !== undefined && !Selections.contains(width,height,at)))
    throw new TypeError('Choose valid fields and an in-bounds native pixel for '+type);
  if (type === 'one-pixel-gap' && query.axis !== undefined && !['horizontal','vertical','either'].includes(query.axis))
    throw new TypeError('Gap axis must be horizontal, vertical, or either');
  if (type === 'protected-detail' && query.kind !== undefined && !Protection.kinds.includes(query.kind))
    throw new TypeError('Choose a protected detail kind: pixel, gap, contour, or accent');
  if (type === 'occluding-contributor' && (!named(query.binding) ||
      scope !== undefined && !['full','partial','either'].includes(scope)))
    throw new TypeError('Occluding contributors need a scene binding and optional scope full, partial, or either');
}

function swatches(query,active) {
  const { swatches,ramp,steps,range } = query;
  if ([swatches,ramp,range].filter(value=>value !== undefined).length !== 1 ||
      steps !== undefined && (ramp === undefined || !Number.isSafeInteger(steps) || steps < 1))
    throw new TypeError('Choose shadow swatches, a ramp with optional steps, or an inkShadow range');
  if (range !== undefined) {
    if (!Array.isArray(range) || range.length !== 2 ||
        !Array.from(range).every(value=>Number.isFinite(value) && value >= 0 && value <= 1) || range[0] > range[1])
      throw new RangeError('Shadow range must be an inclusive [min, max] between 0 and 1');
    return null;
  }
  if (ramp !== undefined) {
    const row = named(ramp) && active.ramps?.find(row=>row.id === ramp);
    if (!row || steps > row.swatches.length) throw new RangeError('Choose an existing shadow ramp and valid step count');
    return new Set(row.swatches.slice(0,steps ?? 1));
  }
  if (!Array.isArray(swatches) || !swatches.length || new Set(swatches).size !== swatches.length ||
      !Array.from(swatches).every(id=>active.swatches.includes(id)))
    throw new TypeError('Shadow swatches must be distinct palette IDs');
  return new Set(swatches);
}

function requirePass(frame,w,h,name) {
  const value = frame?.passes?.[name];
  if (frame?.w !== w || frame.h !== h || frame.passes?.w !== w || frame.passes.h !== h ||
      !ArrayBuffer.isView(value) || value.length !== w*h)
    throw new RangeError('Intent needs the '+name+' art pass on the requested native grid');
  return value;
}

function viewReference(frame) {
  return {
    scene:frame.sourceView?.source ?? frame.scene ?? frame.pixelSelection?.scene ?? null,
    time:frame.time ?? null,camera:frame.sourceView?.camera ?? frame.pixelSelection?.view ?? null
  };
}

function canonical(query) {
  if (Array.isArray(query)) return query.map(canonical);
  if (query && typeof query === 'object')
    return Object.fromEntries(Object.keys(query).sort().map(key=>[key,canonical(query[key])]));
  return query;
}

function selectionIntents(active,{ pigment,scope,findBinding,sceneMatches,capture,bindingCapture }) {
  const { width:w,height:h } = active, size = w*h, grid = [w,h];
  const point = p => [p%w,Math.floor(p/w)];
  const index = ([x,y]) => y*w+x;
  const pixel = p => ({ at:point(p),swatch:pigment(p) });
  const observations = [], sources = [], captures = new Map();
  let rendered;

  function captureRender() {
    if (!capture) throw new TypeError('Render intents need --scene, --source-view, or an SDK renderFrame');
    return rendered ??= capture({ w,h,passes:['inkShadow',...partChannels],sceneInspection:true });
  }

  function observe(frame,channels,fields = {},extra) {
    const view = viewReference(frame);
    sources.push({ kind:'intent-render',...fields,grid:[frame.w,frame.h],view,passes:channels,
      revision:digest([view,fields,ArtPasses.subset(frame.passes,channels),extra]) });
  }

  function shadows(query,add) {
    const authored = swatches(query,active), { range,connectivity = 4,at } = query;
    if (![4,8].includes(connectivity)) throw new RangeError('Shadow connectivity must be 4 or 8');
    const eligible = new Uint8Array(size), seed = at && index(at);
    const signal = authored ? null : requirePass(captureRender(),w,h,'inkShadow');
    if (signal) {
      const coverage = requirePass(rendered,w,h,'coverage');
      observe(rendered,['coverage','inkShadow']);
      for (let p = 0; p < size; p++)
        eligible[p] = Number(coverage[p] > minimumCoverage && signal[p] >= range[0] && signal[p] <= range[1]);
    } else for (let p = 0; p < size; p++) eligible[p] = Number(authored.has(pigment(p)));
    const queue = new Uint32Array(size), visited = new Uint8Array(size);
    const grid = { width:w,height:h,steps:connectivity === 8 ? eight : four,queue };
    const evidence = p=>signal ? { shadow:signal[p] } : { swatch:pigment(p) };
    for (let origin = 0; origin < size; origin++) {
      if (!eligible[origin] || visited[origin]) continue;
      const { area } = visit(origin,visited,1,p=>eligible[p],grid);
      const cluster = queue.subarray(0,area);
      if (at && !cluster.includes(seed)) continue;
      const identity = { origin:point(origin),connectivity,source:authored ? 'palette' : 'inkShadow' };
      for (const p of cluster) add(origin,identity,p,evidence);
      if (at) break;
    }
  }

  function gaps(query,add) {
    const { axis = 'either',at } = query, seed = at && index(at);
    for (let p = seed ?? 0; p < (at ? seed+1 : size); p++) {
      if (pigment(p) !== null) continue;
      const x = p%w, y = Math.floor(p/w);
      const horizontal = axis !== 'vertical' && x > 0 && x+1 < w && pigment(p-1) !== null && pigment(p+1) !== null;
      const vertical = axis !== 'horizontal' && y > 0 && y+1 < h && pigment(p-w) !== null && pigment(p+w) !== null;
      if (!horizontal && !vertical) continue;
      const axes = [...(horizontal ? ['horizontal'] : []),...(vertical ? ['vertical'] : [])];
      add(p,{ at:point(p),axes,protected:!!active.locks[p] },p,()=>({
        ...(horizontal && { horizontal:[pixel(p-1),pixel(p+1)] }),
        ...(vertical && { vertical:[pixel(p-w),pixel(p+w)] })
      }));
    }
  }

  function protectedDetails(query,add) {
    for (const row of active.protectedDetails ?? []) {
      const { pixels,kind = 'pixel',...identity } = row;
      if ((query.id !== undefined && query.id !== row.id) ||
          (query.kind !== undefined && query.kind !== kind) ||
          (query.at && !pixels.some(([x,y])=>x === query.at[0] && y === query.at[1]))) continue;
      const evidence = p=>({ swatch:pigment(p) });
      for (const xy of pixels) add(row.id,{ ...identity,kind },index(xy),evidence);
    }
  }

  function visibleParts(query,add) {
    const frame = captureRender();
    const ids = requirePass(frame,w,h,'partId'), coverage = requirePass(frame,w,h,'coverage');
    const owners = requirePass(frame,w,h,'objectId'), { parts,objects } = frame.passes;
    if (!Array.isArray(parts) || !Array.isArray(objects)) throw new RangeError('Intent needs the part and object owner tables');
    observe(frame,partChannels);
    const identities = new Map(), keys = new Map();
    function owner(p) {
      const row = parts[ids[p]], object = objects[owners[p]] ?? row?.object ?? null;
      if (!ids[p] || !(coverage[p] > minimumCoverage) || !named(row?.part)) return null;
      const key = ids[p]*objects.length+owners[p];
      if (!keys.has(key)) {
        const identity = { part:row.part,object,entity:row.entity ?? null };
        const address = JSON.stringify(identity);
        keys.set(key,address);
        identities.set(address,identity);
      }
      return keys.get(key);
    }
    const seed = query.at && owner(index(query.at));
    if (query.at && seed === null) return;
    const evidence = p=>({ coverage:coverage[p] });
    for (let p = 0; p < size; p++) {
      const key = owner(p);
      if (key === null || (query.at && key !== seed)) continue;
      const identity = identities.get(key);
      if ((query.id !== undefined && query.id !== identity.part) ||
          (query.object !== undefined && query.object !== identity.object) ||
          (query.entity !== undefined && query.entity !== identity.entity)) continue;
      add(key,identity,p,evidence);
    }
  }

  function occluders(query,add,report) {
    const binding = findBinding(query.binding), [sw,sh] = binding.canvas?.size ?? grid;
    if (!captures.has(binding.id)) {
      const frame = bindingCapture(sw,sh,binding), paired = frame?.bindingEvidence;
      if (!frame) throw new TypeError('Occluding contributors need a rendered scene view');
      if (!sceneMatches(binding,frame)) throw new RangeError('The capture must match the scene of binding '+binding.id);
      if (!paired || paired.object !== binding.object || paired.part !== binding.part ||
          [paired.projected,paired.visible,paired.depth].some(plane=>!(plane instanceof Float32Array) || plane.length !== sw*sh))
        throw new RangeError('Occlusion needs matched visible and isolated coverage and depth for binding '+binding.id);
      if ([paired.projected,paired.visible].some(plane=>plane.some(value=>!(value >= 0 && value <= 1))))
        throw new RangeError('Binding coverage must be finite and between 0 and 1');
      requirePass(frame,sw,sh,'depth');
      requirePass(frame,sw,sh,'surfaceKind');
      if (!ArrayBuffer.isView(frame.passes.position) || frame.passes.position.length !== sw*sh*3)
        throw new RangeError('Occlusion needs opaque surface positions on the binding grid');
      observe(frame,sceneChannels,{ binding:binding.id,object:binding.object,part:binding.part ?? null },
        [paired,frame.pixelFragments]);
      captures.set(binding.id,frame);
    }
    const frame = captures.get(binding.id), paired = frame.bindingEvidence, { at,scope = 'either' } = query;
    const seed = at && index(at);
    report.unresolvedPixels = 0;
    report.truncatedPixels = 0;
    function obstruction(p) {
      const hit = CanvasTransforms.sourcePoint(grid,point(p),binding.canvas)?.map(Math.floor);
      if (!hit) return null;
      const q = hit[1]*sw+hit[0], projectedCoverage = paired.projected[q], visibleCoverage = paired.visible[q];
      if (!(projectedCoverage > visibleCoverage+minimumCoverage)) return null;
      const partial = visibleCoverage > minimumCoverage;
      if ((scope === 'partial' && !partial) || (scope === 'full' && partial)) return null;
      const targetDepth = paired.depth[q];
      if (!Number.isFinite(targetDepth)) return { hits:[],truncated:false };
      const surface = ArtPasses.pick(frame.passes,...hit);
      const contributions = Sources.sample(frame,hit,ArtPasses,surface);
      const blocker = Sources.issues(frame,hit,ArtPasses,{ binding,surface,sources:contributions })
        .find(row=>row.code === 'foreground-blocker')?.blocker;
      const opaque = blocker && blocker.kind !== 'splat' ? [{
        ...blocker,entity:frame.passes.parts?.[frame.passes.partId?.[q]]?.entity ?? null,role:'opaque-blocker'
      }] : [];
      const front = (contributions?.splats ?? []).filter(row=>row.depth < targetDepth-1e-5 &&
        row.visibleCoverage > minimumCoverage &&
        !((row.object === binding.object || row.entity === binding.object) &&
          (binding.part === undefined || row.part === binding.part)));
      const hits = [...opaque,...front.map(row=>({ ...row,role:'foreground-splat' }))].map(row=>{
        const { role,kind,object = null,part = null,entity = null,id = null,slot,depth } = row;
        const identity = { role,kind,object,part,entity,
          ...(kind === 'splat' && { id,...(!id && { slot:slot ?? null }) }) };
        return { id:JSON.stringify(identity),identity,evidence:{
          sourceAt:hit,depth,targetDepth,visibleCoverage,projectedCoverage,partial,
          ...(kind === 'splat' && { contribution:row.visibleCoverage,alpha:row.alpha })
        } };
      });
      return { hits,truncated:!!contributions?.truncated };
    }

    for (let p = seed ?? 0; p < (at ? seed+1 : size); p++) {
      const observed = obstruction(p);
      if (!observed) continue;
      report.unresolvedPixels += Number(observed.hits.length === 0);
      report.truncatedPixels += Number(observed.truncated);
      for (const { id,identity } of observed.hits) {
        if ((query.object !== undefined && query.object !== identity.object) ||
            (query.part !== undefined && query.part !== identity.part)) continue;
        add(id,identity,p,q=>obstruction(q).hits.find(row=>row.id === id).evidence);
      }
    }
  }

  const resolve = {
    'shadow-cluster':shadows,'one-pixel-gap':gaps,'protected-detail':protectedDetails,
    'visible-part':visibleParts,'occluding-contributor':occluders
  };

  function match(query) {
    if (!types.has(query?.type)) return null;
    validation(w,h,query);
    const mask = new Uint8Array(size), groups = new Map(), report = { type:query.type,groups,mask };
    function add(key,identity,p,sample) {
      mask[p] = 1;
      if (!groups.has(key)) groups.set(key,{ identity,indices:[],sample });
      groups.get(key).indices.push(p);
    }
    resolve[query.type](query,add,report);
    observations.push(report);
    return mask;
  }

  function report(query,mask,allSources,expected,required) {
    if (!observations.length) {
      if (expected !== undefined) throw new TypeError('A target revision needs an intent query');
      return {};
    }
    if (expected !== undefined && !isRevision(expected)) throw new TypeError('Use the observed SHA-256 target revision');
    const targetRevision = digest(['ink-studio/pixel-intent-v1',active.revision,active.id,scope,canonical(query),mask,allSources]);
    if (required && expected === undefined)
      throw conflict('unverified-target','Query the intent and supply its target revision before saving the selection',{ actual:targetRevision });
    if (expected !== undefined && expected !== targetRevision)
      throw conflict('stale-target','The current intent target differs from the inspected target',{ expected,actual:targetRevision });
    const intents = observations.map(row=>{
      const targets = [];
      let targetCount = 0, matchedPixels = 0;
      for (let p = 0; p < size; p++) if (mask[p] && row.mask[p]) matchedPixels++;
      for (const { identity,indices,sample } of row.groups.values()) {
        const kept = indices.filter(p=>mask[p]).sort((a,b)=>a-b);
        if (!kept.length) continue;
        targetCount++;
        if (targets.length < reportLimit) {
          const nativeRuns = runs(w,kept);
          targets.push({ ...identity,pixelCount:kept.length,runs:nativeRuns.slice(0,reportLimit),
            runCount:nativeRuns.length,sample:{ at:point(kept[0]),...sample(kept[0]) } });
        }
      }
      return { type:row.type,matchedPixels,targetCount,targets,omittedTargets:targetCount-targets.length,
        ...(row.unresolvedPixels !== undefined && {
          unresolvedPixels:row.unresolvedPixels,truncatedPixels:row.truncatedPixels
        }) };
    });
    return { targetRevision,intents,...(expected !== undefined && { verified:true }) };
  }

  return { match,report,sources };
}

module.exports = { selectionIntents };
