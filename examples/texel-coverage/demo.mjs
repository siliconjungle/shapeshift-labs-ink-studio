import { bakeObjectTexels, createRenderer } from '../../webgl.mjs';
import { makeCamera } from '../../src/webgl/view.mjs';

const colors = [
  0x101c29,0x263447,0x425468,0x7e8897,
  0x123f46,0x21616b,0x358b91,0x64beb7,0xb2eee1,
  0x472c25,0x874933,0xc87644,0xf0af63,0xffdf9f,
  0x566876,0x71675c,0x31304a,0x624777
];
const enamel = [4,5,6,7,8], copper = [9,10,11,12,13];
const bands = [
  [0x143c4b,0x276676,0x488e9a,0x89d2c5,0xb2eee1],
  [0x24293e,0x3f4c73,0x626e9b,0x9daece,0xcdd9ed],
  [0x3a2444,0x65364c,0x99536b,0xd18e95,0xf3cbc5]
];
const rgb = color => [color>>16,color>>8&255,color&255];
const get = id => document.getElementById(id);
const panes = [...document.querySelectorAll('canvas')];
const renderers = panes.map(canvas =>
  createRenderer(canvas, { toolkit: { KIT, PixelLook, SpriteSurface } }));

function lanternMesh() {
  const points = [], triangles = [];
  const rings = [[-.82,.64,.53],[-.74,.73,.62],[-.59,.73,.62],[-.51,.55,.48],
    [.49,.55,.48],[.58,.73,.63],[.69,.70,.61],[.86,.35,.31],[.95,.30,.27]];
  for (const [y, x, z] of rings)
    points.push(-x,y,-z, -x,y,z, x,y,z, x,y,-z);
  for (let i=0;i<rings.length-1;i++) for (let j=0;j<4;j++){
    const a=i*4+j, b=i*4+(j+1)%4, c=b+4, d=a+4;
    triangles.push(a,b,c,a,c,d);
  }
  const top = (rings.length-1)*4;
  triangles.push(0,2,1,0,3,2,top,top+1,top+2,top,top+2,top+3);
  return { points, triangles };
}

function lanternPaint({ point:[x,y,z], normal:[nx,ny,nz] }) {
  const u = Math.abs(nz)>0.5 ? x : z;
  const face = Math.abs(nz)>0.5;
  if (Math.abs(ny)>.45 || y<-.55 || y>.52)
    return colors[copper[ny>.4?3:nx>.2?1:2]];
  const shine = nx>.4 ? 0 : 1;
  if (Math.abs(u)<.31 && y>-.39 && y<.35) {
    if (Math.abs(u)>.26 || y<-.33 || y>.29) return colors[10+shine];
    if (face) {
      const mark = Math.abs(u)+Math.abs(y)*.85;
      if (mark<.17) return colors[13];
      if (mark<.24 || Math.abs(u)<.024 || Math.abs(y+.16)<.024) return colors[11];
      return colors[9];
    }
    if (Math.abs(y-.15)<.03 || Math.abs(y)<.03 || Math.abs(y+.15)<.03)
      return bands[0][4];
    return bands[0][1];
  }
  if (Math.abs(u)>.43 || y>.42 || y<-.45) return bands[0][0];
  if (Math.abs(u)>.36) return bands[0][3+shine];
  return bands[0][1+shine];
}

function lantern(resolution) {
  const baked = bakeObjectTexels(lanternMesh(), {
    resolution, paint:lanternPaint,
    fallback: (_triangle, [x,y]) => colors[copper[y>.4?3:x>.2?1:2]]
  });
  const atlas = SpriteSurface.make(baked.width);
  const region = atlas.reserve(baked.width,baked.height);
  atlas.meshRegion(baked,region);
  const world = makeBuilder(25,colors).finish({
    radius:2.2, dither:0, spriteSurfaces:atlas.finish(),
    cam:{ target:[0,.04,0], dist:4.25, pitch:.21, yaw:.4 }
  });
  let lastBand;
  const enamelLookup = new Map(bands[0].map((c,i)=>[c,i]));
  return {
    world,
    tint(band) {
      if (band===lastBand) return;
      const rgba=baked.rgba.slice();
      for(let i=0;i<rgba.length;i+=4) {
        const id=enamelLookup.get(rgba[i]<<16|rgba[i+1]<<8|rgba[i+2]);
        if (id!==undefined) rgba.set(rgb(bands[band][id]),i);
      }
      SpriteSurface.update(world.spriteSurfaces,region,{w:baked.width,h:baked.height,rgba});
      lastBand=band;
    }
  };
}

function crossing() {
  const B=makeBuilder(17,colors), S=KIT.sculpt(makeSculpt(B));
  const plate={r:[1,2,3]}, blue={r:enamel,materialId:'enamel'}, amber={r:copper,materialId:'copper'};
  S.box([0,0,-.19],[1.42,1.04,.12],plate,{res:.058,rd:.07,objectId:'plate'});
  S.box([0,0,-.045],[1.31,.93,.08],blue,{res:.046,rd:.05,objectId:'tile'});
  S.tube([[-1.08,-.64,.13],[.17,.49,.13],[1.16,-.20,.13]],.13,.13,amber,
    {res:.035,objectId:'trace'});
  for(const [x,y] of [[-1.08,-.64],[.17,.49],[1.16,-.20]])
    S.ball([x,y,.14],[.213,.213,.082],amber,{res:.032,objectId:'trace'});
  S.bake();
  return B.finish({ radius:3, dither:0, look:{coverageVote:{ramps:{enamel,copper}}},
    cam:{target:[0,0,.0],yaw:.08,pitch:.05,dist:4.85,ortho:true} });
}

const worlds=[lantern(44),lantern(12)];
const edgeWorld=crossing();
const cameraProbe=makeCamera(edgeWorld,{ stable:false },panes[2].width,panes[2].height);
const orbit=get('orbit'), phase=get('phase'), play=get('play'), status=get('status');
let angle=Number(orbit.value), offset=Number(phase.value), previous, request, playing=false;
function draw(now) {
  request=undefined;
  if(playing && previous!==undefined){
    angle=((angle+Math.min(45,now-previous)*.024+180)%360)-180;
    offset=Math.sin(now*.0012)*95;
  }
  previous=now;
  orbit.value=Math.round(angle); phase.value=Math.round(offset);
  get('degrees').value=orbit.value+'°';
  get('phase-value').value=(offset/100).toFixed(2)+' px';
  try{
    const abs=Math.abs(angle), band=abs<54?0:abs<126?1:2;
    for(const [i,entry] of worlds.entries()){
      entry.tint(band);
      const {width,height}=panes[i];
      renderers[i].render(entry.world,{width,height,raw:true,camera:{...entry.world.cam,yaw:angle*Math.PI/180},changedRows:[]});
    }
    for(let i=2;i<4;i++){
      const {width,height}=panes[i];
      const shift=offset/100*2*cameraProbe.tangent/height;
      const target=[cameraProbe.view[0]*shift,cameraProbe.view[4]*shift,cameraProbe.view[8]*shift];
      renderers[i].render(edgeWorld,{width,height,colored:false,dither:0,stable:false,
        coverageVote:i===2?false:undefined,camera:{...edgeWorld.cam,target},changedRows:[]});
    }
    status.hidden=true;
    document.body.dataset.ready='true';
  }catch(error){
    status.textContent=error.message;status.hidden=false;setPlay(false);
  }
  if(playing)redraw();
}
function redraw(){ request??=requestAnimationFrame(draw); }
function setPlay(value){
  playing=value;previous=undefined;
  play.textContent=playing?'Pause':'Play';play.setAttribute('aria-pressed',playing);
}
orbit.addEventListener('input',()=>{setPlay(false);angle=Number(orbit.value);redraw();});
phase.addEventListener('input',()=>{setPlay(false);offset=Number(phase.value);redraw();});
play.addEventListener('click',()=>{setPlay(!playing);redraw();});
redraw();
