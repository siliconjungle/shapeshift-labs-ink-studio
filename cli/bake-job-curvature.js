const path=require('node:path');
const Surface=require('./bake-job-surface.js');
const {readTexture}=require('./texture-files.js');
const {tileKey}=require('./material-preview-geometry.js');
const {topology}=require('./curvature-topology.js');
const bake=require('./glb-bake.js');

const names=Object.freeze(['curvature','curvature-convex','curvature-concave']);
const fields=['curvatureSource','normalInput','curvatureScale','edgePolicy','normalization','curvatureRange','encoding'];
const choices={mesh:['surface','chart'],normal:['one-sided','strict']};
const limit=1e6;
const clamp=n=>Math.min(1,Math.max(0,n));

function settings(map,options) {
  if(!names.includes(map))return {};
  const {curvatureSource:source='mesh',normalInput,curvatureScale:scale=source==='mesh'?0:1,
    edgePolicy=choices[source]?.[0],encoding='png16',normalization=encoding==='exr'?'none':'auto',curvatureRange:range}=options;
  if(!Object.hasOwn(choices,source)||!choices[source].includes(edgePolicy)||!Surface.encodings.includes(encoding)||
    (source==='normal'?typeof normalInput!=='string'||!normalInput.trim()||!Number.isInteger(scale)||scale<1||scale>32:
      normalInput!==undefined||!Number.isFinite(scale)||scale<0||scale>limit)||
    !['none','auto','manual'].includes(normalization)||normalization==='none'&&encoding!=='exr'||
    (normalization==='manual'?!Number.isFinite(range)||range<=0||range>limit:range!==undefined))
    throw new RangeError('Curvature needs a valid source, scale, edge policy and encoding range. Raw values need OpenEXR.');
  return {encoding,curvature:{source,normalInput,scale,edgePolicy,normalization,range}};
}

function inputReader(libraries,onInput) {
  const loaded=new Map();
  return (id,tile)=>{
    const source=libraries.get(id);
    if(!source)throw new RangeError('Unknown curvature normal input '+id);
    const file=source.file??source.tiles.get(tileKey(tile.tile));
    if(!file)throw new RangeError('Curvature normal input '+id+' has no tile '+tile.label);
    if(!loaded.has(file)) {
      onInput(file);
      const raw=readTexture(file);
      if(raw.channels<3||raw.width*raw.height>4e6||!['png','exr'].includes(raw.encoding))
        throw new RangeError('Curvature needs an RGB(A) PNG or XYZ EXR normal input within four million texels');
      loaded.set(file,raw);
    }
    const {width,height,channels,data,bitDepth,encoding}=loaded.get(file), top=encoding==='exr'?1:bitDepth===16?65535:255;
    const scale=(value)=>top===1?value:value===Math.round(top/2)?0:value/top*2-1;
    const axis=(u,n)=>Math.min(n-1,Math.max(0,u*n-.5));
    return {space:source.space,orientation:source.orientation, sample(u,v) {
      const x=axis(u,width),y=axis(v,height),left=Math.floor(x),topY=Math.floor(y),
        right=Math.min(width-1,left+1),bottom=Math.min(height-1,topY+1),a=x-left,b=y-topY;
      const texel=(x,y,c)=>scale(data[(y*width+x)*channels+c]);
      const value=[0,1,2].map(c=>(texel(left,topY,c)*(1-a)+texel(right,topY,c)*a)*(1-b)+
        (texel(left,bottom,c)*(1-a)+texel(right,bottom,c)*a)*b);
      if(value.some(n=>Math.abs(n)>1.001))throw new RangeError('Curvature normal components need the signed unit range');
      const length=Math.hypot(...value);
      if(length<1e-8)return;
      return value.map((n,c)=>n/length*(c===1&&source.orientation==='directx'?-1:1));
    }};
  };
}

function faceFrame(tile,f,V) {
  const [a,b,c]=tile.faces[f].map(i=>tile.mesh.points[i]), [ua,ub,uc]=tile.uvs[f];
  const ab=V.sub(b,a),ac=V.sub(c,a),g=V.norm(V.cross(ab,ac));
  const s=ub[0]-ua[0],t=ub[1]-ua[1],u=uc[0]-ua[0],v=uc[1]-ua[1], inv=1/(s*v-t*u);
  const du=V.mul(V.sub(V.mul(ab,v),V.mul(ac,t)),inv),dv=V.mul(V.sub(V.mul(ac,s),V.mul(ab,u)),inv);
  const [na,nb,nc]=tile.faces[f].map(i=>tile.normals[i]), dnb=V.sub(nb,na),dnc=V.sub(nc,na);
  const e1=V.norm(du),e2=V.cross(g,e1), span=V.dot(dv,e2), x=V.dot(dv,e1), length=V.len(du);
  return {
    tangentVector(value,uv) {
      const u=uv[0]-ua[0],w=uv[1]-ua[1];
      const n=V.norm(V.mad(V.mad(na,dnb,(u*v-w*(uc[0]-ua[0]))*inv),dnc,(s*w-t*u)*inv),g);
      const tx=V.norm(V.mad(du,n,-V.dot(du,n)),V.perp(n)), cross=V.cross(n,tx);
      const ty=V.mul(cross,V.dot(cross,dv)<0?-1:1);
      return V.mad(V.mad(V.mul(n,value[2]),tx,value[0]),ty,value[1]);
    },
    principal(dU,dV) {
      if(Math.abs(span)<1e-12||length<1e-12)return;
      const a=V.mul(dU,1/length), b=V.mul(V.mad(dV,a,-x),1/span);
      const xx=V.dot(e1,a), xy=(V.dot(e2,a)+V.dot(e1,b))*.5, yy=V.dot(e2,b);
      const mean=(xx+yy)*.5,radius=Math.hypot((xx-yy)*.5,xy),lo=mean-radius,hi=mean+radius;
      return [(Math.max(0,lo)+Math.max(0,hi))*.5,(Math.max(0,-lo)+Math.max(0,-hi))*.5];
    }
  };
}

function measure(tile,settings,prepared,read,K) {
  const {V}=K,{size,padding,curvature:{source,normalInput,scale,edgePolicy}}=settings, count=size*size;
  const convex=new Float32Array(count),concave=new Float32Array(count),valid=new Uint8Array(count);
  const face=new Uint32Array(count), gutter=new Uint32Array(count), isNormal=source==='normal';
  const sampler=isNormal&&read(normalInput,tile);
  const faceCharts=isNormal?tile.source.map(i=>prepared.faceCharts[i]):tile.source.map(()=>0);
  function set(i,values) {
    if(!values||!values.every(n=>Number.isFinite(Math.fround(n))))return;
    convex[i]=Math.max(0,values[0]);
    concave[i]=Math.max(0,values[1]);
    valid[i]=1;
  }
  const visibility={
    forFace:f=>(point,_normal,i)=>{
      face[i]=f+1;
      if(!isNormal)set(i,prepared.sample(tile.source[f],point));
    },
    copy(i,j) {gutter[j]=gutter[i]||i+1;}
  };
  const raster=bake(tile.mesh,tile.faces,tile.uvs,tile.normals,size,padding,K,{registered:true,
    chartBake:{state:{faceCharts},visibility}});
  if(isNormal) {
    const vectors=new Array(count),frames=tile.faces.map((_,i)=>faceFrame(tile,i,V));
    for(let i=0;i<count;i++)if(face[i])vectors[i]=sampler.sample((i%size+.5)/size,(Math.floor(i/size)+.5)/size);
    const {owners}=raster.raster;
    function find(i,x,y,dx,dy) {
      let j=i,n=0;
      for(let k=1;k<=scale;k++) {
        const u=x+k*dx,v=y+k*dy;
        if(u<0||u>=size||v<0||v>=size)break;
        const next=u+v*size;
        if(!vectors[next]||owners[next]!==owners[i])break;
        j=next;n=k;
      }
      return [j,n];
    }
    for(let i=0;i<count;i++) {
      if(!vectors[i])continue;
      const x=i%size,y=Math.floor(i/size), frame=frames[face[i]-1],uv=[(x+.5)/size,(y+.5)/size];
      function diff(dx,dy) {
        const [lo,a]=find(i,x,y,-dx,-dy),[hi,b]=find(i,x,y,dx,dy);
        if(!a&&!b||edgePolicy==='strict'&&(a!==scale||b!==scale))return;
        const raw=V.mul(V.sub(vectors[hi],vectors[lo]),size/(a+b));
        return sampler.space==='world'?raw:frame.tangentVector(raw,uv);
      }
      const du=diff(1,0),dv=diff(0,1);
      if(du&&dv)set(i,frame.principal(du,dv));
    }
  }
  let peak=0,min=Infinity,max=-Infinity,measured=0;
  for(let i=0;i<count;i++) {
    if(valid[i]) {
      const value=convex[i]-concave[i];
      peak=Math.max(peak,convex[i],concave[i]);
      min=Math.min(min,value);
      max=Math.max(max,value);
      measured++;
    }
    if(gutter[i]) {
      convex[i]=convex[gutter[i]-1];
      concave[i]=concave[gutter[i]-1];
    }
  }
  return {convex,concave,valid,peak,covered:raster.sampledTexels,coverage:raster.coverage,
    min:measured?min:null,max:measured?max:null,measured,stats:prepared.stats};
}

function render(tasks,libraries,onInput,K) {
  const read=inputReader(libraries,onInput),byTask=new Map(),groups=new Map();
  for(const task of tasks) {
    const {authored,settings}=task;
    if(!settings.curvature)continue;
    const {source,scale,edgePolicy,normalInput}=settings.curvature;
    const key=JSON.stringify([authored.id,settings.size,settings.padding,source,scale,edgePolicy,normalInput]);
    if(!groups.has(key))groups.set(key,{tasks:[],tiles:new Map()});
    groups.get(key).tasks.push(task);
    byTask.set(task,key);
  }
  return task=>{
    const key=byTask.get(task), group=groups.get(key), {selection,settings,tile,map}=task;
    const {source,scale,edgePolicy,normalization,range,normalInput}=settings.curvature;
    if(group.peak===undefined) {
      const topologyData=topology(selection,source==='normal'?'chart':edgePolicy,K);
      const prepared=source==='normal'?topologyData:topologyData.mesh(scale);
      group.peak=0;
      group.remaining=group.tasks.length;
      for(const member of group.tasks) {
        if(group.tiles.has(member.tile))continue;
        const row=measure(member.tile,settings,prepared,read,K);
        group.tiles.set(member.tile,row);
        group.peak=Math.max(group.peak,row.peak);
      }
    }
    const row=group.tiles.get(tile), signed=map==='curvature';
    const raw=map==='curvature-convex'?row.convex:map==='curvature-concave'?row.concave:
      Float32Array.from(row.convex,(n,i)=>n-row.concave[i]);
    const limit=range??(group.peak||1), displayRange=[signed?-limit:0,limit], physical=normalization==='none';
    let clipped=0;
    if(!physical)for(let i=0;i<raw.length;i++)if(row.valid[i]&&Math.abs(raw[i])>limit)clipped++;
    const display=Float32Array.from(raw,n=>clamp(signed?.5+.5*n/limit:n/limit));
    const encoded=Surface.scalar(settings.size,settings.encoding,physical?raw:display,display);
    if(--group.remaining===0)groups.delete(key);
    return {...encoded,texels:row.covered,coverage:row.coverage,
      output:{kind:'curvature',encoding:settings.encoding,bitDepth:Surface.depth(settings.encoding),units:'inverse-shape-units',
        range:physical?null:displayRange,displayRange,clipped,normalization},
      curvature:{source,scale,edgePolicy,...(normalInput&&{normalInput}),measured:row.measured,unknown:row.covered-row.measured,
        signedMin:row.min,signedMax:row.max,peak:row.peak,...row.stats}};
  };
}

module.exports={names,fields,settings,render};
