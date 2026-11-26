const fs = require('node:fs');
const path = require('node:path');
const { compile, fields, record, localName, range, vector, rad } = require('./character-rig-assembly.js');
const { solveMotion, openPose } = require('./character-rig-solve.js');
const { read } = require('./character-rig-bind.js');
const { graphOutputs } = require('./graph-outputs.js');
const files = require('./asset-files.js');

const format = 'ink-studio/character-motion';
const zero = [0, 0, 0], epsilon = 1e-9;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const rootChannel = 'root';

function channelSize(rig, name) {
  if (name === rootChannel) return 3;
  const count = rig.joints[rig.indices.get(name)]?.dofs.length;
  if (!count) throw new RangeError('Unknown or fixed motion control ' + name);
  return count;
}

function channels(rig, list) {
  if (!Array.isArray(list) || !list.length || list.length > rig.joints.length + 1 ||
      new Set(list).size !== list.length) throw new TypeError('Use a nonempty list of distinct motion controls');
  for (const channel of list) channelSize(rig, channel);
  return new Set(list);
}

function makeTrack(input, limit, size, K) {
  if (!Array.isArray(input) || !input.length || input.length > 1024)
    throw new RangeError('Use 1–1024 keys per motion curve');
  return K.anim.keyframeTrack.create({ v: size ? 'vector' : 'number' }, input.map(key => {
    if (!fields(key, ['time','value','ease']) || !range(key.time,0,limit) ||
        !(size ? vector(key.value,size) : range(key.value,0,1)))
      throw new RangeError('Invalid motion curve key or time');
    return { time:key.time, value:{ v:key.value }, ease:key.ease ?? 'linear' };
  }));
}

function validateDirection(value, K) {
  return fields(value,['local','at','weight','tolerance']) && vector(value.local) && vector(value.at) &&
    K.V.len(value.local)>=1e-7 && K.V.len(value.at)>=1e-7 && range(value.weight ?? 1,.001,1000) &&
    range(value.tolerance ?? 2,.01,180);
}

function contactRows(value, duration, rig, K) {
  if (!Array.isArray(value) || value.length>512) throw new RangeError('Use up to 512 contact windows per clip');
  const ids = new Set();
  for (const row of value) {
    if (!fields(row,['id','joint','start','end','at','offset','weight','tolerance','direction']) ||
        !localName(row.id) || ids.has(row.id) || !rig.indices.has(row.joint) ||
        !range(row.start,0,duration) || !range(row.end,row.start,duration) || !vector(row.at) ||
        !vector(row.offset ?? zero) || !range(row.weight ?? 1,.001,1000) ||
        !range(row.tolerance ?? .012,1e-5,10) ||
        row.direction!==undefined && !validateDirection(row.direction,K))
      throw new TypeError('Invalid or duplicate motion contact window');
    ids.add(row.id);
  }
  return value;
}

function compileCatalog(rig, input, K) {
  if (!fields(input,['format','version','id','rigHash','rootAllowance','clips']) || input.format!==format ||
      input.version!==1 || !localName(input.id) || input.rigHash!==rig.hash ||
      !vector(input.rootAllowance ?? zero,3,0,10000) || !record(input.clips) ||
      !range(Object.keys(input.clips).length,1,128))
    throw new TypeError('Use a version 1 motion catalog for the assembled rig revision');
  const clips = new Map(), {rootAllowance=zero} = input;
  let keyCount = 0;
  for (const [name, row] of Object.entries(input.clips)) {
    if (!localName(name) || !range(row?.duration,.000001,600)) throw new TypeError('Invalid motion clip name or duration');
    const {duration} = row;
    const clip = {name,duration,contacts:contactRows(row.contacts ?? [],duration,rig,K), tracks:new Map(), layers:[]};
    if (row.type==='curves' && fields(row,['type','duration','root','joints','contacts']) && record(row.joints ?? {})) {
      const tracks = [...Object.entries(row.joints ?? {})];
      if (Object.hasOwn(row.joints ?? {},rootChannel)) throw new TypeError('Put root keys on the root curve');
      if (row.root!==undefined) tracks.unshift([rootChannel,row.root]);
      for (const [channel,keys] of tracks) {
        const track = makeTrack(keys,duration,channelSize(rig,channel),K);
        keyCount += track.keys.length;
        clip.tracks.set(channel,track);
      }
    } else if (row.type==='mix' && fields(row,['type','duration','layers','contacts']) &&
        Array.isArray(row.layers) && range(row.layers.length,1,64)) {
      const ids = new Set();
      clip.layers = row.layers.map(layer => {
        if (!fields(layer,['id','clip','at','in','out','speed','mode','weight','mask','contacts']) ||
            !localName(layer.id) || ids.has(layer.id) || !localName(layer.clip) ||
            !Object.hasOwn(input.clips,layer.clip) || !range(layer.at,0,duration) ||
            !range(layer.speed ?? 1,.01,100) || !['override','add'].includes(layer.mode ?? 'override') ||
            layer.contacts!==undefined && typeof layer.contacts!=='boolean')
          throw new TypeError('Invalid or duplicate layer in ' + name);
        ids.add(layer.id);
        const childTime = input.clips[layer.clip]?.duration;
        const {in:from=0,out:to=childTime,speed=1,at,mode='override'} = layer;
        if (!range(from,0,childTime) || !range(to,from,childTime) || to-from<epsilon)
          throw new RangeError('Invalid layer trim in ' + name);
        const span = (to-from)/speed;
        if (span<epsilon || at+span > duration+epsilon) throw new RangeError('Layer exceeds its parent duration in ' + name);
        const weight = layer.weight ?? 1;
        const curve = Array.isArray(weight) ? makeTrack(weight,span,0,K) : null;
        if (!curve && !range(weight,0,1)) throw new RangeError('Invalid layer weight in ' + name);
        keyCount += curve?.keys.length ?? 0;
        const mask = layer.mask===undefined ? null : channels(rig,layer.mask);
        return {id:layer.id,clip:layer.clip,at,span,from,to,speed,mode,weight,curve,mask,
          contacts:layer.contacts ?? mode==='override'};
      });
    } else throw new TypeError('Use a curves or mix clip in ' + name);
    if (keyCount>65536) throw new RangeError('Catalog exceeds its key budget');
    clips.set(name,clip);
  }

  const visiting = new Set(), budgets = new Map();
  function visit(name, level) {
    if (visiting.has(name)) throw new RangeError('Cyclic motion clips at ' + name);
    if (level>16) throw new RangeError('Motion clip nesting exceeds 16 levels');
    const cached = budgets.get(name);
    if (cached) {
      if (level+cached.depth-1>16) throw new RangeError('Motion clip nesting exceeds 16 levels');
      return cached;
    }
    visiting.add(name);
    const clip = clips.get(name);
    const budget = {nodes:1,depth:1,contacts:clip.contacts.length};
    for (const layer of clip.layers) {
      const child = visit(layer.clip,level+1);
      budget.nodes += child.nodes;
      budget.depth = Math.max(budget.depth,1+child.depth);
      if (layer.contacts) budget.contacts += child.contacts;
    }
    visiting.delete(name);
    if (budget.nodes>512 || budget.contacts>512) throw new RangeError('Expanded clip exceeds its layer or contact budget');
    budgets.set(name,budget);
    return budget;
  }
  for (const name of clips.keys()) visit(name,1);
  return {id:input.id,clips,rootAllowance,rig};
}

function getClip(catalog, name) {
  const clip = catalog.clips.get(name);
  if (!clip) throw new RangeError('Unknown motion clip ' + name);
  return clip;
}

function controlsAt(catalog, clip, time, trace, address=clip.name) {
  const controls = new Map();
  for (const [channel,track] of clip.tracks) controls.set(channel,track.sample(time).v);
  for (const layer of clip.layers) {
    if (time<layer.at-epsilon || time>layer.at+layer.span+epsilon) continue;
    const elapsed = clamp(time-layer.at,0,layer.span);
    const weight = clamp(layer.curve?.sample(elapsed).v ?? layer.weight,0,1);
    if (weight===0) continue;
    const sourceTime = clamp(layer.from+elapsed*layer.speed,layer.from,layer.to);
    const ref = address+'/'+layer.id;
    trace?.push({layer:ref,clip:layer.clip,time:sourceTime,weight,mode:layer.mode});
    const child = controlsAt(catalog,getClip(catalog,layer.clip),sourceTime,trace,ref);
    for (const [channel,values] of child) {
      if (layer.mask && !layer.mask.has(channel)) continue;
      const previous = controls.get(channel);
      controls.set(channel,values.map((value,i) => {
        const base = previous?.[i] ?? 0;
        return layer.mode==='add' ? base+value*weight : base+(value-base)*weight;
      }));
    }
  }
  return controls;
}

// Traverse cropped intervals once and keep their mapping to the top-level clip clock.
function timeline(catalog, initial, includeKeys=false) {
  const contacts = [], boundaries = new Set([0,initial.duration]);
  function visit(clip, from, to, parentTime, rate, address, planted) {
    const mapTime = time => clamp(parentTime+(time-from)/rate,0,initial.duration);
    if (includeKeys && boundaries.size<=512) {
      for (const track of clip.tracks.values()) {
        for (const {time} of track.keys) {
          if (time>=from && time<=to) boundaries.add(mapTime(time));
          if (boundaries.size>512) break;
        }
        if (boundaries.size>512) break;
      }
    }
    if (planted) for (const row of clip.contacts) {
      if (row.end<from || row.start>to) continue;
      contacts.push({...row,id:'contact-'+(contacts.length+1),ref:address+'/'+row.id,
        start:mapTime(Math.max(from,row.start)),end:mapTime(Math.min(to,row.end))});
    }
    for (const layer of clip.layers) {
      const start = Math.max(from,layer.at), end = Math.min(to,layer.at+layer.span);
      if (start>end) continue;
      boundaries.add(mapTime(start));
      boundaries.add(mapTime(end));
      for (const {time} of (includeKeys ? layer.curve?.keys ?? [] : [])) {
        if (boundaries.size>512) break;
        const clock = layer.at+time;
        if (clock>=start && clock<=end) boundaries.add(mapTime(clock));
      }
      const childTime = time => clamp(layer.from+(time-layer.at)*layer.speed,layer.from,layer.to);
      visit(getClip(catalog,layer.clip),childTime(start),childTime(end),mapTime(start),rate*layer.speed,
        address+'/'+layer.id,planted&&layer.contacts);
    }
  }
  visit(initial,0,initial.duration,0,1,initial.name,true);
  return {contacts,boundaries};
}

function boundedControls(rig, controls) {
  const clamped = [];
  const bound = (channel,values,limits) => {
    const result = values.map((value,i)=>clamp(value,...limits[i]));
    if (result.some((value,i)=>value!==values[i])) clamped.push(channel);
    return result;
  };
  const angles = {};
  for (const [name,values] of controls) {
    if (name===rootChannel) continue;
    const limits = rig.joints[rig.indices.get(name)].dofs.map(slot => {
      const {min,max} = rig.parameters[slot];
      return [min/rad,max/rad];
    });
    angles[name] = bound(name,values,limits);
  }
  return {initial:{angles,root:bound(rootChannel,controls.get(rootChannel) ?? zero,[[-10000,10000],[-10000,10000],[-10000,10000]])},
    clamped};
}

function validateContacts(contacts) {
  const clock = contacts.flatMap(({start,end})=>[[start-epsilon,1],[end+epsilon,-1]]);
  clock.sort(([a,d],[b,e])=>a-b||e-d);
  let active = 0;
  for (const [,change] of clock) {
    active += change;
    if (active>16) throw new RangeError('A motion clip supports up to 16 simultaneous contacts');
  }
}

function poseAt(rig, controls, contacts, time, allowance, K, options={}) {
  const {initial,clamped} = boundedControls(rig,controls);
  const active = contacts.filter(({start,end})=>time>=start-epsilon&&time<=end+epsilon);
  const targets = options.free ? [] : active.map(({start,end,ref,...target})=>target);
  const pose = solveMotion(rig,targets,initial,allowance,K);
  const refs = new Map(active.map(row=>[row.id,row.ref]));
  pose.motion = {...options.receipt,time,clamped,initial,
    contacts:pose.solve.targets.map(row=>({id:row.id,ref:refs.get(row.id),passed:row.passed}))};
  return pose;
}

function summarize(catalog) {
  return {format:'ink-studio/character-motion-index',version:1,id:catalog.id,rigHash:catalog.rig.hash,
    clips:[...catalog.clips.values()].map(clip=>{
      const {contacts} = timeline(catalog,clip);
      validateContacts(contacts);
      return {id:clip.name,type:clip.layers.length?'mix':'curves',duration:clip.duration,
        curves:[...clip.tracks].map(([control,track])=>({control,keys:track.keys.length})),
        layers:clip.layers.map(({id,clip,at,span,from,to,speed,mode,mask,weight,contacts})=>
          ({id,clip,at,end:at+span,in:from,out:to,speed,mode,weight,contacts,...(mask&&{mask:[...mask]})})),
        contacts};
    })};
}

function sample(catalog, name, time, K, free=false) {
  const clip = getClip(catalog,name), {contacts} = timeline(catalog,clip), layers = [];
  if (!range(time,0,clip.duration)) throw new RangeError('Sample time is outside clip ' + name);
  validateContacts(contacts);
  const controls = controlsAt(catalog,clip,time,layers);
  return poseAt(catalog.rig,controls,contacts,time,catalog.rootAllowance,K,{
    free,receipt:{catalog:catalog.id,clip:name,layers,contactsEnabled:!free}
  });
}

function editCatalog(catalog, input, request, revision, readPose, K) {
  if (!fields(request,['format','version','revision','operations']) ||
      request.format!=='ink-studio/character-motion-edit' || request.version!==1 ||
      request.revision!==undefined && (!validHash(request.revision) || request.revision!==revision) ||
      !Array.isArray(request.operations) || !range(request.operations.length,1,128))
    throw new TypeError('Use a version 1 motion edit with up to 128 operations and the current catalog revision');
  const edited = JSON.parse(JSON.stringify(input)), {rig} = catalog;
  for (const operation of request.operations) {
    const {op,clip,time,control,to,value,ease,pose,controls} = operation ?? {};
    const row = Object.hasOwn(edited.clips,clip) && edited.clips[clip];
    if (row?.type!=='curves' || !range(time,0,row.duration))
      throw new RangeError('Edits need a curves clip and a time within its duration');
    const change = (name, keyValue, action, destination) => {
      channelSize(rig,name);
      const owner = name===rootChannel ? row : (row.joints ??= {}), keys = owner[name] ?? [];
      const index = keys.findIndex(key=>key.time===time);
      if (action==='upsert') {
        const key = {time,value:keyValue,ease:ease ?? keys[index]?.ease ?? 'linear'};
        if (index===-1) keys.push(key);
        else keys[index] = key;
      } else {
        if (index===-1) throw new RangeError('No key at '+time+' on '+name);
        if (action==='move') {
          if (!range(destination,0,row.duration) || destination!==time && keys.some(key=>key.time===destination))
            throw new RangeError('Move destination is outside the clip or already keyed');
          keys[index].time = destination;
        } else keys.splice(index,1);
      }
      if (keys.length) owner[name] = keys.sort((a,b)=>a.time-b.time);
      else delete owner[name];
    };
    if (op==='key-pose' && fields(operation,['op','clip','time','pose','controls','ease'])) {
      if (typeof pose!=='string'||!pose.trim()||path.isAbsolute(pose)||path.win32.isAbsolute(pose))
        throw new TypeError('A keyed pose needs a path relative to its edit file');
      const selected = channels(rig,controls), saved = openPose(rig,readPose(pose),K);
      for (const channel of selected)
        change(channel,channel===rootChannel?saved.rootTranslation:saved.angles[channel],'upsert');
    } else if (op==='upsert' && fields(operation,['op','clip','time','control','value','ease']) && value!==undefined) {
      change(control,value,op);
    } else if (op==='move' && fields(operation,['op','clip','time','control','to']) ||
               op==='remove' && fields(operation,['op','clip','time','control'])) {
      change(control,null,op,to);
    } else throw new TypeError('Use an upsert, move, remove or key-pose motion edit');
  }
  compileCatalog(rig,edited,K);
  return edited;
}

const actions = {
  catalog:{count:2,flags:['out']},
  sample:{count:3,flags:['out','at','free','require-solved'],booleans:['free','require-solved']},
  edit:{count:3,flags:['out'],needsOut:true},
  retarget:{count:5,flags:['out','report','require-solved'],booleans:['require-solved'],needsOut:true}
};

function command([mode,...args], options, kit) {
  const choice = Object.hasOwn(actions,mode) && actions[mode], {KIT:K} = kit;
  if (!choice || args.length!==choice.count || choice.needsOut&&!options.out ||
      Object.entries(options).some(([key,value])=>!choice.flags.includes(key) ||
        (choice.booleans?.includes(key)?value!==true:typeof value!=='string'||!value.trim())))
    throw new TypeError('Use character-motion catalog|sample|edit|retarget. See ink-studio help.');
  const [rigPath,motionPath,name,targetPath,planPath] = args, sources = [];
  const load = file => {
    const resolved = path.resolve(file);
    sources.push(resolved);
    return read(resolved);
  };
  const rig = compile(load(rigPath).document,K);
  const {document,sha256} = load(motionPath);
  const catalog = compileCatalog(rig,document,K);
  let result, report;
  if (mode==='catalog') result = {...summarize(catalog),revision:sha256};
  if (mode==='sample') {
    result = sample(catalog,name,Number(options.at ?? 0),K,options.free);
    result.motion.revision = sha256;
  }
  if (mode==='edit') {
    const editPath = path.resolve(name);
    result = editCatalog(catalog,document,load(editPath).document,sha256,
      pose=>load(path.resolve(path.dirname(editPath),pose)).document,K);
  }
  if (mode==='retarget') {
    const {retarget} = require('./character-motion-retarget.js');
    const target = compile(load(targetPath).document,K), plan = load(planPath);
    ({result,report} = retarget(catalog,name,target,plan.document,K));
    report.sourceRevision = sha256;
    report.planRevision = plan.sha256;
  }
  const out = options.out && path.resolve(options.out), receipt = options.report && path.resolve(options.report);
  const outputs = graphOutputs(sources);
  for (const file of [out,receipt].filter(Boolean)) outputs.protect(fs.statSync(file,{throwIfNoEntry:false}));
  if (out && receipt && (out===receipt || fs.existsSync(out)&&fs.existsSync(receipt)&&
      fs.realpathSync(out)===fs.realpathSync(receipt))) throw new RangeError('Use distinct catalog and report outputs');
  if (out) files.json(out,result);
  if (receipt) files.json(receipt,report);
  if (options['require-solved'] && !(report?.passed ?? result.solve?.passed)) process.exitCode = 2;
  process.stdout.write(JSON.stringify(report ?? result,null,2)+'\n');
}

module.exports = { command, sample, compileCatalog, getClip, controlsAt, timeline, poseAt, validateContacts, format };
