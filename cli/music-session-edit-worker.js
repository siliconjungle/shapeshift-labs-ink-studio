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
    function prepare(session,edits) {
      if (failure) return Promise.reject(failure);
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        worker.postMessage({id,session,edits});
        pending.set(id,{resolve,reject});
      });
    }
    return {prepare,close:()=>worker.terminate()};
  };
} else {
  const P=require('..').load().KIT.procedural;
  const {readAssets}=require('./music-mixer.js');
  const host=workerData.hostFile===undefined ? undefined : require('./clap-adapter').load(workerData.hostFile);
  const editor=P.mediaGraph.musicSession.create(readAssets(workerData.paths,workerData.file,P),host), shared=new WeakMap();
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
  parentPort.on('message',({id,session,edits})=>{
    try {
      const prepared=editor.prepareLive(edits===undefined ? session : editor.edit(session,edits));
      for (const {materials} of Object.values(prepared.media ?? {})) for (const row of Object.values(materials)) {
        const {dry,roomLevel,echoLevel}=row.value;
        row.value={...row.value,dry:{...dry,samples:share(dry.samples)},roomLevel:share(roomLevel),echoLevel:share(echoLevel)};
      }
      parentPort.postMessage({id,value:prepared});
    } catch (error) { parentPort.postMessage({id,error:error.message}); }
  });
}
