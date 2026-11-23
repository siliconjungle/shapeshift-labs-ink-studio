/* Cask Study: one signed-field trace, three graph-edited barrel finishes. */
const fs=require('node:fs');
const path=require('node:path');
const PNG=require('../cli/png.js');
const {KIT}=require('..').load();
const {barrelShape,hoops,nStaves}=require('./pixel-effects-atlas/barrel-shape');
const {graph,raster,drawing2d}=KIT.procedural;
const W=128,H=146,FPS=24,FRAMES=72,TAU=Math.PI*2;
const output=path.resolve(process.argv[2]??'cask-study');
fs.mkdirSync(output,{recursive:true});
const clay=['#251e2b','#3b2731','#583438','#75443c','#95543f','#b8734c','#d38d5c','#edad76','#ffcc92'];
const ash=['#1d2835','#303d49','#4b5457','#686961','#8a826e','#a99b7e','#c7b591','#e6cfaa','#fff0c7'];
const steel=['#151b2e','#242d4a','#384669','#536484','#71849d','#92a7b9','#b5c9ce','#dce0db','#f2f3de'];
const copper=['#272535','#3e2d3d','#613e45','#884a4f','#aa6251','#cb7a55','#e8a16d','#ffc994','#ffe6b7'];
const clamp=t=>Math.max(0,Math.min(1,t));
const fract=t=>t-Math.floor(t);
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const rgb=n=>[n>>>16,n>>>8&255,n&255];
const steps=(palette,x)=>palette[Math.min(palette.length-1,Math.floor(clamp(x)*palette.length))];
const bytes=(width,height,data,channels=1)=>({width,height,channels,data});
function noise(x,y,s=0){
  let n=Math.imul(x+131,374761393)^Math.imul(y+317+s,668265263);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function grain(u,v,s){
  const x=Math.floor(u),y=Math.floor(v);
  const a=smooth(0,1,fract(u)),b=smooth(0,1,fract(v));
  const h0=noise(x,y,s)*(1-a)+noise(x+1,y,s)*a;
  const h1=noise(x,y+1,s)*(1-a)+noise(x+1,y+1,s)*a;
  return h0*(1-b)+h1*b;
}
function scalar(width,height,paint){
  return bytes(width,height,Uint8Array.from({length:width*height},(_,i)=>{
    const x=i%width,y=Math.floor(i/width);
    return Math.round(clamp(paint((x+.5)/width,(y+.5)/height,x,y))*255);
  }));
}
function colorMap(width,height,paint){
  const data=new Uint8Array(width*height*4);
  for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++,i+=4){
    data.set(rgb(paint(x,y)),i);
    data[i+3]=255;
  }
  return bytes(width,height,data,4);
}
const U=384,V=256, halfY=barrelShape.bounds.max[1];
const wood=scalar(U,V,(u,v,x,y)=>{
  const plankPos=fract(u-.5)*nStaves, plank=Math.floor(plankPos), local=fract(plankPos);
  const curved=plankPos*10+.30*Math.sin(v*19+plank)+.47*grain(plankPos*3,v*8,72);
  const line=(.5+.5*Math.sin(curved*TAU+.55*grain(plankPos*25,v*4,57)))**8;
  const fibers=grain(plankPos*38+Math.sin(v*13),v*18,42);
  const knotX=noise(plank,67)*.51+.23, knotY=.16+noise(plank,18)*.67;
  const knot=Math.hypot((local-knotX)*1.24,(v-knotY)*7);
  const knotRings=(.5+.5*Math.cos(39*knot))**6*smooth(.54,.06,knot);
  return .49+.23*(noise(plank,9)-.5)+.30*(fibers-.5)-.16*line-.22*knotRings+.037*(noise(x,y)-.5);
});
const grooves=scalar(U,V,(u,v)=>{
  const s=fract(u-.5)*nStaves, seam=Math.abs(fract(s+.5)-.5);
  return .32*smooth(.079,.012,seam)+.015*(.5+.5*Math.cos(v*TAU*4));
});
const endgrain=scalar(176,176,(u,v,x,y)=>{
  const dx=(u-.5)*2,dz=(v-.5)*2,r=Math.hypot(dx,dz);
  const wav=.34*Math.cos(dx*14)+.41*grain(dx*10,dz*7,98);
  const rings=(.5+.5*Math.sin(86*Math.hypot(dx+.34,dz-.12)+wav*2.9))**8;
  const seams=smooth(.068,.022,Math.abs(fract((dx+.04)*4.6+.5)-.5));
  const rim=smooth(.59,.61,r)*smooth(.68,.65,r);
  return .55+.11*grain(dx*43,dz*7,87)-.11*rings-.22*seams-.27*rim+.05*(noise(x,y)-.5);
});
const metal=scalar(U,V,(u,v,x,y)=>{
  const height=halfY-v*2*halfY;
  const d=Math.min(...hoops.map(h=>Math.abs(h-height)));
  const roll=.32*smooth(.093,.016,d)+.09*smooth(.08,.044,d)-.16*smooth(.074,.10,d);
  const stripes=(.5+.5*Math.sin(v*432+Math.sin(u*TAU*42)*1.1))**10;
  const hammer=.12*(grain(u*230,v*106,19)-.5)+.045*(noise(x,y)-.5);
  return .35+roll+hammer-.05*stripes;
});
const rivets=[];
for(const h of hoops) for(let i=0;i<nStaves;i++){
  const u=fract(.5+(i+.5)/nStaves),v=(halfY-h)/(2*halfY),x=u*U,y=v*V;
  rivets.push({type:'ellipse',rect:[x-2.7,y-2.8,5.4,5.6],fill:'#171717a0'});
  rivets.push({type:'ellipse',rect:[x-2.1,y-2.2,4.2,4.2],fill:'#d2d2d2'});
  rivets.push({type:'rect',rect:[x-1.6,y-1.7,1.9,1.7],fill:'#ffffff'});
}

const link=(node,port)=>({node,...(port&&{port})});
const ref=input=>({input});
const nodes={
  trace:{op:'proc.fieldSprite',inputs:{source:ref('shape'),options:ref('view')}},
  sideGrain:{op:'raster.math',inputs:{a:ref('wood'),b:ref('grooves'),op:'subtract'}},
  rivets:{op:'draw.render',inputs:{width:U,height:V,commands:rivets,edges:'hard'}},
  ironMap:{op:'raster.blend',inputs:{background:ref('metal'),foreground:link('rivets')}}
};
function union(name,rows){
  const parts={};
  rows.forEach(([y,thickness],i)=>{
    const id=name+'-'+i;
    nodes[id]={op:'sdf.shape',inputs:{kind:'box',options:{center:[0,y,0],half:[1.3,thickness,1.3]}}};
    parts[id]=link(id);
  });
  nodes[name+'Parts']={op:'data.record',inputs:parts};
  nodes[name+'List']={op:'data.collect',inputs:{source:link(name+'Parts'),keys:Object.keys(parts)}};
  nodes[name]={op:'sdf.combine',inputs:{sources:link(name+'List'),options:{operation:'union'}}};
}
union('hoopMask',hoops.map(y=>[y,.101]));
union('capMask',[[-1.024,.031],[1.024,.031]]);
function material(name,texture,ramp,projection,mask,options){
  nodes[name]={op:'proc.fieldMaterial',inputs:{texture,ramp,...(mask&&{mask:link(mask)}),
    options:{projection,filter:'linear',...options}}};
}
material('oak',link('sideGrain'),clay,'cylinder-y',null,{lightGain:.68,lightBias:.11,textureGain:1.10});
material('oakCap',ref('endgrain'),clay,'xz','capMask',{lightGain:.65,lightBias:.13,textureGain:.97});
material('ash',link('sideGrain'),ash,'cylinder-y',null,{lightGain:.68,lightBias:.11,textureGain:1.10});
material('ashCap',ref('endgrain'),ash,'xz','capMask',{lightGain:.65,lightBias:.13,textureGain:.97});
material('iron',link('ironMap'),steel,'cylinder-y','hoopMask',{lightGain:.60,lightBias:.05,textureGain:1.2});
material('copper',link('ironMap'),copper,'cylinder-y','hoopMask',{lightGain:.60,lightBias:.05,textureGain:1.2});
const variants={
  original:['oak','oakCap','iron'],
  woodChanged:['ash','ashCap','iron'],
  metalChanged:['ash','ashCap','copper']
};
for (const [name,slots] of Object.entries(variants)){
  nodes[name+'Names']={op:'data.record',inputs:Object.fromEntries(slots.map(key=>[key,link(key)]))};
  nodes[name+'Slots']={op:'data.collect',inputs:{source:link(name+'Names'),keys:slots}};
  nodes[name]={op:'proc.fieldSpriteShade',inputs:{surface:link('trace','surface'),materials:link(name+'Slots')}};
}
const names=Object.keys(variants);
const studio=graph.create({
  inputs:{shape:'field',view:'record',wood:'raster',grooves:'raster',metal:'raster',endgrain:'raster'},nodes,
  outputs:{...Object.fromEntries(names.flatMap(name=>[[name,link(name)],[name+'Ids',link(name,'materialId')]])),
    position:link('trace','position'),illumination:link('trace','illumination'),coverage:link('trace','coverage')}
});
const background=colorMap(W,H,(x,y)=>{
  const light=smooth(78,14,Math.hypot((x-58)*.95,y-54));
  const block=Math.floor(y/11), brickX=(x+6*(block%2))%17, brickY=y%11;
  const fleck=(noise(x,y)-.5)*.085+((x+y)%2)*.030;
  const p=[0x0c111c,0x111824,0x182230,0x222d3b,0x2c3945,0x3c4c56];
  if (y===17 || y===127) return x>8&&x<120 ? p[3] : p[0];
  if(y<18||y>127)return steps(p,.18+fleck);
  const shade=.21+.29*light+(noise(Math.floor((x+6*(block%2))/17),block,5)-.5)*.18+fleck;
  if(brickX===0||brickY===0) return steps(p,shade*.49);
  if(y>109&&Math.hypot((x-66)*.43,(y-116)*1.12)<10) return steps(p,shade*.51);
  return steps(p,shade+(brickY===1?.07:0));
});
const title=(label,x,y,color)=>({source:drawing2d.text(label,{color}).value,x,y});
const headers=[
  [title('A / SMOKED OAK',8,7,'#e1b5a0'),title('FORGED IRON',8,133,'#9caebb')],
  [title('B / PALE ASH',8,7,'#e6d1ac'),title('FORGED IRON',8,133,'#9caebb')],
  [title('C / PALE ASH',8,7,'#e6d1ac'),title('AGED COPPER',8,133,'#d0a080')]
];
function compose(source,labels){return raster.stack({width:W,height:H,layers:[{source:background},{source},...labels]}).value;}
function pack(images){
  const gap=6,w=W*images.length+gap*(images.length-1),rgb=new Uint8Array(w*H*3).fill(10);
  for(const [j,image] of images.entries())for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const s=(y*W+x)*4,t=(y*w+j*(W+gap)+x)*3;
    rgb[t]=image.data[s];rgb[t+1]=image.data[s+1];rgb[t+2]=image.data[s+2];
  }
  return {w,h:H,rgb};
}
function evaluate(index){
  const angle=index%FRAMES/FRAMES*TAU;
  const spin=angle+.22+.07*Math.sin(angle);
  const view={width:W,height:H,center:[64,72],scale:42,orbit:[spin,.65+.058*Math.cos(angle)],roll:.05+.115*Math.sin(angle),
    safety:.73,light:[Math.sin(spin-.62),.60,Math.cos(spin-.62)],ambient:.21,bands:10,ink:'#423848'};
  return studio.evaluate({shape:barrelShape,view,wood,grooves,metal,endgrain},{time:index/FPS}).outputs;
}
const clips=[];
let still,woodPixels=0,metalPixels=0;
for(let index=0;index<FRAMES;index++){
  const o=evaluate(index), a=o.original.data,b=o.woodChanged.data,c=o.metalChanged.data;
  const ids=o.originalIds.data;
  for(let i=0;i<ids.length;i++){
    const id=ids[i],p=i*4;
    if(id!==o.woodChangedIds.data[i]||id!==o.metalChangedIds.data[i]||a[p+3]!==b[p+3]||b[p+3]!==c[p+3])
      throw Error('A finish edit changed the trace or material masks');
    const wood=a[p]!==b[p]||a[p+1]!==b[p+1]||a[p+2]!==b[p+2];
    const metal=b[p]!==c[p]||b[p+1]!==c[p+1]||b[p+2]!==c[p+2];
    if((wood&&id!==1&&id!==2)||(metal&&id!==3)) throw Error('A finish edit crossed into another material');
    woodPixels+=Number(wood);metalPixels+=Number(metal);
  }
  clips.push(pack(names.map((name,i)=>compose(o[name],headers[i]))));
  if(index===13)still=o;
}
if(!woodPixels||!metalPixels)throw Error('Finish variants do not visibly differ');
const join=evaluate(FRAMES);
if(!Buffer.from(pack(names.map((name,i)=>compose(join[name],headers[i]))).rgb).equals(Buffer.from(clips[0].rgb)))throw Error('Cask Study loop seam differs');
studio.clear();
const diagnostics=[
  ['HIT POSITION',(index)=>{
    const p=still.position.data.subarray(index*3,index*3+3);
    return p.reduce((rgb,n)=>(rgb<<8)|Math.round(clamp(.48+n*.40)*255),0);
  }],
  ['ILLUMINATION',index=>steps([0x1e2537,0x35435a,0x596a82,0x8194a3,0xadbac2,0xe0e2c9],still.illumination.data[index])],
  ['MATERIAL SLOT',index=>[0x423848,0xa85148,0xc08550,0x57949e][still.originalIds.data[index]]]
];
const sheet=pack(diagnostics.map(([label,paint])=>compose(colorMap(W,H,(x,y)=>{
  const index=y*W+x;
  return still.coverage.data[index]?paint(index):0x101722;
}),[title(label,8,7,'#c3bec0')])));
const single=clips[13];
PNG.write(path.join(output,'cask-contact.png'),single.w,single.h,single.rgb);
PNG.write(path.join(output,'cask-passes.png'),sheet.w,sheet.h,sheet.rgb);
PNG.animate(path.join(output,'cask-study.png'),clips,FPS);
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cask Study</title><style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;color:#e9e0d8;background:#0e121b}
main{max-width:1190px;margin:auto;padding:24px 16px 56px}h1{font-size:clamp(32px,6vw,64px);margin:0;letter-spacing:-.05em}
p{max-width:64ch;color:#bbb3b1;margin:0 0 18px}h2{font-size:16px;margin:22px 0 8px}img{width:100%;height:auto;display:block;image-rendering:pixelated;border:1px solid #2c3542}
</style><main><h1>Cask Study</h1><p>Each frame traces the barrel once. The middle version changes the wood, and the right version also changes the hoops.</p>
<img src="cask-study.png" width="${sheet.w*3}" height="${sheet.h*3}" alt="A synchronized turntable of oak and iron, ash and iron, and ash and copper">
<h2>Trace and material passes</h2><img src="cask-passes.png" width="${sheet.w*3}" height="${sheet.h*3}" alt="Hit position, banded illumination, and material slot IDs">
</main></html>`);
console.log(path.join(output,'index.html'));
