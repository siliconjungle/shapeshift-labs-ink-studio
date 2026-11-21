const fs = require('node:fs');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = ink.load();

function relay() {
  const B = makeBuilder(34, [
    0x111b29, 0x1a2331, 0x273547, 0x3c4b5e, 0x556a79, 0x7b8086, 0xa8977e, 0xdeb888,
    0x653c37, 0xa55a43, 0xff8554, 0xffb276, 0xffe6b1, 0x1e6570, 0x37aea3, 0x80ebd3, 0xc4fff0
  ]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { sun:K.V.norm([-.45,.71,.58]), sky:.24, sunK:.52, amb:.38 });
  const alloy = { r:[1,2,3,4,5] }, copper = { r:[8,9,10,11] }, plate = { r:[2,3,4,5,6] };
  const box = (at, half, mat, res=.16) => S.box(at, half, mat, { res, rd:.045 });
  box([0,0,-1.55],[3.23,1.84,.19],alloy);
  for (const x of [-3.20,3.20]) {
    box([x,0,-.96],[.215,1.91,.66],plate);
    box([x,0,-.28],[.087,1.6,.05],copper,.12);
    for (const y of [-1.46,-.72,0,.72,1.46]) box([x,y,-.171],[.137,.049,.039],plate,.083);
  }
  for (const y of [-1.8,1.80]) {
    box([0,y,-.87],[3.28,.145,.69],alloy);
    box([0,y,-.145],[3.02,.041,.042],copper,.15);
    for (let x=-2.7;x<2.8;x+=.37) box([x,y,-.092],[.057,.035,.027],plate,.071);
  }
  for (const y of [-1.15,-.57,0,.57,1.15])
    box([0,y,-1.28],[2.88,.025,.055],plate,.18);
  box([0,-1.98,-.28],[3.57,.12,.77],alloy);
  S.bake();
  const track = B.count();
  B.axial(0,0,-.49,[0,1,0],1.57,.081,B.P[11],2,{ em:true });
  B.axial(.16,0,-.47,[0,1,0],1.57,.024,B.P[10],1.45,{ em:true });
  for (const y of [-1.43,-.71,0,.71,1.43])
    B.disc(0,y,-.442,[0,0,1],.105,.01,B.P[12],2,{ em:true });
  B.describeSplats(track, B.count(), { object:'scanner', material:'hot copper' });

  const gate = B.count();
  for (let j=0;j<4;j++) {
    const a=Math.PI*j/2;
    B.axial(Math.cos(a)*.45,Math.sin(a)*.45,.45,[-Math.sin(a),Math.cos(a),0],.43,.072,B.P[13],2);
    B.axial(Math.cos(a)*.45,Math.sin(a)*.45,.52,[-Math.sin(a),Math.cos(a),0],.33,.036,B.P[15],2,{ em:true });
  }
  B.disc(0,0,.52,[0,0,1],.32,.02,B.P[13],2);
  B.disc(0,0,.575,[0,0,1],.20,.02,B.P[14],2);
  B.disc(-.05,.05,.65,[0,0,1],.087,.01,B.P[16],2,{ em:true });
  B.describeSplats(gate,B.count(),{ object:'jade relay', material:'enamel' });

  const seal = K.procedural.drawing2d.text('SIGNAL 04',{ scale:2, tracking:1, color:'#f4b886' }).value;
  const mesh = TexturedSurface.grid({ point:(u,v)=>[-.82+1.64*u,-1.41-.25*v,-.14] });
  const atlas = SpriteSurface.make();
  atlas.mesh(mesh,seal.width,seal.height,(x,y) => {
    const i=(y*seal.width+x)*4;
    return seal.data[i+3] ? (seal.data[i]<<16)|(seal.data[i+1]<<8)|seal.data[i+2] : 0x213340;
  });
  const world = B.finish({ cam:{ target:[0,-.10,0], dist:7.15, yaw:-.025,pitch:.045,ortho:true },
    radius:6,dither:0,spriteSurfaces:atlas.finish() });
  const rest = world.data.slice();
  world.anim = { update(_dt,t) {
    for (let i=track;i<gate;i++) world.data[i*16] = rest[i*16] + (t-1)*6.0;
    for (let i=gate;i<world.count;i++) world.data[i*16] = rest[i*16] + .18 - (t-1)*4;
  } };
  return world;
}

if (!process.argv[2]) throw new Error('Usage: node examples/programmable-exposure.cjs <demo.html>');
const world = relay(), w = 232, h = 142;
const view = { w,h,px:1,t:1,raw:true };
const lock = { select:{ object:'jade relay' }, shutter:false };
const screenGraph = { passes:[
  { id:'ticks', type:'composite', isolated:true, layer:{source:{slot:'tick'},rect:[65,125,4,11]} },
  { id:'signal', type:'distortion', input:'ticks', source:'ticks', amplitude:[43,0], period:160, rate:1.35 },
  { id:'overlay', type:'composite', input:'scene', source:'signal' }
] };
const screen = {
  renderGraph:screenGraph, renderGraphInputs:{tick:{width:1,height:1,channels:4,data:Uint8Array.of(243,173,106,255)}}
};
const modes = [
  { name:'Weighted curve', copy:'A triangular shutter concentrates the orange light near the center. The jade relay holds its pose and occludes the exposure.',
    settings:{ shutter:{ duration:.82,samples:24,curve:'triangle',targets:[lock] } } },
  { name:'Stepped material', copy:'Only hot copper uses the five-step shutter. Each image of the scanner lands at a discrete pose and shares the scene depth buffer.',
    settings:{ shutter:{ curve:'hold',samples:20,targets:[{select:{material:'hot copper'},shutter:{duration:.82,curve:'box',steps:5}},lock] } } },
  { name:'Rolling shutter', copy:'The scan travels down twelve bands. Each band takes a sharp image at its own time while the jade relay ignores the scan.',
    settings:{ shutter:{ curve:'hold',samples:1,rolling:{duration:.77,bands:12,direction:'down'},targets:[lock] } } },
  { name:'Graph pass', copy:'The screen-space signal below the station has a four-step shutter. The scene itself stays at the center time.',
    settings:{ ...screen, shutter:{curve:'hold',samples:16,passes:{signal:{curve:'box',duration:.56,steps:4}}} } }
];
function png(frame) {
  return Buffer.from(PNG.encode(frame.w,frame.h,frame.rgb,3)).toString('base64');
}
const reference = png(ink.render(world,view));
const cards = modes.map(({ name,copy,settings }) => {
  const frame = ink.render(world, {...view,...settings});
  if (png(frame) === reference) throw new Error('Shutter demo did not change the reference for ' + name);
  return { name,copy,image:png(frame) };
});
fs.writeFileSync(process.argv[2],`<!doctype html>
<html lang="en">
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shutter Relay</title>
<style>
:root{color-scheme:dark;background:#131822;color:#f4e4d3;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;padding:35px 25px}
main{max-width:1210px;margin:auto}
header{margin-bottom:20px}
h1{font:500 clamp(44px,8vw,88px)/.94 Georgia,serif;letter-spacing:-.065em;margin:7px 0 12px}
p{font-size:14px;line-height:1.45;color:#c1c5cc;margin:0}
.mono,button,figcaption{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.mono{font-size:11px;letter-spacing:.15em;color:#ffc690}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
figure{margin:0;min-width:0;border:1px solid #505b6b;background:#212a37}
figcaption{padding:9px 12px;border-bottom:1px solid #505b6b;color:#efd6ba;font-size:11px;letter-spacing:.08em}
img{display:block;width:100%;height:auto;aspect-ratio:232 / 142;image-rendering:pixelated;background:#111b29}
nav{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 10px}
button{cursor:pointer;padding:8px 11px;background:#283343;color:#eed6be;border:1px solid #586478;border-radius:2px}
button[aria-pressed=true]{color:#101b23;background:#f5c08d;border-color:#f5c08d}
button:focus-visible{outline:2px solid #7be5d3;outline-offset:3px}
@media(max-width:720px){body{padding:23px 12px}.grid{grid-template-columns:1fr;gap:8px}}
</style>
<main><header><div class="mono">INK STUDIO / PROGRAMMABLE EXPOSURE</div><h1>Shutter Relay</h1>
<p>Compare the same frame with different shutter curves, depth-tested poses, and scan times.</p></header>
<div class="grid">
<figure><figcaption>INSTANTANEOUS FRAME</figcaption><img src="data:image/png;base64,${reference}" alt="A copper scanner next to a jade relay at the center time"></figure>
<figure><figcaption id="name"></figcaption><img id="exposed" alt=""></figure></div>
<nav aria-label="Shutter"></nav><p id="description"></p></main>
<script>
const cards=${JSON.stringify(cards)};
const nav=document.querySelector('nav'), image=document.getElementById('exposed');
const buttons=cards.map(({name},i)=>{
  const button=document.createElement('button');
  button.type='button';
  button.textContent=name;
  button.addEventListener('click',()=>show(i));
  nav.appendChild(button);
  return button;
});
function show(i) {
  const card=cards[i];
  image.dataset.mode=i;
  image.alt=card.copy;
  image.src='data:image/png;base64,'+card.image;
  document.getElementById('name').textContent=card.name.toUpperCase();
  document.getElementById('description').textContent=card.copy;
  buttons.forEach((button,j)=>button.setAttribute('aria-pressed',i===j));
}
show(0);
</script></html>`);
