const $=id=>document.getElementById(id);
const client=crypto.randomUUID();
const desk=new Map(), queuedControls=new Map();
let key,state,context,playing=false,pulling=false,timer,nextAt=0,heard=[],ended=false,clipped=0;

async function post(route,body) {
  const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},
    body:JSON.stringify(body)});
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
const command=async(op,args={})=>(await post('/command',{op,...args})).json();
const status=message=>{$('status').textContent=message;};
const act=fn=>async event=>{
  try {await fn(event);}
  catch(error) {status(error.message);}
};
const label=value=>value.replace(/[-_]+/g,' ').replace(/^./,letter=>letter.toUpperCase());

function position(beat) {
  return 'Bar '+(Math.floor(beat/state.meter)+1)+' · Beat '+(Math.floor(beat)%state.meter+1);
}
function button(text,className) {
  const result=document.createElement('button');
  result.type='button';result.textContent=text;
  if (className) result.className=className;
  return result;
}
async function launch(launches) {
  const {at,state:next}=await command('launch',{launches,quantize:$('grid').value});
  show(next);
  const text=launches.length>1 ? 'All clips stop' : launches[0].clip ? label(launches[0].clip)+' launches' : 'Clip stops';
  status(text+' at '+position(at.beat));
}
function gateControl(id,args) {
  const previous=queuedControls.get(id);
  if (previous) {previous.args=args;return;}
  const entry={args};
  queuedControls.set(id,entry);
  setTimeout(act(async()=>{
    queuedControls.delete(id);
    if (state.done) return;
    show((await command('control',entry.args)).state);
  }),70);
}
function build(lane,settings) {
  const row=document.createElement('article'), header=document.createElement('header'), heading=document.createElement('h3');
  heading.textContent=label(lane);
  const mute=button('Mute','mute');
  mute.dataset.mute=lane;
  mute.addEventListener('click',act(async()=>{
    show((await command('control',{lane,muted:!state.lanes[lane].muted})).state);
  }));
  header.append(heading,mute);
  const slots=document.createElement('div');
  slots.className='slots';
  const buttons=new Map([...settings.slots,{id:null}].map(({id,length})=>{
    const cell=button(id ? label(id) : 'Stop clip','slot');
    if (id) {
      const caption=document.createElement('small');
      caption.textContent=length+' '+(length===1 ? 'beat' : 'beats');
      cell.dataset.clip=id;
      cell.append(caption);
    } else cell.dataset.stop=lane;
    cell.addEventListener('click',act(()=>launch([{lane,clip:id}])));
    slots.append(cell);
    return [id,cell];
  }));
  const sends=document.createElement('div');
  sends.className='sends';
  const knobs=new Map(Object.entries(settings.sends).map(([send,value])=>{
    const field=document.createElement('label'), name=document.createElement('span'), input=document.createElement('input');
    const read=document.createElement('output');
    name.textContent=label(send)+' send';
    input.type='range';input.min='0';input.max='2';input.step='.01';input.value=value;input.dataset.send=lane+'/'+send;
    read.textContent=Number(value).toFixed(2);
    input.addEventListener('input',()=>{
      const value=Number(input.value);
      read.textContent=value.toFixed(2);
      gateControl(lane+'/'+send,{lane,send,value});
    });
    field.append(name,read,input);sends.append(field);
    return [send,{input,read}];
  }));
  row.append(header,slots,sends);
  $('lanes').append(row);
  return {mute,buttons,knobs};
}
function show(next) {
  if (state && next.frame<state.frame) return;
  state=next;
  for (const [lane,settings] of Object.entries(next.lanes)) {
    if (!desk.has(lane)) desk.set(lane,build(lane,settings));
    const {mute,buttons,knobs}=desk.get(lane);
    mute.setAttribute('aria-pressed',String(settings.muted));mute.disabled=state.done;
    for (const [clip,cell] of buttons) {
      cell.setAttribute('aria-pressed',String(settings.active===clip));
      cell.dataset.queued=String(settings.pending!==null && settings.pending.clip===clip);
      cell.disabled=state.done;
    }
    for (const {input} of knobs.values()) input.disabled=state.done;
  }
  $('stop-all').disabled=state.done;
  $('finish').disabled=state.finishing || state.done;
  $('save').disabled=!state.done;
  $('progress').max=state.stop.frame;
}
function heardFrame() {
  const now=context?.currentTime ?? 0;
  while (heard.length>1 && heard[1].time<=now) heard.shift();
  const mark=heard[0];
  return mark ? mark.frame+Math.min(mark.frames,Math.max(0,Math.floor((now-mark.time)*state.sampleRate))) : 0;
}
function clock() {
  const frame=heardFrame(), grid=state.beatSamples;
  let beat=grid.findLastIndex(at=>at<=frame);
  if (frame===state.stop.frame && beat>0) beat--;
  $('progress').value=frame;
  const capturing=ended && context?.currentTime>=nextAt ? 'Pass captured' : playing || ended ? 'Recording' : frame ? 'Paused' : 'Ready';
  $('cursor').textContent=position(beat)+'   ·   '+capturing+(clipped ? '   ·   clipped' : '');
  if (ended && context?.currentTime>=nextAt) {$('play').textContent='Pass captured';$('play').disabled=true;}
  requestAnimationFrame(clock);
}
async function pump() {
  if (!playing || pulling) return;
  pulling=true;
  try {
    if (nextAt-context.currentTime<.065) {
      const count=Math.ceil(state.sampleRate*.045), response=await post('/audio',{frames:count,client});
      const anchor=JSON.parse(response.headers.get('x-ink-transport'));
      const pcm=new DataView(await response.arrayBuffer()), frames=pcm.byteLength/8;
      if (frames) {
        const audio=context.createBuffer(2,frames,state.sampleRate);
        for (let c=0;c<2;c++) {
          const channel=audio.getChannelData(c);
          for (let i=0;i<frames;i++) channel[i]=pcm.getFloat32((i*2+c)*4,true);
        }
        const source=context.createBufferSource();
        source.buffer=audio;source.connect(context.destination);
        if (nextAt<=context.currentTime) nextAt=context.currentTime+.012;
        source.start(nextAt);
        heard.push({frame:anchor.frame,frames,time:nextAt});
        nextAt+=audio.duration;
      }
      clipped=anchor.clippedFrames;
      if (anchor.done) {
        playing=false;ended=true;$('play').disabled=true;
        show(await command('state'));status('Pass captured. Save it to open the clips and automation in the session desk.');
      }
    }
  } catch(error) {
    playing=false;
    $('play').textContent='Resume pass';
    status(error.message);
  } finally {
    pulling=false;
    if (playing) timer=setTimeout(pump,12);
  }
}

$('play').addEventListener('click',act(async()=>{
  context ??= new AudioContext({sampleRate:state.sampleRate});
  playing=!playing;
  $('play').textContent=playing ? 'Pause' : 'Resume pass';
  if (playing) {await context.resume();pump();}
  else {clearTimeout(timer);await context.suspend();}
}));
$('stop-all').addEventListener('click',act(()=>launch(Object.keys(state.lanes).map(lane=>({lane,clip:null})))));
$('finish').addEventListener('click',act(async()=>{
  const {at,state:next}=await command('finish');
  show(next);
  status('Finishing at the end of bar '+at.beat/state.meter);
}));
$('save').addEventListener('click',act(async()=>{
  const saved=await command('save');
  if (typeof saved.session==='string') return status('Saved '+saved.session);
  const url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)+'\n'],{type:'application/json'})), link=document.createElement('a');
  link.href=url;link.download=state.id+'-arrangement.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Downloaded the editable arrangement');
}));
window.addEventListener('pagehide',()=>{
  if (key) fetch('/command',{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},keepalive:true,
    body:JSON.stringify({op:'pause',client})}).catch(()=>{});
});

try {
  const initial=await (await fetch('/session')).json();
  key=initial.key;
  $('title').textContent=initial.state.id;
  $('grid').value=initial.state.quantize;
  show(initial.state);
  $('play').disabled=false;
  requestAnimationFrame(clock);
  setInterval(act(async()=>{if (playing) show(await command('state'));}),180);
} catch(error) {status(error.message);}
