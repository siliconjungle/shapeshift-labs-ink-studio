/* Aster survey pod. The case changes representation while one projector stack stays attached. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const {screenDrawing}=require('../src/frame-composite.js');

function study({KIT:K,makeBuilder,makeSculpt}) {
  const object='aster-07', part='case', target={object,part}, seed=107;
  const palette=[0x132334,0x273c4c,0x435a61,0x637675,0x92a398,
    0x173c4a,0x235560,0x36717b,0x52938e,0x7faea2,
    0x57534a,0x7e6550,0xba8555,0xe6ac6f,0xf3cf92,0xece3bb];
  const ramps=[[5,6,7,8,9],[1,2,3,4],[10,11,12,13,14]];
  const group=(x,y,z)=>z>.27&&y<-.32 ? 1 : z>.25&&x<-.98 ? 2 :
    Math.abs(z)<.41&&y>.58&&Math.abs(x)>.7 ? 1 : 0;
  const shell=(S,frame)=>{
    const point=p=>K.sceneGraph.point(frame,p);
    const ax=[[1,0,0],[0,1,0],[0,0,1]].map(p=>K.M.app(frame.matrix,p)), inverse=K.M.tr(frame.matrix);
    return S.box(point([0,0,0]),[1.31,.74,.46],{
      r:ramps[0],materialId:'blue-enamel',
      rf(x,y,z){return ramps[group(...K.M.app(inverse,K.V.sub([x,y,z],frame.position)))];}
    },{ax,rd:.20,res:.043,objectId:object,target:{part}});
  };
  const graph=K.sceneGraph.create({nodes:{pod:{sockets:{front:{position:[0,0,0]}}}}});
  const sculpt=B=>K.sculpt(makeSculpt(B));
  const sourceBuilder=makeBuilder(seed,palette), local=sculpt(sourceBuilder);
  shell(local,graph.frame('pod'));
  local.bake();
  const source=sourceBuilder.finish({look:{splatCoverage:'continuous'}});
  const raw=K.model.fromSdf(local.sdf,{bounds:{min:[-1.43,-.86,-.58],max:[1.43,.86,.58]},resolution:.058});
  const positions=raw.points.flat(), indices=[], slots=[];
  const light=K.V.norm([-.46,.74,.49]);
  for(const face of raw.faces) {
    const [a,b,c]=face.map(i=>raw.points[i]), n=K.V.norm(K.V.cross(K.V.sub(b,a),K.V.sub(c,a)));
    const p=K.V.mul(face.reduce((sum,i)=>K.V.add(sum,raw.points[i]),[0,0,0]),1/face.length);
    const ramp=group(...p), shade=Math.max(0,Math.min(ramps[ramp].length-1,Math.floor(1.35+3.6*Math.max(0,K.V.dot(light,n)))));
    indices.push(...(face.length===4?[face[0],face[1],face[2],face[0],face[2],face[3]]:face));
    slots.push(...Array(face.length===4?2:1).fill(ramp*5+shade));
  }
  const materials=ramps.flatMap((r,i)=>Array.from({length:5},(_,j)=>({
    id:['blue-enamel','dark-trim','brass-strip'][i]+'-'+j,color:palette[r[Math.min(j,r.length-1)]]
  })));
  const mesh=K.sceneMeshes.create({id:'aster-case',objectId:object,partId:part,positions,
    uvs:Array.from({length:raw.points.length*2},()=>0),indices,materials,faceMaterials:slots});

  const path2=(points,color,width=1)=>({type:'path',points,color,width});
  const rectangle=(rect,color)=>({type:'rect',rect,color});
  const word=(text,x,y,size,color,width)=>K.poly2.text(text,size,{width}).strokes.map(stroke=>
    path2(stroke.map(([u,v])=>[x+u,y-v]),color,width));
  const image=(width,height,strokes)=>({width,height,pixels:Array.from(screenDrawing(width,height,strokes).data)});
  const anchor=(x,y,w,h,bias=.007)=>({...target,node:'pod',socket:'front',at:[x,y,.46],normal:[0,0,1],
    size:[w,h],depth:.26,bias,maxStep:.12});
  const crest=image(46,46,[
    rectangle([5,7,36,32],'#594834'),rectangle([8,5,30,34],'#b07a4a'),
    path2([[9,7],[36,7],[36,35]],'#ffce83',2),
    path2([[13,28],[23,12],[32,28],[23,25],[13,28]],'#f8e3a9',2.4),
    ...word('A',23,33,5,'#f8e3a9',1)
  ]);
  const heights=Array.from({length:46*46},(_,i)=>{
    const x=i%46,y=Math.floor(i/46);
    return Math.round(255*Math.min(1,Math.max(0,Math.min(x-4,41-x,y-3,40-y)/7)));
  });
  const document=K.surfaceDecals.create({format:'ink-studio/surface-decals',version:1,decals:[
    {id:'amber-paint',kind:'paint',anchor:anchor(-.97,.06,.54,1.22,.014),grid:[22,22],
      image:image(38,104,[path2([[1,16],[34,16],[34,101]],'#e6a265',6),
        path2([[1,20],[27,20],[27,101]],'#a76348',2),rectangle([18,73,5,22],'#ffca82')])},
    {id:'aster-lettering',kind:'lettering',anchor:anchor(-.27,.15,1.43,.66,.016),grid:[18,12],
      image:image(150,60,[...word('ASTER  07',75,23,18,'#f9edc8',3.5),
        ...word('SURVEY  POD',75,45,8,'#cbe9d2',1.85),path2([[14,34],[135,34]],'#a4d8c1',1.3)])},
    {id:'port-scuff',kind:'scuff',anchor:anchor(.55,-.40,.89,.39,.015),grid:[18,12],
      lifetime:{start:.35,end:3.85,fadeIn:.4,fadeOut:.5},
      image:image(74,33,[path2([[5,25],[21,18],[32,21],[56,12],[69,11]],'#5a453d',4),
        path2([[10,23],[21,19],[32,22],[55,13]],'#e5ae79',1.5),
        path2([[28,28],[41,24],[58,23]],'#aa8e70',2.6),path2([[55,4],[70,1]],'#ecc79b',1)])},
    {id:'raised-crest',kind:'relief',anchor:anchor(.68,.13,.48,.48,.009),grid:[24,24],image:crest,
      relief:{height:.055,heights}}
  ]});
  const world={sceneGraph:graph};
  const decals=K.surfaceDecals.bind(world,document,{receivers:[
    {...target,representation:'mesh',mesh},
    {...target,representation:'sdf',field:{distance:local.sdf}},
    {...target,representation:'splats',source,bias:.040}
  ]});

  function pose(time,kind) {
    const angle=-.27+.62*Math.sin(time*.36), tilt=.07*Math.sin(time*1.02);
    const matrix=K.M.mul(K.M.rot([0,1,0],angle),K.M.rot([0,0,1],tilt));
    graph.setLocal('pod',{position:[-.20+.42*Math.sin(time*.67),1.38+.065*Math.sin(time*1.14),0],matrix});
    const frame=graph.frame('pod'), point=p=>K.sceneGraph.point(frame,p), ax=[[1,0,0],[0,1,0],[0,0,1]].map(p=>K.M.app(matrix,p));
    const B=makeBuilder(seed,palette), S=sculpt(B);
    Object.assign(S,{sun:light,amb:.42,sky:.14,sunK:.54,wob:0});
    S.lathe([0,-.22,0],.26,[1.90,1.90,1.83,1.76],{r:[1,2,3,4]},{res:.060,objectId:'turntable'});
    S.lathe([0,.022,0],.10,[1.30,1.31,1.29,1.26],{r:[5,6,7,8,9]},{res:.068,objectId:'turntable'});
    for (const x of [-.72,.72]) S.box([x,.34,0],[.22,.23,.34],{r:[1,2,3]},
      {rd:.058,res:.054,objectId:'mount'});
    S.keepRenderSdf=kind==='sdf';
    if(kind!=='mesh') shell(S,frame);
    function detail(at,half,r,rd=.034) {
      S.box(point(at),half,{r},{ax,rd,res:.039,objectId:'case-hardware'});
    }
    detail([0,.77,-.06],[.64,.075,.26],ramps[2],.048);
    detail([0,.86,-.055],[.39,.07,.135],ramps[1],.05);
    for (const x of [-1.02,1.04]) detail([x,-.51,.405],[.10,.10,.079],ramps[2]);
    for (let i=0;i<5;i++) detail([1.28,.20-i*.098,-.11],[.031,.022,.24],ramps[1],.013);
    detail([-.44,-.43,.454],[.21,.051,.015],ramps[1],.014);
    for (let i=0;i<5;i++) detail([-.58+i*.068,-.43,.474],[.016,.020,.009],i<4?[7,8,9,15]:[1,3],.005);
    S.bake();
    if(kind==='mesh') {
      const live=[];
      for(const p of raw.points)live.push(...point(p));
      K.sceneMeshes.pose(mesh,live);
    }
    const current=B.finish({id:'surface-decals',meshes:kind==='mesh'?[mesh]:[],
      cam:{target:[0,1.22,0],dist:5.3,ortho:true,pitch:.18,yaw:.15},
      radius:6,dither:0,fog:{c:1,start:1,max:0},look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#27394f',horizon:'#54777b',ground:'#192e3c',sunStrength:0}}});
    Object.assign(world,current,{renderSdfs:current.renderSdfs??[]});
    decals.use(object,part,kind);
    return world;
  }

  return {world,pose,document,decals,target};
}

const factory=kit=>({
  id:'surface-decals',seed:107,name:'Aster survey pod',
  build(){return study(kit).pose(1,'mesh');}
});
function demo(directory,video=false) {
  const kit=ink.load(), {pose,document,decals,target}=study(kit), out=path.resolve(directory);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'aster-decals.json'),JSON.stringify(document)+'\n');
  const draw=(kind,time)=>{
    const world=pose(time,kind);
    return ink.render(world,{w:392,h:262,px:1,t:time,raw:true,passes:['opaque-surface','partId'],
      sdfAssist:kind==='sdf'&&{rules:[{select:target}]}});
  };
  const receipt=[];
  for(const [name,kind,time] of [['mesh','mesh',.95],['sdf','sdf',1.86],['splats','splats',2.87],['expired','splats',4.15]]) {
    const {w,h,rgb,passes}=draw(kind,time);
    PNG.write(path.join(out,name+'.png'),w,h,rgb);
    const part=passes.parts.findIndex(row=>row?.object===target.object && row.part===target.part);
    const expected={mesh:1,sdf:2,splats:3}[kind];
    const receiverPixels=passes.surfaceKind.reduce((n,value,i)=>n+Number(value===expected && passes.partId[i]===part),0);
    const report=decals.sample(time).report;
    assert(receiverPixels>1000);
    assert(report.filter(row=>row.kind!=='scuff').every(row=>row.triangles>0));
    assert.equal(report.some(row=>row.kind==='scuff' && row.triangles>0),name!=='expired');
    receipt.push({name,time,receiverPixels,decals:report});
  }
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  if(video) {
    const frames=path.join(out,'frames');
    fs.mkdirSync(frames,{recursive:true});
    for(let i=0;i<42;i++) {
      const t=.36+i*.10, kind=t<1.45?'mesh':t<2.58?'sdf':'splats';
      const im=draw(kind,t);
      PNG.write(path.join(frames,String(i).padStart(3,'0')+'.png'),im.w,im.h,im.rgb);
    }
  }
}
if(require.main===module)demo(process.argv[2]??'surface-decal-review',process.argv.includes('--frames'));
module.exports=factory;
