/* Midnight Relay: an animated emission pass lights a raised ceramic receiver. */
const fs=require('node:fs');
const path=require('node:path');
const PNG=require('../cli/png.js');
const {KIT}=require('..').load();
const {graph,raster,drawing2d}=KIT.procedural;

const W=256,H=152,FPS=24,FRAMES=96,DURATION=FRAMES/FPS,TAU=Math.PI*2;
const out=path.resolve(process.argv[2]??'midnight-relay');
fs.mkdirSync(out,{recursive:true});
const clamp=t=>Math.max(0,Math.min(1,t));
const mix=(a,b,t)=>a+(b-a)*t;
const mod=(a,b)=>((a%b)+b)%b;
const packRGB=n=>[n>>>16,n>>>8&255,n&255];
const colors=(swatches,t)=>swatches[Math.min(swatches.length-1,Math.floor(clamp(t)*swatches.length))];
const chamfer=(x,y,hw,hh,corner)=>Math.max(Math.abs(x)-hw,Math.abs(y)-hh,
  (Math.abs(x)+Math.abs(y)-hw-hh+corner)*Math.SQRT1_2);
const tileInk=[0x171724,0x1b2130,0x202b37,0x263543,0x314756,0x3a5360,0x4d6470];
const steel=[0x0d131e,0x121b29,0x192331,0x232f3c,0x343e49,0x52616a,0x6b747b];
const brass=[0x271a27,0x3a2630,0x564044,0x71564d,0x977259,0xc09468,0xe6bb86];
const cyan=['#000000','#032437','#063c56','#0e5772','#1d7387','#259795','#55b8a2','#98dec7','#d3fae1'];
const ember=['#000000','#281923','#4d2531','#753646','#9e4b4d','#ba6656','#dd8d63','#ffb880','#ffd7a1'];
const ramp=swatches=>({interpolation:'step',stops:swatches.map((color,i)=>[[0,.025,.055,.105,.16,.25,.38,.59,.84][i],color])});
function hash(x,y) {
  let n=Math.imul(x+197,374761393)^Math.imul(y+313,668265263);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function image(paint) {
  const data=new Uint8Array(W*H*4);
  for(let y=0,p=0;y<H;y++)for(let x=0;x<W;x++,p+=4){
    data.set(packRGB(paint(x,y)),p);
    data[p+3]=255;
  }
  return {width:W,height:H,channels:4,data};
}

const relief=new Float32Array(W*H), receiver=new Uint8Array(W*H);
const plate=image((x,y)=>{
  const px=x+.5-128,py=y+.5-77;
  const bounds=chamfer(px,py,111,55,13), grit=hash(x,y);
  const dither=((x+y)%2)*.065+(grit-.5)*.10;
  if(bounds>1.4){
    if(y===21||y===133) return x%10<3 ? 0x26313b : 0x0f1620;
    if(x%12===2&&y%12===5) return 0x29313a;
    return colors(steel,.11+.10*clamp(1-Math.hypot(px*.64,py*.7)/110)+dither);
  }
  const shade=.27+.26*clamp((px+52-py*1.5)/145);
  if(bounds>-1) return colors(steel,.35+shade*.9);
  if(bounds>-4){
    if(Math.abs(px)>98||y%11<2||x%19<1) return colors(brass,shade+.09);
    return colors(steel,shade+.19);
  }
  if(bounds>-6) return colors(steel,.08+shade*.22);
  const groove=chamfer(px,py,100,46,8);
  if(groove>0) return colors(brass,.12+shade*.45);
  const lock=chamfer(px,py,18,19,10);
  if(lock<=0){
    const r=Math.hypot(px,py), gloss=.26+.23*clamp((-px-py+16)/30);
    if(lock>-1) return colors(brass,gloss*.7+.2);
    if(lock>-3) return colors(steel,gloss+.25);
    if(Math.abs(r-8)<1) return colors(brass,gloss+.12);
    if(Math.abs(px-py*.5)<.7&&r<7) return 0xb67b52;
    if(Math.abs(py)===11.5&&Math.abs(px)<3) return 0x526172;
    return colors(steel,.09+gloss*.35+dither);
  }
  const socket=Math.hypot(Math.abs(px)-84,py*.92);
  if(socket<10.5){
    if(socket>9.5) return colors(brass,shade*.6+.18);
    if(socket>8) return colors(steel,shade+.33);
    if(socket>5.5) return colors(steel,.08+shade*.24);
    if(socket>4) return colors(brass,shade+.13);
    return colors(steel,.05+grit*.19);
  }
  const row=Math.floor((y+4)/15);
  const step=mod(x+(row%2)*17,34), v=mod(y+4,15);
  const mortar=chamfer(step+.5-17,v+.5-7.5,16.5,7,1.35);
  const seed=hash(Math.floor((x+(row%2)*17)/34),row);
  const meander=fracture(px,py);
  const surface=clamp(-mortar/2.75);
  const grooveX=step>6&&step<29&&v>3&&v<11;
  const patina=Math.sin(x*.13+y*.18)+Math.sin(x*.28-y*.45)*.24;
  const z=surface*(3.6+seed*2.8)+(grooveX?meander*.58:0);
  const p=y*W+x;
  relief[p]=z;
  receiver[p]=mortar>0?103:255;
  if(mortar>0) return colors(tileInk,.03+grit*.13);
  if(surface<.71) {
    const edge=Math.min(step,33-step)<Math.min(v,14-v);
    const left=edge ? step<17 : v<7;
    return colors(tileInk,(left?.43:.15)+seed*.18+dither);
  }
  const inlay=(Math.abs(py+9+.16*px)<.45||Math.abs(py+2-.16*px)<.46) && Math.abs(px)<75;
  if(inlay&&grit>.25) return colors(brass,.18+shade*.37);
  if(v===5&&step>4&&step<29&&grit>.60) return colors(tileInk,.51+seed*.25);
  return colors(tileInk,.20+seed*.42+patina*.09+dither+(grooveX?meander*.08:0));
});
function fracture(x,y){
  return Math.sin(x*.27+Math.sin(y*.39))*.43+Math.cos(y*.89+x*.1)*.33;
}
const height={width:W,height:H,channels:1,data:relief};
const mask={width:W,height:H,channels:1,data:receiver};
const fieldBack=image((x,y)=>{
  const px=x+.5-128,py=y+.5-77;
  const r=chamfer(px,py,103,47,9);
  if(r>0) return x%14===0&&y%14===0 ? 0x212d3a : 0x0b1019;
  if(receiver[y*W+x]===0) return 0x0b1019;
  return r>-1 ? 0x233442 : 0x111c29;
});
const text=(label,x,y,color)=>({source:drawing2d.text(label,{color,tracking:1}).value,x,y});
const top=[text('MIDNIGHT RELAY',13,8,'#a0bab6'),text('CERAMIC RECEIVER',13,138,'#59727c')];
const guide=[text('RECEIVED LIGHT',13,8,'#a0bab6'),text('STEPPED INTENSITY',13,138,'#59727c')];
const insert=(node,port)=>({node,...(port&&{port})});
const input=name=>({input:name});
const circuit=graph.create({
  inputs:{height:'raster',mask:'raster',cool:'record',hot:'record',coolLight:'record',hotLight:'record'},
  nodes:{
    arc:{op:'proc.discharge',inputs:{options:input('cool')}},
    echo:{op:'proc.discharge',inputs:{options:input('hot')}},
    cool:{op:'fx.relight',inputs:{emission:insert('arc','fringe'),height:input('height'),mask:input('mask'),options:input('coolLight')}},
    hot:{op:'fx.relight',inputs:{emission:insert('echo','fringe'),height:input('height'),mask:input('mask'),options:input('hotLight')}},
    cyan:{op:'color.gradient',inputs:{source:insert('cool','intensity'),ramp:ramp(cyan),options:{channel:0,range:[0,1]}}},
    ember:{op:'color.gradient',inputs:{source:insert('hot','intensity'),ramp:ramp(ember),options:{channel:0,range:[0,1]}}}
  },
  outputs:{arc:insert('arc'),echo:insert('echo'),cyan:insert('cyan'),ember:insert('ember')}
});

function frame(i){
  const time=i/FPS, t=time/DURATION*TAU;
  const breath=(Math.sin(t-.66)+1)*.5, sweep=25*Math.sin(t);
  const cool={width:W,height:H,period:DURATION,seed:119,detail:4,roughness:.55,amplitude:7,
    branches:5,branchReach:18,coreWidth:.9,edgeWidth:1.55,haloRadius:4,core:'#e8ffed',edge:'#51e6e4',halo:'#177fbd',
    points:[[44,77],[72,57+12*Math.sin(t+.8)],[113,67+sweep],[159,67+sweep*.88],[189,66+11*Math.sin(t+.2)],[212,77]]};
  const hot={width:W,height:H,period:DURATION,seed:84,detail:4,roughness:.49,amplitude:5,
    branches:3,branchReach:12,coreWidth:.68,edgeWidth:1.35,haloRadius:3,core:'#ffe0a3',edge:'#ff8453',halo:'#a93952',
    points:[[45,78],[80,99+9*Math.sin(t-.5)],[122,89-sweep*.63],[172,96-sweep*.51],[211,78]]};
  const {arc,echo,cyan,ember}=circuit.evaluate({
    height,mask,cool,hot,
    coolLight:{radius:37,emitterHeight:13,strength:mix(.027,.056,breath)},
    hotLight:{radius:29,emitterHeight:10,strength:mix(.032,.049,1-breath)}
  },{time}).outputs;
  const light=[{source:cyan,mode:'screen'},{source:ember,mode:'screen'}];
  const vase=raster.stack({width:W,height:H,layers:[{source:plate},...light,{source:echo},{source:arc},...top]}).value;
  const diagnostic=raster.stack({width:W,height:H,layers:[{source:fieldBack},...light,...guide]}).value;
  return [vase,diagnostic];
}
function makeFrame(images){
  const divider=images.length>1?8:0, w=images.length*W+divider;
  const rgb=new Uint8Array(w*H*3).fill(11);
  for(const [layer,image] of images.entries())for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const src=(y*W+x)*4,dst=(y*w+layer*(W+divider)+x)*3;
    rgb[dst]=image.data[src]; rgb[dst+1]=image.data[src+1]; rgb[dst+2]=image.data[src+2];
  }
  return {w,h:H,rgb};
}
const comparison=[],single=[];
for(let i=0;i<FRAMES;i++){
  const layers=frame(i);
  comparison.push(makeFrame(layers));
  single.push(makeFrame([layers[0]]));
}
const join=makeFrame(frame(FRAMES));
if(!Buffer.from(join.rgb).equals(Buffer.from(comparison[0].rgb)))
  throw Error('Midnight Relay produces different pixels at the loop seam');
circuit.clear();
const still=comparison[25];
PNG.write(path.join(out,'midnight-relay-contact.png'),still.w,still.h,still.rgb);
PNG.animate(path.join(out,'midnight-relay.png'),single,FPS);
PNG.animate(path.join(out,'midnight-relay-passes.png'),comparison,FPS);
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Midnight Relay</title><style>
:root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;color:#e3ebe6;background:#0d121b}
main{max-width:1100px;margin:auto;padding:24px 16px 56px}h1{font-size:clamp(30px,6vw,64px);margin:0;letter-spacing:-.045em}
p{color:#a1b8b7;margin:0 0 18px;max-width:62ch}img{width:100%;height:auto;display:block;image-rendering:pixelated;border:1px solid #283647}
</style><main><h1>Midnight Relay</h1><p>Two plasma filaments wash light over stepped ceramic tiles. The right panel isolates the light received by the surface. The central metal plate and frame stay outside the receiver mask.</p>
<img src="midnight-relay-passes.png" width="1040" height="304" alt="Relit ceramic atlas and its isolated receiver light pass">
</main></html>`);
console.log(path.join(out,'index.html'));
