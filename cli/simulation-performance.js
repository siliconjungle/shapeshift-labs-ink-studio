/* Run an authored simulation budget on the Node host's monotonic clock. */
const fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks'),{embedModels}=require('./simulation-model-files.js');
const {embedStoryDocuments}=require('./story-document.js');

function run(kit,file,{destination,dependency=()=>{}}={}){
  const W=kit.KIT.world,{check}=W.data, owner=path.resolve(file);
  const read=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
  const actual=filename=>fs.existsSync(filename)?fs.realpathSync(filename):filename;
  const output=destination===undefined?undefined:actual(path.resolve(destination));
  const visited=new Set();
  function register(filename){
    check(actual(filename)!==output,'Performance report must be separate from its source assets');
    if(visited.has(filename))return;
    visited.add(filename);dependency(filename);
  }
  register(owner);
  const documents=new Map();
  function resolve(reference,mode){
    check(!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),'Performance source paths must be relative to the plan');
    const file=path.resolve(path.dirname(owner),reference);
    if(!documents.has(file)){
      register(file);
      let value=embedModels(read(file),file,register);
      if(value?.format===W.format)value=embedStoryDocuments(value,file,register);
      if(value?.dataInputs!==undefined)value={...value,dataInputs:require('./data-inputs.js')
        .embed(kit.KIT.dataInputs,value.dataInputs,file,register)};
      documents.set(file,value);
    }
    const document=documents.get(file), model=document?.format===W.models.format;
    check(mode==='blocks'?model:model||document?.format===W.format,
      'Performance case needs a native '+(mode==='blocks'?'block model':'world or model')+' JSON asset');
    return document;
  }
  const report=W.performanceBudgets.run(read(owner),{resolve,now:()=>performance.now(),memory:()=>process.memoryUsage()});
  return {...report,host:{runtime:'node',version:process.version,platform:process.platform,arch:process.arch,clock:'performance.now'}};
}

module.exports={run};
