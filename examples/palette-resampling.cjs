const fs = require('node:fs');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = ink.load();

const dark = 0x364456, light = 0xa6a4a5, blend = 0x6e7480, amber = 0xff9957, teal = 0x79ddcb;
const width = 228, height = 138, frames = 20;
function exhibit() {
  const B = makeBuilder(9, [0x141e2e,0x233146,0x35475c,0x526a7d,0x859398,0xb5b6a7,0x62484c,0xad7960,0xe8b284,teal]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { sun: K.V.norm([-.6,.74,.42]), sky:.24, sunK:.5, amb:.33 });
  const stone = { r:[1,2,3,4,5] }, copper = { r:[6,7,8] };
  const box = (at, half, material, res=.17) => S.box(at, half, material, { res, rd:.03 });
  box([0,-1.33,-.43],[3.34,.16,1.03],stone);
  box([0,-1.54,-.48],[3.59,.075,1.2],stone);
  for (const x of [-3.0,3.0]) {
    box([x,-.59,-.8],[.14,.73,.66],copper,.097);
    box([x,-1.11,.27],[.27,.073,.26],stone,.12);
    box([x,-1.14,.52],[.10,.04,.03],{r:[9],em:true},.05);
  }
  S.bake();

  const R = K.procedural.drawing2d;
  const label = R.text('SIGNAL WEAVE', { scale:3, tracking:1, kerning:{ WE:-1 }, color:'#f3dbc0' }).value;
  const number = R.text('CHANNEL 08', { color:'#a6e6d6', tracking:1 }).value;
  const texWidth = 256, texHeight = 120, A = SpriteSurface.make(texWidth);
  function imageAt(source,x,y,left,top) {
    const u=x-left,v=y-top;
    if (u<0 || v<0 || u>=source.width || v>=source.height) return undefined;
    const i=(v*source.width+u)*4;
    if (source.data[i+3]) return (source.data[i]<<16)|(source.data[i+1]<<8)|source.data[i+2];
  }
  const frame = 0xddb18c, border = 0x253146, cream = 0xf3dbc0, mint = 0xa6e6d6;
  const texture = A.reserve(texWidth,texHeight,(x,y)=>{
    if (x<2 || y<2 || x>=texWidth-2 || y>=texHeight-2) return frame;
    if (x<7 || y<7 || x>=texWidth-7 || y>=texHeight-7) return border;
    if (y<37) {
      const art = imageAt(label,x,y,19,11);
      if (art !== undefined) return art;
      return y===36 ? frame : border;
    }
    if (y>96) return imageAt(number,x,y,20,103) ?? (y===97 ? frame : border);
    if (x%48===16 && y%24>=4 && y%24<=19) return amber;
    if (y===72 && x>=16 && x<241) return teal;
    if ((x-16) % 48 < 2 || (y-45) % 23 < 1) return border;
    return (x+y)%2 ? dark : light;
  });
  const points = TexturedSurface.grid({ segments:[1,1],
    point:(u,v)=>[-3.01+6.02*u, 1.40-2.59*v, -1.54 + 1.55*v + .16*u] });
  A.meshRegion(points,texture,{ id:'weave', sampling:{
    palette:[blend,dark,light,amber,teal,frame,border,cream,mint],
    protect:[amber,teal], protectCoverage:.14, tieTolerance:.006
  } });
  return B.finish({ spriteSurfaces:A.finish(), cam:{target:[0,0,-.45],dist:8.6,yaw:.03,pitch:.23},radius:8,dither:0 });
}

if (!process.argv[2]) throw new Error('Usage: node examples/palette-resampling.cjs <demo.html>');
const scene = exhibit();
const modes = [
  { id:'grazing', name:'Shallow angle', copy:'A slow pan over the tilted panel. The fine weave settles into a palette tone while copper ticks and the mint trace remain visible.',
    view:u=>({ yaw:.13+.105*u, pitch:.63+.03*u, dist:8.2,target:[-.16+.20*u,0,-.45] }) },
  { id:'recede', name:'Pullback', copy:'The same panel recedes. The filter picks authored swatches as several texels begin sharing each art pixel.',
    view:u=>({ yaw:.05+.022*u,pitch:.32,dist:7+3.7*u,target:[-.02+.11*u,0,-.45] }) }
];
function encode(frame) {
  return Buffer.from(PNG.encode(frame.w,frame.h,frame.rgb,3)).toString('base64');
}
function pixelChanges(pictures) {
  let changed = 0, samples = 0;
  for (let i=1;i<pictures.length;i++) {
    const a=pictures[i-1].rgb,b=pictures[i].rgb;
    for (let y=60;y<80;y++) for (let x=68;x<159;x++) {
      const p=(y*width+x)*3;
      if (a[p]!==b[p] || a[p+1]!==b[p+1] || a[p+2]!==b[p+2]) changed++;
      samples++;
    }
  }
  return (100*changed/samples).toFixed(1) + '%';
}
const sequences = modes.map(({id,name,copy,view})=>{
  const run = paletteSampling=>Array.from({length:frames},(_,i)=>ink.render(scene,{
    w:width,h:height,px:1,raw:true,paletteSampling,...view(i/(frames-1))
  }));
  const nearest=run(false), filtered=run(true);
  return { id,name,copy,metric:[pixelChanges(nearest),pixelChanges(filtered)],
    nearest:nearest.map(encode), filtered:filtered.map(encode) };
});

fs.writeFileSync(process.argv[2],`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signal Weave</title>
<style>
:root{color-scheme:dark;background:#141b26;color:#f3e6d4;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;padding:33px 24px}
main{max-width:1216px;margin:auto}
h1{font:500 clamp(44px,8vw,87px)/.93 Georgia,serif;letter-spacing:-.063em;margin:7px 0 12px}
p{font-size:14px;line-height:1.45;color:#c3cbd0;margin:0}
header{display:flex;justify-content:space-between;align-items:end;gap:14px;margin-bottom:21px}
.mono,button,figcaption,label,output{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.mono{font-size:11px;letter-spacing:.14em;color:#eeb786}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
figure{margin:0;min-width:0;border:1px solid #4c6172;background:#212e3d}
figcaption{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid #4c6172;color:#efcfac;font-size:11px;letter-spacing:.045em}
figure:last-child figcaption output{color:#90ead6}
img{display:block;width:100%;height:auto;aspect-ratio:228/138;image-rendering:pixelated;background:#141e2e}
nav,.transport{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.transport{margin:13px 0 12px}
button{cursor:pointer;padding:8px 11px;background:#273547;color:#eadac9;border:1px solid #586e82;border-radius:2px}
button[aria-pressed=true]{color:#16202c;background:#ebbc92;border-color:#ebbc92}
button:focus-visible,input:focus-visible{outline:2px solid #80e4d2;outline-offset:3px}
#timeline{flex:1;min-width:35px;accent-color:#eeb786}
#step{min-width:55px;font-size:12px;color:#ebbc92;text-align:right}
@media(max-width:720px){body{padding:23px 12px}header{flex-direction:column;align-items:start}.grid{grid-template-columns:1fr;gap:8px}}
</style>
<main><header><div><div class="mono">INK STUDIO / PALETTE-PRESERVING RESAMPLING</div><h1>Signal Weave</h1>
<p>Compare the same pixel art as its texels get smaller than the art pixels.</p></div>
<nav aria-label="Camera move"></nav></header>
<div class="grid">
<figure><figcaption>NEAREST TEXEL <output id="before"></output></figcaption><img id="nearest" alt="Textured panel rendered with one nearest texel per art pixel"></figure>
<figure><figcaption>PALETTE FOOTPRINT <output id="after"></output></figcaption><img id="filtered" alt="Textured panel resampled to its authored palette using the pixel footprint"></figure></div>
<div class="transport"><button id="play" type="button">Play</button>
<input id="timeline" type="range" min="0" max="${frames-1}" value="8" aria-label="Camera frame"><output id="step"></output></div>
<p id="copy"></p></main>
<script>
const scenes=${JSON.stringify(sequences)};
const byId=id=>document.getElementById(id), nav=document.querySelector('nav');
let active=0,index=8,timer;
const buttons=scenes.map(({name},i)=>{
 const b=document.createElement('button');
 b.type='button';b.textContent=name;b.addEventListener('click',()=>{active=i;render();});
 nav.appendChild(b);return b;
});
function render(){
 const scene=scenes[active];
 for(const id of ['nearest','filtered']) byId(id).src='data:image/png;base64,'+scene[id][index];
 byId('filtered').dataset.mode=scene.id;byId('filtered').dataset.frame=index;
 byId('before').textContent=scene.metric[0]+' changed';
 byId('after').textContent=scene.metric[1]+' changed';
 byId('timeline').value=index;
 byId('step').textContent=(index+1)+' / '+scene.filtered.length;
 byId('copy').textContent=scene.copy+' Percentages measure pixel changes between consecutive frames in the same center crop.';
 buttons.forEach((button,i)=>button.setAttribute('aria-pressed',i===active));
}
byId('timeline').addEventListener('input',event=>{index=Number(event.target.value);render();});
byId('play').addEventListener('click',()=>{
 if(timer){clearInterval(timer);timer=undefined;}
 else timer=setInterval(()=>{index=(index+1)%scenes[active].filtered.length;render();},120);
 byId('play').textContent=timer?'Pause':'Play';
});
render();
</script></html>`);
console.log(JSON.stringify(sequences.map(({id,metric})=>({id,nearest:metric[0],filtered:metric[1]}))));
