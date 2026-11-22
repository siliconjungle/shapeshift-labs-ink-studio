/* Browser host for the portable live engine. The browser owns the output clock and device. */
(() => {
  'use strict';
  const {sources,timeline,clock,options,streams,waves}=globalThis.floodgate;
  const rate=options.sampleRate, live=KIT.music.production.live;
  const byId=name=>document.getElementById(name), start=byId('start');
  const buttons=[...document.querySelectorAll('[data-scene]')], busy=byId('busy'), late=byId('late');
  const canvas=document.querySelector('canvas'), art=canvas.getContext('2d');
  const display=name=>name ? name[0].toUpperCase()+name.slice(1) : '—';
  const decode=value=>{
    const bytes=Uint8Array.from(atob(value),symbol=>symbol.charCodeAt(0)), data=new DataView(bytes.buffer);
    return {read(first,count) {
      return Float32Array.from({length:count},(_,i)=>data.getInt16(2*(first+i),true)/32768);
    }};
  };
  const banks=Object.fromEntries(Object.entries(waves).map(([name,data])=>[name,decode(data)]));
  let context, engine, playing=false, timer, cursor=0, deviceTime=0, gaps=0, pumping=false, last;
  let averageMs=0, nextProfile=0;
  function rows(target,values) {
    target.replaceChildren(...values.flatMap(([key,value])=>{
      const label=document.createElement('dt'), data=document.createElement('dd');
      label.textContent=key; data.textContent=value;
      return [label,data];
    }));
  }
  function meter(block,peakVoices) {
    const {width,height}=canvas, mid=height/2;
    art.fillStyle='#121b1b'; art.fillRect(0,0,width,height);
    art.strokeStyle='#28403a';
    for (let x=0;x<width;x+=40) {
      art.beginPath(); art.moveTo(x,0); art.lineTo(x,height); art.stroke();
    }
    for (let y=15;y<height;y+=40) {
      art.beginPath(); art.moveTo(0,y); art.lineTo(width,y); art.stroke();
    }
    if (!block) return;
    const frames=block.samples.length/2;
    for (const channel of [0,1]) {
      art.beginPath(); art.strokeStyle=channel ? '#62a694' : '#b8faa7';
      for (let x=0;x<width;x++) {
        const frame=Math.floor(x/width*frames);
        const y=mid+channel*39-20-block.samples[2*frame+channel]*height*.87;
        if (x) art.lineTo(x,y); else art.moveTo(x,y);
      }
      art.stroke();
    }
    art.fillStyle='#b8faa7';
    art.fillRect(0,height-3,width*peakVoices/options.maxVoices,3);
  }
  function show() {
    const state=engine.inspect(), profile=state.profile, join=state.joins.at(-1);
    byId('position').textContent=display(state.section)+' · '+state.position.toFixed(2)+' s · '+state.phrase;
    byId('pending').textContent=state.pending ?
      display(state.pending.to)+' at '+(state.pending.frame/rate).toFixed(2)+' s' :
      'Output '+state.time.toFixed(2)+' s';
    rows(byId('profile'),[
      ['Voices',profile.activeVoices+' / '+profile.maxVoices+' · '+profile.reservedVoices+' reserved'],
      ['Foreground',profile.foregroundStarts+' played · '+profile.foregroundDropped+' dropped'],
      ['Background dropped',profile.dropped-profile.foregroundDropped],
      ['PCM pages',profile.stream.ready+' / '+profile.stream.maxPages+' · '+profile.stream.reads+' reads'],
      ['Late events',profile.lateEvents+' · '+profile.cancellations+' cancelled exits'],
      ['Underruns',profile.streamGaps+' source · '+gaps+' device'],
      ['Render / 32 ms',averageMs.toFixed(2)+' ms average']
    ]);
    if (join) rows(byId('join'),[
      ['Path',display(join.from)+' → '+display(join.to)],
      ['Trigger',join.trigger.rule+' · '+join.trigger.time.toFixed(2)+' s'],
      ['Exit / entry',join.exit.played.toFixed(2)+' s → '+join.entry.offset.toFixed(2)+' s'],
      ['Selected phrase',join.entry.phrase],
      ['Previously heard',Object.entries(join.heard.phrases).map(([name,count])=>name+' × '+count).join(', ') || 'No completed phrase'],
      ['Held and ringing',join.carry.held.map(row=>row.part+' '+row.pitch+' ('+row.state+')').join(', ') || 'No held note'],
      ['FX continuity',[...join.carry.echoes.map(name=>name+' echo'),'room'].join(', ')]
    ]);
    const traces=state.trace.filter(row=>row.kind.startsWith('transition') || row.kind==='late-event').slice(-8);
    byId('trace').textContent=traces.length ? JSON.stringify(traces,null,2) : 'No transitions yet.';
    meter(last,profile.lastBlock?.peakVoices ?? 0);
  }
  async function pump() {
    if (!playing || pumping) return;
    pumping=true;
    try {
      if (deviceTime<context.currentTime) {
        deviceTime=context.currentTime+.025;
        gaps++;
      }
      while (playing && deviceTime<context.currentTime+.098) {
        await engine.prefetch(3328,['bell','chain','foam']);
        if (!playing) break;
        const at=performance.now(), count=1024;
        const sound=engine.pull(count);
        averageMs+=(performance.now()-at-averageMs)*.08;
        cursor+=count;
        const buffer=context.createBuffer(2,count,rate);
        for (const ch of [0,1]) {
          const data=buffer.getChannelData(ch);
          for (let i=0;i<count;i++) data[i]=sound.samples[2*i+ch];
        }
        const source=context.createBufferSource();
        source.buffer=buffer;
        source.connect(context.destination);
        source.start(deviceTime);
        deviceTime+=count/rate;
        last=sound;
      }
      if (performance.now()>=nextProfile) {
        show();
        nextProfile=performance.now()+100;
      }
    } catch (error) {
      byId('pending').textContent=error.message;
      playing=false;
      start.textContent='Resume';
      clearInterval(timer);
    } finally {
      pumping=false;
    }
  }
  function hit(resource,time) {
    engine.dispatch({kind:'music-cue',resource,time});
  }
  start.addEventListener('click',async()=>{
    start.disabled=true;
    try {
      if (playing) {
        playing=false;
        clearInterval(timer);
        await context.suspend();
        start.textContent='Resume';
        return;
      }
      if (!engine) {
        context ??= new AudioContext();
        engine=live.open(sources,timeline,{...options,clock,streams,readPage:(name,first,count)=>banks[name].read(first,count)});
        await engine.prefetch(3328,['bell','chain','foam']);
        hit('foam',.12);
        for (const button of [...buttons,busy,late]) button.disabled=false;
      }
      await context.resume();
      playing=true;
      if (!deviceTime) deviceTime=context.currentTime+.045;
      start.textContent='Pause';
      timer=setInterval(pump,18);
      pump();
    } catch (error) {
      byId('pending').textContent=error.message;
    } finally {
      start.disabled=false;
    }
  });
  for (const button of buttons) button.addEventListener('click',()=>{
    for (const item of buttons) item.setAttribute('aria-pressed',String(item===button));
    engine.update({time:cursor/rate,parameters:Object.fromEntries(buttons.map(item=>
      [item.dataset.scene,Number(item===button)]))});
  });
  busy.addEventListener('click',()=>{
    const time=cursor/rate;
    for (let i=0;i<28;i++) hit('chain',time+.045+.059*i);
    hit('foam',time+.08);
  });
  late.addEventListener('click',()=>hit('bell',Math.max(0,cursor/rate-.36)));
  meter();
})();
