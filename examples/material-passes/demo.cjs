const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const { housing, obj, bronze } = require('../linked-material-preview/panels.cjs');
const { KIT }=Ink.load(), P=KIT.procedural;

const directory=path.resolve(process.argv[2]??'studio/out/material-passes');
const at=name=>path.join(directory,name);
const width=320,height=208,count=width*height;
const fired=new Uint8Array(count*3), coastal=new Uint8Array(count*3), emission=new Uint8Array(count*3);
const elevation=new Float32Array(count), ambient=new Float32Array(count);
const glaze=new Uint8Array(count), dull=new Uint8Array(count), metal=new Uint8Array(count), opacity=new Uint8Array(count);
const bound=n=>Math.min(1,Math.max(0,n));
const mix=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*bound(t)));
const scale=(rgb,f)=>rgb.map(n=>Math.min(255,Math.max(0,Math.round(n*f))));
const near=(n,target,limit)=>Math.abs(n-target)<limit;
const ridge=(u,p)=>p+Math.sin(u*17+.28)*.025+Math.sin((u+.02)*37)*.014;
const styles=[
  { top:[24,37,66], bottom:[64,110,132], shadows:[25,50,73], sea:[48,111,139], line:[102,169,175],
    rim:[33,59,78], sun:[249,166,95], gold:[246,205,135], dark:[127,73,58] },
  { top:[38,29,53], bottom:[129,66,60], shadows:[63,38,62], sea:[52,93,86], line:[131,145,108],
    rim:[59,38,53], sun:[238,155,88], gold:[205,233,161], dark:[125,76,68] }
];
const stars=[[.17,.24],[.23,.46],[.33,.26],[.45,.17],[.51,.32],[.57,.22],[.81,.27],[.87,.39],[.43,.40],[.29,.36]];

for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
  const u=(x+.5)/width,v=(y+.5)/height, edge=Math.min(u,1-u,v*.65,(1-v)*.65);
  const grain=Math.sin(x*1.13+y*1.31)*Math.cos(y*1.64-x*.62);
  const sun=Math.hypot((u-.685)*1.19,(v-.38)*.83);
  const outer=edge<.05, keyline=near(edge,.032,.0022)||near(edge,.045,.0014);
  const rivets=Math.hypot((Math.min(u,1-u)-.023)*1.5,Math.min(v,1-v)-.035)<.012;
  const upper=v>.52+.13*(1-u) && v<ridge(u,.63);
  const middle=v>ridge(u+.17,.68) && v<ridge(u+.17,.73);
  const water=v>ridge(u,.68);
  const cross=u-.373-(v-.55)*.075;
  const tower=v>.415 && v<.733 && Math.abs(cross)<.011+(v-.45)*.04;
  const lamp=v>.394 && v<.437 && Math.abs(u-.361)<.019;
  const roof=v>=.367 && v<.402 && Math.abs(u-.361)<.002+(v-.367)*.73;
  const lampLit=lamp && v>.400 && v<.423 && Math.abs(u-.361)<.011;
  const footing=v>.706 && v<.734 && Math.abs(u-.382)<.049;
  const star=stars.some(([a,b],i)=>Math.abs(u-a)*1.55+Math.abs(v-b)<(i%3?.006:.011));
  const cloud=near(v,.407+(u-.68)*.087,.0065) || near(v,.457+(u-.68)*.11,.0039);
  const waterline=water && [0,1,2,3,4,5,6,7].some(i=>
    near(v,.706+i*.023 + Math.sin(u*14+i*.8)*.022+Math.cos(u*24+i*.38)*.006,.0029));
  const sunstripe=sun<.139 && cloud;
  const rays=sun<.132 && !sunstripe;
  const inlay=keyline||tower||lamp||roof||footing||star||near(sun,.143,.0017);
  for(const [i,palette] of styles.entries()) {
    let color=mix(palette.top,palette.bottom,v*.98+.06*Math.sin(u*14-v*9));
    if(rays) color=mix(palette.sun,palette.gold,(.56-v)*.95);
    if(upper||middle) color=mix(palette.shadows,palette.bottom,upper?.27:.09);
    if(water) color=mix(palette.shadows,palette.sea,(v-.52)*1.5);
    if(waterline) color=mix(color,palette.line,.62);
    if(outer) color=palette.rim;
    if(inlay) color=rays&&!keyline?palette.dark:mix(palette.dark,palette.gold,tower?.74:1);
    if(tower && (v%.082<.012 || (v>.489 && v<.54 && Math.abs(cross)<.003))) color=palette.dark;
    if(lampLit) color=[255,233,160];
    (i===0?fired:coastal).set(scale(color,1+grain*.032),p*3);
  }
  emission.set(lampLit?[255,179,81]:star?[72,37,13]:[0,0,0],p*3);
  elevation[p]=(inlay?.17:rays?.042:waterline?-.034:0)+grain*.0031;
  ambient[p]=rivets?.32:waterline?.57:near(edge,.047,.004)?.68:inlay?.94:.88+grain*.012;
  glaze[p]=Math.round(255*bound((inlay?.3:rays?.24:.41)+grain*.019));
  dull[p]=Math.round(255*bound((inlay?.56:rays?.68:.76)+grain*.028));
  metal[p]=inlay?176:12;
  opacity[p]=rivets?0:255;
}

const assets={},nodes={}, ref=node=>({ node,port:'value' });
function bitmap(id,data,interpretation,w=width,h=height) {
  const encoding=interpretation.intent==='height'||data instanceof Float32Array?'exr':'png';
  const channels=data.length/(w*h);
  const bytes=encoding==='png'?(channels===1?PNG.encodeGray(w,h,data):PNG.encode(w,h,data,channels)):
    Ink.encodeTexture(P.graphImages.declare({width:w,height:h,channels,data},interpretation),{encoding,bitDepth:32});
  assets[id]={format:'bitmap',interpretation,source:{encoding,base64:bytes.toString('base64')}};
  nodes[id]={op:'bitmapAsset',inputs:{name:id}};
}
for(const [id,data] of Object.entries({fired,coastal,emission})) bitmap(id,data,{intent:'color'});
for(const [id,data] of Object.entries({glaze,dull,ambient,metal,opacity})) bitmap(id,data,{intent:'mask'});
bitmap('relief',elevation,{intent:'height',units:'mm'});
const brass=bronze();
bitmap('case-pigment',brass.pigment,{intent:'color'},brass.size,brass.size);
bitmap('case-finish',brass.roughness,{intent:'mask'},brass.size,brass.size);
for(const [id,background,foreground] of [['pigment','fired','coastal'],['finish','glaze','dull']])
  nodes[id]={op:'image.blend',inputs:{background:ref(background),foreground:ref(foreground),opacity:{input:'weathering'}}};
nodes.normal={op:'image.heightToNormal',inputs:{source:ref('relief'),options:{spacing:[.24,.24],strength:.71,method:'sobel'}}};
nodes.layers={op:'data.record',inputs:{baseColor:ref('pigment'),normal:ref('normal'),roughness:ref('finish'),
  height:ref('relief'),ao:ref('ambient'),opacity:ref('opacity'),emission:ref('emission'),metalness:ref('metal')}};
nodes.enamel={op:'material.pack',inputs:{maps:ref('layers')}};
const graph={format:'ink-studio/graph-project',version:1,assets,nodes,inputs:{weathering:{type:'unitScalar',default:0}},
  outputs:{enamel:ref('enamel'),'case-pigment':ref('case-pigment'),'case-finish':ref('case-finish')}};
const material=Ink.openMaterialGraph(graph,{id:'vesper-relay'});
material.label='Vesper Relay';
const saved=Ink.writeMaterialGraph(at('vesper-relay.material.json'),material);
files.write(at('vesper-housing.obj'),obj(housing({tiled:false})));
const plan={format:'ink-studio/linked-material-preview',version:1,label:'Vesper Relay',
  targets:[{id:'relay',kind:'mesh',label:'Relay housing',file:'vesper-housing.obj'},
    {id:'plane',kind:'plane',label:'Flat material sample',slot:'Enamel'}],
  slots:{Enamel:{output:'enamel'},Bronze:{maps:{baseColor:{output:'case-pigment'},roughness:{output:'case-finish'}}}},
  variants:[{id:'weathered',label:'Weathered glaze',inputs:{weathering:1}}],
  view:{width:512,height:372,steps:8,textureSize:320}};
files.json(at('preview.plan.json'),plan);
Ink.writeLinkedMaterialPreview(Ink.createGraphProject(saved),at('preview.plan.json'),{directory})
  .then(({file})=>console.log(file)).catch(error=>{console.error(error);process.exitCode=1;});
