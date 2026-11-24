'use strict';

const { isDeepStrictEqual:equal } = require('node:util');
const LayerStack = require('../src/pixel-layer-stack.js');
const { conflict } = require('./pixel-edit-preview.js');

const origin = [0,0];
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const id = value => typeof value === 'string' && idPattern.test(value);
const celName = value => typeof value === 'string' && value.split('/').length <= 2 && value.split('/').every(id);
const celId = (frame,layer,cel) => cel.id ?? frame.id+'/'+layer;
const getCel = (frame,layer) => Object.hasOwn(frame.cels,layer) ? frame.cels[layer] : undefined;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value,keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
const duration = value => Number.isSafeInteger(value) && value > 0;
const label = value => value === undefined || typeof value === 'string' && !!value.trim();

function index(frames) {
  const cels = new Map(), sources = new Map();
  for (const frame of frames) for (const [layer,cel] of Object.entries(frame.cels)) {
    const key = celId(frame,layer,cel);
    if (cels.has(key)) throw new RangeError('Duplicate pixel cel ID '+key);
    cels.set(key,cel);
  }
  for (const key of cels.keys()) {
    const path = new Set();
    let source = key;
    while (!sources.has(source)) {
      const cel = cels.get(source);
      if (!cel) throw conflict('missing-cel-source','Unknown hold source cel '+source,{ cel:key,source });
      if (path.has(source)) throw conflict('cyclic-cel-hold','Pixel cel holds contain a cycle at '+source,{ cel:key,source });
      path.add(source);
      if (cel.hold === undefined) break;
      source = cel.hold;
    }
    const root = sources.get(source) ?? source;
    for (const step of path) sources.set(step,root);
  }
  return { cels,sources };
}

function availableId(frame,layer,lookup) {
  const base = frame+'/'+layer;
  if (!lookup.cels.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = '-'+i, next = frame+'/'+layer.slice(0,64-suffix.length)+suffix;
    if (!lookup.cels.has(next)) return next;
  }
}

function offset(layer,cel) {
  const [x,y] = layer.offset ?? origin, [dx,dy] = cel?.offset ?? origin;
  return [x+dx,y+dy];
}

function content(cel,lookup) {
  return cel?.hold === undefined ? cel : lookup.cels.get(lookup.sources.get(cel.hold));
}

function independent(cel,lookup) {
  if (cel?.hold === undefined) return cel;
  const { hold,...placement } = cel, source = content(cel,lookup);
  return { ...placement,marks:source.marks,...(source.slots !== undefined && { slots:source.slots }) };
}

function timing(frames) {
  let elapsed = 0;
  return frames.map(frame=>{
    const startMs = elapsed;
    elapsed += frame.durationMs;
    if (!Number.isSafeInteger(elapsed)) throw new RangeError('Pixel timeline duration exceeds the safe millisecond range');
    return { id:frame.id,label:frame.label ?? frame.id,startMs,durationMs:frame.durationMs,endMs:elapsed };
  });
}

function describe(design,revision,lookup = index(design.frames)) {
  const frames = timing(design.frames);
  const stack = LayerStack.prepare(design.layers);
  const layers = [...stack.rows.values()].filter(layer=>layer.kind !== 'group').map(layer=>({
    id:layer.id,label:layer.label ?? layer.id,kind:layer.kind,locked:layer.effectiveLock || layer.kind === 'reference',
    ...(layer.parent !== undefined && { parent:layer.parent }),offset:layer.offset ?? origin,
    cells:design.frames.map(frame=>{
      const cel = getCel(frame,layer.id);
      if (!cel) return { frame:frame.id,state:'empty',cel:null };
      const id = celId(frame,layer.id,cel);
      return { frame:frame.id,state:cel.hold !== undefined ? 'hold' : cel.slots || cel.marks.length ? 'cel' : 'blank',
        cel:id,...(cel.label !== undefined && { label:cel.label }),offset:cel.offset ?? origin,effectiveOffset:offset(layer,cel),
        ...(cel.hold !== undefined && { hold:cel.hold,source:lookup.sources.get(id) }) };
    })
  }));
  return structuredClone({ format:'ink-studio/pixel-cel-timeline',version:1,revision,frames,layers,totalDurationMs:frames.at(-1).endMs });
}

const operations = {
  'add-frame':['frame','durationMs','label','before'],
  duration:['frame','durationMs'],
  'layer-offset':['layer','offset'],
  'cel-offset':['frame','layer','offset'],
  blank:['frame','layer'],
  duplicate:['from','to','replace'],
  hold:['from','to','replace'],
  move:['from','to','replace'],
  copy:['from','to','replace']
};

function edit(design,op) {
  if (!record(op) || !Object.hasOwn(operations,op.type) || !fields(op,['type',...operations[op.type]]) ||
      op.replace !== undefined && typeof op.replace !== 'boolean')
    throw new TypeError('Choose add-frame, duration, layer-offset, cel-offset, blank, duplicate, hold, move, or copy');
  const { type } = op, stack = LayerStack.prepare(design.layers), lookup = index(design.frames);
  const frameById = new Map(design.frames.map((frame,i)=>[frame.id,{ frame,i }]));
  function requireFrame(id) {
    const slot = frameById.get(id);
    if (!slot) throw new RangeError('Unknown pixel frame '+id);
    return slot;
  }
  function slot(address) {
    if (!fields(address,['frame','layer'])) throw new TypeError('A timeline address needs frame and layer IDs');
    const layer = stack.rows.get(address.layer);
    if (!layer || layer.kind === 'group') throw new RangeError('Unknown cel layer '+address.layer);
    const { frame,i } = requireFrame(address.frame);
    const cel = getCel(frame,layer.id);
    return { frame,i,layer,cel,id:cel && celId(frame,layer.id,cel) };
  }
  function writable(layer) {
    if (!layer || layer.kind === 'group') throw new RangeError('Choose a layer that can contain cels');
    if (layer.effectiveLock || layer.kind === 'reference')
      throw conflict('locked-layer','Layer '+layer.id+' does not accept timeline edits',{ layer:layer.id });
  }
  const frames = design.frames.slice();
  let layers = design.layers;
  function setCel(location,cel) {
    const frame = frames[location.i], cels = { ...frame.cels };
    if (cel) cels[location.layer.id] = cel;
    else delete cels[location.layer.id];
    frames[location.i] = { ...frame,cels };
  }
  function placement(value) {
    if (!LayerStack.validOffset(value)) throw new TypeError('Timeline offsets need a bounded integer [x,y] pair');
    return value.slice();
  }
  let report;
  if (type === 'add-frame') {
    if (!id(op.frame) || !duration(op.durationMs) || !label(op.label) || frameById.has(op.frame))
      throw new RangeError('Add frame needs an unused ID and positive integer duration in milliseconds');
    const i = op.before === undefined ? frames.length : requireFrame(op.before).i;
    frames.splice(i,0,{ id:op.frame,...(op.label !== undefined && { label:op.label }),durationMs:op.durationMs,cels:{} });
    report = { frame:op.frame,after:timing(frames)[i] };
  } else if (type === 'duration') {
    const { frame,i } = requireFrame(op.frame);
    if (!duration(op.durationMs)) throw new RangeError('Frame duration must be a positive integer in milliseconds');
    frames[i] = { ...frame,durationMs:op.durationMs };
    report = { frame:op.frame,before:frame.durationMs,after:op.durationMs };
  } else if (type === 'layer-offset') {
    const layer = stack.rows.get(op.layer);
    writable(layer);
    const next = placement(op.offset);
    layers = layers.map(row=>row.id === op.layer ? { ...row,offset:next } : row);
    report = { layer:op.layer,before:layer.offset ?? origin,after:next };
  } else if (type === 'blank' || type === 'cel-offset') {
    const target = slot({ frame:op.frame,layer:op.layer });
    writable(target.layer);
    const { cel } = target, key = target.id ?? availableId(op.frame,op.layer,lookup);
    if (type === 'blank') {
      setCel(target,{ id:key,...(cel?.label !== undefined && { label:cel.label }),...(cel?.offset && { offset:cel.offset }),marks:[] });
      report = { frame:op.frame,layer:op.layer,cel:key };
    } else {
      if (!cel) throw conflict('missing-cel','Cel offset needs an existing cel',{ frame:op.frame,layer:op.layer });
      const next = placement(op.offset);
      setCel(target,{ ...cel,offset:next });
      report = { frame:op.frame,layer:op.layer,cel:key,before:cel.offset ?? origin,after:next };
    }
  } else {
    const from = slot(op.from);
    const nextFrame = frames[from.i+1]?.id;
    const address = type === 'duplicate' && op.to === undefined
      ? { frame:nextFrame,layer:from.layer.id } : op.to;
    if (!from.cel) throw conflict('missing-cel','Source timeline cell is empty',op.from);
    if (!address?.frame && type === 'duplicate') throw new RangeError('Duplicate needs the next frame or an explicit destination');
    const to = slot(address);
    writable(to.layer);
    if (type === 'move') writable(from.layer);
    if (equal(op.from,address)) throw new RangeError('Choose a different destination cell');
    if (to.cel && !op.replace) throw conflict('occupied-cel','Destination timeline cell is occupied',address);
    const key = type === 'move' ? from.id : availableId(address.frame,address.layer,lookup);
    let cel;
    if (type === 'hold') {
      const source = lookup.sources.get(from.id);
      const { label,offset } = from.cel;
      cel = { id:key,hold:source,...(label !== undefined && { label }),...(offset !== undefined && { offset }) };
    } else {
      cel = { ...(type === 'move' ? from.cel : independent(from.cel,lookup)),id:key };
    }
    if (type === 'move') setCel(from,undefined);
    setCel(to,cel);
    report = { from:{ ...op.from,cel:from.id },to:{ ...address,cel:key },...(to.cel && { replaced:to.id }),
      ...(cel.hold !== undefined && { hold:cel.hold }) };
  }
  return { design:{ ...design,layers,frames },report:{ destination:'timeline',kind:'timeline',tool:type,...report } };
}

function translate(width,height,source,[dx,dy]) {
  if (!dx && !dy) return source;
  const slots = new Int16Array(width*height).fill(-1), alpha = source.alpha && new Uint8Array(width*height).fill(255);
  const x = Math.max(0,-dx), end = Math.min(width,width-dx);
  if (x < end) for (let y = Math.max(0,-dy); y < Math.min(height,height-dy); y++) {
    const start = y*width+x, target = (y+dy)*width+x+dx;
    slots.set(source.slots.subarray(start,start+end-x),target);
    alpha?.set(source.alpha.subarray(start,start+end-x),target);
  }
  return { slots,...(alpha && { alpha }) };
}

function localMarks(width,height,marks,[dx,dy],layer) {
  if (!dx && !dy) return marks;
  function local(x,y,length = 1) {
    if (x-dx < 0 || x-dx+length > width || y-dy < 0 || y-dy >= height)
      throw conflict('outside-cel','Edit lies outside the shifted cel grid',{ at:[x,y],layer });
    return [x-dx,y-dy];
  }
  return marks.map(mark=>mark.at ? { ...mark,at:local(...mark.at) } : { ...mark,
    runs:mark.runs.map(([y,x,length])=>{
      const [u,v] = local(x,y,length);
      return [v,u,length];
    }) });
}

module.exports = { celName,celId,getCel,index,availableId,timing,offset,content,independent,describe,edit,translate,localMarks };
