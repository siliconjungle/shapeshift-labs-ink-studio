import { createRenderer } from '../../webgl.mjs';
import { makeCamera } from '../../src/webgl/view.mjs';

const get=id=>document.getElementById(id);
const status=get('contact-status'), canvas=get('view'), overlay=get('guides'), context=overlay.getContext('2d');
const controls=['replay','pause','rig','contacts'].map(get);
const width=canvas.width, height=canvas.height;
try {
  const scene=sluiceDiverScene({KIT,makeBuilder,makeSculpt}), world=scene.build(scene.seed);
  const {rig,paths,duration}=world.diver;
  const renderer=createRenderer(canvas,{toolkit:{KIT,PixelLook}});
  const view={width,height,ortho:true,raw:true,damp:false};
  const {view:matrix,projection}=makeCamera(world,view,width,height);
  let guides=false, contacts=true, moving=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode='passage', previous, pending, target, pointer=null;

  function screen([x,y,z]) {
    return [(1+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*projection[0])*width/2,
      (1-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*projection[5])*height/2];
  }
  function draw() {
    renderer.render(world,{...view,t:rig.time});
    const touching=new Set(rig.contacts());
    context.clearRect(0,0,width,height);
    if (guides) {
      for (const path of paths) {
        context.beginPath();
        path.forEach((id,i)=>context[i?'lineTo':'moveTo'](...screen(rig.point(id))));
        context.strokeStyle='#14232c'; context.lineWidth=3;
        context.stroke();
        context.strokeStyle='#adc8c0'; context.lineWidth=1;
        context.stroke();
      }
      for (const id of rig.ids) {
        const [x,y]=screen(rig.point(id));
        context.fillStyle='#14232c';
        context.fillRect(Math.round(x)-2,Math.round(y)-2,5,5);
        context.fillStyle=touching.has(id)?'#ffbe76':id==='head'?'#f6ebaf':'#afd9cd';
        context.fillRect(Math.round(x)-1,Math.round(y)-1,3,3);
      }
    }
    if (target) {
      const [x,y]=screen(target).map(Math.round);
      context.fillStyle='#ffdd87';
      context.fillRect(x-3,y,7,1);
      context.fillRect(x,y-3,1,7);
    }
    status.value=touching.size?touching.size+' joints in contact':'No joint contacts';
  }
  function queue() { pending??=requestAnimationFrame(frame); }
  function setPlaying(value) {
    moving=value;
    previous=undefined;
    get('pause').textContent=moving?'Pause':'Resume';
    if (moving) queue();
  }
  function frame(now) {
    pending=undefined;
    if (moving) {
      const end=mode==='passage'?duration:Infinity;
      const dt=Math.max(0,Math.min(end-rig.time, previous===undefined ? 0 : (now-previous)/1000,.05));
      previous=now;
      if (dt) world.anim.update(dt,rig.time+dt);
      if (rig.time>=end-1e-8) setPlaying(false);
    }
    draw();
    if (moving) queue();
  }
  function steer(point) {
    const [x,y]=point;
    target=[Math.max(-3.25,Math.min(3.43,x)),Math.max(-1.48,Math.min(1.44,y)),.14];
    mode='free';
    world.diver.target(target);
    if (!moving) setPlaying(true);
  }
  function steerPointer(e) {
    const rect=overlay.getBoundingClientRect(), x=(e.clientX-rect.left)/rect.width, y=(e.clientY-rect.top)/rect.height;
    steer([(2*x-1)/projection[0]-matrix[12],(1-2*y)/projection[5]-matrix[13]]);
  }
  overlay.addEventListener('pointerdown',event=>{
    pointer=event.pointerId;
    overlay.setPointerCapture(pointer);
    steerPointer(event);
  });
  overlay.addEventListener('pointermove',event=>{if(event.pointerId===pointer)steerPointer(event);});
  overlay.addEventListener('lostpointercapture',()=>{pointer=null;});
  const arrows={ArrowLeft:[-.26,0],ArrowRight:[.26,0],ArrowUp:[0,.26],ArrowDown:[0,-.26]};
  overlay.addEventListener('keydown',event=>{
    const delta=arrows[event.key];
    if (!delta) return;
    event.preventDefault();
    const point=target??rig.point('head');
    steer([point[0]+delta[0],point[1]+delta[1]]);
  });
  function replay() {
    mode='passage';
    target=undefined;
    world.diver.reset();
    setPlaying(true);
  }
  get('replay').addEventListener('click',replay);
  get('pause').addEventListener('click',()=>{if(mode==='passage'&&rig.time>=duration-1e-8)replay();else setPlaying(!moving);});
  get('rig').addEventListener('click',()=>{
    guides=!guides;
    get('rig').setAttribute('aria-pressed',String(guides));
    queue();
  });
  get('contacts').addEventListener('click',()=>{
    contacts=!contacts;
    get('contacts').setAttribute('aria-pressed',String(contacts));
    world.diver.setContacts(contacts);
    queue();
  });
  controls.forEach(button=>button.disabled=false);
  setPlaying(moving);
  queue();
} catch (error) {
  status.value=error.message;
  throw error;
}
