'use strict';

const { isDeepStrictEqual:equal } = require('node:util');
const LayerStack = require('../src/pixel-layer-stack.js');
const Playback = require('../src/pixel-playback-ranges.js');
const Tilemap = require('../src/pixel-tilemap.js');
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
  const cels = new Map(), sources = new Map(), locations = new Map();
  for (const frame of frames) for (const [layer,cel] of Object.entries(frame.cels)) {
    const key = celId(frame,layer,cel);
    if (cels.has(key)) throw new RangeError('Duplicate pixel cel ID '+key);
    cels.set(key,cel);
    locations.set(key,{ cel:key,frame:frame.id,layer });
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
  return { cels,sources,locations };
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

function groups(lookup) {
  const roots = new Map();
  for (const key of lookup.cels.keys()) {
    const source = lookup.sources.get(key);
    if (key === source) continue;
    if (!roots.has(source)) roots.set(source,{ source:lookup.locations.get(source),holds:[] });
    roots.get(source).holds.push(lookup.locations.get(key));
  }
  return [...roots.values()];
}

function hasHolds(design) {
  return design?.version === 2 && design.frames.some(frame=>Object.values(frame.cels).some(cel=>cel.hold !== undefined));
}

function preserveBatchLinks(lookup,replacements) {
  const roots = new Set([...replacements.keys()].map(key=>lookup.sources.get(key))), changes = [];
  if (!roots.size) return changes;
  for (const { source,holds } of groups(lookup)) {
    if (!roots.has(source.cel)) continue;
    const members = [source.cel,...holds.map(row=>row.cel)];
    const drawingKey = cel=>JSON.stringify([cel.slots ?? null,cel.marks]);
    const originalDrawing = drawingKey(lookup.cels.get(source.cel));
    const keepers = new Map(), partition = new Map();
    for (const key of members) {
      const replacement = replacements.get(key);
      const drawing = replacement ? drawingKey(replacement) : originalDrawing;
      if (!keepers.has(drawing)) keepers.set(drawing,key);
      partition.set(key,keepers.get(drawing));
    }
    for (const key of members) {
      const original = lookup.cels.get(key), keeper = partition.get(key);
      const hold = keeper === key ? undefined : partition.get(original.hold) === keeper ? original.hold : keeper;
      if (hold !== original.hold) {
        changes.push({ ...lookup.locations.get(key),before:original.hold ?? null,after:hold ?? null });
        if (hold === undefined) {
          const materialized = replacements.get(key) ?? independent(original,lookup);
          replacements.set(key,structuredClone(materialized));
        } else {
          const { marks,slots,hold:prior,...placement } = original;
          replacements.set(key,{ ...placement,hold });
        }
      } else if (hold !== undefined) {
        // The source carries this edit for the whole partition.
        replacements.delete(key);
      }
    }
  }
  return changes;
}

function linkChanges(before,after) {
  if (before === after || before.version !== 2 || after.version !== 2 || !hasHolds(before) && !hasHolds(after)) return;
  const prior = index(before.frames), next = index(after.frames);
  const sharedDrawings = groups(next).filter(({ source })=>{
    const old = content(prior.cels.get(source.cel),prior), drawn = next.cels.get(source.cel);
    return old && (!equal(old.marks,drawn.marks) || !equal(old.slots,drawn.slots));
  });
  const unlinked = [];
  for (const key of prior.cels.keys()) {
    const source = prior.sources.get(key), cel = next.cels.get(key);
    if (key !== source && cel && cel.hold === undefined)
      unlinked.push({ instance:next.locations.get(key),source:prior.locations.get(source) });
  }
  if (sharedDrawings.length || unlinked.length) return { sharedDrawings,unlinked };
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

function validateTags(design,timed) {
  for (const { id,first,last,direction,loop } of Playback.resolve(design.frames,design.tags)) {
    if (direction !== 'ping-pong' || first === last) continue;
    const forward = timed[last].endMs-timed[first].startMs;
    const returnStart = loop ? timed[first].endMs : timed[first].startMs;
    if (!Number.isSafeInteger(forward+(timed[last].startMs-returnStart)))
      throw new RangeError('Playback tag '+id+' exceeds the safe millisecond range');
  }
}

function tagsFor(design) {
  const tags = Playback.resolve(design.frames,design.tags);
  if (!tags.length) return [];
  const durations = design.frames.map(frame=>frame.durationMs);
  return tags.map(tag=>{
    const { order,duration } = Playback.plan(durations,tag);
    return { ...tag,durationMs:duration,order:order.map(index=>design.frames[index].id) };
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
  return structuredClone({ format:'ink-studio/pixel-cel-timeline',version:1,revision,frames,layers,tags:tagsFor(design),
    ...(design.directional && { directional:design.directional }),linkGroups:groups(lookup),totalDurationMs:frames.at(-1).endMs });
}

const operations = {
  'add-frame':['frame','durationMs','label','before'],
  duration:['frame','durationMs'],
  'set-tag':['tag'],
  'set-directional':['directional'],
  'set-tilemap':['tilemap'],
  'place-tiles':['points','tile'],
  'remove-tag':['tag'],
  'layer-offset':['layer','offset'],
  'cel-offset':['frame','layer','offset'],
  blank:['frame','layer'],
  duplicate:['from','to','replace'],
  hold:['from','to','replace'],
  unlink:['frame','layer'],
  move:['from','to','replace'],
  copy:['from','to','replace']
};

function edit(design,op) {
  if (!record(op) || !Object.hasOwn(operations,op.type) || !fields(op,['type',...operations[op.type]]) ||
      op.replace !== undefined && typeof op.replace !== 'boolean')
    throw new TypeError('Choose add-frame, duration, set-tag, remove-tag, set-directional, set-tilemap, place-tiles, layer-offset, cel-offset, blank, duplicate, hold, unlink, move, copy, edit-cels, or write-cels');
  if (op.type === 'set-tilemap') {
    const { tilemap,...rest } = design;
    if (op.tilemap === undefined) throw new TypeError('Set a tilemap or pass null to remove it');
    return { design:op.tilemap === null ? rest : { ...design,tilemap:op.tilemap },
      report:{ destination:'timeline',kind:'tilemap',tool:op.type,before:tilemap ?? null,after:op.tilemap } };
  }
  if (op.type === 'place-tiles') {
    const { tilemap,changes } = Tilemap.place(design.tilemap,new Set(design.frames.map(frame=>frame.id)),
      design.width,design.height,op.points,op.tile);
    return { design:tilemap === design.tilemap ? design : { ...design,tilemap },
      report:{ destination:'timeline',kind:'tilemap',tool:op.type,cellCount:changes.length,changes } };
  }
  if (op.type === 'set-directional') {
    const { directional,...rest } = design;
    if (op.directional === undefined) throw new TypeError('Set a directional view set or pass null to remove it');
    return { design:op.directional === null ? rest : { ...design,directional:op.directional },
      report:{ destination:'timeline',kind:'timeline',tool:op.type,before:directional ?? null,after:op.directional } };
  }
  if (op.type === 'set-tag' || op.type === 'remove-tag') {
    const tags = new Map((design.tags ?? []).map(tag=>[tag.id,tag]));
    const key = op.type === 'set-tag' ? op.tag?.id : op.tag, before = tags.get(key);
    if (op.type === 'set-tag') tags.set(key,op.tag);
    else if (!tags.delete(key)) throw conflict('missing-tag','Unknown playback tag '+key,{ tag:key });
    const revised = { ...design,tags:[...tags.values()] };
    const after = tagsFor(revised).find(tag=>tag.id === key);
    return { design:revised,report:{ destination:'timeline',kind:'timeline',tool:op.type,tag:key,
      before:before ?? null,after:after ?? null } };
  }
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
  } else if (type === 'unlink') {
    const target = slot({ frame:op.frame,layer:op.layer });
    writable(target.layer);
    if (target.cel?.hold === undefined)
      throw conflict('unlinked-cel','Choose a cel with a hold to unlink',{ frame:op.frame,layer:op.layer });
    setCel(target,structuredClone(independent(target.cel,lookup)));
    const retargeted = [];
    for (const [key,cel] of lookup.cels) {
      if (cel.hold !== target.id) continue;
      const location = lookup.locations.get(key), { frame,layer } = location;
      setCel(slot({ frame,layer }),{ ...cel,hold:target.cel.hold });
      retargeted.push(location);
    }
    report = { ...lookup.locations.get(target.id), source:lookup.locations.get(lookup.sources.get(target.id)),retargeted };
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

module.exports = { celName,celId,getCel,index,availableId,timing,offset,content,independent,describe,edit,translate,localMarks,linkChanges,validateTags,preserveBatchLinks };
