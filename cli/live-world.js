const http=require('node:http');
const net=require('node:net');
const {randomBytes,randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {once}=require('node:events');

const usage='Use sim live <world|checkpoint|run> [--ticks N --queries queries.json --step-ms N --linger-ms N --host IP --port N]';
const int=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const maxBytes=8*1024*1024;

async function serve(W,run,options,{until,queries,emit}) {
  const {check}=W.data, api=W.liveSnapshots, start=run.view().tick;
  const host=options.host??'127.0.0.1', port=Number(options.port??0);
  const stepMs=Number(options['step-ms']??run.view().world.dt*1000), linger=Number(options['linger-ms']??500);
  check([options.host,options.port,options['step-ms'],options['linger-ms']].every(value=>value===undefined||typeof value==='string'&&value.trim())&&
    net.isIP(host)&&int(port,0,65535)&&Number.isFinite(stepMs)&&stepMs>0&&stepMs<=60000&&int(linger,0,60000)&&
    int(until,start,W.runtime.maxTick),usage);
  const stream=randomUUID(), token=randomBytes(24).toString('hex'), publisher=api.create({stream});
  const probes=W.graphPorts.queries(queries), signal=new AbortController();
  let ended=false;
  const publish=effects=>publisher.publish(W.graphPorts.frameOf(run.view(),run.query(),probes,{events:effects}));
  publish([]);
  function send(response,status,body) {
    const bytes=JSON.stringify(body);
    response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','X-Ink-Ended':ended?'1':'0'});
    response.end(bytes);
  }
  const server=http.createServer((request,response)=>{
    if (request.headers.authorization!=='Bearer '+token) return send(response,403,{error:'Expected the live world key'});
    try {
      const url=new URL(request.url,'http://localhost');
      if (request.method!=='GET'||!['/snapshot','/live'].includes(url.pathname))
        return send(response,404,{error:'Unknown live world route'});
      const after=url.searchParams.get('after');
      if (url.pathname==='/live'&&(after===null||after.length>512)) return send(response,400,{error:'Expected a live cursor'});
      const cursor=url.pathname==='/snapshot'?null:JSON.parse(after);
      if (url.pathname==='/live'&&!api.validCursor(cursor)) return send(response,400,{error:'Invalid live cursor'});
      send(response,200,publisher.pull(cursor));
    } catch (error) { if (!response.headersSent) send(response,400,{error:error.message}); }
  });
  server.requestTimeout=5000;
  server.maxConnections=64;
  const stop=()=>signal.abort();
  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);
  try {
    server.listen(port,host);
    await once(server,'listening');
    const address=host.includes(':')?'['+host+']':host;
    await emit({event:'live-ready',url:'http://'+address+':'+server.address().port+'/',stream,token,tick:start});
    for(let tick=start+1;tick<=until;tick++) {
      await delay(stepMs,undefined,{signal:signal.signal});
      await run.stepAsync();
      publish(run.committedEvents());
    }
    ended=true;
    await emit({event:'live-end',cursor:publisher.cursor()});
    await delay(linger,undefined,{signal:signal.signal});
  } catch(error) {
    if (!signal.signal.aborted||error.name!=='AbortError') throw error;
  } finally {
    process.off('SIGINT',stop);
    process.off('SIGTERM',stop);
    const closed=new Promise(resolve=>server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
}

function feed(W,{url,token},onState) {
  const api=W.liveSnapshots, stop=new AbortController();
  let cursor=null, pending, job, ended=false;
  async function pull() {
    const target=new URL(cursor?'live':'snapshot',url);
    if(cursor)target.searchParams.set('after',JSON.stringify(cursor));
    const request=new AbortController(), abort=()=>request.abort();
    const timeout=setTimeout(abort,600);
    stop.signal.addEventListener('abort',abort,{once:true});
    try {
      const response=await fetch(target,{headers:{Authorization:'Bearer '+token},signal:request.signal,redirect:'error'});
      if(!response.ok)throw new Error('Live world returned HTTP '+response.status);
      const reader=response.body.getReader(), parts=[];
      let bytes=0;
      try {
        while(true) {
          const {value,done}=await reader.read();
          if(done) break;
          bytes+=value.byteLength;
          if(bytes>maxBytes) throw new Error('Live world packet exceeds its byte budget');
          parts.push(value);
        }
      } finally { await reader.cancel().catch(()=>{}); }
      const packet=JSON.parse(Buffer.concat(parts,bytes).toString('utf8'));
      if(!api.validPacket(packet)||!api.equal(packet.base,cursor))throw new Error('Live world packet has an invalid baseline');
      pending=packet;
      ended=response.headers.get('x-ink-ended')==='1';
      onState(ended?'ended':'online');
    } catch(error) {
      if(!stop.signal.aborted)onState('offline',error.message);
    } finally {
      clearTimeout(timeout);
      stop.signal.removeEventListener('abort',abort);
    }
  }
  function warm() {
    if (!job&&!pending&&!ended&&!stop.signal.aborted) job=pull().finally(()=>{job=undefined;});
    return job;
  }
  return {warm,sample(){
    const packet=pending??null;
    if(packet)cursor=packet.cursor;
    pending=undefined;
    warm();
    return packet;
  },async close(){stop.abort();await job;}};
}

module.exports={serve,feed,usage};
