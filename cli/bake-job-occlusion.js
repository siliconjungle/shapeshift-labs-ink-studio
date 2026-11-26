const Meshes=require('./bake-job-mesh.js');
const Ray=require('./mesh-ray-index.js');
const Surface=require('./bake-job-surface.js');

const scalars=['ao','ao-contact','ao-directional'];
const names=Object.freeze([...scalars,'bent-normal','occlusion-direction']);
const fields=['rays','spread','range','falloff','bias','selfOcclusion','direction','encoding'];
const policies=['all','only','exclude'];
const falloffs={
  none:()=>1,
  linear:t=>t,
  smooth:t=>t*t*(3-2*t)
};
const epsilon=1e-9;
const isDistance=value=>Number.isFinite(value)&&value>0&&value<=1e6;

function settings(id,options) {
  if(!names.includes(id))return {};
  const contact=id==='ao-contact', directional=id==='ao-directional';
  const {rays=contact?24:32,spread=directional?45:contact?75:90,range,bias,
    falloff=contact?'smooth':'none',selfOcclusion='all',direction=directional?[0,1,0]:undefined,
    encoding=scalars.includes(id)?'png8':id==='bent-normal'?'png16':'exr'}=options;
  if(!Number.isSafeInteger(rays)||rays<4||rays>128||!Number.isFinite(spread)||spread<0||spread>90||
      range!==undefined&&!isDistance(range)||bias!==undefined&&(!Number.isFinite(bias)||bias<0||bias>1e6)||
      range!==undefined&&bias!==undefined&&bias>=range||!Object.hasOwn(falloffs,falloff)||!policies.includes(selfOcclusion)||
      !Surface.encodings.includes(encoding)||direction!==undefined&&(!Array.isArray(direction)||direction.length!==3||
        !Array.from(direction).every(Number.isFinite)||!Number.isFinite(Math.hypot(...direction))||Math.hypot(...direction)<=epsilon))
    throw new RangeError('Occlusion needs 4–128 rays, a 0–90° spread, positive range, bias below range and valid falloff and direction');
  return {encoding,occlusion:{rays,spread,range,bias,falloff,selfOcclusion,direction}};
}

function scene(model,receivers,K) {
  const {V,procedural:{spatial}}=K, triangles=[];
  const placements=model.nodes.filter(node=>node.mesh!==null).map(node=>({index:node.mesh,node,active:true}));
  const active=new Set(placements.map(row=>row.index));
  for(const index of new Set(receivers.map(row=>row.index))) {
    if(!active.has(index))placements.push({index,active:false});
  }
  for(const {index,node,active} of placements) {
    const asset=Meshes.sceneMesh(model,index,K,node);
    for(const [part,geometry] of asset.parts.entries()) {
      for(let i=0;i<geometry.indices.length;i+=3) {
        const [a,b,c]=geometry.indices.slice(i,i+3).map(j=>geometry.position.slice(j*3,j*3+3));
        const ab=V.sub(b,a),ac=V.sub(c,a);
        if(V.len(V.cross(ab,ac))<1e-12)continue;
        if(triangles.length>=500000)throw new RangeError('Bake occlusion supports up to 500,000 scene triangles');
        triangles.push({face:triangles.length,mesh:index,active,part,triangle:i/3,a,ab,ac,
          epsilon:1e-12*V.len(ab)*V.len(ac),bounds:spatial.boxOf([a,b,c])});
      }
    }
  }
  return {nearest:Ray.build(triangles,K),triangles:triangles.length};
}

function resolve(id,options,receiver,K) {
  const {V,procedural:{spatial}}=K, box=spatial.boxOf(receiver.points), span=V.dist(box.min,box.max);
  const range=options.range??span*(id==='ao-contact'?.12:1);
  const precision=Math.max(...box.min.map(Math.abs),...box.max.map(Math.abs))*Number.EPSILON*64;
  const bias=options.bias??Math.min(range*.01,Math.max(span*1e-6,precision));
  if(!(range>bias&&bias>=0&&Number.isFinite(range)))throw new RangeError('Occlusion bias must be smaller than the scene-space range');
  return {...options,range,bias,direction:options.direction?V.norm(options.direction):undefined};
}

function directions(rays,spread) {
  // Opposite azimuths at the same elevation keep the unoccluded vector centered.
  const aperture=Math.sin(spread*Math.PI/180)**2, pairs=Math.floor(rays/2), golden=Math.PI*(3-Math.sqrt(5));
  const samples=[];
  for(let i=0;i<pairs;i++) {
    const r=Math.sqrt(aperture*(i+.5)/pairs), azimuth=golden*i, z=Math.sqrt(Math.max(0,1-r*r));
    const x=r*Math.cos(azimuth), y=r*Math.sin(azimuth);
    samples.push([x,y,z],[-x,-y,z]);
  }
  if(rays%2)samples.push([0,0,1]);
  return samples;
}

function prepare(receiver,tile,size,configuration,requested,scene,K) {
  const {V}=K, {rays,spread,range,bias,falloff,selfOcclusion,direction}=configuration;
  const visibility=requested.some(name=>scalars.includes(name))&&new Float32Array(size*size).fill(1);
  const bent=requested.includes('bent-normal')&&new Float32Array(size*size*3);
  const blocker=requested.includes('occlusion-direction')&&new Float32Array(size*size*3);
  if(bent)for(let i=2;i<bent.length;i+=3)bent[i]=1;
  const cone=directions(rays,spread), attenuation=falloffs[falloff], limit=Math.max(0,bias*.1);
  let texels=0,rayCount=0,triangleTests=0,rejected=0,empty=0,blockedRays=0;
  function count() {
    if(++triangleTests>120e6)throw new RangeError('Bake occlusion exceeds the triangle test budget');
  }

  function forFace(face) {
    const row=receiver.metadata[tile.source[face]], geometric=row.normal;
    const accept=hit=>{
      const same=hit.mesh===receiver.index;
      if(same&&hit.part===row.i&&hit.triangle===row.triangle)return false;
      if(!same&&!hit.active)return false;
      return selfOcclusion==='all'||(selfOcclusion==='only' ? same : !same);
    };
    return (point,normal,i)=>{
      const axis=direction??normal, tangent=V.perp(axis), bitangent=V.cross(axis,tangent);
      const origin=V.mad(point,geometric,bias);
      let total=0,blocked=0,lit=[0,0,0],shadow=[0,0,0];
      for(const [x,y,z] of cone) {
        const ray=V.mad(V.mad(V.mul(axis,z),tangent,x),bitangent,y);
        if(V.dot(ray,geometric)<=epsilon) {
          rejected++;
          continue;
        }
        if(++rayCount>26e6)throw new RangeError('Bake occlusion exceeds the ray budget. Use fewer rays or a smaller map.');
        total++;
        const hit=scene.nearest(origin,ray,range,limit,accept,count);
        const weight=hit?attenuation(Math.max(0,1-hit.distance/range)):0;
        if(hit)blockedRays++;
        blocked+=weight;
        if(bent)lit=V.mad(lit,ray,1-weight);
        if(blocker)shadow=V.mad(shadow,ray,weight);
      }
      if(visibility)visibility[i]=total?1-blocked/total:1;
      if(bent)bent.set(V.norm(lit,normal),i*3);
      if(blocker)blocker.set(V.norm(shadow,[0,0,0]),i*3);
      if(!total)empty++;
      texels++;
    };
  }

  function copy(i,j) {
    if(visibility)visibility[j]=visibility[i];
    for(const buffer of [bent,blocker])if(buffer)
      for(let c=0;c<3;c++)buffer[j*3+c]=buffer[i*3+c];
  }
  return {forFace,copy,visibility,bent,blocker,
    report:()=>({...configuration,texels,rayCount,triangleTests,rejectedRays:rejected,
      emptyLobes:empty,blockedRays,sceneTriangles:scene.triangles})};
}

function encode(id,buffers,{size,encoding}) {
  if(scalars.includes(id))return {...Surface.scalar(size,encoding,buffers.visibility),
    output:{kind:'ao',encoding,bitDepth:Surface.depth(encoding),domain:'unit'}};
  const isBent=id==='bent-normal', data=isBent?buffers.bent:buffers.blocker;
  const values=(pixel,lane)=>data[pixel*3+lane];
  return {...Surface.vector(size,encoding,values),output:{
    kind:isBent?'normal':'direction',space:'world',encoding,bitDepth:Surface.depth(encoding),
    domain:encoding==='exr'?'signed-unit':'unit'
  }};
}

module.exports={names,fields,settings,scene,resolve,prepare,encode};
