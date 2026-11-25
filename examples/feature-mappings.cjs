'use strict';

const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const Pixel=require('../cli/pixel-art.js');
const R=require('../cli/render.js');
const Art=require('../src/art-passes.js');
const Bindings=require('../src/pixel-source-bindings.js');
const View=require('../src/pixel-view-source.js');
const Files=require('../cli/asset-files.js');
const PNG=require('../cli/png.js');
const {KIT:K,makeBuilder,makeSculpt}=ink.load();
const grid=[152,106], object='ferry-coupler', part='indicator';
const center={
  original:[-.30,.30,.19], rebuilt:[.34,.35,.19], sdf:[.13,.30,.19],
  splats:[-.03,.26,.19], curve:[.19,.30,.19], card:[.25,.29,.19]
};
const background=[0x101a21,0x40666a,0xb48752,0x6c422d,0x352c2b];
const camera={target:[0,0,0],dist:4.2,yaw:0,pitch:0,ortho:true,sway:0};

function housing() {
  const width=86,height=48, pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const corner=(x<4||x>81)&&(y<4||y>43);
    const rim=x<6||x>79||y<5||y>42;
    const bolt=[[8,7],[77,7],[8,40],[77,40]].some(([a,b])=>Math.hypot(x-a,y-b)<1.75);
    const slot=y>26&&y<38&&x>17&&x<68;
    const grille=slot&&x%6<2;
    const rail=y===22||y===23||y===39;
    const noise=Math.round(5*Math.sin(x*.79+y*.5)+3*Math.cos(x*1.4-y*1.6));
    const c=corner?[25,34,37,0]:bolt?[227,180,105,255]:rim?[132+noise,83+noise,48+noise,255]:
      grille?[124,97,69,255]:slot?[24+noise,56+noise,62+noise,255]:
        rail?[103,132,117,255]:[45+noise,89+noise+Math.round((48-y)*.2),90+noise,255];
    pixels.set(c,(y*width+x)*4);
  }
  return K.sceneMeshes.create({id:'coupler-housing',objectId:'housing',positions:[-1.78,-.85,0,1.78,-.85,0,1.78,.85,0,-1.78,.85,0],
    uvs:[0,1,1,1,1,0,0,0],indices:[0,1,2,0,2,3],materials:[{id:'weathered-enamel',texture:{width,height,pixels},alphaMode:'mask'}]});
}

function plate(center,id,revised=false) {
  const [x,y,z]=center, shape=[[-.49,-.11],[.49,-.11],[.49,.11],[-.49,.11]];
  const vertices=shape.map(([a,b],i)=>({id:'point-'+i,position:[x+a,y+b,z]}));
  if(revised) vertices.push({id:'new-center',position:[x,y+.018,z]});
  const tiles=revised ? [[0,1,4],[1,2,4],[2,3,4],[3,0,4]] : [[0,1,2,3]];
  const faces=tiles.map((row,i)=>({id:(revised?'rebuilt-face-':'feature-face-')+i,material:'aged-brass',
    corners:row.map((v,j)=>({id:'corner-'+i+'-'+j,vertex:vertices[v].id,uv:v===4?[.5,.42]:[[0,1],[1,1],[1,0],[0,0]][v]}))}));
  const doc=K.meshTopology.create({id,vertices,faces});
  return K.meshTopology.toSceneMesh(doc,{objectId:object,partId:part,
    materials:[{id:'aged-brass',color:revised?0xcb9156:0xc79751}]});
}

function worldFor(kind, withHousing=true) {
  const B=makeBuilder(19,background), c=center[kind], meshes=withHousing?[housing()]:[];
  const shared={id:'feature-'+kind,cam:camera,radius:4,look:{pixelSize:1,splatCoverage:'continuous'},dither:0,
    outline:{c:0,edge:0},fog:{c:0,start:1,max:0}};
  const target={part};
  if (kind==='original'||kind==='rebuilt'||kind==='card') {
    const mesh=plate(c,kind==='original'?'indicator-original':'indicator-rebuilt',kind!=='original');
    if (kind==='rebuilt') meshes.push(plate(center.original,'nearby-unrelated-plate'));
    if (kind!=='card') return B.finish({...shared,meshes:[...meshes,mesh]});
    const {spriteAtlas}=require('../cli/sprite-atlas.js');
    const source=makeBuilder(19,background).finish({...shared,meshes:[mesh]});
    const atlas=spriteAtlas(source,{pivot:c,width:62,height:32,directions:1,yaw:0,pitches:[0],
      maps:['depth','normal'],view:{dist:3.2,ortho:true,raw:true}});
    return B.finish({...shared,meshes,spriteAtlases:[K.sprite.placeAtlas({atlas,at:c,objectId:object,partId:part,
      budgetId:'rebaked-indicator',mode:'card',lighting:false,depth:true})]});
  }
  if (kind==='curve') {
    const points=[[-.44,0,0],[0,0,0],[.44,0,0]].map(p=>K.V.add(p,c));
    K.curveSplats.draw(B,{kind:'path',id:'pilot-route',points},{object,target,material:'braided-copper',
      color:'#d09a56',width:.20,edge:'hard',caps:'blunt'});
    return B.finish({...shared,meshes});
  }
  if (kind==='sdf') {
    const saved=globalThis.INK_RETAIN_RENDER_SDF;
    globalThis.INK_RETAIN_RENDER_SDF=true;
    try {
      const S=K.sculpt(makeSculpt(B));
      S.box([c[0],c[1],c[2]-.055],[.49,.11,.055],{r:[2]},{res:.035,objectId:object,target});
      S.bake();
      return B.finish({...shared,meshes,look:{...shared.look,sdfAssist:true}});
    } finally {globalThis.INK_RETAIN_RENDER_SDF=saved;}
  }
  const members=[];
  for(let i=0;i<13;i++){
    B.disc(c[0]+(i-6)*.069,c[1],c[2],[0,0,1],.104,.014,B.P[2],3);
    members.push('indicator-splat-'+i);
  }
  B.describeSplats(0,B.count(),{object,target,material:'satin-copper'});
  const result=B.finish({...shared,meshes,look:{...shared.look,splatFit:{
    format:'ink-studio/splat-fit',version:2,scene:shared.id,target:{object,part},edits:[],groups:[
      {id:'indicator-patch',pivot:c,members,modifiers:[{type:'taper',axis:[1,0,0],length:1,amount:0}]}
    ]}}});
  result.splatIds=members;
  return result;
}

const translation=(x,y,z)=>[1,0,0,x,0,1,0,y,0,0,1,z];
const region=(c)=>({min:[c[0]-.52,c[1]-.14,c[2]-.12],max:[c[0]+.52,c[1]+.14,c[2]+.12]});
const feature='pilot-strip';
function site(id,kind,match) {
  const c=center[id], origin=kind==='sprite' ? [0,0,0] : c;
  return {id,kind,match,toFeature:translation(...origin.map(n=>-n)),region:region(origin),worldFrame:translation(...c)};
}
const featureMapping={format:'ink-studio/feature-mapping',version:1,id:'ferry-feature-register',object,part,features:[
  {id:feature,tolerance:.095,sites:[
    site('original','mesh',{asset:'indicator-original',faces:['feature-face-0']}),
    site('rebuilt','mesh',{asset:'indicator-rebuilt',faces:[0,1,2,3].map(i=>'rebuilt-face-'+i)}),
    site('sdf','sdf',{field:object}),
    site('splats','splat',{group:'indicator-patch'}),
    {id:'curve',kind:'curve',match:{strand:'pilot-route',range:[0,1]},station:[[-.44,0,0],[.44,0,0]],
      worldFrame:translation(...center.curve)},
    site('card','sprite',{asset:'rebaked-indicator'})
  ]}
]};

function capture(world,id,index) {
  const [w,h]=grid, target={object,part}, passes=[...View.channels,...Art.sourceBindings,'strandId','strandU','strandDepth','strandCoverage'];
  function frame(isolated) {
    let sourceView;
    const projection=R.cameraCapture(null,(p,sample)=>{
      sourceView={id,source:world.id,grid,origin:'top-left',frame:{index,...sample.frame},camera:{
        ...sample.camera,matrix:Array.from(p.view),eye:p.eye,near:p.clipNear,far:p.clipFar,fov:sample.fov,focal:sample.focal}};
    });
    const result=ink.render(world,{...projection,w,h,px:1,t:0,raw:true,pixelSelection:{...target,...(isolated&&{isolated:true})},
      trackPixelSources:isolated,passes,renderGrid:false,cameraGuides:false,transparent:true});
    return {...result,sourceView};
  }
  return {full:frame(false),isolated:frame(true)};
}

const graph={nodes:{
  plate:{sockets:{probe:{position:K.V.add(center.original,[.23,.14,.02])}}},
  probe:{parent:{node:'plate',socket:'probe'},transform:{position:[0,.11,0]}}
}};
const decals={format:K.surfaceDecals.format,version:1,decals:[{
  id:'painted-tick',kind:'lettering',anchor:{object,part,at:K.V.add(center.original,[-.26,.024,.017]),
    size:[.16,.089],normal:[0,0,1],depth:.08},grid:[8,5],
  image:{width:5,height:3,pixels:['..#..','.#.#.','##.##'].flatMap(row=>[...row].flatMap(mark=>
    mark==='#'?[26,53,59,255]:[0,0,0,0]))}
}]};

function composite(full,design,frame) {
  const painted=Pixel.compile(design,frame,undefined,true), {rgb}=Pixel.image(painted);
  const pic=full.rgb.slice();
  for(let p=0;p<full.w*full.h;p++){
    const w=painted.slots[p]<0 ? 0 : (painted.opacity?.[p]??255)/255;
    if (w) for(let c=0;c<3;c++) pic[p*3+c]=Math.round(pic[p*3+c]*(1-w)+rgb[p*3+c]*w);
  }
  return pic;
}

function buildDemo(directory){
  fs.mkdirSync(directory,{recursive:true});
  const kinds=Object.keys(center), photos=Object.fromEntries(kinds.map((kind,index)=>[kind,capture(worldFor(kind),kind,index)]));
  const reference=photos.original.full;
  const choose=x=>{
    let best, distance=Infinity;
    for(let y=0;y<reference.h;y++) for(let u=0;u<reference.w;u++){
      const geometry=Bindings.sample(reference,[u,y],Art)?.geometry;
      if(geometry?.asset!=='indicator-original'||!geometry.rest) continue;
      const d=K.V.dist(geometry.rest,K.V.add(center.original,[x,0,0]));
      if(d<distance){best=[u,y];distance=d;}
    }
    if(!best)throw Error('Source feature did not render');
    return best;
  };
  const paint=[choose(-.16),choose(-.04),choose(.09)], accent=choose(.25);
  let design={format:'ink-studio/pixel-art',version:2,width:grid[0],height:grid[1],pixelAspect:[1,1],
    palette:{'electric-mint':'#a3ffe3','laser-glint':'#effff7'},layers:[{id:'approval'}],
    frames:kinds.map(kind=>({id:kind,durationMs:100,cels:kind==='original'?{approval:{
      marks:[...paint.map(at=>({swatch:'electric-mint',at})),{swatch:'laser-glint',at:accent}]
    }}:{}})),
    sceneBindings:[{id:'original-pilot',scene:'feature-original',object,part,frame:'original',featureMapping}],
    protectedDetails:[{id:'pilot-glint',frame:'original',kind:'accent',pixels:[accent]}]};
  const save=(name,data)=>Files.json(path.join(directory,name+'.json'),data);
  save('source-document',design);save('source-hierarchy',graph);save('source-decals',decals);
  const reports=[], attachments={original:{graph,decals}};
  for (const kind of kinds.slice(1)){
    const views={version:1,samples:[{id:'reference',time:0},{id:kind,time:0}]};
    const plan={format:'ink-studio/feature-rebind',version:1,id:'handoff-'+kind,binding:'original-pilot',
      bindReplacement:'pilot-'+kind,feature,from:'original',to:kind,sourceFrame:'original',replacementFrame:kind,
      views,paint:{layer:'approval',pixels:[...paint,accent]},details:[{from:'pilot-glint',id:'glint-'+kind}],
      sockets:[{node:'plate',socket:'probe'}],decals:['painted-tick']};
    save('plan-'+kind,plan);
    const result=ink.rebindPixelFeature(design,plan,{render:(_row,index)=>photos[index?kind:'original'],
      graph,decals,replacementScene:'feature-'+kind});
    save('review-'+kind,result.report);
    if(!result.document) throw Error('Mapping failed for '+kind+' '+JSON.stringify(result.report.problems));
    design=result.document;
    save('hierarchy-'+kind,result.graph);save('decals-'+kind,result.decals);
    reports.push(result.report);
    attachments[kind]=result;
  }
  save('rebound-document',design);
  for(const kind of kinds){
    const world=worldFor(kind), assets=attachments[kind];
    const probe=K.sceneGraph.create(assets.graph).frame('probe').position;
    const circle=Array.from({length:16},(_,i)=>{
      const a=i*Math.PI/8;
      return [probe[0]+.044*Math.cos(a),probe[1]+.044*Math.sin(a),probe[2]+.02];
    });
    world.meshes=[...world.meshes,K.sceneMeshes.create({id:'sensor-tip',positions:[probe,...circle].flat(),
      uvs:new Float32Array(34),indices:circle.flatMap((_,i)=>[0,i+1,(i+1)%16+1]),
      materials:[{id:'probe-pigment',color:0xe6db92}]})];
    if (kind==='original'||kind==='rebuilt') {
      const mesh=world.meshes.find(mesh=>mesh.id==='indicator-'+kind);
      world.surfaceDecals=K.surfaceDecals.bind(world,assets.decals,{receivers:[{object,part,representation:'mesh',mesh}]});
    }
    const full=ink.render(world,{w:grid[0],h:grid[1],px:1,raw:true,t:0});
    PNG.write(path.join(directory,kind+'.png'),...grid,composite(full,design,kind));
  }
  save('review-summary',reports.map(report=>({to:report.to,paint:report.rows.filter(row=>row.kind==='paint').length,
    detail:report.rows.find(row=>row.kind==='protection').at,socket:report.sockets[0].after.position,
    representation:report.rows[0].mapping.to,sceneDecal:report.decals[0].after.at})));
}
module.exports={worldFor,capture,featureMapping,center,buildDemo};
if (require.main===module) buildDemo(path.resolve(process.argv[2]??'studio/out/feature-mappings'));
