const fs = require('node:fs');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT: K, makeBuilder, SpriteSurface } = ink.load();

const width = 315, height = 210, frameCount = 29;
const color = { silhouette:'#b4f3e0', crease:'#ffbd73', occlusion:'#fc7f88', edited:'#fbeeaa' };
const styles = {
  silhouette: { width:1.2, color:color.silhouette },
  crease: { width:1.1, color:color.crease },
  occlusion: { width:1.5, color:color.occlusion }
};
const edits = { 'wing/5-6': { width:4.3, taper:[.06,1], color:color.edited },
  'wing/6-7': { width:4.3, taper:[1,.09], color:color.edited },
  'wing/7-8': { visible:false } };

function exhibit() {
  const atlas = SpriteSurface.make(128), sources = [], accents = [];
  function sheet(id, points, faces, swatches, emit = true) {
    sources.push({ id, mesh:{ points, faces }, emit });
    for (let k = 0; k < faces.length; k++) {
      const face = faces[k], triangles = [];
      for (let i = 2; i < face.length; i++) triangles.push(0,i-1,i);
      atlas.mesh({ points:face.flatMap(i=>points[i]), triangles, uvs:face.flatMap(()=>[.5,.5]) },
        1,1,()=>swatches[k % swatches.length]);
    }
  }
  function box(id, [x,y,z], [u,v,w], swatches, emit = false) {
    const points = [[x,y,z],[u,y,z],[u,v,z],[x,v,z],[x,y,w],[u,y,w],[u,v,w],[x,v,w]];
    sheet(id,points,[[3,2,1,0],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],swatches,emit);
  }
  function disk(id, [x,y,z], radius, paint) {
    const points = [[x,y,z]];
    for (let j = 0; j < 48; j++) {
      const a = j / 48 * Math.PI * 2;
      points.push([x+Math.cos(a)*radius,y+Math.sin(a)*radius,z]);
    }
    sheet(id,points,points.slice(1).map((_, i) => [0,i+1,(i+1)%48+1]),[paint],false);
  }
  disk('eclipse',[1.2,1.7,-2.85],2.02,0x29394e);
  disk('eclipse-inner',[1.2,1.7,-2.840],1.91,0x1f2b41);
  box('bottom',[-3.6,-1.27,-1.88],[3.55,-1.16,1.65],[0x374159,0x293245,0x465371,0x202c43,0x546581,0x4c6179]);
  box('base',[-3.33,-1.16,-1.64],[3.3,-.95,1.42],[0x34435c,0x2a3549,0x3b495f,0x2c3647,0x63738c,0x536783]);
  box('bed',[-3.14,-.95,-1.45],[3.12,-.92,1.22],[0x465771,0x3d4b63,0x4c6080,0x293347,0x455a74,0x4f637e]);
  box('rear-support',[-.52,-.92,-.66],[-.03,.17,-.17],[0x515a6d,0x435267,0x616c80,0x343e54,0x566781,0x546781]);
  box('front-support',[.15,-.92,-.47],[.38,.29,-.13],[0x535b6c,0x626b7c,0x555f74,0x373f55,0x7d8998,0x617287]);

  const points = [
    [-3.20,.73,.05],[-1.80,1.81,-.40],[-.55,2.16,-.59],[.70,1.64,-.54],[3.25,1.40,-.84],
    [-3.09,.56,.47],[-1.67,.63,.82],[-.12,.87,1.05],[1.36,.77,.90],[3.23,.58,.37],
    [-2.64,.21,-.04],[-1.57,-.27,-.48],[-.18,-.57,-.53],[1.65,-.24,-.48],[2.70,.30,-.54]
  ];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    faces.push([i,i+5,i+6],[i,i+6,i+1],[i+5,i+10,i+11],[i+5,i+11,i+6]);
  }
  sheet('wing',points,faces,[
    0x637e90,0x8ba2aa,0x394d68,0x4f697c,
    0x8bafaf,0xb6c6b9,0x40566a,0x47677a,
    0x7fa0a6,0x98b4b8,0x314963,0x486b80,
    0x678b9f,0x94aeb7,0x445469,0x527187
  ]);
  const strut = [
    [.35,-.88,1.39],[.66,-.88,1.39],[1.76,1.84,1.39],[1.49,1.74,1.39],
    [.35,-.88,1.60],[.66,-.88,1.60],[1.76,1.84,1.60],[1.49,1.74,1.60]
  ];
  sheet('strut',strut,[[3,2,1,0],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],
    [0xaa664f,0x9d5948,0x633f47,0x703e3c,0xe59a72,0xbb7558]);
  box('mount',[.20,-.92,1.20],[.79,-.76,1.70],[0xa86c57,0x854d47,0x77504f,0x593c45,0xc88a71,0x8e5b53]);
  for (let i = 0; i < 12; i++) {
    const x = -2.95 + i*.52;
    const length = i%3===0 ? .21 : .11;
    accents.push({ type:'path', space:'world', points:[[x,-.916,1.13],[x,-.916,1.13-length]],
      color:i%3===0?'#ad9f93':'#778994', width:i%3===0 ? 1.1 : .7 });
  }
  const cam = { target:[.06,.56,0], dist:13.0, yaw:-.24, pitch:.15, fov:.53 };
  const world = makeBuilder(43,[0x141b2a]).finish({ spriteSurfaces:atlas.finish(), cam, radius:8, dither:0 });
  return { world,sources,accents };
}

if (!process.argv[2]) throw new Error('Usage: node examples/direction-drawing.cjs <demo.html>');
const { world,sources,accents } = exhibit();
function frame(i, mode) {
  const u = i / (frameCount - 1), angle = .5 - .5*Math.cos(u*Math.PI);
  const directionDrawing = mode && { sources, styles, creaseAngle:32, ...(mode === 'edited' && { edits }) };
  const markLayer = { draw:accents, ...(directionDrawing && {directionDrawing}) };
  return ink.render(world,{
    w:width, h:height, px:1, raw:true, yaw:-.36+.68*angle,pitch:.13+.09*angle,
    composite:{ layers:[markLayer] }
  });
}
function encode({w,h,rgb}) {
  return Buffer.from(PNG.encode(w,h,rgb,3)).toString('base64');
}
const images = Object.fromEntries(['base','edges','edited'].map(mode => [mode,Array.from({length:frameCount},
  (_, i) => encode(frame(i, mode === 'base' ? undefined : mode)))]));
fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fold Observatory</title>
<style>
:root{color-scheme:dark;background:#141923;color:#efdac8;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;padding:27px 26px}
main{max-width:1200px;margin:auto}
h1{font:500 clamp(43px,7.4vw,82px)/.95 Georgia,serif;letter-spacing:-.065em;margin:5px 0 9px}
p{font-size:14px;line-height:1.45;color:#bfc6ca;margin:0}
header{display:flex;justify-content:space-between;align-items:end;flex-wrap:wrap;gap:13px;margin-bottom:18px}
.code,button,figcaption,output,.key{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.code{font-size:11px;letter-spacing:.13em;color:#d4a887}
nav,.transport,.key{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
button{cursor:pointer;color:#ddd1ca;background:#242f40;border:1px solid #566374;border-radius:2px;padding:8px 10px}
button[aria-pressed=true]{color:#121d25;background:#b4f3e0;border-color:#b4f3e0}
button:focus-visible,input:focus-visible{outline:2px solid #b4f3e0;outline-offset:3px}
.plate{display:grid;grid-template-columns:1fr 1fr;gap:12px}
figure{margin:0;min-width:0;border:1px solid #4d5463;background:#202733}
figcaption{padding:8px 11px;font-size:11px;letter-spacing:.07em;color:#e9cbb6;border-bottom:1px solid #4d5463}
img{display:block;width:100%;aspect-ratio:3/2;image-rendering:pixelated}
.transport{margin:12px 0}
input{flex:1;min-width:30px;accent-color:#b4f3e0}
output{font-size:12px;min-width:60px;text-align:right}
.key{gap:7px 16px;font-size:11px;color:#d6d1d2;margin-bottom:8px}
.key span::before{background:var(--ink);content:"";width:14px;height:2px;display:inline-block;margin-right:6px;vertical-align:middle}
@media(max-width:670px){body{padding:18px 12px}.plate{grid-template-columns:1fr;gap:8px}}
</style>
<main>
<header><div><div class="code">INK STUDIO / DIRECTION-AWARE DRAWING</div><h1>Fold Observatory</h1>
<p>Linework follows a folded sculpture as the camera moves around it.</p></div>
<nav aria-label="Line treatment"><button type="button" id="edges">Extracted edges</button>
<button type="button" id="edited">Path edits</button></nav></header>
<div class="plate">
<figure><figcaption>SHADED GEOMETRY</figcaption><img id="base" alt="Faceted blue sculpture with a copper brace"></figure>
<figure><figcaption id="view-title"></figcaption><img id="outlined" alt="The same sculpture with edited silhouette, crease, and occlusion paths"></figure>
</div>
<div class="transport"><button type="button" id="play">Play</button>
<input id="scrub" type="range" min="0" max="${frameCount-1}" value="9" aria-label="Orbit frame"><output id="count"></output></div>
<div class="key" id="key"><span style="--ink:${color.silhouette}">Silhouette</span><span style="--ink:${color.crease}">Crease</span>
<span style="--ink:${color.occlusion}">Occlusion boundary</span><span id="ink-edit" style="--ink:${color.edited}">Edited ridge paths</span></div>
<p id="caption"></p>
</main>
<script>
const images = ${JSON.stringify(images)}, field = id=>document.getElementById(id);
let mode='edges', index=9, timer, step=1;
function draw(){
 const outlined=field('outlined');
 field('base').src='data:image/png;base64,'+images.base[index];
 outlined.src='data:image/png;base64,'+images[mode][index];
 outlined.dataset.mode=mode;
 outlined.dataset.frame=index;
 for(const name of ['edges','edited'])field(name).setAttribute('aria-pressed',String(name===mode));
 field('view-title').textContent=mode==='edited'?'WING RIDGE / TAPER, WIDTH, COLOR, VISIBILITY':'DIRECTION-AWARE PATHS';
 field('scrub').value=index;
 field('count').textContent=(index+1)+' / '+images.base.length;
 field('ink-edit').hidden=mode!=='edited';
 field('caption').textContent=mode==='edited'
   ? 'Two ridge edges gain weight and taper. An adjacent edge is hidden. The edits stay on the same edges through the orbit.'
   : 'The copper brace interrupts the paths behind it. Where the wing overlaps the backdrop, the rim becomes an occlusion boundary.';
}
for(const name of ['edges','edited'])field(name).addEventListener('click',()=>{mode=name;draw();});
field('scrub').addEventListener('input',e=>{index=Number(e.target.value);draw();});
field('play').addEventListener('click',()=>{
 if(timer){clearInterval(timer);timer=undefined;}
 else timer=setInterval(()=>{
   if(index===0)step=1;
   if(index===images.base.length-1)step=-1;
   index+=step;draw();
 },95);
 field('play').textContent=timer?'Pause':'Play';
});
draw();
</script></html>`);
