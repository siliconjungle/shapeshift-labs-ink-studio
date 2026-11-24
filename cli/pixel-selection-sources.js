'use strict';

const ArtPasses = require('../src/art-passes.js');
const CanvasTransforms = require('../src/pixel-canvas-transforms.js');
const { digest } = require('./pixel-edit-revisions.js');
const { minimumCoverage } = require('./pixel-selection-scope.js');

const identity = {
  object:['objectId','objects'], part:['partId','parts'], material:['materialId','materials']
};

function needed(query) {
  const requested = new Set(), stack = [query];
  for (let i = 0; stack.length && i < 32; i++) {
    const row = stack.pop();
    const type = row?.type;
    if (Object.hasOwn(identity,type)) {
      requested.add(identity[type][0]);
      if (type === 'part' && row.object !== undefined) requested.add('objectId');
    } else if (type === 'depth') requested.add('depth');
    else if (type === 'channel' && row.channel !== undefined) requested.add(row.channel);
    else if (['combine','subtract','intersect'].includes(type)) stack.push(row.with,row.base);
    else if (['invert','grow','shrink','outline','cluster'].includes(type) && row.source !== undefined)
      stack.push(row.source);
  }
  for (const pass of requested)
    if (!ArtPasses.channels.includes(pass)) throw new RangeError('Unknown render channel ' + pass);
  return [...requested].sort();
}

const inRange = (value,[min,max]) => Number.isFinite(value) && value >= min && value <= max;

function sourceFor(width,height,query,{ capture,material,binding:findBinding,sceneMatches }) {
  const cells = width*height, sources = [], channels = new Map(), captures = new Map(), bindings = new Map();
  let passes;

  function capturePasses() {
    if (passes) return passes;
    if (!capture) throw new TypeError('Render selections need --scene or an SDK renderFrame with art passes');
    const required = needed(query);
    const frame = capture({ w:width,h:height,passes:required });
    if (frame?.w !== width || frame?.h !== height || frame.passes?.w !== width || frame.passes?.h !== height)
      throw new RangeError('Render selection passes must match the document native grid');
    const subset = ArtPasses.subset(frame.passes,required);
    for (const name of required) {
      const value = subset[name], valid = subset[name+'Valid'];
      if (!ArrayBuffer.isView(value) || !value.length || value.length%cells)
        throw new RangeError('Render selection needs the ' + name + ' art pass');
      if (valid && (!ArrayBuffer.isView(valid) || valid.length !== cells))
        throw new RangeError('The ' + name + ' validity pass must match the native grid');
    }
    sources.push({ kind:'render',passes:required,revision:digest(subset) });
    return passes = subset;
  }

  function numeric(passes,name,component) {
    const data = passes[name], stride = data.length/cells;
    if ((stride !== 1 && component === undefined) || (component ?? 0) >= stride)
      throw new RangeError('Choose a component for ' + name + ' with ' + stride + ' value(s) per pixel');
    const valid = passes[name+'Valid'];
    return p => valid && !valid[p] ? NaN : data[p*stride+(component ?? 0)];
  }

  function matchIdentity(passes,query) {
    const { type,id,at,object,entity } = query;
    const [key,table] = identity[type], indices = passes[key], labels = passes[table];
    if (!Array.isArray(labels) || indices.length !== cells)
      throw new RangeError('Render selection needs the ' + table + ' owner table');
    const seed = at && indices[at[1]*width+at[0]], scoped = object !== undefined || entity !== undefined;
    const label = index => type === 'part' ? labels[index]?.part : labels[index];
    const selected = id ?? label(seed);
    if (!selected) return () => false;
    const matches = new Set();
    if (at) matches.add(seed);
    else for (let index = 1; index < labels.length; index++)
      if (label(index) === selected) matches.add(index);
    return p => {
      const index = indices[p];
      if (!index || !matches.has(index)) return false;
      if (!scoped) return true;
      const row = labels[index];
      const owner = passes.objects?.[passes.objectId?.[p]] ?? row.object;
      return (object === undefined || object === owner) && (entity === undefined || entity === row.entity);
    };
  }

  function captureBinding(binding,isolated) {
    const { object,part,canvas } = binding, size = canvas?.size ?? [width,height], [w,h] = size;
    const key = JSON.stringify([binding.scene,w,h,object,part,isolated]);
    if (captures.has(key)) return captures.get(key);
    if (!capture) throw new TypeError('Binding selection needs --scene or an SDK scope capture');
    const frame = capture({ w,h,passes:[],pixelSelection:{ object,...(part !== undefined && {part}),isolated } });
    if (frame?.w !== w || frame?.h !== h) throw new RangeError('Selection capture must use the binding native grid');
    if (!sceneMatches(binding,frame)) throw new RangeError('Selection source is not the scene of binding '+binding.id);
    const result = frame.pixelSelection;
    if (!result) throw new RangeError('Render did not capture selection coverage with the requested scope');
    if (result.w !== w || result.h !== h || result.object !== object || result.part !== part ||
        result.isolated !== isolated || !(result.coverage instanceof Float32Array) || result.coverage.length !== w*h ||
        result.coverage.some(value=>!Number.isFinite(value) || value < 0 || value > 1))
      throw new RangeError('Selection coverage must match the requested binding and scope');
    captures.set(key,result);
    return result;
  }

  function bindingMatch(query) {
    const { id,scope = 'visible' } = query;
    const key = JSON.stringify([id,scope]);
    if (bindings.has(key)) return bindings.get(key);
    const binding = findBinding(id);
    if (scope === 'isolated-part' && binding.part === undefined)
      throw new RangeError('Isolated-part selection needs a named part on binding '+id);
    const selected = captureBinding(binding,scope !== 'visible');
    const visible = scope === 'through-layers' ? captureBinding(binding,false) : null;
    const map = new Uint8Array(cells);
    let occludedPixels = 0;
    for (let p=0; p<cells; p++) {
      const coordinate = CanvasTransforms.sourcePoint([width,height],[p%width,Math.floor(p/width)],binding.canvas);
      if (!coordinate) continue;
      const q = Math.floor(coordinate[1])*selected.w+Math.floor(coordinate[0]);
      const included = selected.coverage[q] > minimumCoverage;
      map[p] = Number(included);
      if (included && visible && visible.coverage[q] <= minimumCoverage) occludedPixels++;
    }
    sources.push({ kind:'scene-binding',binding:id,scope,object:binding.object,part:binding.part ?? null,
      grid:[selected.w,selected.h],...(visible && {occludedPixels}),
      revision:digest([binding,scope,selected,visible]) });
    const matches = p=>!!map[p];
    bindings.set(key,matches);
    return matches;
  }

  function match(query) {
    const { type,channel,destination,range,component } = query;
    if (type === 'binding') return bindingMatch(query);
    if (destination !== undefined) {
      if (!channels.has(destination)) {
        const source = material(destination);
        channels.set(destination,source);
        sources.push({ kind:'surface-channel',destination,revision:source.sourceRevision });
      }
      const source = channels.get(destination);
      return p => {
        const uv = CanvasTransforms.uv([width,height],[p%width,Math.floor(p/width)],source.canvas);
        if (!uv) return false;
        const value = source.sample(uv);
        const level = source.type === 'indexed' ? Number(!!value) : source.material ? value?.value :
          source.type === 'number' ? value : value?.coverage ?? 0;
        return inRange(level,range);
      };
    }
    const frame = capturePasses();
    if (Object.hasOwn(identity,type)) return matchIdentity(frame,query);
    const read = numeric(frame,type === 'depth' ? 'depth' : channel,component);
    return p=>inRange(read(p),range);
  }

  return { match,sources };
}

module.exports = { sourceFor };
