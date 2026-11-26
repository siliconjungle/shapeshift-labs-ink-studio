const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const { readTexture } = require('../../cli/texture-files.js');
const PNG = require('../../cli/texture-png.js');
const EXR = require('../../cli/texture-exr.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/mothlight-screen');
const at = name => path.join(out,name);
const size = 320, extent = 420;
const clamp = n => Math.max(0,Math.min(1,n));
const mix = (a,b,t) => a+(b-a)*t;
const palette = {
  ink:[12,27,47], indigo:[37,53,87], peacock:[29,105,121], glaze:[71,169,166],
  linen:[245,218,154], brass:[208,147,79], ember:[184,78,80], plum:[97,43,74]
};

function segment(x,y,[ax,ay],[bx,by]) {
  const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy));
  return Math.hypot(x-ax-dx*t,y-ay-dy*t);
}
function polygon(x,y,points) {
  let inside=false,edge=Infinity;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[j],b=points[i];
    edge=Math.min(edge,segment(x,y,a,b));
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside?-edge:edge;
}
function pathDistance(x,y,points) {
  return Math.min(...points.slice(1).map((point,i)=>segment(x,y,points[i],point)));
}
function ellipse(x,y,cx,cy,rx,ry,rotation=0) {
  const dx=x-cx,dy=y-cy,c=Math.cos(rotation),s=Math.sin(rotation);
  return (Math.hypot((dx*c+dy*s)/rx,(-dx*s+dy*c)/ry)-1)*Math.min(rx,ry);
}

const fore=[[.028,-.06],[.101,.13],[.176,.32],[.23,.455],[.319,.55],[.435,.647],[.613,.73],[.77,.765],
  [.885,.733],[.869,.635],[.85,.53],[.79,.413],[.697,.338],[.722,.293],[.64,.227],[.56,.199],[.574,.149],
  [.489,.088],[.429,.08],[.34,-.005],[.267,-.03],[.197,-.105],[.089,-.123]];
const hind=[[.031,-.126],[.124,-.071],[.247,-.037],[.359,.024],[.503,.082],[.616,.061],[.674,.014],[.626,-.077],
  [.607,-.168],[.541,-.253],[.478,-.28],[.417,-.412],[.437,-.486],[.375,-.597],[.338,-.522],[.318,-.471],
  [.258,-.464],[.182,-.404],[.13,-.36],[.087,-.253]];
const cutouts=[
  [.696,.565,.091,.042,.68],[.53,.447,.076,.037,.53],[.394,.305,.071,.032,.53],[.26,.18,.066,.024,.53],
  [.654,.343,.056,.027,.43],[.485,.233,.058,.025,.43],[.309,.092,.055,.022,.37],
  [.504,-.117,.069,.027,-.54],[.378,-.202,.071,.026,-.7],[.268,-.302,.064,.022,-.75]
];
const antenna=[[.022,.254],[.063,.366],[.103,.452],[.155,.511],[.20,.525],[.244,.504]];
const lines=[
  [[.052,-.08],[.245,.034],[.43,.059],[.588,.118],[.689,.244],[.788,.409]],
  [[.073,-.01],[.19,.155],[.311,.287],[.414,.397],[.64,.555],[.81,.672]],
  [[.08,-.153],[.254,-.199],[.399,-.275],[.436,-.425]]
];

function material(x,y) {
  const u=Math.abs(x), wings=[polygon(u,y,fore),polygon(u,y,hind)], wing=Math.min(...wings);
  const tendril=pathDistance(u,y,antenna)-.0085;
  const core=Math.min(ellipse(u,y,0,-.14,.059,.327),ellipse(u,y,0,.236,.066,.082));
  const terminal=Math.hypot(u-.244,y-.504)-.021;
  const border=Math.min(
    Math.max(Math.abs(u-.888)-.004,Math.abs(y+.037)-.733),
    Math.max(Math.abs(u-.911)-.002,Math.abs(y+.037)-.755),
    Math.max(Math.abs(y+.775)-.004,u-.89),
    Math.max(Math.abs(y-.79)-.004,u-.89)
  );
  const stars=Math.min((Math.abs(u-.714)+1.32*Math.abs(y+.524))-.045,
    (Math.abs(u-.594)+1.26*Math.abs(y+.630))-.023,
    (Math.abs(u-.828)+1.2*Math.abs(y+.358))-.019);
  const holes=Math.min(...cutouts.map(params=>ellipse(u,y,...params)));
  const wingsOnly=Math.max(wing,-holes);
  const distance=Math.min(wingsOnly,tendril,core,terminal,border,stars);
  const lower=wings[1]<wings[0], light=.93+.07*(1-x)*.5;
  const arc=Math.hypot(u*.92,(y+.2)*1.04), stripe=arc>.61&&arc<.675;
  let pigment=lower?[palette.plum,palette.ember,palette.brass][arc>.52?2:arc>.35?1:0]:
    [palette.indigo,palette.peacock,palette.glaze,palette.peacock][arc>.86?3:arc>.67?2:arc>.41?1:0];
  if (stripe&&!lower)pigment=palette.indigo;
  const seam=Math.min(...lines.map(points=>pathDistance(u,y,points)));
  if (seam<.005&&u>.085)pigment=lower?palette.linen:palette.ink;
  if (holes>-.003&&holes<.013||wing<.012&&wing>-.012)pigment=palette.brass;
  if (wing<-.013&&wing>-.021)pigment=palette.ink;
  if (Math.min(tendril,core,terminal,border,stars)<wingsOnly) {
    pigment=palette.brass;
    if(core<0&&Math.cos((y+.1)*82)>.70||terminal<0||stars<-.012)pigment=palette.linen;
  }
  const stipple=(Math.sin(x*810+y*419)*Math.cos(y*768-x*321))*.022;
  const zone=clamp(.18+.70*(.54+arc*.33)+stipple);
  return { distance, alpha:clamp(.5-distance/.0085),
    rgb:pigment.map((value,c)=>clamp((value*light*(1+stipple)+zone*[.1,.7,1.1][c])/255)) };
}

function source() {
  const data=new Uint16Array(extent*extent*4), distance=new Float32Array(extent*extent);
  for(let y=0;y<extent;y++)for(let x=0;x<extent;x++) {
    const i=y*extent+x, u=(x+.5)/extent*2-1,v=1-(y+.5)/extent*2;
    const value=material(u,v);
    data.set([...value.rgb,value.alpha].map(n=>Math.round(n*65535)),i*4);
    distance[i]=value.distance;
  }
  fs.writeFileSync(at('acetate.png'),PNG.write({width:extent,height:extent,channels:4,data,alpha:'straight'},{srgb:0}));
  fs.writeFileSync(at('edge-distance.exr'),EXR.write({width:extent,height:extent,planes:{Y:distance}}));
}

function scene() {
  const doc=document(),{gltf}=doc;
  const layouts=[
    [.02,.455,(s,t)=>[mix(.052,.80,t),mix(.432,.104,s)]],
    [.455,.545,(s,t)=>[mix(.852,.947,s),mix(.114,.893,t)]],
    [.545,.98,(s,t)=>[mix(.80,.052,t),mix(.569,.897,s)]]
  ];
  function part([lo,hi,uv1]) {
    const vertices=[[0,0],[1,0],[1,1],[0,1]];
    const uv=vertices.map(([s,t])=>[mix(lo,hi,s),mix(.065,.925,t)]);
    const vector=values=>doc.accessor(Float32Array.from(values.flat()),'VEC2');
    return {
      attributes:{POSITION:doc.accessor(Float32Array.from(uv.flatMap(([u,v])=>[u*2-1,1-v*2,0])),'VEC3',{bounds:true}),
        TEXCOORD_0:vector(uv),TEXCOORD_1:vector(vertices.map(([s,t])=>uv1(s,t)))},
      indices:doc.accessor(Uint16Array.of(0,2,1,0,3,2),'SCALAR')
    };
  }
  gltf.meshes=[{name:'Acetate panels',primitives:layouts.map(part)}];
  gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(at('screen.glb'),doc.finish());
}
function stats(image) {
  const {width,height,channels,bitDepth,data}=image;
  const semi=channels===1&&image.encoding==='png'?[...data].filter(n=>n>0&&n<(bitDepth===16?65535:255)).length:undefined;
  return {width,height,bitDepth,...(semi!==undefined&&{semi})};
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  source();scene();
  const save=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value,null,2)+'\n');
  const linked={textureInput:'acetate',sourceUV:0,sourcePrecision:'unorm16'};
  for(const mode of ['soft','cutout']) {
    const alpha = mode==='cutout' ? {alphaPolicy:'cutout',alphaCutoff:.56} : {};
    save(mode+'.preset.json',{format:'ink-studio/bake-preset',version:1,
      label:mode==='soft'?'Soft acetate edges':'Cutout threshold',defaults:{size,padding:2},maps:[
        {id:'pigment',overrides:{...linked,...alpha,sourceAlpha:'straight',encoding:'exr'}},
        {id:'opacity',overrides:{...linked,...alpha,encoding:'png16'}},
        ...(mode==='soft'?[{id:'texture-transfer',overrides:{textureInput:'distance',sourceUV:0,
          sourcePrecision:'float32',encoding:'exr'}},{id:'coverage'}]:[])
      ]});
  }
  save('screen.bake.json',{format:'ink-studio/bake-job',version:1,label:'Mothlight Screen',source:'screen.glb',
    textureInputs:{acetate:{file:'acetate.png'},distance:{file:'edge-distance.exr'}},
    targets:[{id:'screen',mesh:'Acetate panels',uvSet:1}],preset:'soft.preset.json'});
  const maps={source:{file:'acetate.png',image:'acetate.png',stats:stats(readTexture(at('acetate.png')))}}, reviews={};
  for(const mode of ['soft','cutout']) {
    const result=await runBakeJob(at('screen.bake.json'),{directory:at(mode),presetFile:at(mode+'.preset.json')});
    const base=mode+'/revisions/'+result.revision+'/';
    reviews[mode]=base+'index.html';
    for(const row of result.report.maps) {
      const file=base+row.file,image=base+(row.previewFile??row.file);
      maps[mode+'-'+row.map]={file,image,stats:stats(readTexture(at(file))),transfer:row.textureTransfer};
    }
  }
  if(!maps['soft-opacity'].stats.semi||maps['cutout-opacity'].stats.semi)throw new Error('Expected soft and binary opacity results');
  fs.writeFileSync(at('data.js'),'const demo = '+JSON.stringify({maps,reviews})+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
