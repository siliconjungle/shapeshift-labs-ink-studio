import {setupRecording} from './recording.mjs';
import {setupSoundBrowser} from './sound-browser.mjs';

const $=id=>document.getElementById(id);
const option=(value,label=value)=>new Option(label,value);
const seconds=value=>({seconds:Number(value)});
const client=crypto.randomUUID();
let key,state,context,recorder,sounds,playing=false,pulling=false,timer,nextAt=0,heard=[],clippedFrames=0;
const desks=new Map();
let scoreNotes,reading=false,notesRevision;

async function post(route,body) {
  const binary=body instanceof Uint8Array;
  const response=await fetch(route,{method:'POST',headers:{'content-type':binary ? 'application/octet-stream' : 'application/json',
    'x-ink-session':key},body:binary ? body : JSON.stringify(body)});
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
async function command(op,args={}) {
  return (await post('/command',{op,...args})).json();
}
function status(message) { $('status').textContent=message; }
function act(callback) {
  return async(event)=>{
    event?.preventDefault();
    try { await callback(event); }
    catch (error) { status(error.message); }
  };
}
function selections() {
  const name=$('keep-lane').value;
  const take=state.lanes[name]?.take ?? null;
  const rows=take ? scoreNotes?.lanes[name]?.takes[take] : null;
  const seen=new Set();
  const notes=Array.isArray(rows) ? rows.filter(({address})=>{
    const id=JSON.stringify(address.slice(1,4));
    if (address.length!==5 || seen.has(id)) return false;
    seen.add(id);
    return true;
  }) : [];
  const previous=$('note').value;
  $('note').replaceChildren(option('','Choose a written note'),...notes.map(({address,beat})=>
    option(JSON.stringify({clip:address[1],voice:address[2],note:address[3]}),
      address[3]+' · beat '+Number(beat.toFixed(3)))));
  $('note').value=notes.length && [...$('note').options].some(row=>row.value===previous) ? previous : '';
  $('note').disabled=!notes.length;
  $('copy-note').disabled=$('keep-release').disabled=!$('note').value;
  $('keep-range').disabled=!take;
}
function bounds(loop=state.loop) {
  for (const [input,edge] of [['loop-in','from'],['loop-out','to'],['keep-in','from'],['keep-out','to']]) {
    $(input).max=state.frames/state.sampleRate;
    $(input).value=Number((loop[edge]/state.sampleRate).toFixed(6));
  }
}
function show(next) {
  const loopChanged=state && (next.loop.from!==state.loop.from || next.loop.to!==state.loop.to);
  state=next;
  if (loopChanged) bounds();
  for (const [id,lane] of Object.entries(state.lanes)) {
    if (!desks.has(id)) {
      const row=document.createElement('label'), input=document.createElement('select');
      row.className='lane';
      row.append(document.createTextNode(id),input);
      input.dataset.lane=id;
      input.addEventListener('change',act(async()=>{
        const ack=await command('switch',{lane:id,take:input.value || null});
        await refresh();
        status((ack.take ?? 'Saved edit')+' queued at '+(ack.scoreSample/state.sampleRate).toFixed(3)+' s');
      }));
      $('lanes').append(row);
      desks.set(id,input);
      $('keep-lane').append(option(id));
    }
    const input=desks.get(id), names=['',...lane.takes];
    if (names.join()!==[...input.options].map(row=>row.value).join())
      input.replaceChildren(option('','Saved edit'),...lane.takes.map(take=>option(take)));
    input.value=lane.take ?? '';
  }
  $('comp').textContent=state.comp.length ? state.comp.map(row=>
    row.lane+' · '+row.take+' ('+(row.from/state.sampleRate).toFixed(2)+'–'+(row.to/state.sampleRate).toFixed(2)+' s)').join('   /   ') :
    'No ranges kept';
  selections();
  monitorTargets();
  if (loopChanged) recorder?.newLoop();
  recorder?.show();
  sounds?.show();
}
function monitorTargets() {
  const mode=$('monitor-mode').value, target=$('monitor-target'), selected=target.value;
  const names=mode==='mute' ? Object.keys(state.lanes) : mode ? state.taps : [];
  if (names.join()!==[...target.options].map(row=>row.value).join()) {
    target.replaceChildren(...names.map(name=>option(name)));
    if (names.includes(selected)) target.value=selected;
  }
  target.disabled=!mode;
}
async function refresh(readNotes=false) {
  const next=await command('state');
  if (readNotes || notesRevision!==next.revision) {
    scoreNotes=await command('inspect');
    notesRevision=next.revision;
  }
  if (state && next.revision<state.revision) return;
  if (!state || readNotes || next.revision!==state.revision || next.loop.from!==state.loop.from ||
    next.loop.to!==state.loop.to || JSON.stringify(next.sound)!==JSON.stringify(state.sound) || Object.entries(next.lanes).some(([name,lane])=>lane.take!==state.lanes[name]?.take))
    show(next);
}
async function pump() {
  if (!context || !playing || pulling) return;
  pulling=true;
  try {
    if (nextAt-context.currentTime<.067) {
      const count=Math.ceil(state.sampleRate*.054);
      const response=await post('/audio',{frames:count,client});
      const anchor=JSON.parse(response.headers.get('x-ink-transport'));
      const pcm=new DataView(await response.arrayBuffer());
      const buffer=context.createBuffer(2,count,state.sampleRate);
      for (let channel=0;channel<2;channel++) {
        const dest=buffer.getChannelData(channel);
        for (let n=0;n<count;n++) dest[n]=pcm.getFloat32((2*n+channel)*4,true);
      }
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.connect(context.destination);
      if (nextAt<=context.currentTime) nextAt=context.currentTime+.012;
      const first=Math.round(nextAt*state.sampleRate);
      nextAt=first/state.sampleRate;
      source.start(nextAt);
      heard.push({...anchor,at:nextAt,count});
      recorder?.schedule(anchor,first,count);
      nextAt+=buffer.duration;
      clippedFrames=anchor.clippedFrames;
    }
  } catch (error) {
    playing=false;
    $('play').textContent='Play';
    await context.suspend();
    status(error.message);
  } finally {
    pulling=false;
    if (playing) timer=setTimeout(pump,12);
  }
}
function cursor() {
  const now=context?.currentTime ?? 0;
  while (heard.length>1 && heard[1].at<=now) heard.shift();
  const anchor=heard[0] ?? state;
  if (anchor) {
    const {loop}=anchor, size=loop.to-loop.from;
    const queued=anchor.at===undefined ? 0 : Math.max(0,Math.min(anchor.count-1,Math.floor((now-anchor.at)*state.sampleRate)));
    const offset=anchor.scoreSample-loop.from+queued, intro=offset<0;
    const at=loop.from+offset%size;
    const lap=intro ? 'Lead-in' : 'Pass '+(anchor.pass+1+Math.floor(offset/size));
    $('cursor').textContent=(at/state.sampleRate).toFixed(3)+' s   ·   '+lap+(clippedFrames ? '   ·   clipped' : '');
    $('position').value=intro ? 0 : (offset%size)/size;
  }
  recorder?.tick();
  requestAnimationFrame(cursor);
}

function getContext(create=true) {
  if (!context && create) context=new AudioContext({sampleRate:state.sampleRate});
  if (context && context.sampleRate!==state.sampleRate) throw new Error('Audio device did not open at the session sample rate');
  return context;
}

$('play').addEventListener('click',act(async()=>{
  getContext();
  playing=!playing;
  $('play').textContent=playing ? 'Pause' : 'Play';
  if (playing) {
    await context.resume();
    pump();
  } else {
    clearTimeout(timer);
    recorder?.pause();
    await context.suspend();
  }
}));
$('loop').addEventListener('submit',act(async()=>{
  const lead=$('lead-in').value;
  show(await command('loop',{from:seconds($('loop-in').value),to:seconds($('loop-out').value),
    ...(lead!=='' && {leadInSamples:Math.round(Number(lead)*state.sampleRate)})}));
  bounds();
  recorder?.newLoop();
  if (!playing && nextAt<= (context?.currentTime ?? 0)) heard=[];
  status('Loop updated');
}));
$('keep-lane').addEventListener('change',selections);
$('note').addEventListener('change',()=>{$('copy-note').disabled=$('keep-release').disabled=!$('note').value;});
$('monitor-mode').addEventListener('change',monitorTargets);
$('monitor').addEventListener('submit',act(async()=>{
  const mode=$('monitor-mode').value, target=$('monitor-target').value;
  show(await command('monitor',{selection:mode ? {mode,[mode==='mute' ? 'lane' : 'tap']:target} : null}));
  status(mode ? mode+' · '+target : 'Master mix');
}));
$('keep').addEventListener('submit',act(async()=>{
  const lane=$('keep-lane').value, take=state.lanes[lane]?.take;
  show(await command('keep',{lane,take,from:seconds($('keep-in').value),to:seconds($('keep-out').value)}));
  status('Range kept from '+take);
}));
$('keep-note').addEventListener('submit',act(async(event)=>{
  const lane=$('keep-lane').value, take=state.lanes[lane]?.take, note=JSON.parse($('note').value);
  const release=event.submitter?.value==='release';
  await command('edit',{changes:[release ? {op:'keep-release',lane,take,...note} : {op:'keep-notes',lane,take,notes:[note]}]});
  await refresh(true);
  status(release ? 'Kept the release from '+take : 'Kept '+note.note+' in the reference take');
}));
$('timeline-edits').addEventListener('submit',act(async()=>{
  const changes=JSON.parse($('changes').value);
  await command('edit',{changes});
  await refresh(true);
  status('Applied '+changes.length+' timeline edits');
}));
$('refresh-trace').addEventListener('click',act(async()=>{
  const preview={from:{samples:state.loop.from},to:{samples:state.loop.to},
    ...(state.monitor && {monitor:state.monitor})};
  $('trace').textContent=JSON.stringify(await command('trace',{preview}),null,2);
  $('trace-panel').open=true;
}));
$('save').addEventListener('click',act(async()=>{
  const saved=await command('save');
  if (typeof saved.session==='string') return status('Saved '+saved.session);
  const url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=state.id+'-kept.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Downloaded the session recipe');
}));
window.addEventListener('pagehide',()=>{
  recorder?.close();
  if (key) fetch('/command',{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},keepalive:true,
    body:JSON.stringify({op:'pause',client})}).catch(()=>{});
});

try {
  const initial=await (await fetch('/session')).json();
  key=initial.key;
  $('title').textContent=initial.state.id;
  await refresh(true);
  if (state.monitor) {
    $('monitor-mode').value=state.monitor.mode;
    monitorTargets();
    $('monitor-target').value=state.monitor.lane ?? state.monitor.tap;
  }
  bounds();
  recorder=setupRecording({state:()=>({...state,recordingPlayback:playing}),inspect:()=>scoreNotes,
    context:getContext,post,command,refresh,client,status});
  sounds=setupSoundBrowser({state:()=>state,command,refresh,status,act});
  sounds.show();
  $('play').disabled=false;
  requestAnimationFrame(cursor);
  setInterval(async()=>{
    if (reading) return;
    reading=true;
    try { await refresh(); }
    catch (error) { status(error.message); }
    finally { reading=false; }
  },500);
} catch (error) { status(error.message); }
