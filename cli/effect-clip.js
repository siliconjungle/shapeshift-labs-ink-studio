/* Compile editable cue lanes into an ordinary reusable Ink graph. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash}=require('node:crypto');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const {createGraphProject} = require('./graph-project.js');
const format = 'ink-studio/effect-clip';
const groupFormat = 'ink-studio/graph-group';
const graphFormat = 'ink-studio/graph-project';
const check = (condition,message) => { if (!condition) throw new RangeError('Effect clip: '+message); };
const record = value => value && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const own = Object.hasOwn;
const id = key => typeof key === 'string' && /^[a-z][\w.-]{0,79}$/i.test(key) &&
  !['constructor','prototype','__proto__'].includes(key);
const label = value => typeof value === 'string' && value.trim() && value.length <= 120;
const bounded = (value,min,max) => Number.isFinite(value) && value >= min && value <= max;
const maxPins = 8;
const cueInput = name => 'cue-'+name;
const keysInput = name => 'lane-keys-'+name;
const laneNode = name => 'lane-'+name;

function fields(value,keys,desc) {
  check(record(value) && Object.keys(value).every(key=>keys.includes(key)),'invalid '+desc);
  return value;
}

function named(value,max,desc) {
  check(record(value),desc+' must be a named table');
  const rows=Object.entries(value);
  check(rows.length<=max && rows.every(([name])=>id(name)),desc+' needs bounded entries with valid IDs');
  return rows;
}

function parse(source, kit) {
  const {format:kind,version,id:name,title=name,revision=1,duration,fps=24,cues={},parameters={},
    lanes={},graph,previews={},pins} = fields(source,
    ['format','version','id','title','revision','duration','fps','cues','parameters','lanes','graph','previews','pins'],'document');
  check(kind===format && version===1 && id(name) && label(title) && Number.isSafeInteger(revision) && revision>0,
    'expected a version 1 document with an ID and positive revision');
  check(bounded(duration,.001,600),'duration must be between .001 and 600 seconds');
  const time=kit.KIT.procedural.takeTime;
  const ratio=time.read(fps), rate=time.seconds(ratio);
  check(bounded(rate,1,120),'picture rate must be between 1 and 120 fps');
  fields(graph,['inputs','nodes','outputs','groups','assets','assetRegistry'],'graph');
  named(graph.nodes,1800,'graph nodes');
  const outputs=named(graph.outputs,128,'graph outputs');
  check(outputs.length>0,'graph needs a named output');
  const cueTable=Object.fromEntries(named(cues,64,'cues').map(([name,row])=>{
    const {at,label:caption=name}=fields(row,['at','label'],'cue '+name);
    check(label(caption)&&bounded(at,0,duration),'cue '+name+' must be inside the clip');
    return [name,{label:caption,at}];
  }));
  const numberTable=(table,desc,valueName) => Object.fromEntries(named(table,64,desc).map(([name,entry])=>{
    const {min=0,max=1,step=.01,label:caption=name,[valueName]:value}=fields(entry,
      ['min','max','step','label',valueName],desc+' '+name);
    check(label(caption)&&bounded(min,-1e9,1e9)&&bounded(max,-1e9,1e9)&&max>min&&
      bounded(step,1e-9,max-min),'invalid bounds for '+name);
    if(valueName==='default')check(bounded(value,min,max),'parameter '+name+' is outside its bounds');
    else check(Array.isArray(value)&&value.every(key=>bounded(key?.value,min,max)),'lane '+name+' keys are outside their bounds');
    return [name,{label:caption,min,max,step,[valueName]:value}];
  }));
  const parametersTable=numberTable(parameters,'parameters','default');
  const laneTable=numberTable(lanes,'lanes','keys');
  const targets=Object.fromEntries(outputs.map(([output])=>[output,{output,label:output}]));
  for(const [name,target] of named(previews,64,'previews')){
    const {label:caption=name,output,node,port,range}=fields(target,['label','output','node','port','range'],'preview '+name);
    check(label(caption)&&((id(output)&&own(graph.outputs,output)&&node===undefined&&port===undefined) ||
      (output===undefined&&typeof node==='string'&&node.split('/').every(id)&&(port===undefined||id(port)))),
    'preview '+name+' must select a graph output or node port');
    if(range!==undefined)check(Array.isArray(range)&&range.length===2&&Array.from(range).every(Number.isFinite)&&
      range[1]>range[0]&&Number.isFinite(range[1]-range[0]),'preview '+name+' needs an increasing display range');
    targets[name]={label:caption,...(output===undefined?{node,port:port??'value'}:{output})};
  }
  const checkedPins=pins??Object.keys(targets).slice(0,4);
  check(Array.isArray(checkedPins)&&checkedPins.length>0&&checkedPins.length<=maxPins&&
    new Set(checkedPins).size===checkedPins.length&&Array.from(checkedPins).every(name=>own(targets,name)),
  'pin one to '+maxPins+' distinct previews');
  return {
    format,version:1,id:name,title,revision,duration,fps:time.pack(ratio),cues:cueTable,parameters:parametersTable,
    lanes:laneTable,graph,previews,pins:checkedPins
  };
}

function evaluateTracks(clip,kit) {
  const cueTimes=Object.fromEntries(Object.entries(clip.cues).map(([name,{at}])=>[name,at]));
  const tracks=Object.fromEntries(Object.entries(clip.lanes).map(([name,{keys}])=>{
    try { return [name,kit.KIT.procedural.animationGraph.cueTrack({cues:cueTimes,keys,duration:clip.duration})]; }
    catch(error) { throw new RangeError('Effect clip lane '+name+': '+error.message,{cause:error}); }
  }));
  return {cueTimes,tracks};
}

function graphInputs(clip) {
  const entries=[
    ...Object.entries(clip.cues).map(([name,{at,label}])=>[cueInput(name),{type:'seconds',default:at,description:label}]),
    ...Object.entries(clip.parameters).map(([name,{default:value,label}])=>[name,{type:'number',default:value,description:label}]),
    ...Object.entries(clip.lanes).map(([name,{keys,label}])=>[keysInput(name),
      {type:'array<record>',default:keys,description:label+' keyframes'}])
  ];
  check(new Set(entries.map(([name])=>name)).size===entries.length,'cue, lane-key and parameter inputs must have unique names');
  return Object.fromEntries(entries);
}

function makeGroup(clip) {
  const {inputs={},nodes,outputs,groups}=clip.graph;
  const allInputs=Object.fromEntries(named(inputs,512,'graph inputs'));
  for(const [name,socket] of Object.entries(graphInputs(clip))){
    check(!own(allInputs,name),'graph input is reserved for the effect editor: '+name);
    allInputs[name]=socket;
  }
  const allNodes={...nodes};
  const put=(name,node)=>{
    check(!own(allNodes,name),'node ID is reserved for the effect editor: '+name);
    allNodes[name]=node;
  };
  if (Object.keys(clip.lanes).length) put('effect-cues',{ op:'data.record',
    inputs:Object.fromEntries(Object.keys(clip.cues).map(name=>[name,{input:cueInput(name)}]))
  });
  for(const name of Object.keys(clip.lanes))put(laneNode(name),{
    op:'anim.cueTrack',inputs:{cues:{node:'effect-cues'},keys:{input:keysInput(name)},duration:clip.duration}
  });
  return {format:groupFormat,version:1,revision:clip.revision,inputs:allInputs,nodes:allNodes,outputs,...(groups&&{groups})};
}

function containingProject(group,graph,embedded) {
  const {assets,assetRegistry}=graph;
  const media={...(assets&&{assets}),...(assetRegistry!==undefined&&{assetRegistry})};
  const {format:_format,version:_version,revision:_revision,...body}=group;
  if(embedded===undefined)return {format:graphFormat,version:1,...media,...body};
  return {
    format:graphFormat,version:1,...media,inputs:group.inputs,groups:{ Effect:{file:embedded,revision:group.revision} },
    nodes:{effect:{op:'Effect',inputs:Object.fromEntries(Object.keys(group.inputs).map(name=>[name,{input:name}]))}},
    outputs:Object.fromEntries(Object.keys(group.outputs).map(name=>[name,{node:'effect',port:name}]))
  };
}

function rebase(clip, base, destination, kit) {
  const rewrite = file => destination===null ? path.resolve(base,file) :
    path.relative(destination,path.resolve(base,file)).split(path.sep).join('/');
  function groups(table){
    return Object.fromEntries(Object.entries(table).map(([name,group])=>{
      if(typeof group==='string')return [name,rewrite(group)];
      if(own(group,'file'))return [name,{...group,file:rewrite(group.file)}];
      return [name,group.groups?{...group,groups:groups(group.groups)}:group];
    }));
  }
  const graph={...clip.graph};
  if(graph.groups)graph.groups=groups(graph.groups);
  if(destination===null && typeof graph.assetRegistry==='string'){
    const {scope,graphKinds}=require('./asset-references.js');
    const api=kit.KIT.authoring.assetReferences;
    const resolve=scope(api,path.join(base,'effect.json'),graph.assetRegistry);
    graph.assets=Object.fromEntries(Object.entries(graph.assets??{}).map(([name,entry])=>[
      name,api.isRef(entry.file)?{...entry,file:resolve(entry.file,graphKinds(entry.format)).filename}:entry
    ]));
    delete graph.assetRegistry;
  }
  if(graph.assets)graph.assets=Object.fromEntries(Object.entries(graph.assets).map(([name,entry])=>
    [name,typeof entry.file==='string'?{...entry,file:rewrite(entry.file)}:entry]));
  if(typeof graph.assetRegistry==='string')graph.assetRegistry=rewrite(graph.assetRegistry);
  return {...clip,graph};
}

function scalarPreview(name,value,range) {
  const {width,height,channels,data}=value??{};
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
     (channels??1)!==1||data?.length!==width*height||data.length>2**24)return null;
  if(range===undefined&&(data instanceof Uint8Array||data instanceof Uint8ClampedArray))return null;
  const [min,max]=range??[0,1];
  const gray=Uint8Array.from(data,n=>Math.round(Math.min(1,Math.max(0,(n-min)/(max-min)))*255));
  const bytes=PNG.encodeGray(width,height,gray);
  return {file:'previews/'+name+'.png',format:'png',bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}

function createEffectClip(source, {kit=require('..').load(),baseDir=process.cwd(),sourceFile,operations,adapters} = {}) {
  const {clone,freeze}=kit.KIT.procedural.data;
  let current=freeze(parse(clone(source),kit));
  let sampled=evaluateTracks(current,kit);
  const project=createGraphProject(containingProject(makeGroup(current),current.graph),{kit,baseDir,sourceFile,operations,adapters});
  project.validate();
  const initial=current;

  function previewTargets(clip) {
    const targets=Object.fromEntries(Object.keys(clip.graph.outputs).map(output=>[output,{output,label:output}]));
    for(const [name,{label=name,...select}] of Object.entries(clip.previews))targets[name]={label,...select};
    return targets;
  }
  const catalog=freeze(previewTargets(current));
  let revision=0;
  function edit(change) {
    const {cues={},parameters={},lanes={},pins}=fields(change,['cues','parameters','lanes','pins'],'edit');
    const next = {...current};
    function replace(key,updates,field) {
      const copy={...next[key]};
      for(const [name,value] of named(updates,64,key+' edit')){
        check(own(copy,name),'unknown '+key+' entry '+name);
        copy[name]={...copy[name],[field]:clone(value)};
      }
      next[key]=copy;
    }
    replace('cues',cues,'at');
    replace('parameters',parameters,'default');
    replace('lanes',lanes,'keys');
    if(pins!==undefined)next.pins=clone(pins);
    const checked=parse(next,kit), tracks=evaluateTracks(checked,kit);
    current=freeze(checked);
    sampled=tracks;
    revision++;
    return current;
  }

  function inputValues(clip) {
    return Object.fromEntries(Object.entries(graphInputs(clip)).map(([name,socket])=>[name,socket.default]));
  }
  function sample(time) {
    check(bounded(time,0,current.duration),'playhead is outside the clip');
    return Object.fromEntries(Object.entries(sampled.tracks).map(([lane,track])=>[lane,track.sample(time)]));
  }
  function state() {
    const {graph,previews,...clip}=current;
    return {...clip, previews:catalog, revision,
      authoredRevision:current.revision,eases:kit.KIT.anim.keyframeTrack.eases,
      resolved:Object.fromEntries(Object.entries(sampled.tracks).map(([name,track])=>[name,track.keys.map(key=>key.time)]))};
  }
  async function preview(time,{seed,pins=current.pins}={}) {
    const values=sample(time), clip=current, editNumber=revision;
    check(Array.isArray(pins)&&pins.length>0&&pins.length<=maxPins&&new Set(pins).size===pins.length&&
      Array.from(pins).every(name=>own(catalog,name)),'preview needs known distinct pins');
    const targets=Object.fromEntries(pins.map(name=>{
      const {label,range,...select}=catalog[name];
      return [name,select];
    }));
    const result=await project.previewFrame(targets,{time,seed,inputs:inputValues(clip)});
    const entries=new Map(result.artifacts.map(asset=>[asset.file,asset]));
    const previews={...result.report.previews};
    for(const name of pins){
      const asset=scalarPreview(name,result.values[name],catalog[name].range);
      if(!asset)continue;
      entries.delete(previews[name].file);
      entries.set(asset.file,asset);
      previews[name]={...previews[name],file:asset.file,sha256:asset.sha256,range:catalog[name].range??[0,1]};
    }
    return {...result, artifacts:[...entries.values()],
      report:{...result.report,previews,time,revision:editNumber,pins,lanes:values}};
  }
  function documents(directory) {
    const clip=directory===undefined?current:rebase(current,baseDir,directory===null?null:path.resolve(directory),kit);
    const group=makeGroup(clip);
    return {clip,group,project:containingProject(group,clip.graph,clip.id+'.group.json')};
  }

  function exportTo(directory) {
    directory=path.resolve(directory);
    const docs=documents(directory);
    const names={clip:current.id+'.effect.json',group:current.id+'.group.json',project:current.id+'.project.json'};
    const dependencies=new Set(project.sourceFiles().map(file=>fs.realpathSync(file)));
    for(const file of Object.values(names)){
      const target=path.join(directory,file);
      check(!fs.existsSync(target)||!dependencies.has(fs.realpathSync(target)),'export would overwrite a clip dependency');
    }
    for(const [kind,file] of Object.entries(names))files.json(path.join(directory,file),docs[kind]);
    return {directory,files:names};
  }
  return Object.freeze({ snapshot:()=>current, state, edit, sample, preview, documents, export:exportTo, clear:project.clear,
    reset() { current=initial; sampled=evaluateTracks(initial,kit); revision++; return current; }
  });
}

function readEffectClip(file,options={}) {
  const sourceFile=path.resolve(file);
  check(fs.statSync(sourceFile).size<=2*1024*1024,'document exceeds 2 MiB');
  return createEffectClip(JSON.parse(fs.readFileSync(sourceFile,'utf8')),
    {...options,sourceFile,baseDir:path.dirname(sourceFile)});
}

module.exports={ createEffectClip,readEffectClip };
