import {createLiveSampleCapture} from './sample-capture.mjs';
import {createPassClock,createMidiCapture} from './recording-clock.mjs';

const $=id=>document.getElementById(id);
const choose=(value,label=value)=>new Option(label,value);
const keys='awsedftgyhujk';
const white=[0,2,4,5,7,9,11,12];

export function setupRecording({state,inspect,context,post,command,refresh,client,status}) {
  const rate=state().sampleRate, passClock=createPassClock();
  const historySeconds=Math.min(29,1.9e6/rate);
  let stream,mic,micFrom=Infinity,readingMic=false,monitor,monitorContext,loading,revision=0;
  let access,input,armedAt,scoreFrom=0,busy=false,auto=false,lastAuto=-1;
  const saved=new Map(), keysHeld=new Set();
  const capture=createMidiCapture(rate,message=>monitor?.port.postMessage(message));
  const message=error=>status(error.message);
  const act=fn=>async event=>{try {await fn(event);} catch (error) {message(error);}};
  const warn=text=>$('record-status').textContent=text;
  const audioFrame=(now=performance.now())=>{
    const audio=context(false);
    if (!audio) return 0;
    const stamp=audio.getOutputTimestamp?.();
    const heard=stamp?.performanceTime>0 && audio.state==='running'
      ? stamp.contextTime+(now-stamp.performanceTime)/1000
      : audio.currentTime;
    return Math.max(0,Math.floor(Math.min(audio.currentTime,heard)*rate));
  };

  function stopAuto() {
    auto=false;
    $('record-toggle').textContent='Record passes';
    $('record-toggle').setAttribute('aria-pressed','false');
  }

  function inputsChanged() {
    stopAuto();
    warn('Waiting for a complete loop pass');
    show();
  }

  let scoreLanes=[];
  function show() {
    const notes=inspect(), selected=$('record-lane').value;
    const eligible=scoreLanes.filter(lane=>notes?.pins[lane]!=='all' &&
      ($('record-mode').value!=='notes' || notes?.pins[lane]!=='pitch'));
    if (eligible.join()!==[...$('record-lane').options].map(row=>row.value).join()) {
      $('record-lane').replaceChildren(...eligible.map(id=>choose(id)));
      if (eligible.includes(selected)) $('record-lane').value=selected;
    }
    const micLane=$('mic-lane').value;
    const micLanes=Object.entries(notes?.lanes ?? {}).filter(([name,row])=>row.kind==='audio' && notes.pins[name]!=='all')
      .map(([name])=>name);
    if (['',...micLanes].join()!==[...$('mic-lane').options].map(row=>row.value).join()) {
      $('mic-lane').replaceChildren(choose('','New mic lane'),...micLanes.map(id=>choose(id)));
      if (micLanes.includes(micLane)) $('mic-lane').value=micLane;
    }
    const instrumental=$('record-mode').value!=='mic' && eligible.length>0;
    $('record-lane').disabled=!instrumental;
    $('keys-enable').disabled=!instrumental;
    $('midi-enable').disabled=!instrumental || !!access;
    $('mic-toggle').disabled=readingMic;
    $('mic-lane').disabled=!mic;
    $('mic-offset').disabled=!mic;
    $('record-toggle').disabled=busy;
    $('recover-pass').disabled=busy;
  }

  async function instrument() {
    const audio=context();
    await audio.resume();
    const lane=$('record-lane').value;
    if (!lane) throw new Error('Choose a native instrument lane');
    const activeRevision=revision;
    if (monitorContext===lane) return;
    if (loading?.lane===lane && loading.revision===activeRevision) return loading.job;
    const job=(async()=>{
      const info=await command('instrument',{lane});
      if (!monitor) {
        await audio.audioWorklet.addModule('/instrument-worklet.mjs');
        if (activeRevision!==revision) return;
        if (!monitor) {
          monitor=new AudioWorkletNode(audio,'ink-session-instrument',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
          monitor.connect(audio.destination);
        }
      }
      const assets=Object.fromEntries(await Promise.all(info.assets.map(async asset=>{
        const response=await post('/instrument-asset',{lane,asset});
        const source=await audio.decodeAudioData(await response.arrayBuffer());
        const channels=Math.min(2,source.numberOfChannels), samples=new Float32Array(source.length*channels);
        for (let ch=0;ch<channels;ch++) {
          const data=source.getChannelData(ch);
          for (let i=0;i<source.length;i++) samples[i*channels+ch]=data[i];
        }
        return [asset,{channels,sampleRate:source.sampleRate,samples}];
      })));
      if (activeRevision!==revision) return;
      const id=crypto.randomUUID();
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('The instrument monitor did not start')),4000);
        function finish(error) {
          clearTimeout(timer);
          monitor.port.removeEventListener('message',receive);
          if (error) reject(error); else resolve();
        }
        function receive({data}) {
          if (data.id===id) finish(data.error ? new Error(data.error) : undefined);
        }
        monitor.port.addEventListener('message',receive);
        monitor.port.start();
        monitor.port.postMessage({id,type:'patch',patch:info.patch,performance:info.performance,assets,gain:info.gain},
          Object.values(assets).map(({samples})=>samples.buffer));
      });
      if (activeRevision===revision) monitorContext=lane;
    })();
    loading={lane,revision:activeRevision,job};
    try {await job;}
    finally {if (loading?.job===job) loading=undefined;}
  }

  function midiMessage(data,time) {
    if ($('record-mode').value==='mic') return;
    if (!monitorContext) return;
    capture.midi(data,audioFrame(time));
  }

  function releaseInputs() {
    keysHeld.clear();
    capture.releaseAll(audioFrame());
    for (const key of document.querySelectorAll('.piano-key')) key.classList.remove('down');
  }

  function ports() {
    const selected=$('midi-port').value, found=[...access.inputs.values()].filter(port=>port.state==='connected');
    $('midi-port').replaceChildren(...found.map(port=>choose(port.id,port.name || 'MIDI input')));
    if (found.some(port=>port.id===selected)) $('midi-port').value=selected;
    $('midi-port').disabled=!found.length;
    bindPort();
  }
  function bindPort() {
    const next=access.inputs.get($('midi-port').value);
    if (next===input) return;
    if (input) input.onmidimessage=null;
    releaseInputs();
    input=next;
    if (input) input.onmidimessage=event=>midiMessage(event.data,event.timeStamp);
    warn(input ? 'MIDI connected · '+(input.name || 'Controller') : 'No MIDI device connected');
  }
  $('midi-enable').addEventListener('click',act(async()=>{
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable here. Use a Chromium browser or the on-screen keys.');
    const request=navigator.requestMIDIAccess({sysex:false});
    [access]=await Promise.all([request,instrument()]);
    access.addEventListener('statechange',ports);
    $('midi-enable').disabled=true;
    ports();
  }));
  $('midi-port').addEventListener('change',bindPort);

  $('keys-enable').addEventListener('click',act(async()=>{
    await instrument();
    $('piano').hidden=false;
    $('piano').focus();
    warn('Instrument ready');
  }));
  for (const offset of white) {
    const row=document.createElement('button');
    row.type='button';
    row.className='piano-key';
    row.textContent='C D E F G A B C'.split(' ')[white.indexOf(offset)]+' · '+keys[offset].toUpperCase();
    row.addEventListener('pointerdown',event=>{
      event.preventDefault();
      row.setPointerCapture(event.pointerId);
      row.classList.add('down');
      midiMessage([0x90,60+offset,95],event.timeStamp);
    });
    const release=event=>{
      row.classList.remove('down');
      midiMessage([0x80,60+offset,0],event.timeStamp);
    };
    row.addEventListener('pointerup',release);
    row.addEventListener('pointercancel',release);
    row.addEventListener('keydown',event=>{
      if (event.key!==' ' && event.key!=='Enter' || event.repeat) return;
      event.preventDefault();
      midiMessage([0x90,60+offset,95],event.timeStamp);
    });
    row.addEventListener('keyup',event=>{
      if (event.key===' ' || event.key==='Enter') {
        event.preventDefault();
        midiMessage([0x80,60+offset,0],event.timeStamp);
      }
    });
    $('piano-keys').append(row);
  }
  $('piano').addEventListener('keydown',event=>{
    const key=event.key.toLowerCase(), offset=keys.indexOf(key);
    if (event.ctrlKey || event.metaKey || offset<0 || keysHeld.has(key)) return;
    event.preventDefault();
    keysHeld.add(key);
    midiMessage([0x90,60+offset,95],event.timeStamp);
  });
  window.addEventListener('keyup',event=>{
    const key=event.key.toLowerCase();
    if (keysHeld.delete(key)) midiMessage([0x80,60+keys.indexOf(key),0],event.timeStamp);
  });
  window.addEventListener('blur',releaseInputs);
  for (const [id,cc] of [['breath',2],['room-level',91]])
    $(id).addEventListener('input',event=>midiMessage([0xb0,cc,Number(event.target.value)],event.timeStamp));
  $('pressure-level').addEventListener('input',event=>midiMessage([0xd0,Number(event.target.value)],event.timeStamp));

  function releaseMic() {
    const current=stream;
    mic?.close();
    mic=stream=undefined;
    micFrom=Infinity;
    current?.getTracks().forEach(track=>track.stop());
    $('mic-toggle').textContent='Enable mic';
    inputsChanged();
  }

  $('mic-toggle').addEventListener('click',act(async()=>{
    if (mic) {
      releaseMic();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable here');
    const audio=context();
    readingMic=true;
    show();
    try {
      await audio.resume();
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,
        echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const source=stream, track=source.getAudioTracks()[0], node=audio.createMediaStreamSource(source);
      mic=await createLiveSampleCapture(audio,{node,source:{kind:'mic',name:track.label || 'Microphone'},channels:1,historySeconds});
      track.addEventListener('ended',()=>{
        if (stream===source) {releaseMic();warn('Microphone disconnected');}
      },{once:true});
      micFrom=Math.ceil(audio.currentTime*rate);
      $('mic-toggle').textContent='Disable mic';
      inputsChanged();
    } catch (error) {
      stream?.getTracks().forEach(track=>track.stop());
      stream=undefined;
      throw error;
    } finally {readingMic=false;show();}
  }));

  $('record-lane').addEventListener('change',act(async()=>{
    releaseInputs();
    capture.reset();
    scoreFrom=audioFrame();
    revision++;
    monitorContext=undefined;
    inputsChanged();
    if (monitor || loading) await instrument();
  }));
  $('record-mode').addEventListener('change',()=>{
    const previous=$('record-lane').value;
    inputsChanged();
    if ($('record-lane').value!==previous) $('record-lane').dispatchEvent(new Event('change'));
  });
  $('mic-lane').addEventListener('change',inputsChanged);

  const mode=()=>$('record-mode').value;
  function setup() {
    const selected=mode();
    if (selected==='mic' && !mic) throw new Error('Enable the microphone first');
    if (selected!=='mic' && !monitorContext) throw new Error('Enable MIDI or open the on-screen keys first');
    const offset=Math.round(Number($('mic-offset').value || 0)*rate/1000);
    if (!Number.isFinite(offset) || Math.abs(offset)>rate*.25) throw new Error('Mic offset must be within ±250 ms');
    const {from,to}=state().loop, seconds=(to-from)/rate;
    const cap=mic ? Math.min(26,historySeconds-1) : 26;
    if (seconds<.25 || seconds>cap) throw new Error('For recording, set a loop between 0.25 and '+Math.floor(cap)+' seconds');
    return {selected,offset:mic ? offset : 0,since:Math.max(selected==='mic' ? 0 : scoreFrom,
      mic ? micFrom-offset : 0),lane:$('record-lane').value,micLane:$('mic-lane').value};
  }

  function pack(meta,samples) {
    const header=new TextEncoder().encode(JSON.stringify(meta));
    const value=new Uint8Array(4+header.length+4*(samples?.length ?? 0));
    const view=new DataView(value.buffer);
    view.setUint32(0,header.length,true);
    value.set(header,4);
    for (let i=0;i<(samples?.length ?? 0);i++) view.setFloat32(4+header.length+i*4,samples[i],true);
    return value;
  }

  async function commit(pass, settings) {
    const key=[pass.first,pass.from,pass.to,settings.selected,settings.lane,Boolean(mic)].join('/');
    if (saved.has(key)) {warn('Pass '+(pass.pass+1)+' is already in the take lanes');return;}
    busy=true;
    show();
    try {
      const {selected,lane,micLane,offset}=settings;
      const notes=selected==='notes' ? capture.played(pass.first,pass.end) : undefined;
      const gesture=selected==='gesture' ? capture.gestures(pass.first,pass.end) : undefined;
      const hasNotes=notes?.length>0, hasGesture=gesture && Object.keys(gesture).length>0;
      if (!mic && !hasNotes && !hasGesture) {
        warn('Pass '+(pass.pass+1)+' had no '+(selected==='notes' ? 'notes' : 'controller movement'));
        return;
      }
      const record=mic && await mic.capture({firstSample:pass.first+offset,endSample:pass.end+offset});
      const meta={client,id:crypto.randomUUID().replaceAll('-','').slice(0,24),from:pass.from,to:pass.to,pass:pass.pass,
        ...(hasNotes && {lane,notes}),...(hasGesture && {lane,gesture}),...(record && {mic:{...(micLane && {lane:micLane})}})};
      const response=await post('/record',pack(meta,record?.value.samples));
      const ack=await response.json();
      saved.set(key,ack.take);
      await refresh(true);
      if (ack.micLane && !micLane) $('mic-lane').value=ack.micLane;
      const names=[hasNotes || hasGesture ? lane : '',ack.micLane].filter(Boolean);
      warn('Pass '+(pass.pass+1)+' saved as '+ack.take+' · '+names.join(' + '));
    } catch (error) {
      stopAuto();
      throw error;
    } finally {busy=false;show();}
  }

  $('recover-pass').addEventListener('click',act(async()=>{
    const settings=setup(), now=audioFrame()-Math.max(0,settings.offset);
    const pass=passClock.last(now,Math.max(settings.since,now-(historySeconds-.5)*rate));
    if (!pass) throw new Error('Play one complete loop pass with the selected inputs enabled');
    await commit(pass,settings);
  }));
  $('record-toggle').addEventListener('click',act(async()=>{
    if (auto) {stopAuto();warn('Pass recording stopped');return;}
    setup();
    const audio=context(false);
    if (audio?.state!=='running' || !state().recordingPlayback) throw new Error('Press Play before recording passes');
    auto=true;
    armedAt=audioFrame();
    lastAuto=-1;
    $('record-toggle').textContent='Stop recording';
    $('record-toggle').setAttribute('aria-pressed','true');
    warn('Recording starts at the next loop boundary');
  }));

  command('recording-lanes').then(lanes=>{scoreLanes=lanes;show();}).catch(message);
  show();
  return Object.freeze({
    show,
    schedule:passClock.schedule,
    newLoop(){stopAuto();passClock.reset();warn('Waiting for a complete loop pass');},
    tick() {
      if (!auto || busy || !state().recordingPlayback) return;
      try {
        const settings=setup(), now=audioFrame()-Math.max(0,settings.offset);
        const pending=passClock.passes(now,Math.max(settings.since,armedAt,now-(historySeconds-.5)*rate));
        const pass=pending.find(pass=>pass.first>lastAuto);
        if (!pass) return;
        lastAuto=pass.first;
        void commit(pass,settings).catch(message);
      } catch (error) {stopAuto();message(error);}
    },
    pause(){releaseInputs();},
    close(){mic?.close();stream?.getTracks().forEach(track=>track.stop());}
  });
}
