const el=id=>document.getElementById(id), canvas=document.querySelector('canvas');
const world=toolkit.KIT.diorama.build(spec), track=world.materialResponse;
const slider=el('time'), play=el('play'), end=Number(slider.max);
const moments=[...document.querySelectorAll('button[data-time]')];
const durations={ water:spec.finish.materialResponse.recipe.materials.water.ripple.duration,
  stone:spec.finish.materialResponse.recipe.materials.stone.particles.duration };
let renderer, timer, time=.99;
el('reference').href=el('still').src;
try { renderer=createRenderer(canvas,{toolkit,contextAttributes:{preserveDrawingBuffer:true}}); }
catch {
  canvas.hidden=true;
  el('still').hidden=false;
  el('backend').textContent='Headless still';
  for(const control of [slider,play,...moments])control.disabled=true;
}
function draw(at){
  time=at;
  renderer?.render(world,{time:at,width:canvas.width,height:canvas.height,raw:true,dither:0});
  const hits=track.impacts(at);
  for(const material of ['water','stone']){
    const hit=hits.findLast(row=>row.material===material);
    el(material).textContent=hit
      ? hit.particle+' hit at '+hit.time.toFixed(2)+' s · '+(at-hit.time<durations[material]?'Effect active':'Effect ended')
      : 'Waiting for the first hit.';
  }
  slider.value=at;
  el('clock').value=at.toFixed(2)+' s';
  for(const button of moments)button.setAttribute('aria-pressed',String(Math.abs(Number(button.dataset.time)-at)<.004));
}
function stop(){
  clearTimeout(timer);
  timer=undefined;
  play.textContent='Play';
}
play.addEventListener('click',()=>{
  if(timer!==undefined)return stop();
  const start=performance.now()-(time>=end?0:time*1000);
  play.textContent='Pause';
  function tick(){
    const at=Math.min(end,(performance.now()-start)/1000);
    draw(at);
    if(at>=end) stop();
    else timer=setTimeout(tick,1000/24);
  }
  tick();
});
slider.addEventListener('input',()=>{stop();draw(Number(slider.value));});
for(const button of moments)button.addEventListener('click',()=>{stop();draw(Number(button.dataset.time));});
el('save').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(spec,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='kiln-runoff.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
draw(time);
el('message').textContent=renderer?'':'WebGL2 unavailable. Showing the headless export.';
