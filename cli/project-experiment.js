/* Verify an archived experiment using only the native runners and packaged files. */
const fs=require('node:fs'),path=require('node:path');
const Schema=require('./experiment-schema.js');
const {readProjectBundle,mountProject,experimentToolkit}=require('./project-bundle.js');
const {resolveCheckpoint}=require('./checkpoint-file.js'),{embedModels}=require('./simulation-model-files.js');
const Measurements=require('./simulation-measurements.js');

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pointer=key=>String(key).replace(/~/g,'~0').replace(/\//g,'~1');
const shape=value=>Array.isArray(value)?{type:'array',length:value.length}:value&&typeof value==='object'?
  {type:'record',fields:Object.keys(value).slice(0,16)}:typeof value==='string'?value.slice(0,256):value;

function compare(actual,expected,{absolute=0,relative=0}={}){
  let checked=0;
  function inspect(a,b,at,depth){
    if(depth>256)throw new RangeError('Experiment result exceeds the comparison depth budget');
    if(typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)){
      checked++;
      const delta=Math.abs(a-b),scale=Math.max(Math.abs(a),Math.abs(b));
      const limit=Math.max(absolute,relative*scale);
      if(Number.isFinite(delta)?delta<=limit:Math.abs(a/scale-b/scale)<=relative)return null;
      return {path:at,reason:'numeric',actual:a,expected:b,error:Number.isFinite(delta)?delta:null,
        tolerance:Number.isFinite(limit)?limit:null};
    }
    if(a===b){checked++;return null;}
    const aa=Array.isArray(a), ab=Array.isArray(b);
    if(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&aa===ab){
      if(aa&&a.length!==b.length)return {path:at,reason:'length',actual:a.length,expected:b.length};
      const keys=aa?null:[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
      for(let i=0;i<(aa?a.length:keys.length);i++){
        const key=aa?i:keys[i], child=at+'/'+pointer(key);
        if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))return {path:child,reason:'key',
          actual:Object.hasOwn(a,key)?shape(a[key]):null,expected:Object.hasOwn(b,key)?shape(b[key]):null};
        const diff=inspect(a[key],b[key],child,depth+1);
        if(diff)return diff;
      }
      return null;
    }
    return {path:at,reason:'value',actual:shape(a),expected:shape(b)};
  }
  return {difference:inspect(actual,expected,'',0),checked};
}

function replay(kit,directory,project,recipe){
  const W=kit.KIT.world,{read:get,selector,check}=W.data;
  const bundled=new Set(project.files().map(file=>path.resolve(directory,file)));
  const locate=reference=>{
    const filename=kit.KIT.authoring.projectBundles.resolvePath(project.metadata.entry,reference);
    const target=path.join(directory,filename);
    dependency(target);
    return target;
  };
  function dependency(filename){
    const target=path.resolve(filename);
    if(!bundled.has(target))throw new TypeError('Experiment replay needs a packaged dependency: '+path.relative(directory,target));
    if(/\.(?:js|mjs|cjs|node)$/i.test(target))throw new TypeError('Experiment replay uses native declarative solvers');
  }

  return Object.fromEntries(Object.entries(recipe.runs).map(([name,row])=>{
    const evidence={kind:row.kind,source:row.source,expected:row.expected,...(row.select!==undefined&&{select:row.select}),
      ...(row.checkpoint!==undefined&&{checkpoint:row.checkpoint})};
    try{
      const file=locate(row.source), input=read(file), expected=read(locate(row.expected));
      let actual, cursor;
      if(row.kind==='model'){
        const model=embedModels(input,file,dependency), checkpointFile=row.checkpoint&&locate(row.checkpoint);
        const checkpoint=checkpointFile?resolveCheckpoint(checkpointFile,read(checkpointFile),{onBlock:dependency}):undefined;
        const commands=row.commands&&read(locate(row.commands));
        const session=W.models.session(model,{checkpoint,commands,checkpointCache:0});
        session.seek(row.tick);
        actual=W.models.sample(session);
        cursor={from:checkpoint?.tick??0,to:actual.tick,seed:model.seed,modelRevision:model.revision};
      }else if(row.kind==='native'){
        check(Schema.nativeFormats.has(input?.format),'Choose a supported native experiment run');
        actual=Measurements.sourceResolver(kit,file,dependency).solve({file,value:input},'native');
        if(Number.isSafeInteger(actual.start)&&Number.isSafeInteger(actual.end))
          cursor={from:actual.start,to:actual.end};
      }else if(row.kind==='measure')actual=Measurements.run(kit,input,file,dependency);
      else if(row.kind==='fit')actual=require('./parameter-fit.js').run(kit,input,file,dependency);
      else actual=require('./modal-resonator.js').bake(kit,input,file,dependency);
      const selected=row.select===undefined?actual:get(actual,selector(row.select));
      check(selected!==undefined,'Experiment result path is missing');
      const normalized=JSON.parse(JSON.stringify(selected,(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value));
      const {difference,checked}=compare(normalized,expected,row.tolerance??{});
      return [name,{...evidence,status:difference?'different':'matched',passed:!difference,checked,
        ...(cursor&&{cursor}),...(difference&&{difference})}];
    }catch(error){
      // The temporary archive mount has no meaning to consumers of a saved report.
      const message=String(error.message??error).split(directory+path.sep).join('');
      return [name,{...evidence,status:'error',passed:false,error:message}];
    }
  }));
}

function verify(file,{compareEngine=false}={}){
  if(typeof compareEngine!=='boolean')throw new TypeError('Invalid experiment engine comparison option');
  const project=typeof file==='string'?readProjectBundle(file):file;
  if(project.metadata.kind!=='experiment')throw new TypeError('Project verification needs a packed simulation experiment');
  const recipe=Schema.validate(project.experimentDocument()), expected=project.metadata.toolkit, actual=experimentToolkit();
  const engine={matched:Object.keys(expected).every(key=>expected[key]===actual[key]),expected,actual,compareEngine};
  const base={format:Schema.reportFormat,version:1,id:recipe.id,revision:recipe.revision??1,
    files:project.files().length,engine};
  if(!engine.matched&&!compareEngine)return {...base,status:'engine-mismatch',passed:false,runs:{}};
  const kit=require('../index.js').load();
  const runs=mountProject(project,(_,directory)=>replay(kit,directory,project,recipe));
  const passed=Object.values(runs).every(row=>row.passed);
  return {...base,status:passed?'matched':'diverged',passed,runs};
}

module.exports={verify};
