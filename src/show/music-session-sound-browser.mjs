const $=id=>document.getElementById(id);
const choices=(select,items,selected,empty)=>{
  const values=items.map(([value])=>value);
  if (values.join()!==[...select.options].map(row=>row.value).join())
    select.replaceChildren(...items.map(([value,label])=>new Option(label,value)));
  select.value=values.includes(selected) ? selected : empty ?? values[0] ?? '';
};
const title=value=>value[0].toUpperCase()+value.slice(1);

async function audioExample(file) {
  if (file.size>12*1024*1024) throw new RangeError('Choose a WAV under 12 MB');
  const data=await file.arrayBuffer(), signature=new Uint8Array(data,0,Math.min(12,data.byteLength));
  if (String.fromCharCode(...signature.slice(0,4))!=='RIFF' || String.fromCharCode(...signature.slice(8))!=='WAVE')
    throw new RangeError('Choose a PCM WAV');
  const clock=new OfflineAudioContext(1,4096,8000);
  const audio=await clock.decodeAudioData(data);
  const left=audio.getChannelData(0), right=audio.numberOfChannels>1 ? audio.getChannelData(1) : left;
  const sample=i=>(left[i]+right[i])*.5;
  let peak=0;
  for (let i=0;i<Math.min(8000,left.length);i++) peak=Math.max(peak,Math.abs(sample(i)));
  let from=0;
  while (from<Math.min(8000,left.length) && Math.abs(sample(from))<=peak*.018) from++;
  const length=Math.min(4096,left.length-from);
  if (peak<1e-5 || length<64) throw new RangeError('Choose a WAV with an audible attack near the start');
  const bytes=new Uint8Array(length*2), pcm=new DataView(bytes.buffer);
  for (let i=0;i<length;i++) pcm.setInt16(i*2,Math.round(Math.min(1,Math.max(-1,sample(from+i)))*32767),true);
  return btoa(String.fromCharCode(...bytes));
}

export function setupSoundBrowser({state,command,refresh,status,act,preview}) {
  const track=$('sound-lane'), basis=$('sound-source'), role=$('sound-role'), input=$('sound-query');
  const list=$('sound-results'), count=$('sound-count'), info=$('sound-status'), original=$('sound-original'), keep=$('sound-keep');
  const reference=$('sound-example'), upload=$('sound-file'), name=$('sound-name');
  const exportKind=$('sound-export-kind'), audition=$('sound-preview'), save=$('sound-export');
  let sample,sampleName='', basisChosen=false, request=0, stamp,pending=false,timer,candidates=[];
  const message=text=>{info.textContent=text;};
  const selected=()=>state().sound?.lane===track.value ? state().sound : null;
  const isRecipe=()=>Boolean(selected()?.id.startsWith('recipe-'));

  function active() {
    const sound=selected();
    original.disabled=pending || !sound;
    keep.disabled=pending || !sound;
    audition.disabled=save.disabled=pending || !sound;
    $('sound-note-settings').hidden=!sound || isRecipe();
    for (const button of list.querySelectorAll('button')) {
      button.setAttribute('aria-pressed',String(sound?.id===button.dataset.sound));
      button.disabled=pending || !basis.value;
    }
  }
  async function change(callback) {
    if (pending) return;
    pending=true;active();
    try {await callback();}
    finally {pending=false;active();}
  }
  async function load() {
    const serial=++request, source=basisChosen ? basis.value : '';
    const result=await command('sounds',{lane:track.value,source,role:role.value,query:input.value,sample});
    if (serial!==request) return;
    choices(track,result.lanes.map(lane=>[lane,lane]),result.lane);
    choices(basis,[['','Choose a source take'],...result.sources.map(take=>[take,take==='reference' ? 'Reference' : take])],
      basisChosen ? source : result.source,'');
    choices(role,[['','All roles'],...(result.roles ?? []).map(value=>[value,title(value)])],role.value,'');
    $('sound-fields').disabled=!result.lane;
    candidates=result.results ?? [];
    list.replaceChildren(...candidates.map(row=>{
      const item=document.createElement('li'), button=document.createElement('button');
      button.type='button';
      button.dataset.sound=row.id;
      const label=document.createElement('span'), group=document.createElement('small');
      label.textContent=row.title;
      group.textContent=[row.group,...row.roles.map(title)].join(' · ');
      button.append(label,group);
      item.append(button);
      return item;
    }));
    reference.textContent=sampleName ? 'Matching '+sampleName : '';
    $('sound-clear-example').hidden=!sampleName;
    if (!result.lane) count.textContent='This session has no editable native instrument lanes.';
    else if (!basis.value) count.textContent='This loop spans multiple takes. Choose a source take to audition.';
    else if (!candidates.length) count.textContent='No sounds match that search.';
    else count.textContent=candidates.length+' sounds · '+(sampleName ? 'Closest matches first' : 'Click a sound to hear it in the loop');
    active();
  }
  const sync=act(load);
  function show() {
    active();
    const now=state(), next=[now.revision,now.loop.from,now.loop.to,now.lanes[track.value]?.take].join('/');
    if (next!==stamp) {
      stamp=next;
      basisChosen=false;
      sync();
    }
  }
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    timer=setTimeout(sync,120);
  });
  role.addEventListener('change',sync);
  for (const control of [track,basis]) control.addEventListener('change',act(async()=>{
    basisChosen=control===basis;
    if (state().sound) {
      await command('audition-sound',{id:null});
      await refresh();
    }
    await load();
  }));
  $('sound-match').addEventListener('click',act(async()=>{
    sample='current';
    sampleName='the source sound';
    await load();
  }));
  upload.addEventListener('change',act(async()=>{
    const file=upload.files[0];
    if (!file) return;
    upload.value='';
    sample=await audioExample(file);
    sampleName=file.name;
    await load();
  }));
  $('sound-clear-example').addEventListener('click',act(async()=>{
    sample=undefined;sampleName='';
    await load();
  }));
  list.addEventListener('click',act(async event=>{
    const button=event.target.closest('button[data-sound]');
    if (!button || !basis.value || button.getAttribute('aria-pressed')==='true') return;
    await change(async()=>{
      const {id,title}=candidates.find(row=>row.id===button.dataset.sound);
      const ack=await command('audition-sound',{lane:track.value,source:basis.value,id});
      await refresh();
      message(title+' · queued at '+(ack.scoreSample/state().sampleRate).toFixed(3)+' s');
    });
  }));
  original.addEventListener('click',act(()=>change(async()=>{
    await command('audition-sound',{id:null});
    await refresh();
    message('Original mix');
  })));
  keep.addEventListener('click',act(()=>change(async()=>{
    const {lane,id,source}=selected();
    const take=name.value.trim();
    const ack=await command('keep-sound',{lane,id,source,...(take && {take})});
    await refresh(true);
    name.value='';
    const text='Kept '+ack.take+' in '+ack.lane+' · Save session to write the editable take';
    message(text);
    status(text);
  })));
  exportKind.addEventListener('change',()=>{
    $('sound-revision-label').hidden=exportKind.value!=='family';
  });
  audition.addEventListener('click',act(()=>change(async()=>{
    const {lane,id,source}=selected();
    const settings={};
    if (!isRecipe()) for (const field of ['midi','velocity','gate']) {
      const input=$('sound-'+field);
      if (!input.reportValidity()) return;
      if (input.value!=='') settings[field]=Number(input.value);
    }
    await preview({lane,id,source,settings});
    message('One-shot preview');
  })));
  save.addEventListener('click',act(()=>change(async()=>{
    const {lane,id,source}=selected(), kind=exportKind.value, name=$('sound-export-name').value.trim();
    const revision=$('sound-revision');
    if (kind==='family' && !revision.reportValidity()) return;
    const ack=await command('export-sound',{lane,id,source,kind,...(name && {name}),
      ...(kind==='family' && {revision:Number(revision.value)})});
    const text='Saved '+ack.directory;
    message(text);
    status(text);
  })));
  return {show};
}
