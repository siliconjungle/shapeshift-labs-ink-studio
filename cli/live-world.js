const http=require('node:http');
const net=require('node:net');
const {setTimeout:delay}=require('node:timers/promises');
const {once}=require('node:events');
const Access=require('./live-access.js');

const usage='Use sim live <world|checkpoint|run> [--ticks N --queries queries.json --policy access.json --record run.json --step-ms N --linger-ms N --host IP --port N]';
const int=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const maxBytes=8*1024*1024;

async function serve(W,run,options,{until,queries,policy,playback,emit}) {
  const {check}=W.data, api=W.liveSnapshots, start=run.view().tick;
  const host=options.host??'127.0.0.1', port=Number(options.port??0);
  const stepMs=Number(options['step-ms']??run.view().world.dt*1000), linger=Number(options['linger-ms']??500);
  check([options.host,options.port,options['step-ms'],options['linger-ms']].every(value=>value===undefined||typeof value==='string'&&value.trim())&&
    net.isIP(host)&&int(port,0,65535)&&Number.isFinite(stepMs)&&stepMs>0&&stepMs<=60000&&int(linger,0,60000)&&
    int(until,start,W.runtime.maxTick),usage);
  const access=Access.create(W,run,{until,queries,policy,playback}), signal=new AbortController();
  let ended=false, busy=false;
  access.publish([]);
  function send(response,status,body,headers) {
    const bytes=JSON.stringify(body);
    response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','X-Ink-Ended':ended?'1':'0',...headers});
    response.end(bytes);
  }
  const server=http.createServer(async(request,response)=>{
    const principal=access.authorize(request.headers.authorization);
    if(!principal)return send(response,403,{error:'Expected a live world key'});
    try {
      const url=new URL(request.url,'http://localhost');
      if(request.method==='GET'&&url.pathname==='/permissions')
        return send(response,200,access.permissions(principal,!ended&&run.view().tick<until));
      if(request.method==='POST'&&url.pathname==='/intervene'){
        if(!principal.grants.size)return send(response,403,{error:'Intervention is not granted'});
        const input=await Access.readCommand(request);
        const result=input.status?input:access.submit(principal,input.command,{busy,ended:ended||signal.signal.aborted});
        if(input.status===413||input.status===415){
          request.resume();
          return send(response,result.status,result.body,{'Connection':'close'});
        }
        return send(response,result.status,result.body);
      }
      if (request.method!=='GET'||!['/snapshot','/live'].includes(url.pathname))
        return send(response,404,{error:'Unknown live world route'});
      const after=url.searchParams.get('after');
      if (url.pathname==='/live'&&(after===null||after.length>512)) return send(response,400,{error:'Expected a live cursor'});
      const cursor=url.pathname==='/snapshot'?null:JSON.parse(after);
      if (url.pathname==='/live'&&!api.validCursor(cursor)) return send(response,400,{error:'Invalid live cursor'});
      send(response,200,principal.publisher.pull(cursor));
    } catch {
      if(!response.headersSent&&!response.destroyed)send(response,400,{error:'Invalid live world request'});
    }
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
    await emit({event:'live-ready',url:'http://'+address+':'+server.address().port+'/',...access.ready(),tick:start});
    for(let tick=start+1;tick<=until;tick++) {
      await delay(stepMs,undefined,{signal:signal.signal});
      busy=true;
      await run.stepAsync();
      access.publish(run.committedEvents());
      busy=false;
    }
    ended=true;
    await emit({event:'live-end',...access.cursors()});
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

async function exchange(url,token,{stop,command,limit=maxBytes}={}) {
  const request=new AbortController(), abort=()=>request.abort();
  const timeout=setTimeout(abort,600);
  stop?.addEventListener('abort',abort,{once:true});
  if(stop?.aborted)abort();
  try {
    const headers={Authorization:'Bearer '+token};
    if(command)headers['Content-Type']='application/json';
    const response=await fetch(url,{headers,signal:request.signal,redirect:'error',
      ...(command&&{method:'POST',body:JSON.stringify(command)})});
    if(!response.ok){
      await response.body?.cancel();
      return {response};
    }
    const reader=response.body.getReader(), parts=[];
    let bytes=0;
    try {
      while(true) {
        const {value,done}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>limit)throw new Error('Live world packet exceeds its byte budget');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(()=>{}); }
    return {response,body:JSON.parse(Buffer.concat(parts,bytes).toString('utf8'))};
  } finally {
    clearTimeout(timeout);
    stop?.removeEventListener('abort',abort);
  }
}

async function propose(W,{url,token},command) {
  try {
    const {response,body}=await exchange(new URL('intervene',url),token,{command,limit:4096});
    const httpStatus=response.status;
    if(!response.ok)return {status:httpStatus>=500?'unconfirmed':'rejected',httpStatus};
    if(httpStatus===202&&body?.status==='scheduled'&&body.id===command.id&&body.request===command.request&&
      W.data.id(body.command)&&int(body.tick,1,W.runtime.maxTick))
      return {status:'scheduled',httpStatus,receipt:{command:body.command,tick:body.tick}};
    return {status:'unconfirmed',httpStatus};
  } catch { return {status:'unconfirmed'}; }
}

function feed(W,{url,token},onState) {
  const api=W.liveSnapshots, stop=new AbortController();
  let cursor=null, pending, job, ended=false;
  async function pull() {
    const target=new URL(cursor?'live':'snapshot',url);
    if(cursor)target.searchParams.set('after',JSON.stringify(cursor));
    try {
      const {response,body:packet}=await exchange(target,token,{stop:stop.signal});
      if(!response.ok)throw new Error('Live world returned HTTP '+response.status);
      if(!api.validPacket(packet)||!api.equal(packet.base,cursor))throw new Error('Live world packet has an invalid baseline');
      pending=packet;
      ended=response.headers.get('x-ink-ended')==='1';
      onState(ended?'ended':'online');
    } catch(error) {
      if(!stop.signal.aborted)onState('offline',error.message);
    }
  }
  function warm() {
    if (!job&&!pending&&!ended&&!stop.signal.aborted) job=pull().finally(()=>{job=undefined;});
    return job;
  }
  return {warm,cursor:()=>cursor,sample(){
    const packet=pending??null;
    if(packet)cursor=packet.cursor;
    pending=undefined;
    warm();
    return packet;
  },async close(){stop.abort();await job;}};
}

module.exports={serve,feed,propose,usage};
