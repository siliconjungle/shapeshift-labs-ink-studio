import { createRenderer } from '../../webgl.mjs';
import { makeCamera } from '../../src/webgl/view.mjs';

const toolkit = { KIT, PixelLook, SpriteSurface };
const W = 168, H = 160;
const palette = [
  0x12212d, 0x172331, 0x203347, 0x354d62, 0x65778b,
  0x522d3f, 0x8d4850, 0xc67863, 0xe8a987, 0xfbd7a9,
  0x192e41, 0x25465a, 0x376e79, 0x5a9b94, 0x8ac4aa,
  0x55293c, 0xa14951, 0xd76b59, 0xf99c68,
  0x745151, 0xcf9b62, 0xfce094
];
const mark = (xy, z, radius, normal, softness = .24) => ({
  points: xy.map(([x,y]) => [x,y,z]), radius, normal, softness
});

function courier() {
  const B = makeBuilder(25,palette), S = KIT.sculpt(makeSculpt(B));
  Object.assign(S,{sun:[.62,.33,.65],amb:.72,sky:.15,sunK:.15,shLen:0,pixel:false});
  const finish = (r, positions, strokes) => KIT.surface.material({r},{
    layers:{diffuse:{type:'diffuse',shadow:false,shadeNormals:{strokes},
      lightingRamp:{stops:r.map((swatch,i) => [positions[i],swatch]),interpolation:'step'}}}
  });
  const skin = finish([5,6,7,8,9],[0,.22,.44,.63,.89],[
    mark([[-.31,1.84],[-.24,1.69],[-.05,1.57],[.12,1.52]],.49,.16,[-.89,-.31,.29]),
    mark([[-.22,2.13],[-.09,2.09],[.025,2.08]],.51,.072,[.2,.95,.23],.32),
    mark([[.16,1.78],[.29,1.81],[.37,1.88]],.53,.078,[.78,.17,.60],.33)
  ]);
  const cloak = finish([10,11,12,13,14],[0,.21,.44,.66,.88],[
    mark([[-.81,1.08],[-.63,.95],[-.47,.88],[-.32,.71]],.24,.16,[-.89,-.23,.39],.2),
    mark([[-.59,.71],[-.42,.57],[-.22,.38],[.03,.24]],.26,.12,[.70,.17,.70],.19),
    mark([[.52,1.04],[.42,.85],[.4,.63],[.56,.4]],.25,.15,[.78,.18,.60],.22),
    mark([[.67,.81],[.55,.61],[.62,.38]],.24,.084,[-.86,-.36,.31],.21)
  ]);
  const ink = {r:[1,2,3]}, hair = {r:[1,2,3,4]}, red = {r:[15,16,17,18]}, gold = {r:[19,20,21]};
  const piece = (loop,z,depth,mat,res=.029,rd=.016) =>
    S.extrude([loop],[0,0,z],depth,mat,{res,rd});
  const mantle = [[-1.03,.21],[-1.01,.51],[-.9,.86],[-.77,1.11],[-.51,1.26],[-.26,1.33],
    [.23,1.33],[.54,1.21],[.76,1.03],[.91,.72],[1.02,.25],[.61,.10],[-.53,.10]];
  const head = [[-.48,1.88],[-.43,2.13],[-.3,2.35],[-.09,2.46],[.19,2.45],[.43,2.32],
    [.46,2.10],[.46,1.96],[.56,1.83],[.47,1.77],[.42,1.61],[.3,1.43],[.15,1.41],
    [-.08,1.5],[-.28,1.66]];
  piece(mantle,-.05,.34,ink,.038,.034);
  piece(mantle,.075,.31,cloak,.027,.033);
  S.ball([.03,1.42,.16],[.31,.33,.19],skin,{res:.034});
  piece(head,.33,.30,skin,.023,.065);
  S.ball([.444,1.91,.473],[.11,.126,.114],skin,{res:.026});
  S.ball([-.382,1.845,.43],[.102,.144,.085],skin,{res:.021});
  piece([[-.54,1.8],[-.61,2.04],[-.60,2.24],[-.50,2.45],[-.32,2.58],[-.07,2.64],
    [.19,2.64],[.47,2.51],[.56,2.34],[.49,2.17],[.44,2.29],[.31,2.36],[.19,2.26],
    [-.03,2.31],[-.22,2.2],[-.37,2.11],[-.39,1.94]],.255,.39,hair,.027,.043);
  piece([[-.54,2.31],[-.4,2.54],[-.16,2.64],[.22,2.66],[.47,2.52],[.54,2.43],
    [.30,2.51],[.11,2.49],[-.16,2.40],[-.36,2.30]],.41,.132,{r:[2,3,3,4]},.024,.025);
  piece([[-.15,2.046],[-.03,2.085],[.10,2.073],[.139,2.035],[.09,2.031],[-.018,2.044]],.483,.044,ink,.014,.009);
  piece([[.274,2.059],[.368,2.083],[.419,2.074],[.429,2.043],[.36,2.044],[.298,2.028]],.478,.040,ink,.014,.009);
  S.ball([.068,2.048,.519],[.017,.015,.011],{r:[9]},{res:.009});
  S.ball([.385,2.053,.507],[.014,.014,.011],{r:[9]},{res:.009});
  piece([[.21,1.626],[.365,1.661],[.393,1.655],[.36,1.625],[.268,1.61]],.481,.045,{r:[5,6]},.014,.008);
  S.ball([-.408,1.772,.482],[.057,.062,.036],gold,{res:.014});
  piece([[-.48,1.46],[-.3,1.52],[-.1,1.46],[.18,1.36],[.41,1.395],[.52,1.29],
    [.35,1.16],[.08,1.13],[-.16,1.23],[-.43,1.24]],.355,.22,red,.023,.038);
  piece([[.18,1.24],[.48,1.25],[.69,1.02],[.74,.79],[.55,.88],[.45,.81],[.32,1.017]],.27,.14,red,.027,.023);
  S.ball([.21,1.185,.474],[.085,.094,.043],gold,{res:.018});
  S.ball([.216,1.198,.51],[.035,.045,.014],{r:[12,14,21]},{res:.013});
  S.bake();
  return B.finish({
    radius:4, dither:0, look:{splatCoverage:'continuous'}, fog:{start:1,max:0,c:0},
    cam:{target:[.025,1.40,0],dist:5.2,fov:2*Math.atan(1.46/5.2),yaw:-.06,pitch:.035,ortho:true}
  });
}

const world = courier(), original = world.surfaces;
const by = id => document.getElementById(id);
const canvases = [by('sculpt'),by('painted')];
const renderers = canvases.map(canvas => createRenderer(canvas,{
  toolkit,contextAttributes:{preserveDrawingBuffer:true}
}));
const light = by('light'), orbit = by('orbit'), play = by('play'), brush = by('brush');
const tracks = {
  left:[-.93,0,.36], right:[.93,0,.36], erase:null
};
let state, active, animation, start, playing = false;

function render() {
  const angle = Number(light.value)*Math.PI/180;
  world.surfaceLight = [[0,Math.sin(angle)*.94,.32,Math.cos(angle)*.94]];
  state = {width:W,height:H,raw:true,changedRows:[],yaw:Number(orbit.value)*Math.PI/180};
  for (let i=0; i<2; i++) renderers[i].render(world,{...state,shadeNormals:i===1});
  by('light-value').value=light.value+'°';
  by('orbit-value').value=orbit.value+'°';
}
function tick(now) {
  start ??= now;
  light.value = Math.round(56*Math.sin((now-start)/1160));
  render();
  animation=requestAnimationFrame(tick);
}
function setPlaying(on) {
  cancelAnimationFrame(animation);
  playing=on;
  start=undefined;
  play.textContent=on?'Pause light':'Play light';
  play.setAttribute('aria-pressed',String(on));
  if(on) animation=requestAnimationFrame(tick);
}
function pick(event) {
  const bounds=canvases[1].getBoundingClientRect();
  const x=(event.clientX-bounds.left)/bounds.width-.5, y=.5-(event.clientY-bounds.top)/bounds.height;
  if(Math.abs(x)>.5||Math.abs(y)>.5) return;
  const camera=makeCamera(world,state,W,H), m=camera.view, back=[m[2],m[6],m[10]];
  const origin=camera.eye.map((value,i) =>
    value+2*camera.tangent*(m[i*4]*x*camera.aspect+m[i*4+1]*y));
  const hit=renderers[1].pick(world,{origin,direction:back.map(n=>-n),limit:1},state);
  const item=hit.solid??hit.dominant, binding=world.surfaceData[(item?.index??-1)*8]-1;
  if (world.surfaces[binding]?.settings.layers?.diffuse?.shadeNormals) return {binding,point:item.point};
}
function edit(binding, mark, replace) {
  const next=world.surfaces.slice(), entry=next[binding], settings=entry.settings, diffuse=settings.layers.diffuse;
  const strokes=diffuse.shadeNormals.strokes, kept=replace ? strokes.slice(0,-1) : strokes;
  if(kept.length>=256) return false;
  next[binding]={...entry,settings:{...settings,layers:{...settings.layers,diffuse:{
    ...diffuse,shadeNormals:{strokes:[...kept,mark]}
  }}}};
  world.surfaces=next;
  render();
  return true;
}

canvases[1].addEventListener('pointerdown',event=>{
  if(event.button!==0||active) return;
  setPlaying(false);
  const hit=pick(event);
  if(!hit) return;
  const stroke={points:[hit.point],radius:.155,normal:tracks[brush.value],softness:.3};
  if(!edit(hit.binding,stroke,false)) return;
  active={id:event.pointerId,binding:hit.binding,stroke};
  canvases[1].setPointerCapture(event.pointerId);
});
canvases[1].addEventListener('pointermove',event=>{
  if(active?.id!==event.pointerId) return;
  const hit=pick(event), {stroke,binding}=active;
  if(hit?.binding!==binding) { active=undefined; return; }
  if(stroke.points.length>=1024||KIT.V.dist(stroke.points.at(-1),hit.point)<.028) return;
  active.stroke={...stroke,points:[...stroke.points,hit.point]};
  edit(binding,active.stroke,true);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])
  canvases[1].addEventListener(type,event=>{ if(active?.id===event.pointerId) active=undefined; });
for(const slider of [light,orbit])
  slider.addEventListener('input',()=>{setPlaying(false);render();});
play.addEventListener('click',()=>setPlaying(!playing));
by('reset').addEventListener('click',()=>{world.surfaces=original;render();});
render();
document.body.dataset.ready='true';
