const {Worker,isMainThread,workerData,parentPort}=require('node:worker_threads');

if (isMainThread) {
  module.exports=function createPreparer(file,paths,hostFile) {
    const worker=new Worker(__filename,{workerData:{file,paths,hostFile}});
    const pending=new Map();
    let sequence=0, failure;
    worker.on('message',({id,value,error})=>{
      const job=pending.get(id);
      pending.delete(id);
      if (error) job.reject(new RangeError(error));
      else job.resolve(value);
    });
    function stop(error) {
      failure=error;
      for (const job of pending.values()) job.reject(error);
      pending.clear();
    }
    worker.on('error',stop);
    worker.on('exit',code=>stop(new Error('Session preparation worker ended ('+code+')')));
    function request(message) {
      if (failure) return Promise.reject(failure);
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        worker.postMessage({id,...message});
        pending.set(id,{resolve,reject});
      });
    }
    return {
      prepare:(session,edits,asset)=>request({session,edits,asset}),
      searchSounds:(session,state,query)=>request({session,search:{state,query}}),
      discardAsset:name=>worker.postMessage({discard:name}),close:()=>worker.terminate()
    };
  };
} else {
  const P=require('..').load().KIT.procedural;
  const path=require('node:path');
  const {readAssets}=require('./music-mixer.js');
  const {createSoundBrowser}=require('./music-sound-browser.js');
  const host=workerData.hostFile===undefined ? undefined : require('./clap-adapter').load(workerData.hostFile);
  const assets=readAssets(workerData.paths,workerData.file,P), shared=new WeakMap();
  const paths=Object.fromEntries(Object.entries(workerData.paths).map(([name,file])=>[name,path.resolve(path.dirname(workerData.file),file)]));
  const editor=P.mediaGraph.musicSession.create(assets,host);
  let browser;
  function drop(name) {
    editor.discardAsset(name);
    delete assets[name];
  }
  function share(pcm) {
    if (!pcm) return pcm;
    let value=shared.get(pcm);
    if (!value) {
      value=new Float32Array(new SharedArrayBuffer(pcm.byteLength));
      value.set(pcm);
      shared.set(pcm,value);
    }
    return value;
  }
  parentPort.on('message',({id,session,edits,asset,discard,search})=>{
    if (discard) {drop(discard);return;}
    const added=[];
    try {
      if (search) {
        browser ??= createSoundBrowser(P,assets,paths);
        parentPort.postMessage({id,value:browser.search(session,search.state,search.query)});
        return;
      }
      for (const {name,pcm} of [].concat(asset ?? [])) {
        editor.addAsset(name,pcm);
        assets[name]=pcm;
        added.push(name);
      }
      const prepared=editor.prepareLive(edits===undefined ? session : editor.edit(session,edits));
      for (const {materials} of Object.values(prepared.media ?? {})) for (const row of Object.values(materials)) {
        const {dry,roomLevel,echoLevel}=row.value;
        row.value={...row.value,dry:{...dry,samples:share(dry.samples)},roomLevel:share(roomLevel),echoLevel:share(echoLevel)};
      }
      parentPort.postMessage({id,value:prepared});
    } catch (error) {
      for (const name of added) drop(name);
      parentPort.postMessage({id,error:error.message});
    }
  });
}
