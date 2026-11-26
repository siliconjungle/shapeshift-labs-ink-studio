const fs=require('node:fs');
const PNG=require('./png.js');
const UV=require('./material-preview-geometry.js');
const Texture=require('../src/texture-address.js');
const { fromGltf }=require('./scene-resource-gltf.js');

const vector=(row,i,n)=>row.slice(i*n,(i+1)*n);
const clamp=n=>Math.min(1,Math.max(0,n));
const linear=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const slot=(model,p)=>p.material===null?'Unassigned':model.materials[p.material].name;
function load(filename,directory,onInput) {
  const model=fromGltf(filename,directory,onInput,{bakeAttributes:true});
  if(!model.meshes.length)throw new RangeError('No meshes in the scene');
  return model;
}
function catalog(model) {
  return model.meshes.map((mesh,index)=>({index,name:mesh.name,
    submeshes:mesh.parts.map((p,index)=>({index,slot:slot(model,p),triangles:p.indices.length/3,uvSets:Object.keys(p.uv).map(Number)}))}));
}

function chooseMesh(model,selector,label) {
  const matches=model.meshes.map((mesh,i)=>typeof selector==='number'?i===selector:mesh.name===selector);
  if(matches.filter(Boolean).length!==1)throw new RangeError('Choose one unique mesh for '+label);
  return matches.indexOf(true);
}

function sceneTransform(model,index,{V},instance) {
  const asset=model.meshes[index], instances=model.nodes.filter(node=>node.mesh===index);
  if(instance===undefined&&instances.length>1)throw new RangeError('Projection needs one scene placement for mesh '+asset.name);
  const matrix=(instance??instances[0])?.world;
  if(!matrix)return;
  const [x,y,z]=[0,4,8].map(i=>matrix.slice(i,i+3));
  const origin=matrix.slice(12,15), dual=[V.cross(y,z),V.cross(z,x),V.cross(x,y)];
  const determinant=V.dot(x,dual[0]), sign=Math.sign(determinant);
  if(!Number.isFinite(determinant)||Math.abs(determinant)<=V.len(x)*V.len(y)*V.len(z)*1e-12)
    throw new RangeError('Projection needs a nonsingular transform on '+asset.name);
  const columns=[x,y,z], apply=(a,b,c,axes)=>V.add(V.add(V.mul(axes[0],a),V.mul(axes[1],b)),V.mul(axes[2],c));
  return {
    mirrored:sign<0,
    point:value=>V.add(origin,apply(...value,columns)),
    normal(value) {
      const direction=apply(...value,dual), length=V.len(direction);
      return length>0?V.mul(direction,sign/length):[0,1,0];
    }
  };
}

function sceneMesh(model,index,K,instance) {
  const asset=model.meshes[index], transform=sceneTransform(model,index,K,instance);
  if(!transform)return asset;
  return {...asset,parts:asset.parts.map(part=>{
    const position=[], normals=[], indices=part.indices.slice();
    for(let i=0;i<part.position.length;i+=3) {
      position.push(...transform.point(part.position.slice(i,i+3)));
      if(part.normal)normals.push(...transform.normal(part.normal.slice(i,i+3)));
    }
    if(transform.mirrored)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    return {...part,position,indices,...(part.normal&&{normal:normals})};
  })};
}

function surfaces(model,asset,selected,K,images) {
  const {V}=K;
  const points=[], faces=[], geometryNormals=[], metadata=[];
  function texture(row) {
    if(!row)return null;
    const key=[row.file,row.wrapS,row.wrapT].join('\0');
    if(!images.has(key)) {
      const {w,h,data,max}=PNG.raster(fs.readFileSync(row.file)), modes={repeat:'wrap',clamp:'clamp',mirror:'mirror'};
      const pixels=Float32Array.from(data,n=>n/max);
      images.set(key,Texture.sampler(pixels,w,h,Texture.settings({filter:'nearest',edgeU:modes[row.wrapS],edgeV:modes[row.wrapT]})));
    }
    return images.get(key);
  }
  for(const [i,part] of asset.parts.entries()) {
    const start=points.length;
    for(let p=0;p<part.position.length/3;p++)points.push(vector(part.position,p,3));
    const paint=model.materials[part.material], maps=paint?Object.entries(paint.maps).map(([name,ref])=>{
      if(selected[i]&&!part.uv[ref.uv])throw new RangeError('Source map '+name+' needs TEXCOORD_'+ref.uv+' on submesh '+i);
      return [name,ref,selected[i]&&texture(ref)];
    }):[];
    for(let f=0;f<part.indices.length;f+=3) {
      const vertices=part.indices.slice(f,f+3), final=vertices.map(i=>i+start), [a,b,c]=final.map(i=>points[i]);
      const ab=V.sub(b,a), ac=V.sub(c,a), cross=V.cross(ab,ac);
      if(V.len(cross)<1e-12) continue;
      const normal=V.norm(cross), normals=part.normal?vertices.map(i=>vector(part.normal,i,3)):[normal,normal,normal];
      const charts=Object.fromEntries(Object.entries(part.uv).map(([set,flat])=>[set,vertices.map(i=>vector(flat,i,2))]));
      const d00=V.dot(ab,ab),d01=V.dot(ab,ac),d11=V.dot(ac,ac), denominator=d00*d11-d01*d01;
      const row={i,vertices,selected:selected[i],normal,cross,normals,points:[a,b,c],charts};
      row.weights=point=>{
        const ap=V.sub(point,a), e0=V.dot(ap,ab), e1=V.dot(ap,ac);
        const u=(d11*e0-d01*e1)/denominator, v=(d00*e1-d01*e0)/denominator;
        return [1-u-v,u,v];
      };
      row.sample=(point,n)=>{
        const weights=row.weights(point), [,u,v]=weights;
        const value={color:paint?.color.slice(0,3)??[.45,.45,.45],roughness:paint?.roughness??.8,
          metallic:paint?.metallic??0,emission:paint?.emission??[0,0,0],opacity:paint?.alphaMode==='OPAQUE'?1:paint?.color[3]??1};
        if(part.color) {
          const tint=lane=>vertices.reduce((sum,id,i)=>sum+weights[i]*part.color[id*part.colorLanes+lane],0);
          value.color=value.color.map((n,i)=>n*clamp(tint(i)));
          if(part.colorLanes===4&&paint?.alphaMode!=='OPAQUE')value.opacity*=clamp(tint(3));
        }
        const rgba=[0,0,0,0];
        for(const [name,ref,read] of maps) {
          const [ta,tb,tc]=charts[ref.uv], x=ta[0]+u*(tb[0]-ta[0])+v*(tc[0]-ta[0]), y=ta[1]+u*(tb[1]-ta[1])+v*(tc[1]-ta[1]);
          read(x,y,rgba);
          if(name==='base')value.color=value.color.map((c,i)=>c*linear(rgba[i]));
          if(name==='emissive')value.emission=value.emission.map((c,i)=>c*linear(rgba[i]));
          if(name==='roughness'||name==='metallic'||name==='opacity')value[name]*=rgba['rgba'.indexOf(ref.channel)];
          if(name==='normal') {
            const du1=tb[0]-ta[0],dv1=tb[1]-ta[1],du2=tc[0]-ta[0],dv2=tc[1]-ta[1], det=du1*dv2-du2*dv1;
            if(Math.abs(det)<1e-12)continue;
            const tangent=V.mul(V.sub(V.mul(ab,dv2),V.mul(ac,dv1)),1/det);
            const bitangent=V.mul(V.sub(V.mul(ac,du1),V.mul(ab,du2)),1/det);
            const tx=V.norm(V.mad(tangent,n,-V.dot(n,tangent)),V.perp(n)), cross=V.cross(n,tx);
            const ty=V.mul(cross,V.dot(cross,bitangent)<0?-1:1);
            value.normal=V.norm(V.mad(V.mad(V.mul(n,2*rgba[2]-1),tx,2*rgba[0]-1),ty,2*rgba[1]-1),n);
          }
        }
        return value;
      };
      faces.push(final);
      geometryNormals.push(normal);
      metadata.push(row);
    }
  }
  return {points,faces,geometryNormals,metadata};
}

function meshFor(model,selection,K,images) {
  const {V}=K,index=chooseMesh(model,selection.mesh,selection.id), {uvSet}=selection;
  const asset=selection.projection?sceneMesh(model,index,K):model.meshes[index];
  if(selection.submeshes?.some(n=>!asset.parts[n])||selection.slots?.some(name=>!asset.parts.some(p=>slot(model,p)===name)))
    throw new RangeError('Unknown submesh or slot in '+selection.id);
  const selected=asset.parts.map((part,i)=>(!selection.submeshes||selection.submeshes.includes(i))&&
    (!selection.slots||selection.slots.includes(slot(model,part))));
  if(!selected.some(Boolean))throw new RangeError('The submesh and slot filters select no faces in '+selection.id);
  if(asset.parts.some((p,i)=>selected[i]&&!p.uv[uvSet]))throw new RangeError('Selected submesh lacks TEXCOORD_'+uvSet+' in '+selection.id);
  const geometry=surfaces(model,asset,selected,K,images), {metadata}=geometry;
  const tiles=selection.tiles.map(tile=>{
    const [x,y]=tile, points=[],faces=[],uvs=[],normals=[],source=[];
    for(const [i,row] of metadata.entries()) {
      if(!row.selected)continue;
      const triangle=row.charts[uvSet].map((uv,j)=>({uv,p:row.points[j],n:row.normals[j]}));
      const polygon=UV.clip(UV.clip(UV.clip(UV.clip(triangle,0,x,1),0,x+1,-1),1,y,1),1,y+1,-1);
      for(let j=1;j+1<polygon.length;j++) {
        const corners=[polygon[0],polygon[j],polygon[j+1]];
        const [a,b,c]=corners.map(q=>q.p), [ta,tb,tc]=corners.map(q=>q.uv);
        if(V.len(V.cross(V.sub(b,a),V.sub(c,a)))<1e-12||
           Math.abs((tb[0]-ta[0])*(tc[1]-ta[1])-(tc[0]-ta[0])*(tb[1]-ta[1]))<1e-12)continue;
        const offset=points.length;
        points.push(...corners.map(q=>q.p));normals.push(...corners.map(q=>q.n));
        faces.push([offset,offset+1,offset+2]);uvs.push(corners.map(q=>[clamp(q.uv[0]-x),clamp(q.uv[1]-y)]));source.push(i);
        if(faces.length>100000)throw new RangeError('Bake tile exceeds the clipped face budget');
      }
    }
    if(!faces.length)throw new RangeError('No UV surface on '+selection.id+' tile '+UV.tileLabel(tile));
    return {tile,label:UV.tileLabel(tile),name:asset.name,mesh:{points,materials:[{}],paintedOpacity:true,
      sampleSurface:(p,n,f)=>metadata[source[f]].sample(p,n)},faces,uvs,normals,source};
  });
  return {index,mesh:asset.name,asset,selected,...geometry,tiles};
}
module.exports={load,catalog,chooseMesh,sceneMesh,sceneTransform,surfaces,meshFor};
