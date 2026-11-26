const fs = require('node:fs');
const path = require('node:path');
const { fields, record, range, sha } = require('./character-rig-assembly.js');
const { grid, integer } = require('./channel-timing.js');

const maximumBytes = 64*1024**2;

function readFile(file) {
  const fd = fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size>maximumBytes) throw new RangeError('Channel source exceeds its file budget');
    const bytes = fs.readFileSync(fd);
    if (bytes.length>maximumBytes) throw new RangeError('Channel source exceeds its file budget');
    return { bytes,sha256:sha(bytes) };
  } finally { fs.closeSync(fd); }
}

function json(file) {
  const {bytes,sha256} = readFile(file);
  return { document:JSON.parse(bytes),sha256 };
}

function animation(rigInput, motionInput, spec, K, offset, charge) {
  const {compile} = require('./character-rig-assembly.js');
  const {compileCatalog,getClip,sample} = require('./character-motion.js');
  const rig = compile(rigInput,K), catalog = compileCatalog(rig,motionInput,K), clip = getClip(catalog,spec.clip);
  const T = K.procedural.takeTime, duration = T.read(clip.duration);
  const channels = new Map(), axes = ['x','y','z'];
  let lastTime, pose;
  function add(name, index, unit, joint, axis) {
    channels.set(name,{unit,axis,at(time) {
      const local = T.sub(time,offset);
      if (local[0]<0n || T.compare(local,duration)>0) return null;
      if (!lastTime || T.compare(time,lastTime)!==0) {
        charge();
        pose = sample(catalog,clip.name,T.seconds(local),K,!spec.contacts);
        if (!pose.solve.passed) throw new RangeError('Animation contact solve failed in '+clip.name+' at '+T.seconds(local));
        lastTime = time;
      }
      return (joint===undefined ? pose.rootTranslation : pose.angles[joint])[index];
    }});
  }
  for (const [i,axis] of axes.entries()) add('root.'+axis,i,'model-unit');
  for (const {id,dofs} of rig.joints) for (const [i,slot] of dofs.entries())
    add(id+'.'+(dofs.length===1?'angle':axes[i]),i,'deg',id,rig.parameters[slot].axis);
  return {channels,clock:{kind:'continuous',origin:T.pack(offset),end:T.pack(T.add(offset,duration)),endInclusive:true},
    details:{rig:rig.id,rigHash:rig.hash,clip:clip.name,contacts:spec.contacts??false}};
}

function uniform(trace, offset, T) {
  const {sampleRate,startSample,frames,channels} = trace;
  if (!frames) throw new RangeError('Channel sources need at least one sample');
  const origin = T.add(offset,T.div(T.read(startSample),T.read(sampleRate)));
  const clock = grid(T,{rate:sampleRate,start:T.pack(origin),frames},8000000);
  const series = new Map(Object.entries(channels).map(([name,{samples,unit}])=>[name,{unit,values:samples,clock}]));
  return {channels:series,clock:{kind:'samples',sampleRate,startSample,endSample:startSample+frames,
    origin:clock.report.start,end:clock.report.end,endInclusive:false}};
}

function openSources(specs, owner, K) {
  const W = K.world, T = K.procedural.takeTime;
  const files = new Map(), loaded = new Map(), paths = [];
  let byteCount = 0, samples = 0, animationEvaluations = 0;
  function load(name, audio=false) {
    if (typeof name!=='string' || !name.trim() || path.isAbsolute(name) || path.win32.isAbsolute(name))
      throw new TypeError('Channel source paths must be relative to the plan');
    const file = path.resolve(path.dirname(owner),name);
    const key = JSON.stringify([file,audio]);
    if (!files.has(key)) {
      const {bytes,sha256} = readFile(file);
      byteCount += bytes.length;
      if (byteCount>192*1024**2) throw new RangeError('Channel sources exceed their total file budget');
      const value = audio ? require('./wav.js').decode(bytes,{metadata:true}) : JSON.parse(bytes);
      files.set(key,{value,receipt:{file:name,sha256}});
      paths.push(file);
    }
    const {value,receipt} = files.get(key);
    return {value,receipt:{...receipt,file:name}};
  }
  function get(name) {
    if (loaded.has(name)) return loaded.get(name);
    if (!Object.hasOwn(specs,name)) throw new RangeError('Unknown channel source '+name);
    const spec = specs[name], {kind,file} = spec ?? {};
    const common = ['kind','file','offset'];
    const keys = {audio:['startSample'],simulation:['options'],animation:['rig','clip','contacts']};
    if (!Object.hasOwn(keys,kind) || !fields(spec,[...common,...keys[kind]]))
      throw new TypeError('Invalid channel source '+name);
    const offset = T.read(spec.offset ?? 0);
    if (!range(T.seconds(offset),-1e12,1e12)) throw new RangeError('Invalid channel source offset');
    const primary = load(file,kind==='audio'), dependencies=[primary.receipt];
    let source;
    if (kind==='animation') {
      if (!W.data.id(spec.clip) || spec.contacts!==undefined && typeof spec.contacts!=='boolean')
        throw new TypeError('Animation channel source needs a named clip');
      const rig = load(spec.rig);
      dependencies.push(rig.receipt);
      source = animation(rig.value,primary.value,spec,K,offset,()=>{
        if (++animationEvaluations>28800) throw new RangeError('Channel run exceeds its animation evaluation budget');
      });
    } else {
      const {value} = primary;
      let trace, details;
      if (kind==='audio') {
        const reference = value.bwf?.timeReference;
        const startSample = spec.startSample ?? (reference===undefined?0:Number(reference));
        if (!integer(startSample,0,Number.MAX_SAFE_INTEGER))
          throw new RangeError('WAV sample origin exceeds its integer range');
        trace = W.outputAdapters.trace({sampleRate:value.sampleRate,channels:value.channels,samples:value.samples,startSample});
        details={encoding:'normalized PCM',...(reference!==undefined&&{timeReference:reference}),
          ...(spec.startSample!==undefined&&{sampleOriginOverride:true})};
      } else {
        if (spec.options!==undefined && !record(spec.options)) throw new TypeError('Simulation trace options must be a record');
        trace = W.outputAdapters.trace(value,spec.options);
        details={format:value.format??'named samples',...(spec.options&&{options:spec.options})};
      }
      samples += trace.frames*Object.keys(trace.channels).length;
      if (samples>8000000) throw new RangeError('Channel sources exceed their total sample budget');
      source = {...uniform(trace,offset,T),details};
    }
    const report = {kind,offset:T.pack(offset),clock:source.clock,dependencies,...source.details,
      channels:Object.fromEntries([...source.channels].map(([key,row])=>
        [key,{unit:row.unit,...(row.axis&&{axis:row.axis})}]))};
    const result = {...source,report};
    loaded.set(name,result);
    return result;
  }
  return {get,paths};
}

module.exports = { openSources, json };
