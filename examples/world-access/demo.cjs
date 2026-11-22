const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const {setTimeout:delay}=require('node:timers/promises');

const root=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(root,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/out/world-access');
const files=['harbor.world.json','harbor.access.json','harbor.queries.json'];
const [world,policy,queries]=files, tape='intervention.run.json';
const options=['--policy',policy,'--queries',queries];
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
const readView=(view,source=world,tick=1)=>run('sim','view',source,...options,'--view',view,
  '--ticks',String(tick),'--out',view+(source===world?'-view.json':'-committed.json'));

async function live() {
  const child=spawn(process.execPath,[cli,'sim','live',world,...options,'--ticks','7','--step-ms','650',
    '--linger-ms','600','--record',tape],{cwd:out,stdio:['ignore','pipe','pipe']});
  let error='';
  child.stderr.on('data',bytes=>{error+=bytes;});
  const done=once(child,'close'), lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  try {
    const first=await lines.next();
    assert(!first.done,error);
    const ready=JSON.parse(first.value);
    assert.equal(ready.event,'live-ready');
    const readKey=name=>ready.principals[name].token, west=readKey('west-guide'), spectator=readKey('projector');
    async function call(token,route,body) {
      const response=await fetch(ready.url+route,{headers:{Authorization:'Bearer '+token,
        ...(body&&{'Content-Type':'application/json'})},...(body&&{method:'POST',body:JSON.stringify(body)})});
      return {status:response.status,body:await response.json()};
    }
    async function get(token,route){
      const reply=await call(token,route);
      assert.equal(reply.status,200,JSON.stringify(reply.body));
      return reply.body;
    }
    async function waitFor(read,predicate){
      for(let i=0;i<160;i++){
        const value=await read();
        if(predicate(value))return value;
        await delay(15);
      }
      throw Error('Timed out watching the live harbor');
    }
    await waitFor(()=>get(west,'snapshot'),row=>row.cursor.tick>=1);
    const permissions={west:await get(west,'permissions'),audience:await get(spectator,'permissions')};
    assert.equal(permissions.west.writable,true);
    assert.equal(permissions.audience.writable,false);
    const wrongView=await get(spectator,'snapshot?view=authority');
    assert.equal(wrongView.state.visibility.kind,'spectator');
    assert.deepEqual(Object.keys(wrongView.state.samples),['lanterns']);
    const request={id:'release-lantern',request:'chosen-route',after:wrongView.cursor};
    const unauthorized=await call(spectator,'intervene',request);
    assert.equal(unauthorized.status,403);
    const crossScope=await call(west,'intervene',request);
    assert.equal(crossScope.status,409);
    const fresh=()=>get(west,'snapshot').then(row=>row.cursor);
    const forged=await call(west,'intervene',{...request,after:await fresh(),args:{branch:'hold'}});
    assert.equal(forged.status,400);
    const restricted=await waitFor(async()=>call(west,'intervene',{id:'ring-siren',request:'native-guard',after:await fresh()}),
      row=>row.status!==409);
    assert.equal(restricted.status,422);

    let baseline, decision;
    const accepted=await waitFor(async()=>{
      baseline=await get(spectator,'snapshot');
      decision={...request,after:await fresh()};
      if(decision.after.tick!==baseline.cursor.tick)return {status:409};
      return call(west,'intervene',decision);
    },reply=>{
      if(reply.status===409)return false;
      assert.equal(reply.status,202,JSON.stringify(reply.body));
      return true;
    });
    const next=()=>get(spectator,'live?after='+encodeURIComponent(JSON.stringify(baseline.cursor)));
    const update=await waitFor(next,packet=>packet.kind!=='idle');
    assert.equal(update.kind,'live');
    assert.deepEqual(update.effects.map(row=>[row.kind,row.payload]),[['lantern-lit',{amount:1}]]);
    assert.equal(update.state.samples.lanterns.value,1);
    const retry=await call(west,'intervene',decision);
    assert.deepEqual(retry,accepted);
    save('live-demonstration.json',{permissions,unauthorized,crossScope,forged,restricted,accepted,retry,baseline,update});
    const {graph}=require(root).load().KIT.procedural;
    const patch=graph.create({inputs:{packet:'liveSnapshot'},nodes:{
      source:{op:'sim.liveWorld',inputs:{packet:{input:'packet'}}},
      lamps:{op:'sim.worldScalar',inputs:{source:{node:'source'},options:{query:'lanterns'}}},
      cue:{op:'sim.worldPulse',inputs:{source:{node:'source'},options:{kind:'lantern-lit'}}}
    },outputs:{lamps:{node:'lamps'},cue:{node:'cue'}}});
    const before=patch.evaluate({packet:baseline},{time:0}).outputs;
    const after=patch.evaluate({packet:update},{time:.1}).outputs;
    const quiet=patch.evaluate({packet:null},{time:.2}).outputs;
    assert.deepEqual([before.lamps,after.lamps,quiet.lamps],[0,1,1]);
    assert.deepEqual([before.cue.entries.length,after.cue.entries.length,quiet.cue.entries.length],[0,1,0]);
    save('spectator-patch.json',{before,after,quiet});
    assert.equal(JSON.parse((await lines.next()).value).event,'live-end');
    assert.deepEqual(await done,[0,null],error);
    return accepted.body;
  } finally {
    if(child.exitCode===null){child.kill();await done;}
  }
}

async function main(){
  fs.mkdirSync(out,{recursive:true});
  if(out!==__dirname)for(const file of files)fs.copyFileSync(path.join(__dirname,file),path.join(out,file));
  for(const view of ['authority','west','east','audience'])readView(view);
  const inspection=view=>read(view+'-view.json').samples.knowledge.value.records[0].data;
  assert.deepEqual(inspection('west'),{});
  assert.equal(inspection('east').severity,'hinge fractured');
  assert.deepEqual(Object.keys(read('audience-view.json').samples),['lanterns']);
  const command=await live();
  run('sim','verify',tape,'--out','verify.json');
  assert.equal(read('verify.json').status,'verified');
  assert.deepEqual(read(tape).commands.map(row=>row.id),[command.command]);
  readView('authority',tape,command.tick);
  readView('audience',tape,command.tick);
  const choice=read('authority-committed.json').events.find(row=>row.kind==='story-branch-chosen');
  assert(choice.causes.some(row=>row.id===command.command));
  console.log('West knew the inspection location. East also knew the severity. The spectator received only the amber signal.');
  console.log('The west guide queued one story choice at tick '+command.tick+'. The spectator patch saw one lantern light.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
