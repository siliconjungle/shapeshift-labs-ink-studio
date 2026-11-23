/* Local-file playback of a portable reference and its aligned Ink render. */
(() => {
  const plan = JSON.parse(document.getElementById('workbench').textContent);
  const { create:align, alignmentFormat, register } = KIT.referenceClips;
  let alignment = align(plan);
  const find = id => document.getElementById(id);
  const ui = Object.fromEntries([
    'title','image','mode','zoom','divider','swipe','play','back','next','loop','speed','seek','left','right','selection','beats',
    'note','note-form','note-list','note-status','download','import','notes-file','status',
    'alignment','beat-form','edit-beat','beat-label','reference-frame','candidate-frame','remove-beat','download-beats','beat-status'
  ].map(id=>[id,find(id)]));
  const {width,height} = plan;
  const visible = ui.image.getContext('2d');
  ui.title.textContent=plan.title;
  document.title=plan.title;
  ui.mode.value=plan.view.mode;
  ui.divider.value=plan.view.divider;

  const controls = KIT.comparison;
  const stage=ui.image.parentElement, beatButtons=new Map();
  const cache=new Map();
  const localKey='ink-reference-clip:'+plan.sessionId;
  const beatKey=localKey+':beats';
  const pairInputs={reference:ui['reference-frame'],candidate:ui['candidate-frame']};
  try {
    const saved=JSON.parse(localStorage.getItem(beatKey));
    if(saved?.format===alignmentFormat&&saved.version===1&&saved.sessionId===plan.sessionId) {
      alignment=align({...plan,beats:saved.beats});
    }
  } catch {}
  let notes=alignment.notes(plan.notes);
  let loopBeat=null, clock, lastTime, animation, presented='', requested='', drawing=0, draft=null;

  function viewClock(time, playing = false) {
    const range=alignment.range(loopBeat);
    clock=controls.create({ range,time,playing,loop:loopBeat!==null,rate:Number(ui.speed.value) });
    lastTime=undefined;
    ui.seek.min=range[0];
    ui.seek.max=range[1]-(loopBeat===null?0:1e-6);
    render();
  }

  function resize() {
    const columns=ui.mode.value==='side-by-side'?2:1;
    const scale=ui.zoom.value==='auto'
      ? Math.max(1,Math.min(8,Math.floor((stage.clientWidth-24)/(width*columns))))
      : Number(ui.zoom.value);
    ui.image.style.width=width*columns*scale+'px';
  }

  function load(side,address) {
    const file=side.images[address.index];
    const key=file+'@'+side.offset.join(',');
    if(cache.has(key)){
      const earlier=cache.get(key);
      cache.delete(key);
      cache.set(key,earlier);
      return earlier;
    }
    const result=(async()=>{
      // Retain the same straight-alpha bytes as Node, without a canvas decode round trip.
      const packed=Uint8Array.from(atob(referenceClipImages[file]),char=>char.charCodeAt(0));
      const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
      const rgba=new Uint8Array(await new Response(stream).arrayBuffer());
      return register({width:side.width,height:side.height,rgba},plan,side.offset);
    })();
    cache.set(key,result);
    if(cache.size>12)cache.delete(cache.keys().next().value);
    return result;
  }

  function render() {
    const state=clock.snapshot(), address=draft??alignment.sample(state.time);
    const { reference,candidate,beat }=address;
    const label=alignment.beats.find(row=>row.id===beat)?.label;
    ui.seek.value=state.time;
    ui.left.textContent=plan.reference.label+' · frame '+reference.frame;
    ui.right.textContent=plan.candidate.label+' · frame '+candidate.frame;
    ui.selection.textContent=draft?'Unaligned preview':(label?label+' · ':'')+state.time.toFixed(3)+' s';
    ui['note-form'].querySelector('button').disabled=!!draft;
    ui.play.textContent=state.playing?'Pause':'Play';
    ui.play.setAttribute('aria-label',state.playing?'Pause comparison':'Play comparison');
    for(const [id,button] of beatButtons)button.setAttribute('aria-pressed',String(id===beat));
    const mode=ui.mode.value,divider=Number(ui.divider.value);
    ui.swipe.hidden=mode!=='swipe';
    const key=[reference.index,candidate.index,mode,divider].join(' ');
    if(key===requested)return;
    requested=key;
    const ticket=++drawing;
    if(key===presented)return;
    Promise.all([load(plan.reference,reference),load(plan.candidate,candidate)]).then(([left,right])=>{
      if(ticket!==drawing)return;
      const opts={...plan.view,mode,divider};
      const image=controls.compose(left,right,opts);
      ui.image.width=image.w;
      ui.image.height=image.h;
      resize();
      const rgba=visible.createImageData(image.w,image.h);
      for(let i=0,j=0;i<image.rgb.length;i+=3,j+=4) {
        rgba.data[j]=image.rgb[i];
        rgba.data[j+1]=image.rgb[i+1];
        rgba.data[j+2]=image.rgb[i+2];
        rgba.data[j+3]=255;
      }
      visible.putImageData(rgba,0,0);
      ui.image.dataset.referenceFrame=reference.frame;
      ui.image.dataset.candidateFrame=candidate.frame;
      ui.status.textContent='';
      presented=key;
    }).catch(error=>{
      if(ticket!==drawing)return;
      requested='';
      ui.status.textContent=error.message;
      stop();
    });
  }

  function advance(now) {
    animation=undefined;
    if(lastTime!==undefined)clock.advance((now-lastTime)/1000);
    lastTime=now;
    render();
    if(clock.snapshot().playing)animation=requestAnimationFrame(advance);
  }
  function stop() {
    if(animation!==undefined)cancelAnimationFrame(animation);
    animation=undefined;
    clock.pause();
    lastTime=undefined;
  }
  function closeEditor() {
    draft=null;
    ui.alignment.open=false;
  }
  function seek(time) {
    stop();
    closeEditor();
    clock.seek(time);
    render();
  }
  function selectBeat(id) {
    const time=alignment.range(id)[0];
    if(ui.loop.checked){
      closeEditor();
      loopBeat=id;
      viewClock(time,clock.snapshot().playing);
    } else seek(time);
  }

  function showBeats() {
    beatButtons.clear();
    ui.beats.replaceChildren();
    ui['edit-beat'].replaceChildren(new Option('New beat',''));
    ui.loop.disabled=!alignment.beats.length;
    for(const beat of alignment.beats) {
      const button=document.createElement('button');
      button.type='button';
      button.textContent=beat.label;
      button.addEventListener('click',()=>selectBeat(beat.id));
      beatButtons.set(beat.id,button);
      ui.beats.append(button);
      ui['edit-beat'].append(new Option(beat.label,beat.id));
    }
  }
  showBeats();
  ui.loop.addEventListener('change',()=>{
    const {time,playing}=clock.snapshot();
    closeEditor();
    loopBeat=ui.loop.checked?(alignment.sample(time).beat??alignment.beats[0].id):null;
    const range=alignment.range(loopBeat);
    viewClock(time>=range[1]&&loopBeat!==null?range[0]:time,playing);
  });
  ui.play.addEventListener('click',()=>{
    if(clock.snapshot().playing){stop();render();return;}
    closeEditor();
    clock.play();
    lastTime=undefined;
    render();
    if(clock.snapshot().playing&&animation===undefined)animation=requestAnimationFrame(advance);
  });
  function step(delta) {
    const current=alignment.sample(clock.snapshot().time).reference.frame;
    const next=Math.max(alignment.reference.startFrame,Math.min(alignment.reference.endFrame-1,current+delta));
    const time=alignment.frameTime(next), [start,end]=clock.snapshot().range;
    if(loopBeat!==null&&(time<start||time>=end))return;
    seek(time);
  }
  ui.back.addEventListener('click',()=>step(-1));
  ui.next.addEventListener('click',()=>step(1));
  ui.seek.addEventListener('input',()=>seek(Number(ui.seek.value)));
  ui.speed.addEventListener('change',()=>clock.update({rate:Number(ui.speed.value)}));
  ui.mode.addEventListener('change',()=>{resize();render();});
  ui.divider.addEventListener('input',render);
  ui.zoom.addEventListener('change',resize);
  window.addEventListener('resize',resize);

  function previewPair() {
    const pair={};
    for(const [side,input] of Object.entries(pairInputs)){
      const frame=input.valueAsNumber;
      if(!input.validity.valid)return;
      pair[side]={frame,index:frame-alignment[side].startFrame};
    }
    draft=pair;
    render();
  }
  function chooseBeat() {
    const beat=alignment.beats.find(row=>row.id===ui['edit-beat'].value);
    const address=alignment.sample(clock.snapshot().time);
    ui['beat-label'].value=beat?.label??'';
    ui['remove-beat'].hidden=!beat;
    for(const [side,input] of Object.entries(pairInputs)){
      input.min=alignment[side].startFrame;
      input.max=alignment[side].endFrame-1;
      input.value=beat?.[side]??address[side].frame;
    }
    ui['beat-status'].textContent='';
    previewPair();
  }
  ui.alignment.addEventListener('toggle',()=>{
    if(!ui.alignment.open){draft=null;render();return;}
    stop();
    chooseBeat();
  });
  ui['edit-beat'].addEventListener('change',chooseBeat);
  for(const input of Object.values(pairInputs))input.addEventListener('input',previewPair);
  function alignmentDocument() {
    const beats=alignment.beats.map(({id,label,reference,candidate})=>({id,label,reference,candidate}));
    return {format:alignmentFormat,version:1,sessionId:plan.sessionId,beats};
  }
  function updateBeats(beats,id) {
    alignment=align({...plan,beats});
    notes=alignment.notes(notes);
    const saved=alignmentDocument();
    try { localStorage.setItem(beatKey,JSON.stringify(saved)); } catch {}
    saveNotes();
    showBeats();
    showNotes();
    if(id===null) {
      const time=clock.snapshot().time;
      if(loopBeat&&!alignment.beats.some(beat=>beat.id===loopBeat)){
        loopBeat=null;
        ui.loop.checked=false;
      }
      viewClock(time);
      chooseBeat();
    } else selectBeat(id);
  }
  ui['beat-form'].addEventListener('submit',event=>{
    event.preventDefault();
    const label=ui['beat-label'].value.trim();
    if(!label)return;
    const selected=ui['edit-beat'].value;
    const stem=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'beat';
    let id=selected||stem;
    if(!selected)for(let i=2;alignment.beats.some(row=>row.id===id);i++)id=stem+'-'+i;
    const pairing={id,label,reference:pairInputs.reference.valueAsNumber,candidate:pairInputs.candidate.valueAsNumber};
    const beats=alignment.beats.filter(row=>row.id!==id).concat(pairing).sort((a,b)=>a.reference-b.reference);
    try { updateBeats(beats,id); }
    catch(error) { ui['beat-status'].textContent=error.message; }
  });
  ui['remove-beat'].addEventListener('click',()=>{
    const selected=ui['edit-beat'].value;
    updateBeats(alignment.beats.filter(row=>row.id!==selected),null);
  });

  function noteDocument() {
    return { format:alignment.noteFormat,version:1,sessionId:plan.sessionId,notes };
  }
  function readNotes(document) {
    if(document?.format!==alignment.noteFormat || document.version!==1 || document.sessionId!==plan.sessionId ||
       !Array.isArray(document.notes)) throw new Error('Notes belong to different source clips.');
    return alignment.notes(document.notes);
  }
  function saveNotes() {
    try { localStorage.setItem(localKey,JSON.stringify(noteDocument())); }
    catch { ui['note-status'].textContent='Download notes to keep them across browser sessions.'; }
  }
  function showNotes() {
    const rows=notes.slice().sort((a,b)=>a.time-b.time).map(note=>{
      const row=document.createElement('li'), jump=document.createElement('button'), text=document.createElement('p');
      jump.type='button';
      jump.textContent=note.time.toFixed(3)+' s · '+note.reference+' / '+note.candidate;
      jump.setAttribute('aria-label','Jump to note at '+note.time.toFixed(3)+' seconds');
      jump.addEventListener('click',()=>{
        const range=alignment.range(loopBeat);
        if(note.time<range[0]||note.time>=range[1]){
          ui.loop.checked=false;
          loopBeat=null;
          stop();
          viewClock(note.time);
        } else seek(note.time);
      });
      text.textContent=note.text;
      row.append(jump,text);
      return row;
    });
    ui['note-list'].replaceChildren(...rows);
    ui.download.disabled=!notes.length;
  }
  ui.note.addEventListener('focus',()=>{stop();render();});
  ui['note-form'].addEventListener('submit',event=>{
    event.preventDefault();
    if(draft)return;
    const text=ui.note.value.trim();
    if(!text)return;
    stop();
    try {
      const id=globalThis.crypto?.randomUUID?.() ?? 'note-'+Date.now()+'-'+notes.length;
      notes=alignment.notes([...notes,{id,time:clock.snapshot().time,text}]);
      ui.note.value='';
      ui['note-status'].textContent='Saved at the playhead.';
      saveNotes();
      showNotes();
    } catch(error) { ui['note-status'].textContent=error.message; }
    render();
  });
  function download(documentValue,name) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(documentValue,null,2)+'\n'],{type:'application/json'}));
    const file=document.createElement('a');
    file.href=url;
    file.download=name;
    file.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  ui.download.addEventListener('click',()=>download(noteDocument(),'reference-clip-notes.json'));
  ui['download-beats'].addEventListener('click',()=>download(alignmentDocument(),'reference-clip-alignment.json'));
  ui.import.addEventListener('click',()=>ui['notes-file'].click());
  ui['notes-file'].addEventListener('change',async()=>{
    const file=ui['notes-file'].files[0];
    if(!file)return;
    try {
      if(file.size>2*1024*1024)throw new Error('Notes file exceeds 2 MiB.');
      const loaded=readNotes(JSON.parse(await file.text()));
      const unique=new Map([...notes,...loaded].map(note=>[note.id,note]));
      notes=alignment.notes([...unique.values()]);
      ui['note-status'].textContent='Opened '+loaded.length+' frame notes.';
      saveNotes();
      showNotes();
    } catch(error) { ui['note-status'].textContent=error.message; }
    ui['notes-file'].value='';
  });

  try {
    const existing=localStorage.getItem(localKey);
    if(existing){
      const notesById=new Map([...notes,...readNotes(JSON.parse(existing))].map(note=>[note.id,note]));
      notes=alignment.notes([...notesById.values()]);
    }
  } catch {}
  showNotes();
  viewClock(plan.initialTime);
})();
