const {randomBytes,randomUUID}=require('node:crypto');

const maxBody=4096, maxReceipts=4096, maxPerTick=32;
const denial=(status,error)=>({status,body:{error}});

async function readCommand(request) {
  if (request.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json')
    return denial(415,'Interventions need application/json');
  if (Number(request.headers['content-length'])>maxBody) return denial(413,'Intervention request exceeds 4 KiB');
  const chunks=[];
  let size=0;
  for await (const chunk of request.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    if(size>maxBody) return denial(413,'Intervention request exceeds 4 KiB');
    chunks.push(chunk);
  }
  try { return {command:JSON.parse(Buffer.concat(chunks,size).toString('utf8'))}; }
  catch { return denial(400,'Expected a JSON intervention request'); }
}

function create(W,run,{policy,queries,until,playback=false}) {
  const api=W.liveSnapshots, {id,record,check}=W.data;
  const access=policy===undefined?undefined:W.worldAccess.compile(policy,run.view().world,{queries});
  const probes=access?undefined:W.graphPorts.queries(queries);
  const principals=access?.principals??[{id:'operator',view:'world',interventions:[]}];
  check(principals.length>0,'Live world access needs at least one principal');
  const keys=new Map(), streams=new Map(), issued=[];
  for(const {id,view,interventions} of principals){
    if(!streams.has(view))streams.set(view,api.create({stream:randomUUID()}));
    const publisher=streams.get(view), token=randomBytes(24).toString('hex');
    const principal={view,publisher,grants:new Set(interventions),receipts:new Map()};
    keys.set('Bearer '+token,principal);
    issued.push([id,{token,view}]);
  }
  let accepted=0, lastTick, acceptedAtTick=0;
  function publish(effects) {
    const snapshot=run.view(), query=run.query();
    for(const [name,publisher] of streams)publisher.publish(access?
      access.project(name,snapshot,query,effects):W.graphPorts.frameOf(snapshot,query,probes,{events:effects}));
  }
  function ready() {
    const credentials=issued.map(([name,{token,view}])=>[name,{token,stream:streams.get(view).cursor().stream,view}]);
    const {token,stream}=credentials[0][1];
    return access?{principals:Object.fromEntries(credentials)}:{token,stream};
  }
  function cursors() {
    return access?{cursors:Object.fromEntries([...streams].map(([view,source])=>[view,source.cursor()]))}:
      {cursor:streams.get('world').cursor()};
  }
  function permissions(principal,open) {
    return {view:access?.audience(principal.view)??{id:'world',kind:'world'},
      interventions:[...principal.grants],writable:open&&!playback&&principal.grants.size>0};
  }
  function submit(principal,body,{busy,ended}) {
    if(!record(body)||Object.keys(body).length!==3||!id(body.id)||!id(body.request)||!api.validCursor(body.after))
      return denial(400,'Expected an intervention id, request id and applied cursor');
    if(!principal.grants.has(body.id))return denial(403,'Intervention is not granted');
    const prior=principal.receipts.get(body.request);
    if(prior)return prior.id===body.id?{status:202,body:prior}:denial(409,'Request ID was used for a different intervention');
    if(playback||ended||run.view().tick>=until)return denial(409,'This stream is read-only');
    const {action,args,maxLag}=access.intervention(body.id), head=principal.publisher.cursor(), lag=head.tick-body.after.tick;
    if(busy||head.stream!==body.after.stream||lag<0||lag>maxLag||head.revision-body.after.revision!==lag)
      return denial(409,'Use the latest committed cursor for this view');
    const tick=head.tick+1;
    if(tick!==lastTick){lastTick=tick;acceptedAtTick=0;}
    if(accepted>=maxReceipts||acceptedAtTick>=maxPerTick)return denial(429,'Intervention budget reached');
    const command='live-'+randomUUID();
    try { run.schedule([{id:command,tick,action,args}]); }
    catch { return denial(422,'The world rejected this command'); }
    const receipt={status:'scheduled',id:body.id,request:body.request,tick,command};
    principal.receipts.set(body.request,receipt);
    accepted++;
    acceptedAtTick++;
    return {status:202,body:receipt};
  }
  return {publish,ready,cursors,authorize:header=>keys.get(header),permissions,submit};
}

module.exports={create,readCommand};
