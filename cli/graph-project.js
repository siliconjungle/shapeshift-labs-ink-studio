const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { createGraphHost } = require('./graph-host.js');
const { clip } = require('./graph-clip.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { loadGraphGroups, groupFor, groupUsage, groupDependencies } = require('./graph-groups.js');
const { snapshotFormat } = require('./graph-diff.js');
const { fingerprint } = require('./graph-artifact-cache.js');
const { estimateGraphMemory } = require('./graph-memory.js');

const format = 'ink-studio/graph-project';
const reportFormat = 'ink-studio/graph-report';
const version = 1;
const maxNodes = 2000;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sameValue = (a,b) => isDeepStrictEqual(a,b);

function fields(value, keys, label) {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Invalid ' + label);
  return value;
}

function named(value, label) {
  if (!record(value) || !Object.keys(value).every(id))
    throw new TypeError('Expected ' + label + ' keyed by graph ID');
  return Object.entries(value);
}

function separateNames(names, label) {
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length)
    throw new TypeError(label + ' need distinct names on case-insensitive filesystems');
}

function imageBytes(value, grayscale = false) {
  if (value?.colorSpace==='srgb-linear') throw new TypeError('Graph PNG output needs display RGB. Use color.rasterToDisplay first.');
  const { width, height, data } = value ?? {};
  const size = width * height;
  const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      size > 2**24) throw new TypeError('Graph PNG output needs valid image dimensions');
  if (grayscale && bytes && data.length === size && (value.channels ?? 1) === 1)
    return PNG.encodeGray(width,height,data);
  if (![size*3,size*4].includes(data?.length) || !(Array.isArray(data) || ArrayBuffer.isView(data)))
    throw new TypeError('Graph PNG output needs an RGB8 or RGBA8 image');
  if (!bytes) for (let i=0; i<data.length; i++) {
    const n=data[i];
    if (!Number.isInteger(n) || n<0 || n>255) throw new TypeError('Graph PNG output needs an RGB8 or RGBA8 image');
  }
  return PNG.encode(width,height,bytes ? data : Uint8Array.from(data),data.length / size);
}

function jsonBytes(value) {
  const active = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || Number.isFinite(item)) return item;
    if (active.has(item)) throw new TypeError('Graph JSON output contains a cycle');
    if (!Array.isArray(item) && !(ArrayBuffer.isView(item) && typeof item.length==='number') && !record(item))
      throw new TypeError('Graph JSON output needs finite JSON data or numeric buffers');
    active.add(item);
    const result = Array.isArray(item) || ArrayBuffer.isView(item) ? Array.from(item,visit) :
      Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0).map(([key,value])=>[key,visit(value)]));
    active.delete(item);
    return result;
  }
  return Buffer.from(JSON.stringify(visit(value),null,2)+'\n');
}

function describe(value, depth = 0) {
  if (typeof value === 'function') return {kind:'runtime',type:'function'};
  if (value === undefined || typeof value === 'bigint' || typeof value === 'symbol' ||
      typeof value === 'number' && !Number.isFinite(value)) return {kind:'runtime',type:typeof value};
  if (!value || typeof value !== 'object') return value;
  if (Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) && value.data)
    return {kind:'image',width:value.width,height:value.height,samples:value.data.length,
      ...(typeof value.colorSpace==='string' && {colorSpace:value.colorSpace})};
  if (Number.isSafeInteger(value.sampleRate) && value.sampleRate > 0 && Number.isSafeInteger(value.channels) &&
      value.channels > 0 && (Array.isArray(value.samples) || ArrayBuffer.isView(value.samples))) {
    const frames=value.samples.length / value.channels;
    return {kind:'audio',sampleRate:value.sampleRate,channels:value.channels,frames,duration:frames/value.sampleRate};
  }
  if (ArrayBuffer.isView(value)) return {kind:'buffer',type:value.constructor.name,length:value.length};
  if (Array.isArray(value)) return depth<3 && value.length<=32 ? value.map(item => describe(item,depth+1)) :
    {kind:'array',length:value.length};
  const keys = Object.keys(value);
  if (!record(value) || depth>=3 || keys.length>32) return {kind:'record',keys:keys.slice(0,32),length:keys.length};
  return Object.fromEntries(keys.map(key=>[key,describe(value[key],depth+1)]));
}

function graphSpec(value, label, groupOperators) {
  fields(value,['inputs','nodes','outputs'],label);
  const {inputs={},nodes,outputs}=value;
  function binding(value) {
    if (!record(value)) return;
    const kinds=['value','node','input','keys'].filter(key=>Object.hasOwn(value,key));
    if (!kinds.length) return;
    const [kind]=kinds;
    const allowed=kind==='node' ? ['node','port'] : kind==='keys' ? ['keys','mode'] : [kind];
    if (kinds.length!==1 || Object.keys(value).some(key=>!allowed.includes(key)) ||
        kind==='node' && (!id(value.node) || Object.hasOwn(value,'port') && !id(value.port)) ||
        kind==='input' && !id(value.input) || kind==='keys' && !Array.isArray(value.keys))
      throw new TypeError('Invalid graph binding in '+label);
  }
  for (const [name,node] of named(nodes,label+' nodes')) {
    fields(node,['op','params','inputs',...(groupOperators.includes(node?.op) ? ['group'] :
      node?.op==='data.typed' ? ['type'] : [])],'node '+name);
    if (!id(node.op)) throw new TypeError('Invalid operation for node '+name);
    if (node.group!==undefined && !id(node.group)) throw new TypeError('Invalid group for node '+name);
    for (const [,value] of [...named(node.inputs??{},'node inputs'),...named(node.params??{},'node parameters')]) binding(value);
  }
  named(inputs,label+' parameters');
  for (const [,value] of named(outputs,label+' outputs')) binding(value);
  return {inputs,nodes,outputs};
}

function select(frame, output, subpath) {
  if (!Object.hasOwn(frame.outputs,output)) throw new RangeError('Unknown graph output '+output);
  let value = frame.outputs[output];
  for (const key of subpath) {
    if (value===null || (typeof value!=='object' && typeof value!=='string') || !Object.hasOwn(value,key))
      return {found:false};
    value=value[key];
  }
  return {found:true,value};
}

function prepareAssertions(rows, plan) {
  const compares = {
    eq: sameValue, ne:(a,b)=>!sameValue(a,b),
    min:(a,b)=>Number.isFinite(a) && a>=b, max:(a,b)=>Number.isFinite(a) && a<=b
  };
  if (!Array.isArray(rows)) throw new TypeError('Graph assertions need an array');
  const ids = new Set();
  return Array.from(rows,definition=>{
    const {id:name,output,path:subpath=[],op,value}=fields(definition,['id','output','path','op','value'],'graph assertion');
    if (!id(name) || ids.has(name) || !id(output) || !Object.hasOwn(plan.outputs,output) ||
        !Object.hasOwn(compares,op) && op!=='sha256' ||
        !Object.hasOwn(definition,'value') || !Array.isArray(subpath) || !Array.from(subpath).every(key=>
          typeof key==='string' || Number.isSafeInteger(key) && key>=0) ||
        (op==='min' || op==='max') && !Number.isFinite(value) ||
        op==='sha256' && (typeof value!=='string' || !/^[0-9a-f]{64}$/.test(value)))
      throw new TypeError('Invalid or duplicate graph assertion '+name);
    ids.add(name);
    return frame=>{
      const {found,value:actual}=select(frame,output,subpath);
      let error, measured=actual;
      let passed=false;
      try {
        if (found && op==='sha256') {
          measured=sha256(Number.isSafeInteger(actual?.width) && actual.data ? imageBytes(actual) : jsonBytes(actual));
          passed=measured===value;
        } else if (found) passed=compares[op](actual,value);
      }
      catch (cause) { error=cause.message; }
      return {id:name,output,path:subpath,op,expected:describe(value),found,actual:found ? describe(measured) : null,
        passed,...(error && {error})};
    };
  });
}

function nativeOperations(kit, assets) {
  const binary = (fn, type='number') => ({inputs:{a:'number',b:'number'},outputs:{value:type},run(args){return {value:fn(args)};}});
  function asset(type, accepts) {
    return {inputs:{name:'string'},outputs:{value:type},asset:'name',workerLocal:true,run({name}){
      const entry=assets.get(name);
      if (!entry || !accepts(entry)) throw new RangeError('Unknown '+type+' graph asset '+name);
      return {value:entry.value};
    }};
  }
  return {
    add:binary(({a,b})=>a+b),
    multiply:binary(({a,b})=>a*b),
    lessThan:binary(({a,b})=>a<b,'boolean'),
    time:{time:true,outputs:{value:'seconds'},run(_,ctx){return {value:ctx.time};}},
    random:{outputs:{value:'number'},seed:true,run(_,ctx){return {value:kit.KIT.grow.dice(ctx.seed)()};}},
    ...require('./graph-render.js').graph3DOperations(kit),
    pngAsset:asset('image', entry => entry.format==='png'),
    indexedPngAsset:{
      inputs:{name:'string'},outputs:{value:'raster',palette:'palette',alpha:'raster'},asset:'name',workerLocal:true,
      run({name}) {
        const entry=assets.get(name);
        if (entry?.format!=='indexed-png') throw new RangeError('Unknown indexed PNG graph asset '+name);
        return entry.value;
      }
    },
    jsonAsset:asset('any', entry => entry.format==='json'),
    audioAsset:asset('audio', entry => entry.type==='audio'),
    rasterAsset:asset('raster', entry => entry.type==='raster'),
    inputAsset:asset('record', entry => entry.format==='inputs')
  };
}

function operationRegistry(kit, operations = {}, assets = new Map()) {
  const stock = nativeOperations(kit, assets);
  const extensions = Object.fromEntries(named(operations, 'host operations'));
  return { stock, extensions, overrides: { ...stock, ...extensions }, toolkit: kit.KIT.procedural.graph.operations };
}

function snapshotInputs(inputs, clone) {
  const active=new Set();
  function copy(value) {
    // Existing compiled toolkit handles and native sample buffers keep their identity.
    if (typeof value==='function' || typeof value?.sample==='function' || typeof value?.snapshot==='function' ||
        ArrayBuffer.isView(value)) return value;
    if (!Array.isArray(value) && !record(value)) return clone(value);
    if (active.has(value)) throw new TypeError('Graph inputs contain a cycle');
    active.add(value);
    const result=Array.isArray(value) ? Array.from(value,copy) :
      Object.fromEntries(Object.entries(value).map(([key,item])=>{
        if (['__proto__','constructor','prototype'].includes(key)) throw new TypeError('Unsafe graph input key '+key);
        return [key,copy(item)];
      }));
    active.delete(value);
    return Object.freeze(result);
  }
  return Object.fromEntries(Object.entries(inputs).map(([name,value])=>[name,copy(value)]));
}

function sweepCases(definition, broadcast) {
  const {sweep,idPrefix='case',limit=256}=fields(definition,['sweep','idPrefix','limit'],'graph sweep');
  if (!id(idPrefix)) throw new TypeError('Graph sweep needs a valid ID prefix');
  const {inputs={},time,seed}=fields(sweep,['inputs','time','seed'],'graph sweep axes');
  const axes={...Object.fromEntries(named(inputs,'sweep parameter axes').map(([name,values])=>['inputs.'+name,values])),
    ...(time!==undefined && {time}),...(seed!==undefined && {seed})};
  const rows=broadcast(axes,{mode:'cartesian',limit});
  if (!rows.length) throw new RangeError('Graph sweep axes must contain at least one value each');
  const digits=Math.max(3,String(rows.length).length);
  return {cases:rows.map(({time,seed,...values},i)=>({
    id:idPrefix+'-'+String(i+1).padStart(digits,'0'),
    inputs:Object.fromEntries(Object.entries(values).map(([key,value])=>[key.slice(7),value])),
    ...(time!==undefined && {time}),...(seed!==undefined && {seed})
  })), report:{mode:'cartesian',axes:Object.keys(axes).sort().map(name=>({name,count:axes[name].length})),
    count:rows.length,limit}};
}

function cacheReport(frame) {
  const nodes = {};
  function collect(result, prefix, cached) {
    for (const [name,status] of Object.entries(result.status)) {
      const hit=cached || status==='cached';
      nodes[prefix+name]=hit ? 'cached' : 'evaluated';
      const nested=result.inspectGroup(name);
      if (nested) collect(nested,prefix+name+'/',hit);
    }
  }
  collect(frame,'',false);
  const hits=Object.values(nodes).filter(status=>status==='cached').length;
  return {hits,misses:Object.keys(nodes).length-hits,nodes};
}

function createGraphProject(source, { kit=require('../index.js').load(), baseDir=process.cwd(), operations={}, adapters={},
  sourceFile, workerPool, planAssets=false }={}) {
  if (workerPool && !workerPool.matches(kit)) throw new TypeError('Graph worker pool and project need the same toolkit');
  const {graph,data,mediaGraph,takeTime}=kit.KIT.procedural;
  const host=createGraphHost(adapters,{kit});
  const {broadcast}=graph.arrays;
  const groupOperators=[...graph.arrays.groupOperators,...kit.KIT.procedural.animationGraph.groupOperators];
  const project=data.freeze(data.clone(source));
  const {format:kind,version:revision,groups:definitions={},assets:assetDefinitions={},exports:exportsSpec={},
    assertions:assertionSpecs=[],time=0,seed=0,...root}=fields(project,
    ['format','version','inputs','nodes','outputs','groups','assets','exports','assertions','time','seed'],'graph project');
  if (kind!==format || revision!==version) throw new TypeError('Expected ink-studio/graph-project version 1');
  const spec=graphSpec(root,'project graph',groupOperators);
  const paths=new Set(sourceFile ? [path.resolve(sourceFile)] : []);
  const groupTree=loadGraphGroups(definitions,baseDir,{onFile:file=>paths.add(file)});
  const groupSpecs=new Map(groupTree.entries.map(group=>[group,graphSpec(group.spec,'group '+group.alias,groupOperators)]));
  const assets=new Map(named(assetDefinitions,'assets').map(([name,definition])=>{
    const {format,file,type,codec,options}=fields(definition,
      definition?.format==='codec' ? ['format','file','type','codec','options'] : ['format','file'],'graph asset '+name);
    if (!['png','indexed-png','json','wav','inputs','codec'].includes(format) || typeof file!=='string' || !file)
      throw new TypeError('Graph assets need a PNG, JSON, WAV, input recording or hosted codec file');
    const full=path.resolve(baseDir,file);
    paths.add(full);
    if ((format==='wav' || format==='codec') && fs.statSync(full).size>WAV.maxBytes)
      throw new RangeError('Graph media asset exceeds its byte budget');
    const bytes=fs.readFileSync(full);
    let value, kind;
    if (format==='png') {
      const {w,h,data,max}=planAssets ? PNG.layout(bytes) : PNG.raster(bytes);
      value=planAssets ? {width:w,height:h} : {width:w,height:h,
        data:max===255 ? data : Uint8Array.from(data,n=>Math.round(n*255/max))};
      kind='raster';
    } else if (format==='indexed-png') {
      if (planAssets) {
        const {w,h}=PNG.layout(bytes,true);
        value={value:{width:w,height:h}};
      } else value=PNG.indexedRaster(bytes);
    } else if (format==='wav') {
      value=WAV.decode(bytes);
      kind='audio';
    } else if (format==='codec') {
      value=host.decode(codec,bytes,{type,file:full,options});
      kind=type;
    } else {
      const parsed=JSON.parse(bytes.toString('utf8'));
      value=format==='inputs' ? mediaGraph.recording(parsed) :
        data.freeze(data.clone(resolveCheckpoint(full,parsed,{onBlock:block=>paths.add(block)})));
    }
    return [name,{format,file,sha256:sha256(bytes),value,...(kind && {type:kind}),...(codec && {codec})}];
  }));
  const {stock,overrides:ops}=operationRegistry(kit,operations,assets);
  const scopes=new Map(), preparedGroups=new Map(), visiting=new Set();
  function operationsIn(scope) {
    if (!scopes.has(scope)) scopes.set(scope,Object.create(null));
    return scopes.get(scope);
  }

  function compile(spec,scope) {
    let expandedNodes=Object.keys(spec.nodes).length;
    for (const node of Object.values(spec.nodes)) {
      const dependency=groupFor(scope,node);
      if (dependency) expandedNodes+=compileGroup(dependency).expandedNodes;
    }
    if (expandedNodes>maxNodes) throw new RangeError('Expanded graph exceeds its '+maxNodes+' node budget');
    const compiled=graph.create(spec,{operations:ops,groups:operationsIn(scope),planOnly:true}), plan=compiled.plan();
    for (const {id,op,inputs} of plan.nodes) {
      if (ops[op]!==stock[op] || !['pngAsset','indexedPngAsset','jsonAsset','audioAsset','rasterAsset','inputAsset'].includes(op) ||
          inputs.name.source.kind!=='value') continue;
      const node=spec.nodes[id], definition=node.inputs?.name ?? node.params?.name;
      const name=record(definition) ? definition.value : definition;
      try { stock[op].run({name}); }
      catch (error) { throw new RangeError('Unknown graph asset '+name+' at '+id,{cause:error}); }
    }
    return {compiled,plan:{...plan,expandedNodes}};
  }

  function compileGroup(group) {
    const {name,alias,owner,scope}=group;
    if (preparedGroups.has(alias)) return preparedGroups.get(alias).plan;
    if (visiting.has(group)) throw new Error('Graph group cycle at '+alias);
    if (Object.hasOwn(ops,name) || Object.hasOwn(graph.operations??{},name))
      throw new Error('Graph group name conflicts with an operation: '+alias);
    visiting.add(group);
    const spec=groupSpecs.get(group), {plan,compiled}=compile(spec,scope);
    visiting.delete(group);
    const outputs=Object.fromEntries(Object.entries(plan.outputs).map(([key,link])=>[key,link.type]));
    operationsIn(owner)[name]={...graph.group(spec,{operations:ops,groups:operationsIn(scope),outputs}),
      expandedNodes:plan.expandedNodes};
    preparedGroups.set(alias,{plan,scope,compiled});
    return plan;
  }

  for (const group of groupTree.entries) compileGroup(group);
  const groups=operationsIn(groupTree.scope);
  const {compiled,plan:rootPlan}=compile(spec,groupTree.scope);
  const exports=named(exportsSpec,'exports').map(([name,definition])=>{
    const {output,format,encoding,type,codec,options}=fields(definition,definition?.format==='wav' ?
      ['output','format','encoding'] : definition?.format==='codec' ? ['output','format','type','codec','options'] :
      ['output','format'],'graph export '+name);
    if (!id(output) || !Object.hasOwn(rootPlan.outputs,output) || !['png','json','atlas','wav','codec'].includes(format))
      throw new TypeError('Graph export '+name+' needs a known output and png, json, atlas, wav or codec format');
    const port=rootPlan.outputs[output].type, compatible=kit.KIT.procedural.graphTypes.compatible;
    if ((format==='png' || format==='codec' && type==='raster') && port==='linearRaster')
      throw new TypeError('Graph image export '+name+' needs display RGB. Use color.rasterToDisplay first.');
    if (format==='png' && !compatible(port,'raster')) throw new TypeError('Graph PNG export '+name+' needs an image output');
    if (format==='atlas' && !compatible(port,'atlas')) throw new TypeError('Graph atlas export '+name+' needs an atlas output');
    if (format==='wav' && (!compatible(port,'audio') || encoding!==undefined && !WAV.encodings.includes(encoding)))
      throw new TypeError('Graph WAV export '+name+' needs audio and a supported PCM encoding');
    if (format==='codec' && (!['audio','raster'].includes(type) || !compatible(port,type) || !id(codec) ||
        options!==undefined && !record(options))) throw new TypeError('Graph codec export '+name+' needs typed media and a named codec');
    if (format==='codec') host.requireCodec(codec,'encode');
    return {name,output,format,...(encoding && {encoding}),...(codec && {type,codec,...(options && {options})})};
  });
  separateNames(exports.map(entry=>entry.name),'Graph exports');
  const assertions=prepareAssertions(assertionSpecs,rootPlan);
  const assetInfo=Object.fromEntries([...assets].map(([name,{value,...entry}])=>[name,{...entry,...(entry.type==='raster' &&
    {width:value.width,height:value.height}),...(entry.type==='audio' && {
      sampleRate:value.sampleRate,channels:value.channels,frames:value.samples.length/value.channels
    })}]));
  const dependencyRows=groupDependencies(groupTree,spec.nodes,baseDir);
  // Preserve existing graph hashes for unchanged legacy groups and take checkpoints.
  const versionedGroups=groupTree.entries.filter(group=>group.document &&
    (group.document.versioned || group.alias.includes('/') || group.scope!==group.owner ||
      typeof definitions[group.name]!=='string'));
  const groupFiles=Object.fromEntries(versionedGroups.map(group=>[group.alias,
    { reference:group.reference, sha256:group.document.sha256 }]));
  const projectHash=sha256(jsonBytes({project,
    groups:Object.fromEntries([...groupSpecs].map(([group,body])=>[group.alias,body])),assets:assetInfo,
    ...(versionedGroups.length && {groupFiles})}));
  const header={format:reportFormat,version,projectHash};

  function clock(t,s) {
    if (!Number.isFinite(t) || !Number.isSafeInteger(s)) throw new TypeError('Graph time must be finite and seed must be an integer');
    return {time:t,seed:s};
  }
  clock(time,seed);
  const projectPlan={...header,kind:'plan',...rootPlan,time,seed,assets:assetInfo,exports,assertions:assertionSpecs,
    groups:Object.fromEntries([...preparedGroups].map(([name,{plan}])=>[name,plan])),
    groupDependencies:dependencyRows,hostOperations:Object.keys(operations).sort()};

  function artifactIdentity() {
    const usesCodec=[...assets.values()].some(asset=>asset.format==='codec') || exports.some(entry=>entry.format==='codec');
    const used=groupUsage(groupTree.scope,spec.nodes);
    const names=new Set();
    for (const body of [spec,...[...used].map(group=>groupSpecs.get(group))])
      for (const {op} of Object.values(body.nodes)) if (Object.hasOwn(operations,op)) names.add(op);
    const versions=[...names].sort().map(name=>[name,operations[name].cacheVersion]);
    const unversioned=versions.filter(([,id])=>!(typeof id==='string' && id.trim()) &&
      !(Number.isSafeInteger(id) && id>0)).map(([name])=>name);
    const registered=versions.map(([name,id])=>[name,unversioned.includes(name) ? null : id,...['run','instantiate','specialize'].map(method=>{
      const implementation=operations[name][method];
      return typeof implementation==='function' ? Function.prototype.toString.call(implementation) : null;
    })]);
    // Include declaration order and exact numbers alongside the existing project hash.
    return {fingerprint:fingerprint([projectHash,project,[...groupSpecs].map(([group,body])=>[group.alias,body]),
      dependencyRows,registered]),
      ...(usesCodec ? {reason:'host-codec'} : unversioned.length ? {reason:'unversioned-operation',operations:unversioned} : {})};
  }

  function describeScope(compiled,scope,overrides={}) {
    const {inputs,nodes,outputs}=compiled.plan({bindings:true});
    for (const [name,value] of Object.entries(overrides)) inputs[name].default=value;
    return {inputs,nodes:Object.fromEntries(nodes.map(({id,...node})=>{
      const group=groupFor(scope,node);
      return [id,{...node,...(group && {groupPath:group.alias}),
        ...(node.seed===undefined && Object.hasOwn(operations,node.op) && {seed:true})}];
    })),outputs,order:nodes.map(node=>node.id)};
  }

  const groupDetails=()=>Object.fromEntries([...preparedGroups].map(([name,{compiled,scope}])=>[name,describeScope(compiled,scope)]));

  function snapshot(options={}) {
    const {inputs={},time:at=time,seed:sampleSeed=seed}=fields(options,['inputs','time','seed'],'graph snapshot options');
    clock(at,sampleSeed);
    const values=Object.fromEntries(named(inputs,'input values').map(([name,value])=>{
      if (!Object.hasOwn(rootPlan.inputs,name)) throw new RangeError('Unknown graph input '+name);
      const type=rootPlan.inputs[name].type, types=kit.KIT.procedural.graphTypes;
      if (!types.validator(type)(value))
        throw new TypeError('Wrong input value for graph socket '+name+': expected '+types.description(type));
      return [name,value];
    }));
    return JSON.parse(jsonBytes({format:snapshotFormat,version,projectHash,settings:{seed:sampleSeed,time:at},
      graph:describeScope(compiled,groupTree.scope,values),
      groups:groupDetails(),
      assets:assetInfo, references:Object.fromEntries(dependencyRows.map(({group,used,...reference})=>[group,reference])),
      exports:exportsSpec,assertions:assertionSpecs}));
  }

  function request(options={}) {
    const {inputs={},take,time:t=take?.start ?? time,seed:s=seed}=fields(options,['inputs','time','seed','take'],'graph run options');
    const resolved=clock(t,s);
    if (take!==undefined) {
      takeTime.requireFrame(take);
      if (t!==take.start) throw new RangeError('Graph seconds must match the take frame start');
    }
    for (const [name] of named(inputs,'input values'))
      if (!Object.hasOwn(rootPlan.inputs,name)) throw new RangeError('Unknown graph input '+name);
    return {...resolved,take,inputs:compiled.parameters(snapshotInputs(inputs,data.clone))};
  }

  function execution() {
    let executable, previous=new Map();
    function reset() {
      try { executable?.clear(); }
      finally {
        executable=undefined;
        previous=new Map();
      }
    }

    let busy=false;
    function clear() {
      if (busy) throw new Error('Cannot clear a graph project during asynchronous evaluation');
      reset();
    }
    function start(inputs) {
      if (busy) throw new Error('An asynchronous graph project evaluation is already running');
      if (planAssets) throw new Error('Graph loaded for memory preflight. Open it normally to evaluate.');
      const values=Object.fromEntries(Object.entries(inputs).map(([name,value])=>{
        const prior=previous.get(name);
        return [name,sameValue(prior,value) ? prior : value];
      }));
      executable??=graph.create(spec,{operations:ops,groups});
      return values;
    }

    function done(frame,values,{time,seed,take}) {
      previous=new Map(Object.entries(values));
      return {frame,report:{...header,time,seed,...(take!==undefined && {take}),cache:cacheReport(frame),
        inputs:Object.fromEntries(Object.entries(values).map(([name,value])=>[name,describe(value)]))}};
    }
    function failed(error) {
      try { reset(); } catch { /* Preserve the evaluation error after discarding this instance. */ }
      throw error;
    }
    function evaluate({inputs,...options},sequence) {
      const values=start(inputs);
      try {
        return done(executable.evaluate(values,{...options,sequence,workers:workerPool}),values,options);
      } catch (error) { return failed(error); }
    }
    async function evaluateAsync({inputs,...options},profile) {
      const values=start(inputs);
      busy=true;
      try {
        return done(await executable.evaluateAsync(values,{...options,profile}),values,options);
      } catch (error) { return failed(error); }
      finally { busy=false; }
    }

    return {evaluate,evaluateAsync,clear};
  }
  const {evaluate,evaluateAsync,clear}=execution();

  function encode(name,value,format,settings={}) {
    const result=format==='codec' ? host.encode(settings.codec,value,settings) : undefined;
    const bytes=result?.bytes ?? (format==='png' ? imageBytes(value,settings.grayscale) :
      format==='wav' ? WAV.encode(value,settings) : jsonBytes(value));
    return {file:'artifacts/'+name+'.'+(result?.extension ?? format),format,sha256:sha256(bytes),bytes};
  }

  function encodeAtlas(name,value) {
    const {spriteAtlasManifest}=require('./sprite-atlas.js'), location='artifacts/'+name+'/', images=new Map();
    const manifest=spriteAtlasManifest(value,(width,height,rgba)=>{
      const bytes=PNG.encode(width,height,rgba,4), hash=sha256(bytes), file='images/'+hash+'.png';
      images.set(file,{file:location+file,format:'png',sha256:hash,bytes});
      return file;
    });
    const bytes=jsonBytes(manifest);
    return [...images.values(),{file:location+'atlas.json',format:'json',sha256:sha256(bytes),bytes}];
  }

  function run(prepared) {
    workerPool?.resetStats();
    const {frame,report}=evaluate(prepared);
    const {assertions:checks,passed}=prepareFrameChecks(frame);
    const artifacts=exports.flatMap(({name,output,format,...settings})=>{
      const value=frame.outputs[output], encoded=format==='atlas' ? encodeAtlas(name,value) : [encode(name,value,format,settings)];
      return encoded.map(artifact=>({name,output,...artifact}));
    });
    return {outputs:frame.outputs,artifacts,report:{...report,kind:'run',passed,assertions:checks,
      ...(workerPool && {workers:workerPool.stats()}),
      outputs:Object.fromEntries(Object.entries(frame.outputs).map(([name,value])=>[name,describe(value)])),
      artifacts:artifacts.map(({bytes,...entry})=>({...entry,bytes:bytes.length}))}};
  }

  function inspect(target,options) {
    const {output,node,port='value'}=fields(target,['output','node','port'],'graph inspection target');
    if ((output===undefined)===(node===undefined) || output!==undefined && !id(output) ||
        node!==undefined && (typeof node!=='string' || !node.split('/').every(id) || !id(port)))
      throw new TypeError('Inspect one named graph output or one node and port');
    workerPool?.resetStats();
    const {frame,report}=evaluate(request(options));
    const value=output!==undefined ? select(frame,output,[]).value : frame.preview(node,port);
    const {file,format,sha256,bytes}=preview(value)??{};
    return {value,artifacts:bytes ? [{file,format,sha256,bytes}] : [],
      report:{...report,kind:'inspect',target:output!==undefined ? {output} : {node,port},value:describe(value),
        ...(workerPool && {workers:workerPool.stats()}),
        artifacts:bytes ? [{file,format,sha256,bytes:bytes.length}] : []}};
  }

  async function previewFrame(targets, options, { profile = false } = {}) {
    const watches=named(targets,'patch previews');
    if (watches.length>64) throw new RangeError('A patch frame supports up to 64 previews');
    separateNames(watches.map(([name])=>name),'Patch previews');
    for (const [,target] of watches) {
      const {output,node,port}=fields(target,['output','node','port'],'patch preview');
      if ((output===undefined)===(node===undefined) || output!==undefined && (!id(output) || !Object.hasOwn(rootPlan.outputs,output)) ||
          node!==undefined && (typeof node!=='string' || !node.split('/').every(id) || port!==undefined && !id(port)))
        throw new TypeError('Patch preview needs a known output or node and port');
    }
    const {frame,report}=await evaluateAsync(request(options),profile);
    const results=watches.map(([name,{output,node,port}])=>{
      const value=output!==undefined ? frame.outputs[output] : frame.preview(node,port);
      const artifact=preview(value,{grayscale:true});
      return { name, value, artifact:artifact && {...artifact,file:'previews/'+name+'.'+artifact.format} };
    });
    const assertions=prepareFrameChecks(frame);
    return {outputs:frame.outputs,values:Object.fromEntries(results.map(({name,value})=>[name,value])),
      artifacts:results.flatMap(({artifact})=>artifact?[artifact]:[]),
      report:{...report,kind:'patch-frame',...assertions,...(frame.timings && {timingsMs:frame.timings}),
        previews:Object.fromEntries(results.map(({name,value,artifact})=>[name,{value:describe(value),
          ...(artifact && {file:artifact.file,sha256:artifact.sha256})}]))}};
  }
  function prepareFrameChecks(frame) {
    const checks=assertions.map(check=>check(frame));
    return {passed:checks.every(check=>check.passed),assertions:checks};
  }

  function preview(value, settings) {
    if (Number.isSafeInteger(value?.sampleRate) && value.samples) {
      try { return encode('preview',value,'wav'); }
      catch { /* Fall through to the generic data preview. */ }
    }
    if (Number.isSafeInteger(value?.width) && value.data) {
      try { return encode('preview',value,'png',settings); }
      catch { /* Numeric raster channels can be inspected as JSON. */ }
    }
    try { return encode('preview',value,'json'); }
    catch { return null; }
  }

  function planValue(value) {
    try { return data.clone(value); }
    catch { return describe(value); }
  }

  function prepareBatch(cases,defaults={}) {
    fields(defaults,['inputs','time','seed'],'graph batch defaults');
    if (defaults.inputs!==undefined) named(defaults.inputs,'batch input values');
    const sweep=Array.isArray(cases) ? null : sweepCases(cases,broadcast);
    const rows=sweep?.cases ?? cases;
    if (!rows.length) throw new TypeError('Graph batch needs a nonempty case array');
    const prepared=Array.from(rows,row=>{
      const {id:name,inputs={},...options}=fields(row,['id','inputs','time','seed'],'graph batch case');
      if (!id(name)) throw new TypeError('Graph batch case needs an ID');
      named(inputs,'case input values');
      const settings=request({...defaults,...options,inputs:{...defaults.inputs,...inputs}});
      return {id:name, requestKey:()=>fingerprint(settings), run:()=>run(settings)};
    });
    separateNames(prepared.map(row=>row.id),'Graph batch cases');
    return { cases:prepared, summarize(results) {
      return {...header,kind:'batch',passed:results.every(row=>row.report.passed),
        ...(sweep && {sweep:sweep.report}),
        cases:results.map(({id,report})=>({id,directory:'cases/'+id,...report}))};
    }};
  }

  return Object.freeze({
    sockets: compiled.sockets,
    plan(inputs,{memory=false}={}) {
      const resolved=inputs===undefined ? undefined : request({inputs}).inputs;
      return {...data.clone(projectPlan),
        ...(resolved && {resolvedInputs:Object.fromEntries(Object.entries(resolved).map(([name,value])=>[name,planValue(value)]))}),
        ...(memory && {memory:estimateGraphMemory({graph:describeScope(compiled,groupTree.scope),
          groups:groupDetails(),assets,overrides:resolved??{},kit,hostOperations:projectPlan.hostOperations})})};
    },
    validate(inputs) {
      if (inputs!==undefined) request({inputs});
      return {...header,kind:'validate',valid:true,nodes:rootPlan.expandedNodes,groups:preparedGroups.size};
    },
    dependencies:()=>({...header,kind:'dependencies',groups:data.clone(dependencyRows)}),
    artifactIdentity,
    snapshot,
    run:options=>run(request(options)),
    clip(options) {
      const { inputs, seed, ...settings } = fields(options,
        ['output','from','to','warmup','format','clock','renderOptions','capture','inputs','seed'], 'graph clip options');
      const requestOptions = request({inputs,seed});
      const runner = execution();
      workerPool?.resetStats();
      try {
        const result=clip(settings,{kit,plan:projectPlan,checks:assertions,seed:requestOptions.seed,
          sample(take,sequence) {
            return runner.evaluate({...requestOptions,time:take.start,take},sequence).frame;
          }});
        if (workerPool) result.report.workers=workerPool.stats();
        return result;
      } finally { runner.clear(); }
    },
    inspect,
    previewFrame,
    prepareBatch,
    batch(cases,defaults={}) {
      const batch=prepareBatch(cases,defaults);
      const results=batch.cases.map(row=>({id:row.id,...row.run()}));
      return {results,report:batch.summarize(results)};
    },
    clear,
    sourceFiles:()=>[...paths]
  });
}

function readGraphProject(file, options={}) {
  const sourceFile=path.resolve(file), document=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
  if (document?.format==='ink-studio/project-bundle') {
    const bundles=require('./project-bundle.js'), project=bundles.readProjectBundle(sourceFile);
    const take=project.takeDocument?.(), graph=take?.graph;
    if (!graph) throw new TypeError('Project bundle needs a take with a graph');
    const mounted=bundles.mountProject(project,entry=>readGraphProject(path.resolve(path.dirname(entry),graph),options));
    return Object.freeze({...mounted,takeClock:take.clock,sourceFiles:()=>[sourceFile]});
  }
  return createGraphProject(document,{...options,baseDir:path.dirname(sourceFile),sourceFile});
}

module.exports = { createGraphProject, readGraphProject, operationRegistry };
