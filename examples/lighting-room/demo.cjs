const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'studio/out/lighting-room');
const panorama = process.argv[3] && path.resolve(process.argv[3]);
const at = name => path.join(directory,name);
const width = 512, height = 256, size = width*height;
const pigment = new Uint8Array(size*4), finish = new Uint8Array(size), metal = new Uint8Array(size);
const relief = new Float32Array(size);
const tau = Math.PI*2;
const clamp = x => Math.max(0,Math.min(1,x));
const mix = (a,b,t) => a.map((value,i)=>Math.round(value+(b[i]-value)*clamp(t)));
const near = (n,center,radius) => Math.abs(n-center)<radius;
const brass = [195,124,61], gold = [255,215,131], cobalt = [25,65,112], aqua = [87,157,164];
for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
  const u=(x+.5)/width,v=(y+.5)/height;
  const centered=(u+.30)%.5-.25;
  const a=centered*2,b=v-.48,r=Math.hypot(a,b),angle=Math.atan2(b,a);
  const grain=Math.sin(x*.82+y*1.21)*Math.cos(y*1.67-x*.49);
  const pigmentFlow=.5+.20*Math.sin(u*tau*8+v*16)+.14*Math.sin(u*tau*13-v*37);
  let color=mix(cobalt,aqua,pigmentFlow*.7), rough=.24, heightValue=grain*.0008, metallic=0;
  function inlay(pigment, h=.012) {
    color=pigment;rough=.29;metallic=.58;heightValue+=h;
  }
  const band=Math.min(Math.abs(v-.25),Math.abs(v-.75));
  if(band<.044) {
    color=mix([26,44,75],[39,78,99],pigmentFlow);
    rough=.48;
    if(near(band,.014,.0032)||near(band,.039,.002))inlay(mix(brass,gold,pigmentFlow+.23));
    if(band<.012 && Math.abs(Math.sin(u*tau*24))<.38)inlay(gold,.017);
  }
  const frame=Math.hypot(a,b*1.15);
  if(frame<.165 && band>=.044) {
    color=mix([19,52,93],[28,85,113],pigmentFlow);
    rough=.37;
    if(near(frame,.159,.0028)||near(frame,.141,.0024))inlay(mix(brass,gold,pigmentFlow+.23));
    const spoke=Math.abs(Math.sin(angle*2)), ray=.106*Math.exp(-spoke*5);
    if(r<.019+ray)inlay(mix([183,101,47],gold,Math.sin(angle*4)>.0?.95:.53),.022);
    if(r<.024) { color=[208,241,216];metallic=.08;rough=.18;heightValue+=.025; }
    if(near(r,.083,.0016))inlay(brass);
    if(r>.090 && r<.116 && Math.abs(Math.cos(angle*8))>.97)inlay(gold);
  } else if(band>=.044 && v>.18 && v<.82) {
    const cellX=((u*12+.5)%1)-.5, cellY=((v*9+.5)%1)-.5;
    if(Math.abs(cellX)+Math.abs(cellY)<.11)inlay(mix(brass,gold,pigmentFlow));
    else if(near(Math.abs(cellX)+Math.abs(cellY),.35,.015))color=mix(color,aqua,.24);
  }
  if(v<.13 || v>.87)color=mix(color,[23,36,56],.53);
  pigment.set([...color,255],p*4);
  finish[p]=Math.round(255*clamp(rough+grain*.023));
  metal[p]=Math.round(255*metallic);
  relief[p]=heightValue;
}
const P=Ink.load().KIT.procedural;
const elevation=P.graphImages.declare({width,height,channels:1,data:relief},{intent:'height',units:'mm'});
const encoded={
  color:{encoding:'png',intent:'color',data:PNG.encode(width,height,pigment,4)},
  roughness:{encoding:'png',intent:'mask',data:PNG.encodeGray(width,height,finish)},
  metalness:{encoding:'png',intent:'mask',data:PNG.encodeGray(width,height,metal)},
  height:{encoding:'exr',intent:'height',data:Ink.encodeTexture(elevation,{encoding:'exr',bitDepth:32})}
};
const assets={},nodes={},ref=node=>({node,port:'value'});
for(const [name,{encoding,intent,data}] of Object.entries(encoded)) {
  assets[name]={format:'bitmap',interpretation:intent==='height'?{intent,units:'mm'}:{intent},
    source:{encoding,base64:data.toString('base64')}};
  nodes[name]={op:'bitmapAsset',inputs:{name}};
}
nodes.normal={op:'image.heightToNormal',inputs:{source:ref('height'),options:{spacing:[.042,.046],strength:.84,method:'sobel'}}};
nodes.maps={op:'data.record',inputs:{baseColor:ref('color'),roughness:ref('roughness'),metalness:ref('metalness'),normal:ref('normal')}};
nodes.enamel={op:'material.pack',inputs:{maps:ref('maps')}};
const graph={format:'ink-studio/graph-project',version:1,assets,nodes,outputs:{enamel:ref('enamel')}};
const material=Ink.openMaterialGraph(graph,{id:'lightwell-enamel'});
material.label='Lightwell enamel';
const saved=Ink.writeMaterialGraph(at('lightwell.material.json'),material);
const rig=(id,label,environment,camera)=>({format:'ink-studio/lighting-room-rig',version:1,id,label,environment,camera});
const rigs=[
  rig('cabinet','Enamel cabinet',{source:'neutral-softbox',rotation:-26,exposureEV:.65},
    {yaw:-16,pitch:10,distance:3.78,focalLength:35}),
  rig('bench','Orthographic bench',{source:'neutral-raking',rotation:118,exposureEV:.62},
    {yaw:-24,pitch:15,distance:3.7,focalLength:36,projection:'orthographic'})
];
if(panorama) {
  const file=path.basename(panorama);
  if(panorama!==at(file))fs.copyFileSync(panorama,at(file));
  rigs.push(rig('photo-studio','Photo studio',{file,name:'Studio Small 09',rotation:43,background:true,exposureEV:0},
    {yaw:-16,pitch:10,distance:3.9,focalLength:34,exposureEV:.2}));
}
const plan={format:'ink-studio/lighting-room',version:1,label:'Lightwell',source:{output:'enamel'},
  view:{width:840,height:660,textureSize:512},rigs,selected:'cabinet'};
files.json(at('room.plan.json'),plan);
Ink.writeLightingRoom(Ink.createGraphProject(saved),at('room.plan.json'),{directory})
  .then(({file})=>console.log(file)).catch(error=>{console.error(error);process.exitCode=1;});
