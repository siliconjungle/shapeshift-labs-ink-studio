const $=id=>document.getElementById(id);
const second=value=>value.toFixed(3)+' s';
let session,context,active,staged,target,pending,generation=0,rendering=false,playing=false,origin,length;
const buffers=new WeakMap();
const status=text=>{$('status').textContent=text;};

function describe(mix){
  $('voice-list').replaceChildren(...mix.voices.map(voice=>{
    const row=document.createElement('li'), detail=document.createElement('small');
    row.textContent=voice.cue+(voice.selection?' · '+voice.selection.family+'/'+voice.selection.take:'');
    const admission=voice.voiceBudget;
    detail.textContent=voice.binding+' · '+voice.bus+' · '+second(voice.arrivalSample/session.sampleRate)+
      (admission?.action==='dropped'?' · dropped by voice budget':admission?.stolenAt!==undefined?' · displaced by voice budget':'');
    row.append(detail);
    return row;
  }));
}
async function buffer(mix){
  if(buffers.has(mix))return buffers.get(mix);
  const bytes=Uint8Array.from(atob(mix.waves),char=>char.charCodeAt(0));
  const audio=await context.decodeAudioData(bytes.buffer);
  const fade=Math.min(Math.floor(audio.length/4),Math.round(audio.sampleRate*.004));
  for(let channel=0;channel<audio.numberOfChannels;channel++){
    const samples=audio.getChannelData(channel);
    for(let i=0;i<fade;i++){
      samples[i]*=i/fade;
      samples[samples.length-1-i]*=i/fade;
    }
  }
  buffers.set(mix,audio);
  return audio;
}
function start(mix,when){
  const source=context.createBufferSource();
  source.buffer=buffers.get(mix);
  source.loop=true;
  source.connect(context.destination);
  source.onended=()=>source.disconnect();
  source.start(when);
  return {source,mix,when};
}
function schedule(){
  if(!playing||staged||active.mix===target||!buffers.has(target))return;
  const pass=Math.max(1,Math.ceil((context.currentTime+.035-origin)/length));
  const when=origin+pass*length;
  staged=start(target,when);
  active.source.stop(when);
  status('Mix queued for pass '+(pass+1));
}
function clock(){
  if(playing){
    const now=context.currentTime;
    if(staged&&now>=staged.when){
      active=staged;
      staged=undefined;
      describe(active.mix);
      status('Playing '+(active.mix===session.original?'original mix':'cue preview'));
      schedule();
    }
    const elapsed=Math.max(0,now-origin);
    $('position').value=(elapsed%length)/length;
    $('clock').textContent='Pass '+(1+Math.floor(elapsed/length))+' · '+
      second(session.original.firstSample/session.sampleRate+elapsed%length);
  }
  requestAnimationFrame(clock);
}
function controls(){
  const binding=$('binding').value, family=$('family').value;
  const highpass=$('highpass').value, lowpass=$('lowpass').value, gainDb=Number($('gain').value);
  return {gainDb,...(binding&&{binding}),...(family&&{family}),
    ...(highpass!==''&&{highpass:Number(highpass)}),...(lowpass!==''&&{lowpass:Number(lowpass)})};
}
async function renderNext(){
  if(rendering)return;
  rendering=true;
  try{
    while(pending){
      const {version,edit}=pending;
      pending=undefined;
      try{
        let mix=session.original;
        if(edit&&(edit.family||edit.gainDb!==0||edit.highpass!==undefined||edit.lowpass!==undefined)){
          status('Rendering scene mix…');
          const response=await fetch('/render',{method:'POST',
            headers:{'Content-Type':'application/json','X-Ink-Session':session.key},body:JSON.stringify(edit)});
          mix=await response.json();
          if(!response.ok)throw new Error(mix.error);
        }
        if(context&&version===generation)await buffer(mix);
        if(version!==generation)continue;
        target=mix;
        if(playing){
          schedule();
          if(!staged)status('Playing '+(target===session.original?'original mix':'cue preview'));
        }else{
          describe(target);
          status('Scene mix ready');
        }
      }catch(error){
        if(version===generation)status(error.message);
      }
    }
  }finally{rendering=false;}
}
function request(edit){
  pending={version:++generation,edit};
  renderNext();
}
function stop(){
  for(const row of [active,staged])if(row)row.source.stop();
  active=staged=undefined;
  playing=false;
  $('play').textContent='Play loop';
  $('position').value=0;
  $('clock').textContent='';
}
$('play').addEventListener('click',async()=>{
  if(playing){stop();return;}
  $('play').disabled=true;
  try{
    context??=new AudioContext({sampleRate:session.sampleRate});
    await context.resume();
    let mix;
    do{mix=target;await buffer(mix);}while(mix!==target);
    length=buffers.get(mix).duration;
    origin=context.currentTime+.03;
    active=start(mix,origin);
    playing=true;
    $('play').textContent='Pause';
    status('Playing '+(mix===session.original?'original mix':'cue preview'));
    describe(mix);
  }catch(error){status(error.message);}
  finally{$('play').disabled=false;}
});
$('controls').addEventListener('submit',event=>{event.preventDefault();request(controls());});
for(const id of ['binding','family','gain','highpass','lowpass'])$(id).addEventListener('change',()=>{
  if($('controls').checkValidity())request(controls());
});
$('reset').addEventListener('click',()=>{$('controls').reset();request();});

try{
  const response=await fetch('/session');
  if(!response.ok)throw new Error('The cue audition session is unavailable');
  session=await response.json();
  target=session.original;
  $('beat').textContent=session.beatId;
  $('binding').replaceChildren(new Option('Entire beat',''),...session.bindings.map(name=>new Option(name,name)));
  $('family').replaceChildren(new Option('Scene choice',''),...session.families.map(name=>new Option(name,name)));
  $('family').disabled=!session.families.length;
  const {firstSample,endSample,voices}=target, rate=session.sampleRate;
  $('range').textContent=second(firstSample/rate)+' – '+second(endSample/rate);
  $('onset').style.left=(100*Math.max(0,(voices[0].arrivalSample-firstSample)/(endSample-firstSample)))+'%';
  $('play').disabled=$('fields').disabled=false;
  describe(target);
  status('Scene mix ready');
  requestAnimationFrame(clock);
}catch(error){status(error.message);}
