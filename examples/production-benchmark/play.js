/* Run the native world on a simulation clock and schedule its emitted intents on the audio clock. */
'use strict';
const el=id=>document.getElementById(id);
const x={landing:120,passage:360,chamber:600};
let audio,buffers,engine,origin,playing,version,busy=false,requested=null;
const sources=new Set();
function sound(id,at,loop,gain) {
  const node=audio.createBufferSource(), fader=audio.createGain();
  node.buffer=buffers[id]; node.loop=loop; fader.gain.value=gain;
  node.connect(fader).connect(audio.destination);
  sources.add(node);
  node.onended=()=>{sources.delete(node);node.disconnect();fader.disconnect();};
  node.start(at);
  return {node,fader};
}
function cue(name,when) {
  const at=Math.max(audio.currentTime,origin+when), fade=BENCHMARK.fade[version];
  if (playing) {
    playing.fader.gain.cancelAndHoldAtTime(at);
    playing.fader.gain.linearRampToValueAtTime(0,at+fade);
    playing.node.stop(at+fade+.001);
  }
  playing=sound(version+'-'+name,at,true,0);
  playing.fader.gain.linearRampToValueAtTime(.9,at+fade);
}
function dispatch(value) {
  const tick=engine.view().tick+1;
  engine.schedule([{tick,action:'world/input',args:{port:'score/parameter.route',value}}]);
  requested=value===1?'chamber':value===0?'landing':'passage';
  el('state').textContent='Waiting for the next musical boundary.';
  controls(engine.view().states.score.clock.section);
}
function controls(section) {
  el('approach').disabled=section!=='landing' || requested==='passage';
  el('retreat').disabled=section==='chamber' || section==='landing' && requested!=='passage' || requested==='landing';
  el('open').disabled=section!=='passage' || requested==='chamber';
  el('back').disabled=section!=='chamber' || requested==='passage';
}
function place(section) {
  el('position').setAttribute('cx',x[section]);
  el('door').classList.toggle('closed',section!=='chamber');
  el('state').textContent=section==='chamber'?'Chamber open. Listen to what carries through the return.':
    section==='passage'?'In the passage. You can wait, turn back, or open the chamber.':'At the landing.';
  controls(section);
}
function tick() {
  if (!engine) return;
  const limit=Math.floor((audio.currentTime-origin+.12)/BENCHMARK.world.dt);
  for (let i=0;i<40 && engine.view().tick<limit;i++) {
    const state=engine.step();
    for (const intent of state.states.score.intents) {
      if (intent.kind==='music-transition') {
        requested=null;
        cue(intent.to,intent.time);
        place(intent.to);
      } else if (intent.kind==='music-cue') sound(version+'-'+intent.resource,Math.max(audio.currentTime,origin+intent.time),false,.9);
    }
  }
  requestAnimationFrame(tick);
}
el('approach').onclick=()=>dispatch(.54);
el('retreat').onclick=()=>dispatch(0);
el('open').onclick=()=>dispatch(1);
el('back').onclick=()=>dispatch(.54);
el('start').onclick=async()=>{
  if (busy) return;
  busy=true;
  try {
    if (!audio) audio=new AudioContext();
    await audio.resume();
    if (!buffers) buffers=Object.fromEntries(await Promise.all(Object.entries(BENCHMARK.assets).map(async ([name,data])=>
      [name,await audio.decodeAudioData(Uint8Array.from(atob(data),letter=>letter.charCodeAt(0)).buffer)])));
    const running=Boolean(engine);
    for (const node of sources) node.stop();
    playing=null; requested=null; version=el('version').value;
    engine=KIT.world.runtime.create(BENCHMARK.world);
    origin=audio.currentTime+.20;
    if (version==='revised') sound('carrier',origin,true,.72);
    cue('landing',0);
    place('landing');
    el('start').textContent='Restart world';
    if (!running) tick();
  } catch (error) {
    el('state').textContent=error.message;
  } finally {busy=false;}
};
