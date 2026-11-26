const fs = require('node:fs');
const path = require('node:path');
const { fields, record, range } = require('./character-rig-assembly.js');
const { grid, sample, methods, integer } = require('./channel-timing.js');
const { openSources, json } = require('./channel-sources.js');
const { graphOutputs } = require('./graph-outputs.js');
const files = require('./asset-files.js');

const planFormat = 'ink-studio/channel-plan', routeFormat = 'ink-studio/channel-route';
const reportFormat = 'ink-studio/channel-report';
const operations = ['filter','blend','resample'];

function stats(values) {
  let min = Infinity, max = -Infinity, count = 0;
  for (const value of values) if (value!==null) {
    min = Math.min(min,value);
    max = Math.max(max,value);
    count++;
  }
  return {present:count,gaps:values.length-count,min:count?min:null,max:count?max:null};
}

function mapping(W, settings, sourceUnit) {
  const pair = value => Array.isArray(value) && value.length===2 &&
    value.every(Number.isFinite) && Number.isFinite(value[1]-value[0]);
  if (!fields(settings,['input','output','unit','shape','exponent']) ||
      !pair(settings.input) || settings.input[0]>=settings.input[1] || !pair(settings.output) ||
      (settings.unit!==undefined && (typeof settings.unit!=='string'||!settings.unit.trim()||settings.unit.length>96)) ||
      !['linear','smoothstep','power'].includes(settings.shape ?? 'linear') ||
      !range(settings.exponent ?? 2,.05,20) || (settings.exponent!==undefined&&settings.shape!=='power'))
    throw new TypeError('Channel mapping needs increasing input bounds, output bounds, and a supported shape');
  const {input,output,unit=sourceUnit,shape='linear',exponent=2} = settings;
  return {unit,transform:value=>value===null?null:W.motionSound.mapRange(value,input,output,shape,exponent)};
}

function filter(W, spec, clock, input, values, T) {
  const {mode} = spec;
  if (!['lowpass','highpass','abs','map'].includes(mode)) throw new TypeError('Unknown channel filter '+mode);
  const amount = ['lowpass','highpass'].includes(mode);
  if ((amount ? !range(spec.seconds,.000001,1e6) : spec.seconds!==undefined) ||
      (mode==='map')!==(spec.map!==undefined)) throw new TypeError('Invalid settings for channel filter '+mode);
  if (mode==='map') {
    const {unit,transform} = mapping(W,spec.map,input.unit);
    return {unit,values:values.map(transform)};
  }
  if (mode==='abs') return {unit:input.unit,values:values.map(value=>value===null?null:Math.abs(value))};
  const alpha = -Math.expm1(-1/(T.seconds(clock.rate)*spec.seconds));
  let state = null;
  return {unit:input.unit,values:values.map(value=>{
    if (value===null) return (state=null);
    state = state===null ? value : state*(1-alpha)+value*alpha;
    return mode==='highpass' ? value-state : state;
  })};
}

function prepare(plan, owner, K) {
  const W = K.world, T = K.procedural.takeTime, {id} = W.data;
  const table = (value, max, min=0) => record(value) && range(Object.keys(value).length,min,max) &&
    Object.keys(value).every(id);
  if (!fields(plan,['format','version','id','clock','sources','stages','traces','routes']) ||
      plan.format!==planFormat || plan.version!==1 || !id(plan.id) || !table(plan.sources,32,1) ||
      !table(plan.stages ?? {},128) || !table(plan.traces ?? {},128) || !table(plan.routes ?? {},64))
    throw new TypeError('Expected a version 1 channel plan with named sources and a clock');
  const common = grid(T,plan.clock), sourceReader = openSources(plan.sources,owner,K);
  const sourceReports = new Map(), stages = new Map(), visiting = new Set();
  let addresses = 0, visits = 0;
  function readSource(name) {
    const result = sourceReader.get(name);
    sourceReports.set(name,result.report);
    return result;
  }
  function measure(n) {
    visits += n;
    if (visits>16000000) throw new RangeError('Channel run exceeds its reduction sample budget');
  }
  function evaluate(input, clock, method='linear') {
    if (!methods.includes(method)) throw new RangeError('Unknown channel sampling method '+method);
    addresses += clock.frames;
    if (addresses>1500000) throw new RangeError('Channel run exceeds its output sample budget');
    const values = Array.from({length:clock.frames},(_,i)=>sample(T,input,clock.at(i),clock.at(i+1),method,measure));
    if (values.some(value=>value!==null&&!Number.isFinite(value)))
      throw new RangeError('Channel sampling exceeded its numeric range');
    return values;
  }
  function reference(name) {
    if (typeof name!=='string') throw new TypeError('Channel inputs name a stage or source/channel');
    const parts = name.split('/');
    if (parts.length===1 && id(name) && Object.hasOwn(plan.stages ?? {},name)) return stage(name);
    if (parts.length!==2 || !parts.every(id)) throw new RangeError('Unknown channel reference '+name);
    const result = readSource(parts[0]).channels.get(parts[1]);
    if (!result) throw new RangeError('Unknown channel reference '+name);
    return result;
  }
  function stage(name) {
    if (stages.has(name)) return stages.get(name);
    if (visiting.has(name)) throw new RangeError('Cyclic channel stage '+name);
    if (visiting.size>=64) throw new RangeError('Channel stage nesting exceeds 64 levels');
    const spec = plan.stages?.[name], {op} = spec ?? {};
    if (!operations.includes(op)) throw new TypeError('Unknown channel stage '+name);
    const clock = spec.clock===undefined ? common : grid(T,spec.clock);
    visiting.add(name);
    let result;
    if (op==='blend') {
      const {inputs,missing='gap'} = spec;
      if (!fields(spec,['op','clock','inputs','missing']) || !['gap','zero'].includes(missing) ||
          !Array.isArray(inputs) || !range(inputs.length,1,32) ||
          inputs.some(row=>!fields(row,['input','weight','method']) || !range(row.weight ?? 1,-1000,1000)))
        throw new TypeError('Blend stages need weighted inputs and a valid gap policy');
      const sources = inputs.map(row=>reference(row.input)), unit = sources[0].unit;
      if (sources.some(input=>input.unit!==unit)) throw new RangeError('Blend inputs need the same unit. Map units explicitly first.');
      const series = sources.map((source,i)=>evaluate(source,clock,inputs[i].method));
      const weights = inputs.map(row=>row.weight ?? 1);
      const values = series[0].map((_,i)=>{
        let sum = 0, present = false;
        for (const [j,track] of series.entries()) {
          if (weights[j]===0) continue;
          const value = track[i];
          if (value===null && missing==='gap') return null;
          if (value===null) continue;
          present = true;
          sum+=value*weights[j];
        }
        return present?sum:null;
      });
      result = {unit,values};
    } else {
      if (!fields(spec,['op','clock','input','method',...(op==='filter'?['mode','seconds','map']:[])]))
        throw new TypeError('Invalid channel '+op+' stage '+name);
      const input = reference(spec.input), values = evaluate(input,clock,spec.method);
      result = op==='filter'?filter(W,spec,clock,input,values,T):{unit:input.unit,values};
    }
    if (result.values.some(value=>value!==null&&!Number.isFinite(value)))
      throw new RangeError('Nonfinite values in channel stage '+name);
    const series = {...result,clock,report:{...spec,clock:clock.report,unit:result.unit,...stats(result.values)}};
    visiting.delete(name);
    stages.set(name,series);
    return series;
  }
  function routed() {
    const result = {};
    for (const [name,row] of Object.entries(plan.routes ?? {})) {
      if (!fields(row,['input','method','map','fallback']) || row.fallback!==undefined && !Number.isFinite(row.fallback))
        throw new TypeError('Invalid channel route '+name);
      const input = reference(row.input), {unit,transform} = row.map===undefined ?
        {unit:input.unit,transform:value=>value} : mapping(W,row.map,input.unit);
      const raw = evaluate(input,common,row.method), values = raw.map(value=>transform(value) ?? row.fallback ?? null);
      result[name] = {input:row.input,method:row.method ?? 'linear',unit,values,...stats(values),
        sourceGaps:stats(raw).gaps,...(row.map&&{map:row.map}),...(row.fallback!==undefined&&{fallback:row.fallback})};
    }
    return result;
  }
  function traces() {
    const chosen = plan.traces ?? Object.fromEntries(Object.keys(plan.stages ?? {}).map(name=>[name,name]));
    return Object.fromEntries(Object.entries(chosen).map(([name,spec])=>{
      const row = typeof spec==='string' ? {input:spec} : spec;
      if (!fields(row,['input','method'])) throw new TypeError('Invalid trace column '+name);
      const input = reference(row.input), values = evaluate(input,common,row.method);
      return [name,{input:row.input,method:row.method ?? 'linear',unit:input.unit,values,...stats(values)}];
    }));
  }
  function output(mode, name) {
    let clock = common, result, format;
    if (mode==='discover') {
      for (const source of Object.keys(plan.sources)) readSource(source);
      result = {stages:plan.stages ?? {},routes:plan.routes ?? {},traces:plan.traces ?? {}};
      format = 'ink-studio/channel-index';
    } else if (mode==='run' || mode==='route') {
      const controls = routed();
      if (mode==='route'&&!Object.keys(controls).length) throw new RangeError('The channel plan needs named routes');
      result = mode==='route'?{controls}:{traces:traces(),controls};
      if (mode==='run'&&!Object.keys(result.traces).length&&!Object.keys(controls).length)
        throw new RangeError('The channel plan needs trace columns, stages, or routes');
      format = mode==='route'?routeFormat:reportFormat;
    } else {
      if (plan.stages?.[name]?.op!==mode || !id(name)) throw new RangeError('Choose a named '+mode+' stage');
      const series = stage(name);
      clock = series.clock;
      result = {traces:{[name]:{input:name,unit:series.unit,values:series.values,...stats(series.values)}}};
      format = reportFormat;
    }
    const {stages:authored,...payload} = result;
    return {format,version:1,id:plan.id,clock:clock.report,sources:Object.fromEntries(sourceReports),
      stages:authored ?? Object.fromEntries([...stages].map(([key,row])=>[key,row.report])),...payload,
      ...(mode!=='discover'&&{timecodes:Array.from({length:clock.frames},(_,i)=>T.pack(clock.at(i)))})};
  }
  return {output,paths:sourceReader.paths};
}

function command([mode,file,name,...extra], options, {KIT:K}) {
  if (![...operations,'discover','route','run'].includes(mode) || typeof file!=='string' ||
      operations.includes(mode)!==(name!==undefined)||extra.length ||
      Object.entries(options).some(([key,value])=>key!=='out'||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use channels discover|filter|blend|resample|route|run <plan.json> [stage] [--out report.json]');
  const owner = path.resolve(file), {document,sha256} = json(owner), plan = prepare(document,owner,K);
  const report = {...plan.output(mode,name),planSha256:sha256};
  if (options.out) {
    const destination = path.resolve(options.out);
    graphOutputs([owner,...plan.paths]).protect(fs.statSync(destination,{throwIfNoEntry:false}));
    files.json(destination,report);
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function frameControls(file, inputName, graphOptions, project, K) {
  const W = K.world, T = K.procedural.takeTime, {document,sha256} = json(file);
  const inputs = project.plan().inputs;
  if (!W.data.id(inputName)||inputs[inputName]?.type!=='record'||Object.hasOwn(graphOptions.inputs ?? {},inputName))
    throw new TypeError('Routed graph clips need an exclusive record input named '+inputName);
  if (![routeFormat,reportFormat].includes(document?.format)||document.version!==1||!record(document.controls))
    throw new TypeError('Graph clip --controls needs a saved Ink channel route');
  const {rate,start,frames} = document.clock ?? {};
  const clock = grid(T,{rate,start,frames}), entries = Object.entries(document.controls);
  if (!range(entries.length,1,64) || entries.some(([name,series])=>!W.data.id(name) ||
      !Array.isArray(series?.values) || series.values.length!==frames ||
      !series.values.every(value=>value===null||Number.isFinite(value))))
    throw new TypeError('Invalid named control samples in the route output');
  const {from=0,to,warmup=0} = graphOptions;
  if (!integer(from,0,1000000000)||!integer(to,from+1,1000000000)||!integer(warmup,0,1000000000))
    throw new RangeError('Routed graph clip needs a valid frame range and warmup');
  const pictureRate = T.read(graphOptions.clock.fps ?? 24), first = Math.max(0,from-warmup);
  if (T.compare(clock.rate,pictureRate)!==0)
    throw new RangeError('Routed controls need the exact graph clip frame rate');
  const address = frame => T.sub(T.read(frame),T.mul(clock.start,clock.rate));
  const firstIndex = address(first), lastIndex = address(to-1);
  if (firstIndex[1]!==1n || firstIndex[0]<0n || lastIndex[0]>=BigInt(frames))
    throw new RangeError('Routed controls must cover every graph clip frame including warmup on exact frame boundaries');
  const offset = T.index(firstIndex[0])-first;
  const used = entries.map(([name])=>name);
  function frameInputs(frame) {
    const index = frame.frame+offset, values = entries.map(([name,series])=>{
      const value = series.values[index];
      if (value===null) throw new RangeError('Control '+name+' has a gap at graph frame '+frame.frame);
      return [name,value];
    });
    return {[inputName]:Object.fromEntries(values)};
  }
  return {frameInputs,report:{input:inputName,sha256,clock:clock.report,names:used}};
}

module.exports = { command, frameControls, prepare };
