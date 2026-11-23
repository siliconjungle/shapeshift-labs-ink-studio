/* Real TUM RGB-D crop with authored diffuse/roughness and fitted tangent normals. */
const path=require('node:path');
const fs=require('node:fs');
const ink=require('..');
const PNG=require('../cli/png.js');
const R=require('../cli/render.js');
const files=require('../cli/asset-files.js');
const {readDepthInput}=require('../cli/depth.js');
const {KIT:K}=ink.load();

function fitCenter(points) {
  const offset=[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k]/points.length,0));
  function fit(samples) {
    const rows=Array.from({length:4},()=>new Float64Array(5));
    for (const point of samples) {
      const p=K.V.sub(point,offset), a=[...p.map(n=>2*n),1], b=K.V.dot(p,p);
      for(let i=0;i<4;i++) for(let j=0;j<=4;j++) rows[i][j]+=a[i]*(j===4?b:a[j]);
    }
    for(let i=0;i<4;i++) {
      for(let j=i+1;j<4;j++) if(Math.abs(rows[j][i])>Math.abs(rows[i][i])) [rows[i],rows[j]]=[rows[j],rows[i]];
      const scale=rows[i][i];
      if(Math.abs(scale)<1e-9) throw new RangeError('The globe crop needs a curved set of depth samples');
      for(let j=i;j<=4;j++) rows[i][j]/=scale;
      for(let j=0;j<4;j++) if(j!==i) {
        const weight=rows[j][i];
        for(let k=i;k<=4;k++) rows[j][k]-=weight*rows[i][k];
      }
    }
    const center=K.V.add(offset,[rows[0][4],rows[1][4],rows[2][4]]);
    return {center,radius:Math.sqrt(Math.max(0,rows[3][4]+K.V.len(K.V.sub(center,offset))**2))};
  }
  const first=fit(points);
  const clean=points.filter(p=>Math.abs(K.V.len(K.V.sub(p,first.center))-first.radius)<.018);
  return clean.length>100 ? fit(clean) : first;
}

function mapsFor(capture) {
  const {width,height,image}=capture, {data}=image;
  const diffuse=Uint8Array.from(data), roughness=new Uint8Array(width*height), normal=new Uint8Array(data.length);
  const fine=K.depth.fromMap({...capture,stride:1,isolatedPatches:false});
  const coarse=K.depth.fromMap({...capture,stride:2,isolatedPatches:false});
  const {pos,tri}=coarse.front, uvs=coarse.frontUVs();
  const mesh=K.sceneMeshes.create({id:'globe',positions:pos,uvs,indices:tri,materials:[{id:'paint'}]});
  const trace=K.sceneMeshes.rayQuery(mesh,K);
  const observations=Array.from(fine.observations());
  const {center,radius}=fitCenter(observations.map(row=>row.position));
  const unit=v=>K.V.mul(v,1/Math.max(1e-8,K.V.len(v)));
  for(const {u,v,position} of observations) {
    const pixel=v*width+u,i=pixel*4,[r,g,b]=data.subarray(i,i+3);
    const glare=K.clamp((Math.min(r,g,b)-117)/81,0,.88);
    // This is a hand-directed pigment estimate rather than an inverse-lighting fit.
    const pigment=[.68*r,.79*g,.89*b];
    diffuse.set(pigment.map((n,k)=>Math.round(n*(1-glare)+[67,110,159][k]*glare)),i);
    roughness[pixel]=b>r+32&&b>g+13 ? 50 : 148;
    normal.set([128,128,255,255],i);
    const hit=trace({origin:[0,0,0],direction:unit(position),maxDistance:10});
    if(!hit)continue;
    const ids=Array.from(tri.subarray(hit.triangle*3,(hit.triangle+1)*3));
    const [a,p,q]=ids.map(index=>Array.from(pos.subarray(index*3,index*3+3)));
    const [uv0,uv1,uv2]=ids.map(index=>Array.from(uvs.subarray(index*2,index*2+2)));
    const du=uv1.map((n,k)=>n-uv0[k]),dv=uv2.map((n,k)=>n-uv0[k]),det=du[0]*dv[1]-du[1]*dv[0];
    const ep=K.V.sub(p,a),eq=K.V.sub(q,a), sign=Math.sign(det);
    const right=unit(ep.map((n,k)=>(n*dv[1]-eq[k]*du[1])*sign));
    const up=ep.map((n,k)=>(n*dv[0]-eq[k]*du[0])*sign);
    const N=hit.normal;
    let bitangent=K.V.cross(N,right);
    if(K.V.dot(bitangent,up)<0)bitangent=K.V.mul(bitangent,-1);
    let fitted=unit(K.V.sub(hit.point,center));
    if(K.V.dot(fitted,N)<.15)fitted=unit(K.V.add(fitted,K.V.mul(N,.75)));
    const encoded=[right,bitangent,N].map(axis=>128+Math.round(127*K.V.dot(axis,fitted)));
    normal.set([...encoded,255],i);
  }
  return {materials:{diffuse:{width,height,channels:4,data:diffuse},normal,roughness,captured:true,
      angles:[.72,.96],daylight:{ambient:.57,light:[-.42,.75,.55],specular:.48}},fit:{center,radius}};
}

async function review(depthFile,imageFile,out) {
  const capture=readDepthInput(depthFile,{image:imageFile,'max-jump':.044});
  const {materials,fit}=mapsFor(capture);
  const result=await ink.scanToMesh(capture,{name:'Relightable TUM Globe',meshStride:2,materials,rgbThreshold:15});
  const world=await result.world();
  const {width,height}=capture;
  for(const [file,data] of Object.entries({diffuse:materials.diffuse.data,normal:materials.normal}))
    files.write(path.join(out,file+'.png'),PNG.encode(width,height,data,4));
  files.write(path.join(out,'roughness.png'),PNG.encodeGray(width,height,materials.roughness));
  files.write(path.join(out,'relightable-globe.glb'),result.glb);
  files.json(path.join(out,'relightable-globe.scan.json'),result.report);
  const target=[-.914,.766,-2.22], view={w:156,h:140,px:1,target,yaw:.40,pitch:-.30,ortho:true,dist:.88,raw:true,reflection:false,atmosphere:false};
  function lamp(phase) {
    const at=K.V.add(target,[.36*Math.sin(phase),.12+.14*Math.cos(phase),.32+.055*Math.cos(phase)]);
    return {id:'moving-amber',shape:'disk',at,normal:K.V.norm(K.V.sub(target,at)),
      size:[.064,.064],color:'#ffc293',intensity:1.8,radius:.86,sampleGrid:2,visible:false,shadows:false};
  }
  const lightAt=.93, daylight=R.render(world,view);
  const palette=['1','2','3'];
  const frame=phase=>{
    const local={...view,scanDaylight:false,areaLights:[lamp(phase)]};
    return [daylight,R.render(world,local),R.render(world,{...local,scanAppearance:.78})];
  };
  const poster=R.upscale(R.grid(frame(lightAt),3,palette),3);
  PNG.write(path.join(out,'globe-materials.png'),poster.w,poster.h,poster.rgb);
  const clip=[];
  const samples=[];
  for(let i=0;i<48;i++) {
    const phase=-Math.PI+2*Math.PI*i/48, frames=frame(phase);
    clip.push(PNG.packFrame(R.upscale(R.grid(frames,3,palette),2)));
    const {rgb}=frames[1];
    const sample=x=>Array.from(rgb.subarray(3*(70*view.w+x),3*(70*view.w+x+1)));
    samples.push({phase,light:lamp(phase).at,left:sample(57),right:sample(98)});
  }
  files.write(path.join(out,'moving-light.png'),PNG.encodeAnimation(clip,12));
  files.json(path.join(out,'review.json'),{fit,panels:['daylight','moving area light','moving area light + captured color'],
    captureWeight:.78,source:'TUM desktop globe RGB-D',samples,frame:lightAt,material:result.report.material});
  console.log(JSON.stringify({fit,material:result.report.material}));
}

if(require.main===module){
  if(process.argv.length!==5)throw new TypeError('Supply globe-depth.json, globe-capture.png and an output directory');
  const [depth,image,out]=process.argv.slice(2).map(file=>path.resolve(file));
  fs.mkdirSync(out,{recursive:true});
  review(depth,image,out).catch(error=>{console.error(error);process.exitCode=1;});
}
