/* Faultglass: move painted enamel cells and drive the revealed light from the gap port. */
const fs = require('node:fs');
const path = require('node:path');
const PNG = require('../cli/png.js');
const {KIT} = require('..').load();
const {graph,raster,drawing2d}=KIT.procedural;
const W=256,H=160,CX=128,CY=80,FPS=24,FRAMES=120;
const TAU=2*Math.PI;
const target=path.resolve(process.argv[2] ?? 'faultglass');
fs.mkdirSync(target,{recursive:true});

const clamp=n=>Math.max(0,Math.min(1,n));
const fract=n=>n-Math.floor(n);
const ease=(a,b,t)=>{const u=clamp((t-a)/(b-a)); return u*u*(3-2*u);};
const ramp=(colors,t)=>colors[Math.min(colors.length-1,Math.floor(clamp(t)*colors.length))];
const rgb=n=>[n>>>16,n>>>8&255,n&255];
const gold=[0x44273a,0x79404a,0xa7524b,0xc77751,0xe5a56b,0xf4ca88,0xffeba9,0xffffda];
const enamel=[0x131629,0x1c2339,0x23324b,0x28465d,0x2d6170,0x438582,0x70ae9d];
const night=[0x0b0c15,0x10131f,0x151b28,0x172534,0x203645];
const ember=[0x68293a,0x9c3943,0xc95745,0xf0824a,0xffb46a,0xffefa0];
function hash(x,y) {
  let n=Math.imul(x+103,374761393)^Math.imul(y+911,668265263);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

function layer(paint) {
  const data=new Uint8Array(W*H*4);
  for(let y=0,p=0;y<H;y++) for(let x=0;x<W;x++,p+=4){
    const ink=paint(x+.5-CX,y+.5-CY,x,y);
    if(ink==null) continue;
    const [color,alpha=255]=Array.isArray(ink)?ink:[ink];
    data.set(rgb(color),p);
    data[p+3]=alpha;
  }
  return {width:W,height:H,channels:4,data};
}

const sealRadius=(x,y)=>{
  const a=Math.atan2(y*1.09,x), r=Math.hypot(x,y*1.09);
  return r*Math.cos((fract(a/TAU*12+.5)-.5)*TAU/12);
};
const plate=layer((x,y,gx,gy)=>{
  const r=sealRadius(x,y), a=Math.atan2(y*1.09,x);
  if(r>58) return;
  const shine=.46+.39*Math.cos(a+2.1)+.08*(hash(gx,gy)-.5);
  if(r>57) return gold[1];
  if(r>55.5) return ramp(gold,shine+.14);
  if(r>53.5) return ramp(gold,shine*.8+.02);
  if(r>52.4) return gold[0];
  if(r>51.5) return ramp(gold,shine+.07);
  if(r>49.5) return enamel[0];
  if(r>46.8) {
    const tick=fract((a/TAU+.5)*48+.5);
    if(tick<.14||tick>.86) return ramp(gold,shine*(tick<.08||tick>.92?1:.75));
  }
  if(Math.abs(r-43.7)<.45||Math.abs(r-39)<.38) return ramp(enamel,shine+.15);
  const u=Math.abs(x), v=y;
  const leftWing=((u-14+.44*(v+10))/17)**2+((v+10)/9.5)**2<1 && u>3;
  const lowerWing=((u-11-.49*(v-5))/11.4)**2+((v-5)/7.5)**2<1 && u>3;
  const body=u<1.7+2.25*ease(14,0,Math.abs(v)) && v>-15 && v<22;
  const antenna=v<-14&&v>-24&&Math.abs(u-(-v-13)*.72)<.8;
  if(leftWing||lowerWing||body||antenna){
    const rib=fract((Math.atan2(v+1,u)*3.3)*1.4);
    if(!body&&!antenna&&(rib<.10 || rib>.95 || u>21&&v<-10&&hash(gx,gy)>.89)) return gold[1];
    const hot=.72-.22*Math.min(1,u/32)-.012*v+.15*Math.sin(u*.67+v*.23)+.07*hash(gx,gy);
    return ramp(gold,hot);
  }
  if((u>27&&u<35)&&Math.abs(v)<2.9-.35*Math.abs(u-31)) return ramp(gold,.61+.2*Math.sin(a));
  if((Math.abs(y)>25&&Math.abs(y)<31)&&u<2.8-.62*Math.abs(Math.abs(y)-28)) return gold[5];
  const meridian=Math.abs(Math.sin(x*.29+Math.sin(y*.12)))*Math.abs(Math.sin(y*.44));
  const lattice=Math.abs(y)<34 && u<34 && meridian<.125 ? .12 : 0;
  const inlay=fract(a/TAU*16+.5), facet=inlay>.08&&inlay<.11&&r>18?.12:0;
  const grade=.29+.17*Math.sin(a-.5)+.16*(1-r/58)+lattice+facet;
  const patina=hash(gx,gy)-.5;
  return ramp(enamel,grade+.14*patina);
});

const sites=[
  {id:11,at:[-36,-31],move:[-18,-12],turn:-.17,depth:1},
  {id:16,at:[-8,-45],move:[1,-15],turn:.12,depth:0},
  {id:23,at:[23,-33],move:[14,-11],turn:.15,depth:-3},
  {id:34,at:[42,-12],move:[20,-4],turn:-.19,depth:-4},
  {id:51,at:[-46,-4],move:[-22,1],turn:.17,depth:1},
  {id:60,at:[-18,-7],move:[-6,-2],turn:-.28,depth:-2},
  {id:67,at:[9,-4],move:[9,-1],turn:.24,depth:-5,scale:1.06},
  {id:76,at:[-30,20],move:[-16,11],turn:-.16,depth:3},
  {id:84,at:[-3,29],move:[-4,19],turn:.20,depth:-1},
  {id:93,at:[25,20],move:[16,10],turn:-.17,depth:-2},
  {id:108,at:[21,49],move:[9,18],turn:.18,depth:2}
];
const ids=new Uint16Array(W*H);
for(let y=0,p=0;y<H;y++) for(let x=0;x<W;x++,p++){
  if(!plate.data[4*p+3]) continue;
  const u=x+.5-CX,v=y+.5-CY;
  let best=Infinity;
  for(const {id,at:[sx,sy]} of sites){
    const dx=u+.80*Math.sin(v*.48)+.7*Math.sin(u*.82)-sx,dy=v+1.3*Math.sin(u*.35)-sy;
    const distance=dx*dx+dy*dy;
    if(distance<best){ best=distance;ids[p]=id; }
  }
}
const labels={width:W,height:H,channels:1,data:ids};

const backdrop=layer((x,y,gx,gy)=>{
  const r=Math.hypot(x*.8,y*1.04);
  const seal=sealRadius(x,y-3);
  if(seal>57.6&&seal<60.5) return r<56?0x323446:0x242735;
  if(seal<60.3) return seal>55?0x1e1723:0x151119;
  const scatter=hash(gx,gy);
  if(gx%12===8&&gy%12===8) return r<110?0x273540:0x21222e;
  if(Math.abs(y)<.51&&Math.abs(x)>82 && gx%3) return 0x1d303c;
  const detail=.22+.25*ease(116,20,r)+.12*(scatter-.5);
  return ramp(night,detail);
});
const readout=layer((x,y,gx,gy)=>{
  const r=sealRadius(x,y);
  if(r<58.4) return r>57?0x333747:0x1b1e2b;
  if(gx%10===1&&gy%10===0) return 0x223344;
  return ramp(night,.17+.25*ease(115,27,Math.hypot(x,y)));
});
const shadow=raster.canvas({width:W,height:H,color:[10,5,13,194]});
const matteInk=raster.canvas({width:W,height:H,color:[255,219,174]});
function stockText(value,x,y,color){
  return {source:drawing2d.text(value,{color,tracking:1}).value,x,y};
}
const annotations=[
  stockText('FAULTGLASS',9,9,'#a099a2'),
  stockText('ENAMEL / 11',9,145,'#61727f')
];
const maskAnnotations=[
  stockText('GAP MASK',9,9,'#b7a4a2'),
  stockText('EXPOSED ALPHA',9,145,'#61727f')
];
const studio=graph.create({
  inputs:{paint:'raster',labels:'raster',transforms:'array<record>',light:'raster',shadow:'raster'},
  nodes:{
    pieces:{op:'fx.moveRegions',inputs:{source:{input:'paint'},labels:{input:'labels'},transforms:{input:'transforms'}}},
    fissures:{op:'raster.mask',inputs:{source:{input:'light'},mask:{node:'pieces',port:'gaps'}}},
    glow:{op:'fx.glow',inputs:{source:{node:'fissures'},options:{radius:3,strength:.86,color:'#ed6a48'}}},
    cast:{op:'raster.mask',inputs:{source:{input:'shadow'},mask:{node:'pieces'},options:{channel:'alpha'}}}
  },
  outputs:{face:{node:'pieces'},glow:{node:'glow'},shadow:{node:'cast'},gaps:{node:'pieces',port:'gaps'}}
});

function framesAt(p){
  const peel=ease(.12,.64,p)*(1-ease(.72,.99,p));
  const envelope=(delay)=>ease(.11+delay,.47+delay,p)*(1-ease(.64+delay*.25,.94+delay*.17,p));
  const transforms=sites.map(({id,at:[x,y],move:[dx,dy],turn,depth,scale=1},i)=>{
    const lift=envelope(i*.023);
    const shiver=Math.sin((p*4.2+i*.27)*TAU)*peel;
    const drawIn=ease(.012,.108,p)*(1-ease(.111,.18,p));
    return {id,pivot:[CX+x,CY+y],scale:1+(scale-1)*lift,depth,
      offset:[lift*dx+shiver*.85-dx*drawIn*.17,lift*dy+shiver*.55-dy*drawIn*.17],
      angle:turn*lift+shiver*.017};
  });
  const light=layer((x,y)=>{
    const t=.55+.17*Math.sin(x*.125-y*.17+p*TAU*3)+.13*Math.sin(y*.44+x*.06)+.15*peel;
    return [ramp(ember,t),240];
  });
  const result=studio.evaluate({paint:plate,labels,transforms,light,shadow}).outputs;
  const sparks=layer((x,y,gx,gy)=>{
    const ring=sealRadius(x,y);
    if(ring<46||ring>82||hash(gx,gy)<.993) return;
    const t=fract(p*2+hash(gy,gx));
    if(t>.24+.39*peel||peel<.05) return;
    return [gold[4+(hash(gx+4,gy)>.62)],Math.floor(peel*200)];
  });
  const beauty=raster.stack({width:W,height:H,layers:[
    {source:backdrop},{source:result.glow},{source:result.shadow,x:2,y:4},
    {source:result.face},{source:sparks},...annotations
  ]}).value;
  const matte=raster.stack({width:W,height:H,layers:[
    {source:readout},{source:raster.mask(matteInk,result.gaps)},...maskAnnotations
  ]}).value;
  return {beauty,matte,gaps:result.gaps};
}
function pack(images){
  const partition=images.length>1?8:0, w=W*images.length+partition;
  const rgb=new Uint8Array(w*H*3).fill(11);
  for(const [j,image] of images.entries()) for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const from=(y*W+x)*4,to=(y*w+j*(W+partition)+x)*3;
    for(let c=0;c<3;c++)rgb[to+c]=image.data[from+c];
  }
  return {w,h:H,rgb};
}
const clip=[],split=[];
for(let i=0;i<FRAMES;i++){
  const {beauty,matte,gaps}=framesAt(i/FRAMES);
  if(i===0 && gaps.data.some(n=>n)) throw Error('The intact seal has an unexpected gap');
  if(i===65 && !gaps.data.some(n=>n===255)) throw Error('The split seal did not expose its backing');
  clip.push(pack([beauty]));
  split.push(pack([beauty,matte]));
}
studio.clear();
const still=split[65];
PNG.write(path.join(target,'faultglass-contact.png'),still.w,still.h,still.rgb);
PNG.animate(path.join(target,'faultglass.png'),clip,FPS);
PNG.animate(path.join(target,'faultglass-matte.png'),split,FPS);
fs.writeFileSync(path.join(target,'index.html'),`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Faultglass</title><style>
:root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;background:#0d0e16;color:#ede3d8}
main{max-width:1100px;padding:24px 16px 56px;margin:auto}h1{font-size:clamp(30px,6vw,62px);margin:0;letter-spacing:-.044em}
p{color:#b6a7aa;margin:0 0 16px;max-width:53ch}img{display:block;width:100%;height:auto;image-rendering:pixelated;border:1px solid #29283a}
</style><main><h1>Faultglass</h1><p>Eleven pieces of enamel lift and settle. The gap mask on the right isolates the newly exposed backing that lights the seams on the left.</p>
<img src="faultglass-matte.png" width="1040" height="320" alt="Animated enamel dial and its synchronized gap mask">
</main></html>`);
console.log(path.join(target,'index.html'));
