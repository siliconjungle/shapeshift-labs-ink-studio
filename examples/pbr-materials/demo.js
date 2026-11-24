const el = id => document.getElementById(id);
const canvas = document.querySelector('canvas'), still=el('still'), play=el('play'), slider=el('light');
const controls = [...document.querySelectorAll('[data-mode]')];
el('download').href=still.src;
let renderer, world, mode='physical', angle=initial, animation;

function draw() {
  const isStill=mode==='export';
  still.hidden=!isStill;
  canvas.hidden=isStill;
  if (!isStill) {
    const art=mode==='palette';
    const materials=world.look.pbrMaterials;
    const stylized=art?{
      ...materials,materials:{...materials.materials,
        copper:{...materials.materials.copper,highlight:{color:'#ffe5ad',threshold:.47,strength:.66}},
        lens:{...materials.materials.lens,highlight:{color:'#cfffe6',threshold:.29,strength:.5}}
      }
    }:materials;
    renderer.render(world,{ width,height,raw:!art,outline:art,edges:art,dither:art?.15:0,pixelSize:art?2:1,
      pbrMaterials:mode==='off'?false:stylized,pbrLights:keyLight(angle),changedRows:[] });
  }
  el('backend').textContent=isStill?'Headless export':'Live WebGL';
  el('degrees').value=(isStill?initial:Math.round(angle))+'°';
  slider.value=isStill?initial:angle;
  slider.disabled=play.disabled=isStill||mode==='off';
  for (const control of controls) control.setAttribute('aria-pressed', String(control.dataset.mode===mode));
  document.documentElement.dataset.backend=isStill?'headless':'webgl';
}
function stop() {
  if (animation) cancelAnimationFrame(animation);
  animation=undefined;
  play.textContent='Play';
  play.setAttribute('aria-pressed','false');
}
try {
  const [kitSource,browserSource]=await Promise.all([unpack('@TOOLKIT@'),unpack('@RENDERER@')]);
  const toolkit = new Function(kitSource)();
  const url=URL.createObjectURL(new Blob([browserSource],{type:'text/javascript'}));
  let toolkitBrowser;
  try { toolkitBrowser=await import(url); } finally { URL.revokeObjectURL(url); }
  world=createScene(toolkit,toolkitBrowser);
  renderer=toolkitBrowser.createRenderer(canvas,{toolkit,contextAttributes:{preserveDrawingBuffer:true}});
  draw();
  for (const control of controls) {
    control.disabled=false;
    control.addEventListener('click',()=>{stop();mode=control.dataset.mode;draw();});
  }
  slider.addEventListener('input',()=>{stop();angle=Number(slider.value);draw();});
  play.addEventListener('click',()=>{
    if(animation)return stop();
    const zero=performance.now(), from=angle;
    play.textContent='Pause';
    play.setAttribute('aria-pressed','true');
    const frame = now => {
      angle=((from+180+(now-zero)*.036)%360)-180;
      draw();
      animation=requestAnimationFrame(frame);
    };
    animation=requestAnimationFrame(frame);
  });
} catch (error) {
  console.error(error);
  renderer?.dispose();
  canvas.hidden=true;
  still.hidden=false;
  el('backend').textContent='Headless still';
  el('message').textContent='The live preview could not start. The headless still is available above.';
  document.documentElement.dataset.backend='fallback';
}
