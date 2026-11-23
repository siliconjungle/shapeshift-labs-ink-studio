/* Two native-grid texture studies using the stock curve map and raster sampler. */
const fs = require('node:fs');
const path = require('node:path');
const PNG = require('../cli/png.js');
const {KIT:K} = require('..').load();
const {graph,raster,drawing2d} = K.procedural;

const W=180,H=120, tau=2*Math.PI, fps=20, frameCount=80;
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const mix=(a,b,t)=>a+(b-a)*t;
const wrap=u=>u-Math.floor(u);
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const rgb=n=>[n>>>16,n>>>8&255,n&255];
const ramp=(colors,value)=>colors[Math.min(colors.length-1,Math.floor(clamp(value)*colors.length))];
const hash=(i,j)=>{
  let a=Math.imul(i+37,0x7f4a7c15)^Math.imul(j+91,0x51ed270b);
  a=Math.imul(a^(a>>>16),0x45d9f3b);
  return ((a^(a>>>16))>>>0)/4294967296;
};
const output=path.resolve(process.argv[2]??'curve-raster-demo');
fs.mkdirSync(output,{recursive:true});

const bound = graph.create({
  inputs:{path:'path',texture:'raster',options:'record'},
  nodes:{
    map:{op:'warp.curveMap',inputs:{path:{input:'path'},width:W,height:H,options:{input:'options'}}},
    ink:{op:'warp.sample',inputs:{source:{input:'texture'},field:{node:'map'},options:{filter:'nearest'}}}
  },
  outputs:{
    ink:{node:'ink'},...Object.fromEntries(['along','across','tangent','coverage','length'].map(port=>[port,{node:'map',port}]))
  }
});
function evaluate(path,texture,options) {
  return bound.evaluate({path,texture,options}).outputs;
}

function pixels(width,height,paint,channels=4){
  const data=new Uint8Array(width*height*channels);
  for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++,i+=channels){
    const color=paint(x,y);
    if(color!==undefined)data.set([...rgb(color),...(channels===4?[255]:[])],i);
  }
  return {width,height,channels,data};
}
const dark=pixels(W,H,(x,y)=>{
  const fall=smooth(93,18,Math.hypot((x-88)*.68,y-58)),grid=x%15===0&&y%15===0;
  return ramp([0x10131f,0x161e2e,0x1b2837,0x283747,0x3a4a55],.13+.39*fall+(grid?.32:0));
});
const petrol=[0x0a3543,0x135266,0x207c85,0x2eb8ad,0x57dbbe,0xaeefc8,0xe2f8da];
const rose=[0x41213b,0x71334b,0xad4c51,0xdf725d,0xfba477,0xffd297,0xfff1ca];
function ribbonTexture(u){
  return pixels(384,44,(x,y)=>{
    const s=(x+.5)/384,v=(y+.5)/44;
    const colors=s<.47||s>.97?petrol:rose;
    const edge=Math.min(v,1-v), seam=wrap(s*28-u*5);
    if(edge<.045)return 0x0d1927;
    if(v<.12)return ramp(colors,.70+.26*smooth(.83,.95,seam));
    if(v>.92)return colors[1];
    if(v>.76&&v<.81)return colors[4];
    const ribs=smooth(.08,.21,seam)*smooth(.78,.55,seam);
    const beam=wrap(s*4-u*2), reflection=smooth(.81,.93,beam)*smooth(1,.95,beam);
    const shade=.38+.20*ribs+.19*smooth(.66,.19,v)+.23*reflection;
    return ramp(colors,shade);
  });
}
function knot(u){
  const phase=u*tau, points=[],strokeWidth=[],count=132;
  for(let i=0;i<count;i++){
    const a=.72+i/count*tau, dx=67*Math.sin(a),dy=(25+3*Math.cos(phase))*Math.sin(a*2);
    const angle=-.25+.15*Math.sin(phase);
    points.push([90+dx*Math.cos(angle)-dy*Math.sin(angle),
      61+dx*Math.sin(angle)+dy*Math.cos(angle)+3*Math.sin(phase+a*3)]);
    strokeWidth.push(15+2.6*Math.sin(a*2-phase)+2*Math.cos(a));
  }
  return {path:{points,closed:true},strokeWidth};
}
function lit(results){
  const {ink,coverage,tangent,across}=results;
  const shaded=ink.data.slice();
  for(let i=0;i<coverage.data.length;i++){
    if(!coverage.data[i])continue;
    const dx=tangent.data[2*i],dy=tangent.data[2*i+1];
    const back=across.data[i]>=0;
    const grade=Math.abs(dx*.65+dy*.76);
    const light=grade>.77?1:grade>.55?.91:.81;
    for(let c=0;c<3;c++)shaded[i*4+c]*=light*(back?.96:1);
  }
  return raster.stack({width:W,height:H,layers:[{source:dark},{source:{...ink,data:shaded}}]}).value;
}

const flame=[0x39223f,0x743250,0xba4757,0xef6556,0xff914f,0xffb95b,0xffe58b,0xfff6ce];
function ember(u){
  const points=[],strokeWidth=[];
  for(let i=0;i<=88;i++){
    const a=i/88,p=u*tau;
    points.push([13+154*a+8*Math.sin(a*5+p)*a,103-81*a-38*Math.sin(a*Math.PI)+9*Math.sin(a*6+p)*a]);
    strokeWidth.push(a===1?0:2+33*Math.sin(a*Math.PI)**.84*(1+.13*Math.sin(a*8+p)));
  }
  const texture=pixels(384,52,(x,y)=>{
    const s=x/384,v=(y+.5)/52;
    const drift=wrap(s*4-u*3);
    const edge=Math.abs(v-.5)*2;
    const river=.5+.5*Math.sin((s*4-u*3)*tau+Math.sin(s*21)*.9+v*3.3);
    const grain=.5+.5*Math.cos(s*107+v*8-u*tau*7);
    const core=.23+.53*(1-edge)+.18*river+.064*grain;
    const bite=.15*Math.sin(s*69-u*tau*3)+.11*Math.cos(s*29+u*tau);
    if(edge>.84+bite && (drift>.27 || hash(x>>2,y>>2)>.72))return;
    if(edge>.69+bite && hash(x>>1,y>>2)>.65)return;
    return ramp(flame,core);
  });
  const map=evaluate(points,texture,{strokeWidth,feather:1.05});
  const sparks=[];
  for(let j=0;j<33;j++){
    const a=wrap(u*(j%2+1)+hash(j,3));
    const [x,y]=points[Math.floor(20+66*a)];
    const dx=(1-2*hash(j,7))*a*20, dy=-a*(8+hash(j,8)*19);
    if(a<.18||a>.87)continue;
    const color='#'+ramp(flame,.46+.54*hash(j,4)).toString(16).padStart(6,'0');
    sparks.push({type:'rect',rect:[Math.floor(x+dx),Math.floor(y+dy),j%9===0?2:1,1],fill:color});
  }
  const flecks=drawing2d.render({width:W,height:H,commands:sparks,edges:'hard'});
  return raster.stack({width:W,height:H,layers:[{source:lit(map)},{source:flecks}]}).value;
}

function pack(panes,columns=Math.min(panes.length,2)){
  const gap=6,width=columns*(W+gap)+gap,height=Math.ceil(panes.length/columns)*(H+gap)+gap;
  const rgb=new Uint8Array(width*height*3);
  for(let i=0;i<rgb.length;i+=3)rgb.set([10,14,23],i);
  for(const [i,pane] of panes.entries()){
    const x0=gap+i%columns*(W+gap),y0=gap+Math.floor(i/columns)*(H+gap);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const from=(y*W+x)*4,to=((y+y0)*width+x+x0)*3;
      for(let c=0;c<3;c++)rgb[to+c]=pane.data[from+c];
    }
  }
  return {w:width,h:height,rgb};
}
function diagnostics(map){
  const paint=[
    (i)=>ramp([0x313474,0x475ba0,0x568da9,0x79c5af,0xdaebbd],map.along.data[i]/map.length),
    (i)=>ramp([0xa14b78,0xe87988,0xf8bc9a,0xe4e4be,0x8bc9d0,0x5376a4,0x374981],.5+map.across.data[i]/20),
    (i)=>ramp([0x5abcb7,0x73a2d0,0x8267bc,0xce76a6,0xea8067,0xf4bf73,0xa2cb91],wrap(Math.atan2(map.tangent.data[2*i+1],map.tangent.data[2*i])/tau)),
    (i)=>ramp([0x223346,0x405367,0x789099,0xdde9db],map.coverage.data[i])
  ];
  return pack(paint.map(f=>pixels(W,H,(x,y)=>{const i=y*W+x;return map.coverage.data[i]?f(i):0x141b2a;})),2);
}
const crossings=[],strokes=[];
for(let i=0;i<frameCount;i++){
  const u=i/frameCount,{path:guide,strokeWidth}=knot(u),texture=ribbonTexture(u);
  const first=evaluate(guide,texture,{strokeWidth,overlap:'first',feather:.8});
  const last=evaluate(guide,texture,{strokeWidth,overlap:'last',feather:.8});
  crossings.push(pack([lit(first),lit(last)]));
  strokes.push(pack([ember(u)]));
  if(i===25){
    const plate=diagnostics(last);
    PNG.write(path.join(output,'coordinates.png'),plate.w,plate.h,plate.rgb);
    const still=crossings.at(-1);
    PNG.write(path.join(output,'crossing-still.png'),still.w,still.h,still.rgb);
  }
}
PNG.animate(path.join(output,'crossing.png'),crossings,fps);
PNG.animate(path.join(output,'ember.png'),strokes,fps);
bound.clear();

fs.writeFileSync(path.join(output,'index.html'),`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curve-to-raster studies</title>
<style>
:root{color-scheme:dark;background:#111721;color:#eaf2ee;font:15px/1.5 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0}main{max-width:1050px;margin:auto;padding:26px 16px 52px}
h1{font-size:clamp(25px,5vw,48px);letter-spacing:-.045em;margin:0 0 17px}
section{background:#1a2330;border:1px solid #334459;border-radius:8px;overflow:hidden;padding:10px}
h2{font-size:17px;margin:0 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;text-align:center}
.pair span{color:#b6ded3;padding:5px;font-size:13px}.lower{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
img{display:block;max-width:100%;height:auto;image-rendering:pixelated;margin:auto}
@media(max-width:650px){.lower{grid-template-columns:1fr}}
</style><body><main>
<h1>Curve-to-raster studies</h1>
<section><h2>Switchback</h2><div class="pair"><span>Earlier span in front</span><span>Later span in front</span></div>
<img src="crossing.png" width="756" height="264" alt="The same animated ribbon with opposite crossing rules"></section>
<div class="lower"><section><h2>Ember stroke</h2><img src="ember.png" width="384" height="264" alt="Hot pigment traveling along a bent and tapered stroke"></section>
<section><h2>Coordinate outputs</h2><div class="pair"><span>Distance along</span><span>Signed distance across</span></div>
<img src="coordinates.png" width="378" height="258" alt="Along and across coordinates above tangent direction and coverage">
<div class="pair"><span>Tangent direction</span><span>Coverage</span></div></section></div>
</main></body></html>`);
console.log(path.join(output,'index.html'));
