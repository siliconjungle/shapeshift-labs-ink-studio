const fs = require('node:fs');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();

const width = 218, height = 132, frameCount = 34;
const pale = 0xffd899, shadow = 0x262943;
const paint = [0x151b2a,0x222d43,0x344861,0x486173,0x66838b,0x99ada1,
  0x57404b,0x8c5a58,0xc08365,0xe9b87d,0x7aceba,0x324b62,0x263953,0x51727d,
  0x8cb0a8,0xd19d72,0xd29a64,0xe6ac6b,pale,shadow,0x3c485f,0x1d2b42];
const packed = rgb => (rgb >> 16) + (rgb >> 8 & 255)*256 + (rgb & 255)*65536;
const hex = color => '#' + color.toString(16).padStart(6,'0');
const spatial = { select:{material:'enamel'}, minPixels:1, protect:{boundaries:false} };
const baseline = { targets:[spatial] };
const controlled = { maxMotion:9, targets:[{ ...spatial, coherence:[
  { swatches:[hex(pale)], splitFrames:3, mergeFrames:3, holdFrames:2, birthFrames:1 },
  { swatches:[hex(shadow)], splitFrames:2, mergeFrames:3, holdFrames:1, birthFrames:2 }
] }] };

function build() {
  const B = makeBuilder(51,paint);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { sun:K.V.norm([-.53,.72,.38]), sky:.23, sunK:.52, amb:.32 });
  const body = { r:[1,2,3,4,5] }, metal = { r:[6,7,8,9] };
  const box = (at,half,material,res) => S.box(at,half,material,{res,rd:.035});
  box([0,-1.75,-.45],[3.91,.13,.94],body,.16);
  box([0,-1.86,-.5],[4.08,.045,1.01],body,.16);
  box([0,.18,-.37],[3.67,1.86,.36],body,.115);
  for (const x of [-3.83,3.83]) {
    box([x,-.21,-.43],[.10,1.28,.36],metal,.085);
    box([x,-1.53,-.27],[.14,.17,.41],metal,.09);
  }
  box([0,-1.39,.04],[3.52,.14,.055],metal,.10);
  for (const x of [-2.94,-2.77,2.88,3.08]) box([x,-1.39,.12],[.038,.038,.045],{r:[10],em:true},.065);
  S.bake();

  const cells = [], start = B.count(), step = .095;
  for (let y = -15; y <= 14; y++) for (let x = -36; x <= 36; x++) {
    cells.push([x,y,B.count()]);
    B.disc(x*step,.47+y*step,.016,[0,0,1],.067,.010,B.P[11],3);
  }
  B.describeSplats(start,B.count(),{object:'mercury-panel',material:'enamel'});
  const world = B.finish({ cam:{ target:[0,.08,-.16], dist:9.6, yaw:.07, pitch:.17, fov:.65 }, radius:9, dither:0 });
  return { world,cells };
}

function color(x,y,frame) {
  const line = 3.4 + 3*Math.sin((x+9)/16) - .065*x;
  const d = y-line;
  const shape = Math.sqrt(Math.max(0,1-(x/35)**2));
  let tone = (x+y)%8===0 && y%6===2 ? 13 : 11;
  if (Math.abs(d) < .42*shape) tone = 14;
  if (d < 0 && d > -.8-5.9*shape) tone = d > -2.7*shape ? 16 : 15;
  if (d < -.8-5.9*shape && d > -1.8-7.2*shape) tone = 13;
  if (d > 0 && d < 1.45*shape && Math.abs(x) < 35) tone = 17;
  if (d > 1.45*shape && d < 3*shape && Math.abs(x) < 35) tone = 13;

  const left = ((x+16)/11)**2 + ((d-.15)/2.45)**2 < 1;
  const right = ((x-15)/11)**2 + ((d-.10)/2.4)**2 < 1;
  const connect = ![5,9,12,13,14,15,16,18,19].includes(frame);
  const blink = frame === 28;
  if (!blink && (left || right || (connect && Math.abs(x) <= 9 && Math.abs(d) < .74))) tone = 18;

  const bed = -6.75 + 2.55*Math.sin((x-5)/19) + .015*x;
  const v = y-bed;
  if (Math.abs(v) < 2.4*shape && d < -4.8) tone = v>0 ? 20 : 12;
  const dimA = ((x+14)/10)**2 + ((v+.25)/1.7)**2 < 1;
  const dimB = ((x-13)/9)**2 + ((v+.45)/1.65)**2 < 1;
  const link = frame >= 9 && frame !== 17 && !(frame >= 23 && frame <= 25);
  if (frame !== 30 && (dimA || dimB || link && Math.abs(x+1)<=7 && Math.abs(v+.28)<.69)) tone = 19;

  if (y === 13 || y === -14 || Math.abs(x) === 35) tone = 1;
  if (y === 12 && x < -26 || y === -13 && x > 26) tone = 4;
  if (y%6 === 0 && Math.abs(x) > 33) tone = 10;
  return paint[tone];
}

function crop(source, x, y, w, h) {
  const rgb = new Uint8Array(w*h*3);
  for (let i=0;i<h;i++) {
    const start = ((y+i)*source.w+x)*3;
    rgb.set(source.rgb.subarray(start,start+w*3), i*w*3);
  }
  return { w,h,rgb };
}

if (!process.argv[2]) throw new Error('Usage: node examples/cluster-coherence.cjs <demo.html>');
const { world,cells } = build();
const colorClusterHistory = K.colorClusters.history();
const sample = [];
for (let i=0;i<frameCount;i++) {
  for (const [x,y,row] of cells) world.data[row*16+7] = packed(color(x,y,i));
  const phase = i / (frameCount-1);
  const view = { w:width,h:height,px:1,outline:false, dither:0, yaw:.095-.17*phase,
    pitch:.16+.06*phase, target:[.07-.15*phase,.10,-.18], t:i/24 };
  const direct = ink.render(world,{ ...view,colorClusters:baseline });
  const stable = ink.render(world,{ ...view,colorClusters:controlled,colorClusterHistory });
  const { tracking } = stable.colorClusters;
  const encode = ({w,h,rgb}) => Buffer.from(PNG.encode(w,h,rgb,3)).toString('base64');
  sample.push({ direct:encode(direct), stable:encode(stable), detail:[direct,stable].map(frame=>encode(crop(frame,56,45,108,33))),
    edited:tracking.editedPixels, hold:tracking.heldPixels,
    splits:tracking.deferredSplits, joins:tracking.deferredMerges, events:tracking.events.length });
}
const highlights = sample.map(({ hold,splits,joins,edited },i)=>({i,hold,splits,joins,edited}));
const best = (field, skip) => highlights.reduce((maximum, row) =>
  row.i !== skip?.i &&
  row[field] && row[field] * 10 + row.edited > (maximum[field] * 10 + maximum.edited) ? row : maximum,
  { [field]:0,edited:0 });
const split = best('splits');
const selected = [split,best('joins',split),best('hold')];
if (selected.some((row,i)=>!row[['splits','joins','hold'][i]])) throw new Error('Exhibit did not produce all three transitions');
console.log(JSON.stringify(selected));

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mercury Current</title>
<style>
:root{color-scheme:dark;background:#141927;color:#f4e3cf;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;padding:26px 24px}
main{max-width:1190px;margin:auto}
h1{font:500 clamp(40px,7.8vw,83px)/.94 Georgia,serif;letter-spacing:-.062em;margin:5px 0 8px}
p{font-size:14px;line-height:1.45;color:#bdc6d0;margin:0}
header{display:flex;justify-content:space-between;align-items:end;flex-wrap:wrap;gap:13px;margin-bottom:19px}
.code,button,figcaption,output{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.code{color:#e0ad7a;letter-spacing:.135em;font-size:11px}
nav,.transport{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
button{cursor:pointer;padding:8px 10px;color:#d6d8e0;background:#253045;border:1px solid #5b677c;border-radius:2px}
button[aria-pressed=true]{background:#edc497;border-color:#edc497;color:#242332}
button:focus-visible,input:focus-visible{outline:2px solid #f0c493;outline-offset:3px}
.plate,.detail{display:grid;grid-template-columns:1fr 1fr;gap:12px}
figure{margin:0;min-width:0;border:1px solid #57657c;background:#222d40}
figcaption{font-size:11px;letter-spacing:.07em;padding:7px 10px;color:#efc99e;border-bottom:1px solid #57657c}
img{width:100%;display:block;image-rendering:pixelated}
figure img{aspect-ratio:218/132}
.detail{margin-top:7px}
.detail img{aspect-ratio:108/33;width:100%;border:1px solid #57657c}
.transport{margin:11px 0 8px}
input{flex:1;min-width:30px;accent-color:#edc497}
output{text-align:right;font-size:11px;color:#e1b98d;min-width:59px}
@media(max-width:680px){body{padding:18px 12px}.plate,.detail{gap:5px}figcaption{font-size:9px}}
</style>
<main><header><div><div class="code">INK STUDIO / COHERENT PIXEL CLUSTERS</div><h1>Mercury Current</h1>
<p>Highlight and shadow patches on a glazed instrument panel.</p></div>
<nav aria-label="Transition" id="modes"></nav></header>
<div class="plate">
<figure><figcaption>INDEPENDENT FRAMES</figcaption><img id="direct" alt="Enamel panel rendered independently each frame"></figure>
<figure><figcaption>COHERENT CLUSTERS</figcaption><img id="stable" alt="Enamel panel with tracked highlight and shadow patches"></figure>
</div>
<div class="detail"><img id="before" alt="Close-up of the current independent render"><img id="after" alt="Close-up of the same region with cluster history"></div>
<div class="transport"><button type="button" id="play">Play</button>
<input id="scrub" type="range" min="0" max="${frameCount-1}" aria-label="Frame"><output id="step"></output></div>
<p id="caption"></p></main>
<script>
const frames=${JSON.stringify(sample)}, keyframes=${JSON.stringify(selected.map(r=>r.i))};
const label=['Split','Merge','Dropout'], byId=id=>document.getElementById(id);
const captions=[
 'A brief break divides a highlight. With history, Ink retains the connection while the break is tested.',
 'The raw render introduces a connection. With history, the patches stay distinct until the connection persists.',
 'A patch briefly drops out. With history, the previous swatch holds on the moving panel.'
];
let active=0,index=keyframes[0],timer;
const buttons=label.map((name,i)=>{
 const button=document.createElement('button');
 button.type='button';button.textContent=name;
 button.onclick=()=>{active=i;index=keyframes[i];draw();};
 byId('modes').appendChild(button);return button;
});
function draw(){
 const f=frames[index];
 for(const [id,source] of Object.entries({direct:f.direct,stable:f.stable,before:f.detail[0],after:f.detail[1]}))
   byId(id).src='data:image/png;base64,'+source;
 byId('stable').dataset.frame=index;
 byId('stable').dataset.edit=f.edited;
 byId('step').textContent=(index+1)+' / '+frames.length;
 byId('scrub').value=index;
 byId('caption').textContent=index===keyframes[active]?captions[active]:
   [f.splits&&'Split pending',f.joins&&'Merge pending',f.hold&&'Holding previous swatches',f.events&&'Lineage changed']
     .filter(Boolean).join(' · ') || 'Tracking the selected swatches as the camera moves.';
 buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(active===i)));
}
byId('scrub').addEventListener('input',e=>{index=Number(e.target.value);draw();});
byId('play').onclick=()=>{
 if(timer){clearInterval(timer);timer=undefined;}
 else timer=setInterval(()=>{index=(index+1)%frames.length;draw();},120);
 byId('play').textContent=timer?'Pause':'Play';
};
draw();
</script></html>`);
