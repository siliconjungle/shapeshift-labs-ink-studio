const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {createInterface}=require('node:readline');
const {setTimeout:delay}=require('node:timers/promises');

const root=path.resolve(process.argv[3]??path.join(__dirname,'../..'));
const cli=path.join(root,'cli/ink-studio.js'), PNG=require(path.join(root,'cli/png.js'));
const out=path.resolve(process.argv[2]??'studio/out/live-snapshot-cursor');
const cueFile='.live-'+randomUUID()+'.cues.json';
const children=new Set();
const files=['dock.world.cjs','dock.queries.json','dock.patch.json','ink-studio.config.js'];
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');

function start(...args) {
  const child=spawn(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','pipe']});
  children.add(child);
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let error='';
  child.stderr.on('data',part=>{error+=part;});
  const done=once(child,'close').then(([status])=>{children.delete(child);assert.equal(status,0,error);});
  done.catch(()=>{});
  return {done,async next(){
    const line=await lines.next();
    assert(!line.done,error);
    return JSON.parse(line.value);
  }};
}

async function waitFor(read,match) {
  for(let i=0;i<250;i++){
    const value=await read();
    if(value&&match(value))return value;
    await delay(17);
  }
  throw Error('Timed out awaiting demo state');
}

async function main(){
  fs.mkdirSync(out,{recursive:true});
  for(const file of files)if(out!==__dirname)fs.copyFileSync(path.join(__dirname,file),path.join(out,file));
  const simulation=start('sim','live','dock.world.cjs','--ticks','16','--queries','dock.queries.json',
    '--step-ms','480','--linger-ms','1500');
  const ready=await simulation.next();
  assert.equal(ready.event,'live-ready');
  const headers={Authorization:'Bearer '+ready.token};
  const url=ready.url;
  assert.equal((await fetch(url+'snapshot')).status,403);
  async function request(route){
    const response=await fetch(url+route,{headers});
    assert.equal(response.status,200);
    return response.json();
  }
  const snapshot=()=>request('snapshot');
  const after=cursor=>request('live?after='+encodeURIComponent(JSON.stringify(cursor)));
  const joined=await waitFor(snapshot,packet=>packet.cursor.tick>=2);
  const live=await waitFor(()=>after(joined.cursor),packet=>packet.kind!=='idle');
  assert.equal(live.kind,'live');
  assert.equal(live.cursor.tick,joined.cursor.tick+1);
  assert.deepEqual(live.effects.filter(row=>row.kind==='transfer').map(row=>row.tick),[live.cursor.tick]);
  await waitFor(snapshot,packet=>packet.cursor.tick>=live.cursor.tick+2);
  const caughtUp=await after(live.cursor);
  assert.deepEqual([joined.reason,caughtUp.reason],['join','gap']);
  for(const packet of [joined,caughtUp]){
    assert.equal(packet.state.samples.stock.value.balance,packet.cursor.tick);
    assert.deepEqual(packet.effects,[]);
  }
  save('viewer.json',{joined,live,caughtUp});

  const cue={format:'ink-studio/patch-show',version:1,patch:'dock.patch.json',output:'picture',
    fps:30,frames:95,slowMs:500,projector:{wait:false},liveWorld:{url,token:ready.token,input:'dock'}};
  fs.writeFileSync(path.join(out,cueFile),JSON.stringify(cue),{mode:0o600,flag:'wx'});
  const show=start('patch','show',cueFile);
  const showReady=await show.next();
  fs.unlinkSync(path.join(out,cueFile));
  assert.equal(showReady.event,'show-ready');
  const projector=showReady.projector, session=await fetch(projector+'session').then(response=>response.json());
  const displayHeaders={'x-ink-session':session.key,'x-ink-client':'demo-viewer'};
  let serial=0;
  async function picture(baseline=false){
    const response=await fetch(projector+(baseline?'snapshot':'frame?after='+serial),{headers:displayHeaders});
    if(response.status===204)return;
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-ink-stream'),session.stream);
    serial=Number(response.headers.get('x-ink-serial'));
    const width=Number(response.headers.get('x-ink-width')), height=Number(response.headers.get('x-ink-height'));
    const pixels=new Uint8Array(await response.arrayBuffer());
    const crates=Array.from({length:16},(_,i)=>pixels[(30*width+16+i*10)*4]===255).filter(Boolean).length;
    return {frame:Number(response.headers.get('x-ink-frame')),serial,
      state:response.headers.get('x-ink-state'),crates,flash:pixels[1]===255,width,height,pixels};
  }
  // Join after the patch has already rendered multiple frames.
  await delay(220);
  const first=await waitFor(()=>picture(true),frame=>frame.frame>=2&&frame.crates>=caughtUp.cursor.tick&&!frame.flash);
  assert.equal(first.state,'snapshot');
  const flash=await waitFor(picture,frame=>frame.flash);
  assert.equal(flash.state,'live');
  assert(flash.crates>first.crates);
  const quiet=await waitFor(picture,frame=>!frame.flash);
  const describe=({pixels,...rest})=>rest;
  save('projector.json',{joined:describe(first),transfer:describe(flash),quiet:describe(quiet)});
  for(const [name,frame] of [['projector-join',first],['projector-transfer',flash]])
    fs.writeFileSync(path.join(out,name+'.png'),PNG.encode(frame.width,frame.height,frame.pixels,4));
  const report=await show.next();
  save('show-report.json',report);
  assert.equal(report.reason,'completed');
  assert.equal(report.sources.world.outages,0);
  await show.done;
  assert.equal((await simulation.next()).cursor.tick,16);
  await simulation.done;
  console.log('Remote viewer: tick '+joined.cursor.tick+' joined with '+joined.state.samples.stock.value.balance+
    ' crates and zero effects. Tick '+live.cursor.tick+' sent one transfer. Tick '+caughtUp.cursor.tick+' caught up without effects.');
  console.log('Projector: frame '+first.frame+' joined with '+first.crates+' crates and a quiet strip. Frame '+
    flash.frame+' displayed a new transfer flash.');
}

main().catch(error=>{ console.error(error);process.exitCode=1; }).finally(()=>{
  fs.rmSync(path.join(out,cueFile),{force:true});
  for(const child of children)child.kill();
});
