'use strict';

const ArtPasses = require('../src/art-passes.js');
const CanvasTransforms = require('../src/pixel-canvas-transforms.js');
const { digest } = require('./pixel-edit-revisions.js');

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

function sourceFor(width,height,query,{ capture,material }) {
  const cells = width*height, sources = [], channels = new Map();
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

  function match(query) {
    const { type,channel,destination,range,component } = query;
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
        return inRange(source.type === 'number' ? value : value?.coverage ?? 0,range);
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
