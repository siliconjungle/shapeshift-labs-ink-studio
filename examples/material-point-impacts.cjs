/* Slip Cast: a fixed-step material-point study using measured contact for the spray. */
const fs=require('node:fs');
const path=require('node:path');
const PNG=require('../cli/png.js');
const {KIT}=require('..').load();
const {rasterSimulation:S,graph,raster,drawing2d}=KIT.procedural;
const W=128,H=90;
const floorY=x=>78-Math.max(0,Math.abs(x-64)-38)*.54;
const layer=(w,h,apply)=>({width:w,height:h,channels:1,data:Uint8Array.from({length:w*h},(_,i)=>apply(i%w,Math.floor(i/w))*255)});
const walls=layer(W,H,(x,y)=>y>=Math.floor(floorY(x))||x<6||x>=122);
const shoe=layer(43,6,(x,y)=>x>=y&&x<=42-y&&y>=Math.floor(x/20));
const circle=[];
for(let y=12.5;y<31;y+=.78)for(let x=28.5;x<49;x+=.78){
  const u=x-38,v=y-21.5,d=Math.hypot(u*.96,v);
  if(d<9.4&&(d>4.4 || u<-.5&&v>2))circle.push([x,y]);
}
const moving={id:'shoe',mask:shoe,maskChannel:0,keys:[
  {time:0,at:[49,63]}, {time:.50,at:[47,61]}, {time:.86,at:[45,57]},
  {time:1.2,at:[39,56]}, {time:1.72,at:[28,64]}, {time:2.35,at:[44,64]}, {time:3.15,at:[49,62]}
]};
const recipe=S.define('mpm',{width:W,height:H,cell:1.65,maxSpeed:108,substeps:9,gravity:[0,110],bounce:.38,damping:.15,
  mask:walls,maskChannel:0,colliders:[moving],
  materials:[{type:'elastic',color:'#f4b360',stiffness:4800,shear:1250,density:1},
    {type:'fluid',color:'#5eead1',stiffness:4300,density:1.18}],
  bodies:[{points:circle,spacing:.78,material:0,velocity:[25,12],release:.34},
    {rect:[79,14,14,17],spacing:.72,material:1,velocity:[-11,23],release:.18},
    {rect:[90,26,6,7],spacing:.69,material:1,velocity:[-16,29],release:.49}],
  impulses:[{time:.97,body:0,deltaVelocity:[18,-47]},
    {time:1.60,material:1,at:[72,56],radius:28,deltaVelocity:[42,-51]}]
},{dt:1/48,maxTicks:180,seed:989});

const output=path.resolve(process.argv[2]??'slip-cast');
fs.mkdirSync(output,{recursive:true});
const FPS=24, ticks=160;
const clamp=x=>Math.max(0,Math.min(1,x));
const rgb=n=>[n>>>16,n>>>8&255,n&255];
const ramp=(colors,x)=>colors[Math.min(colors.length-1,Math.floor(clamp(x)*colors.length))];
const amber=[0x532e40,0x7d4347,0xad5f4e,0xd78255,0xf3aa64,0xffd28a,0xffedb6];
const lagoon=[0x17334e,0x174a61,0x196479,0x258b90,0x42b5a5,0x7be3c3,0xc2f7d8];
const pressure=[0x243e56,0x424f79,0x785c92,0xb7719b,0xf19f9d,0xffd9ab];
const alloy=[0x0d1221,0x151c2d,0x1d293a,0x26384a,0x354b5c,0x4b6570];
const sparkInk=[0x7a4857,0xc16a62,0xf49d70,0xffcd87,0xffefbb];
const heat={interpolation:'step',stops:[[0,'#000000'],[.025,'#39253b'],[.075,'#73435a'],
  [.16,'#bf655e'],[.32,'#ff986d'],[.54,'#ffcf8d'],[.8,'#fff1bc'],[1,'#ffffe2']]};
const field=(node,port)=>({node,...(port&&{port})});
const solver=graph.create({
  nodes:{
    body:{op:'sim.mpm',inputs:{recipe,options:{every:8,cache:12}}},
    amber:{op:'raster.select',inputs:{sources:field('body','materialDensity'),index:0}},
    teal:{op:'raster.select',inputs:{sources:field('body','materialDensity'),index:1}},
    impact:{op:'color.gradient',inputs:{source:field('body','contact'),ramp:heat,
      options:{channel:0,range:[0,540]}}}
  },
  outputs:{amber:field('amber'),teal:field('teal'),rim:field('impact'),
    cover:field('body','materialCoverage'),squeeze:field('body','materialCompression'),
    contact:field('body','contact'),collision:field('body','collisionMask'),report:field('body','report')}
});
function noise(x,y){
  let n=Math.imul(x+109,0x9e3779b1)^Math.imul(y+313,0x85ebca77);
  n=Math.imul(n^(n>>>14),0xc2b2ae3d);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function image(paint){
  const data=new Uint8Array(W*H*4);
  for(let y=0,i=0;y<H;y++)for(let x=0;x<W;x++,i++){
    const value=paint(x,y,i);
    if(value===undefined) continue;
    data.set(rgb(value),i*4);
    data[i*4+3]=255;
  }
  return {width:W,height:H,channels:4,data};
}
function backdrop(x,y){
  const f=floorY(x), metal=x<6||x>=122, grit=noise(x,y);
  const dither=((x+y)%2)*.08+(grit-.5)*.12;
  if(y>=Math.floor(f)){
    const lip=y-Math.floor(f);
    if(lip===0)return alloy[4];
    if(lip===1)return alloy[2];
    const latch=(x+4)%17===0&&y%4===0&&lip<7;
    return ramp(alloy,.14+.085*(lip<5)+.37*latch+dither);
  }
  if(metal)return x===5||x===122||y%8===1 ? alloy[3] : alloy[1];
  if((x===25||x===104)&&y>4&&y<58&&y%4!==0)return alloy[1];
  if(y%10===4&&x%10===4) return alloy[2];
  return ramp(alloy,.115+.13*clamp(1-Math.hypot((x-64)*.62,y-53)/65)+dither);
}
const background=image(backdrop);
const scanBack=image((x,y)=>x%8===0&&y%8===0?alloy[2] : x<6||x>=122||y>=floorY(x)?0x0d131f:0x101928);
const caption=(label,x,y,color)=>({source:drawing2d.text(label,{color}).value,x,y});
const beautyNote=[caption('SLIP CAST',10,4,'#a6b6b4'),caption('ELASTIC / FLUID',9,81,'#7c928f')];
const scanNote=[caption('COMPRESSION',10,4,'#c29cb2'),caption('WALL CONTACT',9,81,'#db9d82')];

function paintMaterial(o,diagnostic=false){
  const densities=[o.amber.data,o.teal.data], cover=o.cover.map(p=>p.data), squeeze=o.squeeze.map(p=>p.data);
  return image((x,y,i)=>{
    const id=cover[0][i]===1&&cover[1][i]===1 ? Number(densities[1][i]>densities[0][i]) :
      Number(cover[1][i]>cover[0][i]);
    const coverage=cover[id][i], tightness=squeeze[id][i];
    if(coverage<.32)return;
    if(diagnostic){
      if(tightness<.055)return id===0?0x282e45:0x183b48;
      return ramp(pressure,tightness/.50);
    }
    const plane=densities[id], color=id===0?amber:lagoon;
    const above=y>0?plane[i-W]:0, beside=x>0?plane[i-1]:0;
    const face=.53+.30*Math.tanh((plane[i]-above)*1.7+(plane[i]-beside)*.52);
    const lines=.07*Math.sin(x*.66+y*.17)+.045*(noise(x,y)-.5);
    return ramp(color,face+lines+.23*tightness-.35*(1-coverage));
  });
}
function collider(o,diagnostic=false){
  const [sx,sy]=o.report.colliders[0].at;
  return image((x,y,i)=>{
    if(diagnostic) return o.collision.data[i] ? alloy[2] : undefined;
    const u=x-sx,v=y-sy;
    if(u<0||u>=shoe.width||v<0||v>=shoe.height||!shoe.data[v*shoe.width+u])return;
    if(v<=Math.floor(u/20)) return u%12<3?0xcf9e72:0x76858d;
    if(v===5) return alloy[0];
    if((u-v*2)%9<3) return 0x665059;
    return ramp(alloy,.46-.058*v);
  });
}
const newSparks=[], maxima=new Map();
function trigger(report,tick){
  const {peak,at}=report.impact;
  if(peak<95)return;
  const [x,y]=at, region=Math.floor(x/15)+9*Math.floor(y/12);
  if(tick-(maxima.get(region)??-100)<11)return;
  maxima.set(region,tick);
  for(let i=0;i<Math.min(17,Math.ceil(peak/31));i++){
    const s=noise(tick,i), d=noise(i,tick), n=noise(tick+7,i+1);
    newSparks.push({tick,x,y,vx:(s-.53)*(32+38*d),vy:-(19+48*n),age:.13+.28*d,rank:i});
  }
}
function sparkFrame(tick){
  const commands=[];
  for(const s of newSparks){
    const t=(tick-s.tick)/48;
    if(t<0||t>s.age)continue;
    const x=Math.floor(s.x+s.vx*t),y=Math.floor(s.y+s.vy*t+105*t*t);
    const color='#'+ramp(sparkInk,1-t/s.age).toString(16).padStart(6,'0');
    commands.push({type:'rect',rect:[x,y,s.rank%4===0?2:1,1],fill:color});
  }
  return drawing2d.render({width:W,height:H,commands,edges:'hard'});
}
function paint(o,tick){
  const sparks=sparkFrame(tick), glow={source:o.rim,mode:'screen'};
  const materials=paintMaterial(o), compression=paintMaterial(o,true);
  const beauty=raster.stack({width:W,height:H,layers:[{source:background},{source:collider(o)},
    {source:materials},glow,{source:sparks},...beautyNote]}).value;
  const diagnostic=raster.stack({width:W,height:H,layers:[{source:scanBack},{source:collider(o,true)},
    {source:compression},glow,...scanNote]}).value;
  return [beauty,diagnostic];
}
function pack(images){
  const gap=images.length>1?6:0,w=images.length*W+gap,data=new Uint8Array(w*H*3).fill(11);
  for(const [j,image] of images.entries())for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=(y*W+x)*4,q=(y*w+j*(W+gap)+x)*3;
    data[q]=image.data[p];data[q+1]=image.data[p+1];data[q+2]=image.data[p+2];
  }
  return {w,h:H,rgb:data};
}
const clip=[],passes=[];
let firstHit, best={peak:0};
for(let tick=0;tick<ticks;tick++){
  const o=solver.evaluate({}, {time:tick/48}).outputs;
  const {peak,at}=o.report.impact;
  if(peak>best.peak)best={peak,at,tick};
  if(tick>0&&peak>180&&firstHit===undefined)firstHit=tick;
  trigger(o.report,tick);
  if(tick%2)continue;
  const pair=paint(o,tick);
  clip.push(pack([pair[0]]));
  passes.push(pack(pair));
}
solver.clear();
if(firstHit===undefined||!newSparks.length)throw Error('Slip Cast has no collision-driven spray');
const still=passes[Math.floor(best.tick/2)];
PNG.write(path.join(output,'slip-cast-contact.png'),still.w,still.h,still.rgb);
PNG.animate(path.join(output,'slip-cast.png'),clip,FPS);
PNG.animate(path.join(output,'slip-cast-passes.png'),passes,FPS);
fs.writeFileSync(path.join(output,'impact.json'),JSON.stringify({firstHit,peak:best,dt:1/48},null,2)+'\n');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slip Cast</title><style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;color:#e8e7df;background:#0d121b}
main{max-width:1080px;margin:auto;padding:24px 16px 56px}h1{font-size:clamp(32px,6vw,64px);margin:0;letter-spacing:-.05em}
p{max-width:62ch;color:#aebcbb;margin:0 0 18px}img{width:100%;height:auto;display:block;image-rendering:pixelated;border:1px solid #293348}
</style><main><h1>Slip Cast</h1><p>An elastic gasket and liquid pigment drop onto a moving plate. The right panel shows compression and collision strength. Spray on the left is triggered by the measured contacts.</p>
<img src="slip-cast-passes.png" width="1048" height="360" alt="A material-point landing beside its compression and contact passes">
</main></html>`);
console.log(path.join(output,'index.html'));
