const el=id=>document.getElementById(id), canvas=document.querySelector('canvas');
const slider=el('time'), fraction=el('fraction'), play=el('play'), steps=el('steps');
const end=base.timeline.duration, percent=value=>(value*100).toFixed(value<.1 ? 1 : 0)+'%';
const bands=base.finish.materialResponse.recipe.materials.tile.transfer.bands;
let renderer, scene=base, world, events, time=end, frame, running=false;
el('reference').href=el('still').src;
try { renderer=createRenderer(canvas,{toolkit,contextAttributes:{preserveDrawingBuffer:true}}); }
catch (error) {
  canvas.hidden=true;
  el('still').hidden=false;
  el('backend').textContent='Headless still';
  for (const control of [slider,fraction,play]) control.disabled=true;
}
function refresh() {
  world=toolkit.KIT.diorama.build(scene);
  events=world.materialResponse.transfers();
  steps.replaceChildren();
  for (const shoe of ['left','right']) {
    const line=document.createElement('div'), title=document.createElement('span');
    line.className='steps';
    title.className='label';
    title.textContent=shoe;
    line.append(title);
    for (const row of events.filter(row=>row.carrier===shoe && row.action==='deposit')) {
      const button=document.createElement('button');
      button.type='button';
      button.textContent=percent(row.amount);
      button.setAttribute('aria-label',shoe+' shoe at '+row.time.toFixed(2)+' seconds, deposit '+percent(row.amount));
      button.style.setProperty('--ink',bands.findLast(band=>row.amount>=band.at)?.color ?? '#53615a');
      button.dataset.time=row.time;
      button.disabled=!renderer;
      button.addEventListener('click',()=>{ stop(); draw(row.time); });
      line.append(button);
    }
    steps.append(line);
  }
  draw(time);
}
function draw(at) {
  time=at;
  if (renderer) {
    world.anim.update(0,at);
    renderer.render(world,{time:at,width:356,height:128,raw:true,dither:0});
  }
  const current=events.filter(row=>row.time<=at), last=current.at(-1);
  for (const shoe of ['left','right']) {
    const amount=current.findLast(row=>row.carrier===shoe)?.after ?? 0;
    el(shoe).value=amount;
    el(shoe+'-amount').value=percent(amount);
  }
  steps.querySelectorAll('button').forEach(button=>{
    const stamp=Number(button.dataset.time);
    button.dataset.future=stamp>at;
    button.setAttribute('aria-current',String(stamp===last?.time));
  });
  el('detail').textContent=last ? last.carrier[0].toUpperCase()+last.carrier.slice(1)+' shoe '+
    (last.action==='pickup'?'picked up ':'deposited ')+percent(last.amount)+' at '+last.time.toFixed(2)+' s.' :
    'Both shoes are clean before reaching the mud.';
  slider.value=at;
  el('clock').value=at.toFixed(2)+' s';
}
function stop() {
  clearTimeout(frame);
  running=false;
  play.textContent='Play walk';
}
play.addEventListener('click',()=>{
  if (running) return stop();
  const start=performance.now()-(time>=end?0:time*1000);
  running=true;
  play.textContent='Pause';
  function tick() {
    const elapsed=Math.min(end,(performance.now()-start)/1000);
    draw(elapsed);
    if (elapsed>=end) stop();
    else frame=setTimeout(tick,1000/24);
  }
  tick();
});
slider.addEventListener('input',()=>{ stop(); draw(Number(slider.value)); });
fraction.addEventListener('input',()=>{ el('fraction-value').value=fraction.value+'%'; });
fraction.addEventListener('change',()=>{
  stop();
  scene=structuredClone(base);
  scene.finish.materialResponse.recipe.materials.tile.transfer.fraction=Number(fraction.value)/100;
  refresh();
});
el('save').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(scene,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='after-the-rain.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
refresh();
el('message').textContent=renderer?'':'WebGL2 unavailable. Showing the headless export.';
