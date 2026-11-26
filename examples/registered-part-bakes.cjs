const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const Render=require('../cli/render.js');
const Plan=require('../cli/registered-part-plan.js');
const {KIT:K,makeBuilder,makeSculpt}=ink.load();
const T=K.meshTopology, A=K.procedural.drawing2d;
const out=path.resolve(process.argv[2]??'ferrylight-manifold');
fs.mkdirSync(out,{recursive:true});
const file=name=>path.join(out,name);
const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const command=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'material-bake',...args],
  { cwd:out,encoding:'utf8',maxBuffer:6*1024*1024 }));
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#efce93')=>({type:'text',text,at:[x,y],scale,color});
const label=(text,x,y)=>({type:'text',text,at:[x,y],scale:1,color:'#a3c8c0'});
const palette={format:'ink-studio/pixel-palette',version:1,swatches:[
  {id:'shadow',color:'#182f39'},{id:'gulf',color:'#264650'},{id:'teal',color:'#367176'},
  {id:'glaze',color:'#53978e'},{id:'seafoam',color:'#96c4ac'},{id:'bronze',color:'#ad7b59'},
  {id:'sunlit',color:'#d4a369'},{id:'signal',color:'#ffe39c',locked:true},{id:'ember',color:'#c86c54'}
]};
const colors=Object.fromEntries(palette.swatches.map(row=>[row.id,row.color]));
const rgb=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
const pack=layout=>PNG.encode(layout.width,layout.height,layout.data,4);
const housing=[-2.08,-.91,1.04,.91], badge=[1.14,-.62,2.21,.60];
const smooth=(v,range)=>Math.max(0,1-Math.abs(v)/range)**2;
function detail(kind,u,v) {
  if(kind==='housing') {
    const r=Math.hypot((u-.325)*1.29,(v-.52)*.88), a=Math.atan2(v-.52,u-.325);
    const rim=smooth(r-.237,.034), coil=smooth(r-.135,.031), tick=smooth(r-.192,.023)*Math.max(0,Math.cos(16*a))**3;
    const vent=smooth(v-.55,.27)*smooth(u-.75,.205), ridges=Math.max(0,Math.cos(84*(u+.2*v)))**5;
    const bezel=smooth(Math.min(u,v,1-u,1-v)-.042,.036);
    const nib=smooth(Math.hypot(u-.60,v-.325),.036);
    const mark=smooth(v-.18,.04)*smooth(u-.38,.375);
    const offset=.015+.098*rim+.047*coil+.058*tick+.075*vent*ridges-.028*vent+.042*bezel+.08*nib+.025*mark;
    return {offset,tone:bezel>.15?'gulf':rim>.18?'seafoam':tick>.19?'sunlit':coil>.20?'glaze':
      nib>.2?'ember':venTone(vent,ridges,mark,u,v)};
  }
  const edge=smooth(Math.min(u,v,1-u,1-v)-.06,.056);
  const lens=smooth(Math.hypot(u-.5,(v-.7)*.8)-.215,.038), slots=smooth(v-.60,.2)*Math.max(0,Math.cos(42*u))**8;
  return {offset:.01+.065*edge+.098*lens+.027*slots,tone:edge>.15?'bronze':lens>.16?'glaze':'gulf'};
}
function venTone(vent,ridges,mark,u,v) {
  if(mark>.23)return 'glaze';
  if(vent>.27)return ridges>.41?'seafoam':'shadow';
  if(vent>.10)return 'gulf';
  return Math.sin(47*u-30*v)>.54?'glaze':'teal';
}

function makeHigh(part,box,nu,nv) {
  const [left,bottom,right,top]=box, points=[],faces=[],uvs=[],normals=[],faceParts=[];
  for(let y=0;y<=nv;y++)for(let x=0;x<=nu;x++){
    const u=x/nu,v=1-y/nv,d=detail(part,u,v),eps=.0003;
    points.push([left+(right-left)*u,bottom+(top-bottom)*y/nv,d.offset]);
    const du=(detail(part,u+eps,v).offset-detail(part,u-eps,v).offset)/(2*eps*(right-left));
    const dv=-(detail(part,u,v+eps).offset-detail(part,u,v-eps).offset)/(2*eps*(top-bottom));
    normals.push(K.V.norm([-du,-dv,1]));
  }
  for(let y=0;y<nv;y++)for(let x=0;x<nu;x++){
    const n=x+y*(nu+1), face=[n,n+1,n+nu+2,n+nu+1];
    faces.push(face);
    uvs.push(face.map(index=>[index%(nu+1)/nu,1-Math.floor(index/(nu+1))/nv]));
    faceParts.push(part);
  }
  const w=212,h=134,image=new Uint8Array(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)
    image.set(rgb(colors[detail(part,(x+.5)/w,(y+.5)/h).tone]),(y*w+x)*3);
  PNG.write(file(part+'-source.png'),w,h,image);
  save(part+'-high.json',{points,faces,uvs,normals,faceParts,materials:[{name:part,color:[1,1,1],texture:part+'-source.png',
    roughness:part==='housing'?.32:.57,metallic:part==='housing'?.45:.16}]});
}
makeHigh('housing',housing,86,54);
makeHigh('legend',badge,38,37);

const nameplate=A.render({width:40,height:40,edges:'hard',commands:[
  rect(0,0,40,40,colors.shadow),rect(2,2,36,36,colors.bronze),rect(4,4,32,32,colors.gulf),
  rect(5,5,30,1,colors.sunlit),rect(5,34,30,1,colors.teal),text('F2',8,10,2,colors.signal),
  rect(8,28,24,3,colors.shadow),rect(15,28,17,3,colors.glaze),rect(15,28,4,3,colors.seafoam)
]});
const tilesets={badge:ink.readTilesetImage(pack(nameplate))};

function receiver(id,box,pages,part) {
  const [x0,y0,x1,y1]=box, xs=pages===2?[x0,(x0+x1)/2,x1]:[x0,x1], vertices=xs.flatMap((x,i)=>
    [y0,y1].map((y,k)=>({id:'v'+i+'-'+k,position:[x,y,0]})));
  const uv=[[.08,.90],[.92,.90],[.92,.10],[.08,.10]];
  const faces=Array.from({length:pages},(_,i)=>{
    const name='panel-'+i,material=part==='legend'?'enamel':'metal-'+i;
    const slots=['v'+i+'-0','v'+(i+1)+'-0','v'+(i+1)+'-1','v'+i+'-1'];
    return {id:name,material,corners:slots.map((vertex,j)=>({id:name+'/c'+j,vertex,uv:uv[j],
      ...(j===0 && {uvPinned:true})}))};
  });
  const document=T.create({id,vertices,faces});
  if(part==='legend')save(id+'.json',{id,style:'slate',solids:[],tilesets,
    topologyMeshes:{badge:{document,materials:[{id:'enamel',texture:{tileset:'badge'}}]}}});
  else save(id+'.json',document);
  return document;
}

const targets=[];
for(const part of ['housing','legend'])for(const lod of [0,1]){
  const id=part+'-lod'+lod, tiled=part==='housing'&&lod===0, count=tiled?2:1;
  const doc=receiver(id,part==='housing'?housing:badge,count,part), revision=T.revision(doc);
  const layout=tiled ? id+'-pages.json':undefined;
  if(layout)save(layout,{format:'ink-studio/uv-tile-layout',version:1,mesh:id,revision,uvSet:0,
    tiles:doc.faces.map((row,i)=>({at:[i,0],material:row.material,size:[64,56],faces:[row.id]}))});
  const pins=part==='housing'?[{id:'warning-light',swatch:'signal',uv:lod===0?[.52,.35]:[.30,.35],
    ...(tiled && {tile:[0,0]})}]:[];
  targets.push({id,part,lod,receiver:id+'.json',revision,...(layout && {layout}),
    ...(part==='legend' && {object:'badge',protectPigment:['panel-0']}),
    source:{file:part+'-high.json'},pins,
    sampling:{size:lod===0?64:32,padding:lod===0?3:2,direction:'geometric',maxWork:1600000,
      cage:{search:part==='housing'?.29:.24,margin:part==='housing'?.095:.07,maxProbes:48}}});
}
command('preset','indexed','--out','indexed-preset.json');
save('bake-plan.json',{format:'ink-studio/registered-part-batch',version:1,preset:'indexed-preset.json',palette,targets});
const preview=command('inspect','bake-plan.json');
save('inspection.json',preview);
const completed=command('run','bake-plan.json','--out','package');
const jobs=completed.targets;
assert.equal(jobs.length,4);
assert.equal(completed.budget.pages,5);
assert(jobs.every(job=>job.samplingTotals.hits>0 && job.cage.matches>0));
assert.equal(jobs[0].seamSummary.edges,1);
assert(jobs[0].seamSummary.sampled>0);
assert.equal(jobs[0].palettePins[0].slot,jobs[1].palettePins[0].slot);
assert.equal(jobs[0].palettePins[0].swatch,'signal');

function load(job) {
  const dir=path.dirname(path.join(completed.directory,job.materialBake));
  const material=JSON.parse(fs.readFileSync(path.join(completed.directory,job.materialBake),'utf8'));
  return material.meshes.map(page=>({
    pigment:PNG.raster(path.join(dir,page.maps.pigment.file)),
    normal:PNG.raster(path.join(dir,page.maps.normal.file)),
    roughness:PNG.raster(path.join(dir,page.maps.roughness.file)),
    indexed:PNG.raster(path.join(dir,page.palette.indexed.file)),
    evidence:page.cageBake
  }));
}
const maps=jobs.map(load);
for(const pages of maps.slice(2))assert(pages[0].evidence.protectedPigment.texels>0);
for(const [i,job] of jobs.entries())for(const pin of job.palettePins){
  const page=job.pages.findIndex(row=>row.at.join('/')===pin.tile.join('/'));
  const {data,w}=maps[i][page].indexed, [x,y]=pin.at;
  assert.deepEqual(Array.from(data.slice((y*w+x)*4,(y*w+x)*4+4)),[...rgb(colors.signal),255]);
}

const working=Plan.plan(file('bake-plan.json'),ink,K), meshes=[];
for(const i of [0,2])for(const [j,page] of working.targets[i].pages.entries()){
  const {model}=page, m=maps[i][j], {w,h,data}=m.pigment, count=model.faces.length*3, points=[];
  for(const face of model.faces) for(const vertex of face) points.push(...model.points[vertex]);
  meshes.push(K.sceneMeshes.create({id:'baked-'+i+'-'+j,positions:points,uvs:model.uvs.flat(2),
    indices:Array.from({length:count},(_,k)=>k),normals:model.cornerNormals?.flat(2),
    materials:[{id:'baked',texture:{width:w,height:h,pixels:data},normal:m.normal.data,
      roughness:Uint8Array.from({length:w*h},(_,i)=>m.roughness.data[i*4]),
      mipmaps:{light:[-.64,.48,.63],ambient:.54,specular:.48}}]}));
}
const B=makeBuilder(51,[0x152e38,0x274450,0x3f5c60,0x7a8171,0xbc9466,0xfadc96]);
const sculpt=K.sculpt(makeSculpt(B));
sculpt.box([.03,0,-.38],[2.28,1.01,.23],{r:[0,1,2,3]},{res:.079,rd:.038});
for(const y of [-.967,.967])sculpt.box([.03,y,-.105],[2.27,.052,.105],{r:[0,1,2,3,4]},{res:.069,rd:.027});
sculpt.box([.10,-1.04,-.25],[2.43,.16,.83],{r:[0,1,2,3]},{res:.084,rd:.07});
for(const x of [-1.92,2.04])sculpt.box([x,-1.15,-.08],[.32,.15,.35],{r:[1,2,3,4]},{res:.073,rd:.055});
sculpt.bake();
const world=B.finish({meshes,radius:7,dither:0,cam:{target:[.08,-.18,-.08],dist:6.5,yaw:-.28,pitch:.26,ortho:true,fov:.55}});
const frame=Render.render(world,{w:284,h:208,px:1,raw:true,edges:false,lockCamera:true});
PNG.write(file('rendered-near.png'),frame.w,frame.h,frame.rgb);

const W=629,H=354;
const commands=[rect(0,0,W,H,'#152630'),text('FERRYLIGHT MANIFOLD',20,12,3),label('REGISTERED PART AND LOD BAKE',21,44),
  text('HOUSING',329,63,2),text('LEGEND',514,63,2),label('NEAR / LOD 0',329,92),label('NEAR / LOD 0',514,92),
  label('FAR / LOD 1',329,213),label('FAR / LOD 1',514,213),label('PINNED SIGNAL SWATCH',20,269),
  text(jobs[0].seamSummary.flagged+' FLAGGED SEAM  /  5 PAGES  /  4 TARGETS',20,326,1),
  label('PROTECTED ENAMEL',514,322),label('PIGMENT    NORMAL',327,322)];
const result=A.render({width:W,height:H,edges:'hard',commands});
function paste(w,h,data,channels,x,y,step=1) {
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const p=(j*w+i)*channels,q=data.slice(p,p+3),alpha=channels===4?data[p+3]:255;
    if(!alpha)continue;
    for(let dy=0;dy<step;dy++)for(let dx=0;dx<step;dx++)result.data.set([...q,255],((y+j*step+dy)*W+x+i*step+dx)*4);
  }
}
paste(frame.w,frame.h,frame.rgb,3,15,57);
for(const [i,j,x,y,step] of [[0,0,329,110,1],[0,1,398,110,1],[1,0,329,228,2],[2,0,514,110,1],[3,0,514,228,2]]){
  const image=maps[i][j].indexed;
  paste(image.w,image.h,image.data,4,x,y,step);
}
const normal=maps[1][0].normal;
paste(normal.w,normal.h,normal.data,4,398,228,2);
const marker=[...rgb(colors.signal),255];
paste(1,1,Uint8Array.from(marker),4,20,286,15);
for(const [x,id] of [[45,'glaze'],[70,'teal'],[95,'gulf'],[120,'bronze'],[145,'ember']])
  paste(1,1,Uint8Array.from([...rgb(colors[id]),255]),4,x,286,15);
fs.writeFileSync(file('ferrylight-manifold.png'),pack(result));
save('report.json',{image:'ferrylight-manifold.png',targets:jobs.map(({id,part,lod,cage,samplingTotals,palettePins,seamSummary,pages})=>
  ({id,part,lod,cage,samplingTotals,palettePins,seamSummary,pages:pages.length})),texels:completed.budget.texels,
  protectedLegendTexels:maps.slice(2).map(pages=>pages[0].evidence.protectedPigment.texels)});
console.log(file('ferrylight-manifold.png'));
