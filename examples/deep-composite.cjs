const fs = require('node:fs');
const ink = require('..');
const PNG = require('../cli/png.js');

const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = ink.load();
const { drawing2d, waterBodies } = K.procedural;

function archive() {
  const B = makeBuilder(42, [
    0x111e2d, 0x192437, 0x27374a, 0x3f5262, 0x586c7b, 0x859193, 0xb6b4a1, 0xe6cb9b,
    0x514045, 0x805354, 0xb9745d, 0xe6a369, 0xf8d492, 0xfef0bb, 0x32617a, 0x519bad, 0xa8e3dc
  ]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S,{ sun:K.V.norm([-.65,.70,.45]), ambient:.36, sunK:.53, sky:.24 });
  const wall = { r:[1,2,3,4,5] }, metal = { r:[8,9,10,11,12] }, lamp = { r:[11,12,13], em:true };
  const box = (at, half, material, res = .13) => S.box(at, half, material, { res, rd:.03 });
  box([0,1.12,-1.24],[2.38,1.12,.24],wall);
  box([0,2.32,-.85],[2.64,.18,.78],wall);
  box([0,2.23,-.05],[2.60,.04,.035],metal,.085);
  box([0,.16,-.73],[2.49,.17,.70],wall);
  box([0,.45,-.47],[2.43,.07,.44],metal);
  for (const x of [-2.30,2.30]) {
    box([x,1.24,-.42],[.19,.9,.49],wall,.085);
    box([x,1.46,.05],[.079,.24,.035],metal,.05);
    box([x,1.46,.104],[.038,.13,.025],lamp,.05);
  }
  for (const x of [-1.65,-.55,.55,1.65]) {
    box([x,2.69,-1.12],[.18,.29,.23],wall);
    box([x,.035,.52],[.06,.07,.07],metal,.067);
  }
  for (const y of [.63,1.99]) box([0,y,.18],[1.79,.035,.051],metal,.075);
  for (const x of [-1.81,0,1.81]) box([x,1.30,.18],[.033,.68,.045],metal,.072);
  for (const x of [-2.62,2.62]) {
    box([x,-.01,.9],[.23,.17,1.9],wall);
    box([x,1.01,1.58],[.066,1.04,.067],metal,.075);
    box([x,2.0,1.58],[.14,.10,.14],lamp,.060);
  }
  S.bake();
  const glass = B.count();
  for (const sign of [-1,1]) for (let y=0;y<10;y++) for (let x=0;x<13;x++) {
    const X=sign*(.077+x*.132), Y=.70+y*.135;
    const glint = Math.abs(Y-1.18-X*.35)<.082;
    B.disc(X,Y,.14,[0,0,1],.104,.009,B.P[glint ? 16 : 14],glint ? .44 : .23,{ gl:true, nd:true });
  }
  B.describeSplats(glass,B.count(),{ object:'archive pane', material:'blue glass' });
  const buoy = B.count();
  for (let y=0;y<11;y++) {
    const tint = y===3 || y===6 ? 13 : 10 + (y%3);
    const r=.10+.14*Math.sin(Math.PI*y/10);
    B.disc(-1.26,.35+y*.091,1.89,[0,0,1],r,.03,B.P[tint],1.45,{ em:true });
  }
  B.describeSplats(buoy,B.count(),{ object:'copper buoy', material:'enamel' });

  const { value: sign } = drawing2d.text('ARCHIVE', { scale:3, tracking:1,
    kerning:{ AR:-2, CH:-1 }, color:'#f9df9a' });
  const mesh = TexturedSurface.grid({ point:(u,v)=>[-1.53+3.06*u,1.44-.57*v,-.82] });
  const art = SpriteSurface.make();
  art.mesh(mesh,sign.width,sign.height,(x,y) => {
    const p=(y*sign.width+x)*4,[r,g,b,a]=sign.data.subarray(p,p+4);
    if (a) return (r<<16)|(g<<8)|b;
    return x<2 || y<2 || x>=sign.width-2 || y>=sign.height-2 ? 0xb47450 : 0x492d38;
  });
  const ground = TexturedSurface.heightfield({ bounds:[-2.95,2.95,-1.42,6.45],segments:[8,8],height:()=>-.48 });
  art.mesh(ground,48,45,(x,y)=> x%8===0 || y%9===0 ? 0x172738 : 0x223649);

  const basin = waterBodies.create({ id:'archive pool',bounds:{min:[-2.36,-1.30],max:[2.36,6.16]},resolution:[16,16],
    sample:()=>({ bed:-.60,surface:-.07 }),
    optics:{ tint:[.07,.18,.23],extinction:[.15,.11,.09],surfaceColor:[.79,.98,1],surface:.98,
      refraction:0,foam:0,caustics:0,reflection:{plane:'basin',distortion:2.3,blur:0} } });
  const atmosphere = [K.atmosphere.box({ min:[-2.1,.30,-1.15], max:[2.1,2.15,-.23], density:.27,color:'#93a6b1' })];
  K.weather.fall(B,{ kind:'rain',worldSpace:true,n:73,seed:29,top:2.75,ground:()=>-.065,
    box:[-2.5,2.5,.48,2.45],cols:[4,5,15,16],len:.071,size:.008,speed:2.6 });
  return B.finish({ radius:6, dither:0, cam:{target:[0,.80,.62],dist:8.5,pitch:.35,yaw:-.16,ortho:true},
    spriteSurfaces:art.finish(), atmosphere, water:waterBodies.scene([basin]),
    reflections:[K.reflection.plane({id:'basin',at:[0,-.07,0]})],
    refract:5, look:{splatCoverage:'continuous',coverageAware:true} });
}

function rgba(frame) {
  return K.procedural.sceneGraph.rasterFrame(frame);
}
const png = raster => Buffer.from(PNG.encode(raster.width,raster.height,raster.data,raster.channels)).toString('base64');
function showLayer(layer) {
  const data = layer.value.data.slice();
  for (let i=0;i<layer.valid.data.length;i++) data[i*4+3] = layer.valid.data[i];
  return { ...layer.value, data };
}
function previewMask(layer, channel) {
  const { width, height, data } = layer[channel], image = new Uint8Array(width*height*4);
  for (let p=0;p<width*height;p++) {
    if (!layer.valid.data[p]) continue;
    const n = channel === 'transmission' ? 1-(data[p*3]+data[p*3+1]+data[p*3+2])/3 : data[p];
    const amount = Math.min(1, n * (channel === 'mask' ? 3 : 1.75));
    image.set([Math.round(24+222*amount),Math.round(50+123*amount),Math.round(73+21*amount),255],p*4);
  }
  return {width,height,channels:4,data:image};
}

if (!process.argv[2]) throw new Error('Usage: node examples/deep-composite.cjs <demo.html>');
const frame = ink.render(archive(), { w:216,h:144,px:1,t:.54,raw:true,fragmentBudget:950000,
  deepComposite:{layers:8,reflections:['basin']} });
const transmitted = ink.graphDeepLayer(frame,{view:'transmitted',kind:'sprite'});
const reflected = ink.graphDeepLayer(frame,{view:'reflected',plane:'basin',object:'copper buoy'});
const cards = [
  { title:'Through the pane', data:png(showLayer(transmitted)), note:'The lettering surface sampled through the front glass.' },
  { title:'Reflected in the pool', data:png(showLayer(reflected)), note:'The copper buoy mapped to the water pixels that sample it.' },
  { title:'Fog before the lettering', data:png(previewMask(transmitted,'transmission')), note:'Light lost between the camera and the lettering surface.' },
  { title:'Reflection contribution', data:png(previewMask(reflected,'mask')), note:'The buoy’s coverage after water reflectance and foreground occlusion.' }
];
fs.writeFileSync(process.argv[2],`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tide Archive</title>
<style>
:root{color-scheme:dark;background:#121925;color:#f8ead7;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;padding:35px 26px}
main{max-width:1220px;margin:auto}
header{margin-bottom:24px}
h1{font:500 clamp(46px,7vw,84px)/.92 Georgia,serif;letter-spacing:-.068em;margin:8px 0 12px}
p{color:#c0c8cf;line-height:1.45;margin:0;font-size:14px}
.mono,figcaption,button{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.mono{color:#deb58b;letter-spacing:.13em;font-size:11px}
.layout{display:grid;grid-template-columns:1.88fr 1fr;gap:15px;align-items:start}
figure{margin:0;min-width:0;background:#1d2938;border:1px solid #425061}
figcaption{padding:9px 12px;color:#edd2ad;border-bottom:1px solid #425061;font-size:11px;letter-spacing:.06em}
img{width:100%;height:auto;aspect-ratio:216 / 144;display:block;image-rendering:pixelated;background:#151f2e}
nav{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 10px}
button{background:#273649;color:#eed7b9;border:1px solid #52637a;padding:7px 8px;border-radius:2px;font-size:11px;cursor:pointer}
button[aria-pressed=true]{background:#e9bc87;color:#161e2c;border-color:#e9bc87}
button:focus-visible{outline:2px solid #b4dfdf;outline-offset:2px}
#detail{margin:11px 0 0}
@media(max-width:760px){body{padding:24px 13px}.layout{grid-template-columns:1fr}.layout aside{max-width:540px;width:100%}}
</style>
<main><header><div class="mono">INK STUDIO / DEEP COMPOSITING</div><h1>Tide Archive</h1>
<p>Inspect the surfaces and optical contributions retained beneath the rendered image.</p></header>
<div class="layout"><figure><figcaption>COMPOSITED SCENE</figcaption>
<img src="data:image/png;base64,${png(rgba(frame))}" alt="Splat archive behind blue glass with a copper buoy reflected in water"></figure>
<aside><nav aria-label="Layer">
<button type="button" data-layer="0" aria-pressed="true">Through glass</button>
<button type="button" data-layer="1" aria-pressed="false">Water reflection</button>
<button type="button" data-layer="2" aria-pressed="false">Fog loss</button>
<button type="button" data-layer="3" aria-pressed="false">Reflectance</button></nav>
<figure><figcaption id="name"></figcaption><img id="layer" alt=""></figure><p id="detail"></p></aside></div></main>
<script>
const illustrations = ${JSON.stringify(cards)};
const buttons = Array.from(document.querySelectorAll('nav button'));
function select(index) {
  const {title,data,note} = illustrations[index], image = document.getElementById('layer');
  image.dataset.layer = index;
  image.src = 'data:image/png;base64,' + data;
  image.alt = note;
  document.getElementById('name').textContent = title.toUpperCase();
  document.getElementById('detail').textContent = note;
  for (const [i,button] of buttons.entries()) button.setAttribute('aria-pressed',i===index);
}
buttons.forEach((button,i)=>button.addEventListener('click',()=>select(i)));
select(0);
</script>
</html>`);
console.log(JSON.stringify({
  transmitted: transmitted.valid.data.filter(Boolean).length,
  reflected: reflected.valid.data.filter(Boolean).length
}));
