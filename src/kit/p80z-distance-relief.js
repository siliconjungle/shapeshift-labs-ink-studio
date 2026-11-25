/* Select a depth-tested relief representation from the rendered art grid. */
(function (K) {
  const {V,sceneMeshes:Meshes}=K, preview=K.procedural.lod.preview;
  const approvals=K.procedural.lod.reliefApproval;
  const {boxOf}=K.procedural.spatial, programs=new WeakSet();
  const tiers=['painted','normal','geometry'], zeroEmission=Object.freeze([0,0,0]);
  const list=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&!(value instanceof DataView);
  const number=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&number(n,lo,hi);
  const vector=(value,n,test=Number.isFinite)=>list(value)&&value.length===n&&Array.from(value).every(test);
  const name=value=>TargetSelectors.name(value);
  const bytes=value=>value instanceof Uint8Array||value instanceof Uint8ClampedArray;
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  function need(ok,message){
    if(!ok)throw new RangeError('Relief LOD: '+message);
  }
  function mode(value){
    need(value===undefined||value===true||value===false||value==='auto'||tiers.includes(value),
      'choose auto, geometry, normal, painted or false');
    return value;
  }

  function create({id,objectId=id,partId,materialId='relief',origin,right,up,texture,heights,normalMap,
      featureSize,normalPixels=.75,geometryPixels=3,segments,paintedSize=64,
      color=0xffffff,light=[-.45,.64,.62],ambient=.42,roughness=.55,geometry,painted,paintedTexels}={}){
    need(name(id)&&name(objectId)&&(partId===undefined||name(partId))&&name(materialId),
      'use stable mesh, object, part and material IDs');
    need(vector(origin,3)&&vector(right,3)&&vector(up,3)&&V.len(right)>1e-6&&V.len(up)>1e-6,
      'a chart needs a finite bottom-left origin and nonzero right and up edges');
    [origin,right,up]=[origin,right,up].map(value=>Array.from(value));
    const size=[V.len(right),V.len(up)], tangent=V.norm(right), vertical=V.norm(up), normal=V.cross(tangent,vertical);
    need(Math.abs(V.dot(tangent,vertical))<1e-7,'the chart edges must be perpendicular');
    const {width,height,pixels}=texture??{};
    need(integer(width,2,512)&&integer(height,2,512)&&
      (heights===undefined?geometry!==undefined&&normalMap!==undefined:vector(heights,width*height,n=>number(n,-1000,1000))),
      'supply a 2–512 texel chart with world-space heights or custom geometry and normals');
    need(normalMap===undefined||bytes(normalMap)&&normalMap.length===width*height*4,'normals need matching RGBA8 pixels');
    need(pixels===undefined||bytes(pixels)&&pixels.length===width*height*4,'pigment needs matching top-down RGBA8 pixels');
    const steps=segments===undefined?[Math.min(96,width-1),Math.min(96,height-1)]:segments;
    const feature=featureSize??Math.min(...size)/8;
    need(vector(steps,2,n=>integer(n,1,192))&&integer(paintedSize,2,256)&&number(feature,1e-6,1e6)&&
      number(normalPixels,.05,4096)&&number(geometryPixels,normalPixels,4096)&&geometryPixels>normalPixels,
      'invalid grid, feature size or increasing native-pixel thresholds');
    need(integer(color,0,0xffffff)&&vector(light,3)&&V.len(light)>1e-6&&number(ambient,0,1)&&number(roughness,0,1),
      'invalid pigment tint, light, ambient or roughness');
    const heightData=heights&&Float32Array.from(heights), suppliedNormals=normalMap&&Uint8Array.from(normalMap);
    const meshSteps=Array.from(steps);
    const pigment=pixels?Uint8Array.from(pixels):new Uint8Array(width*height*4).fill(255);
    need(pigment.some((n,i)=>i%4===3&&n>=128),'the relief chart has no covered texels');
    const materialLight=V.norm(light);
    const settings={light:materialLight,ambient,specular:0};
    const at=(u,v,z)=>V.mad(V.mad(V.mad(origin,right,u),up,1-v),normal,z);
    const heightAt=(u,v)=>{
      if(!heightData)return 0;
      const x=clamp(u,0,1)*(width-1),y=clamp(v,0,1)*(height-1),i=Math.floor(x),j=Math.floor(y);
      const a=x-i,b=y-j,c=Math.min(width-1,i+1),d=Math.min(height-1,j+1);
      return (heightData[j*width+i]*(1-a)+heightData[j*width+c]*a)*(1-b)+
        (heightData[d*width+i]*(1-a)+heightData[d*width+c]*a)*b;
    };
    let geometrySource;
    if(geometry!==undefined){
      need(geometry&&typeof geometry==='object','custom geometry needs indexed triangle arrays');
      const {positions,uvs,indices}=geometry;
      need(vector(positions,positions?.length)&&positions.length>0&&positions.length<=2250000&&
        vector(indices,indices?.length)&&indices.length>0&&indices.length<=750000,'custom geometry exceeds the native mesh budget');
      TexturedSurface.validate({points:positions,uvs,triangles:indices});
      geometrySource={positions:Float32Array.from(positions),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices)};
    }

    let min=0,max=0;
    for(let i=0;i<(heightData?.length??0);i++)if(pigment[i*4+3]>=128){
      min=Math.min(min,heightData[i]);
      max=Math.max(max,heightData[i]);
    }
    const bounds=boxOf([min,max].flatMap(z=>[0,1].flatMap(u=>[0,1].map(v=>at(u,v,z)))));
    if(geometrySource)for(let i=0;i<geometrySource.positions.length;i+=3){
      const p=geometrySource.positions.subarray(i,i+3);
      need(p.every(Number.isFinite),'custom geometry exceeds float storage');
      const z=V.dot(V.sub(p,origin),normal);
      min=Math.min(min,z); max=Math.max(max,z);
      for(let k=0;k<3;k++){
        bounds.min[k]=Math.min(bounds.min[k],p[k]);
        bounds.max[k]=Math.max(bounds.max[k],p[k]);
      }
    }
    const basis=[tangent,vertical];
    const profile=[at(.5,.5,min),at(.5,.5,max)];
    const center=at(.5,.5,0);
    let authoredPaint;
    if(painted!==undefined){
      need(integer(painted?.width,1,256)&&integer(painted?.height,1,256)&&bytes(painted.pixels)&&
        painted.pixels.length===painted.width*painted.height*4,'painted override needs bounded RGBA8 pixels');
      authoredPaint={width:painted.width,height:painted.height,pixels:Uint8Array.from(painted.pixels)};
    }
    let texelPaint;
    if(paintedTexels!==undefined){
      const {width:w,height:h,rgba,points,uvs,triangles}=paintedTexels??{};
      need(!authoredPaint&&integer(w,1,512)&&integer(h,1,512)&&bytes(rgba)&&rgba.length===w*h*4&&
        list(points)&&list(uvs)&&list(triangles)&&triangles.length<=750000,'use a bounded object texel bake as the painted tier');
      TexturedSurface.validate({points,uvs,triangles});
      texelPaint={width:w,height:h,pixels:Uint8Array.from(rgba),points:Float32Array.from(points),
        uvs:Float32Array.from(uvs),triangles:Uint32Array.from(triangles)};
      for(let i=0;i<texelPaint.points.length;i++){
        const p=texelPaint.points[i], axis=i%3;
        bounds.min[axis]=Math.min(bounds.min[axis],p);
        bounds.max[axis]=Math.max(bounds.max[axis],p);
      }
    }

    let revision=K.procedural.data.hash(JSON.stringify([id,objectId,partId,materialId,Array.from(origin),Array.from(right),
      Array.from(up),width,height,meshSteps,feature,normalPixels,geometryPixels,paintedSize,color,materialLight,
      ambient,roughness,authoredPaint?.width,authoredPaint?.height,texelPaint?.width,texelPaint?.height]));
    for(const buffer of [heightData,suppliedNormals,pigment,geometrySource?.positions,geometrySource?.uvs,geometrySource?.indices,
      authoredPaint?.pixels,texelPaint?.pixels,texelPaint?.points,texelPaint?.uvs,texelPaint?.triangles]){
      revision=K.procedural.data.hash(String(buffer?.byteLength??-1)+':',revision);
      if(buffer)for(const byte of new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength))
        revision=Math.imul(revision^byte,16777619);
    }
    const asset=Object.freeze({id,objectId,partId:partId??null,revision:'r'+(revision>>>0).toString(36)});

    function chartNormal(u,v){
      if(suppliedNormals){
        const i=(Math.round(v*(height-1))*width+Math.round(u*(width-1)))*4;
        return suppliedNormals[i+3]<128?[0,0,1]:
          V.norm([0,1,2].map(c=>Math.max(-127,suppliedNormals[i+c]-128)),[0,0,1]);
      }
      const du=1/(width-1),dv=1/(height-1);
      const l=Math.max(0,u-du),r=Math.min(1,u+du),t=Math.max(0,v-dv),b=Math.min(1,v+dv);
      return V.norm([(heightAt(l,v)-heightAt(r,v))/((r-l)*size[0]),
        (heightAt(u,b)-heightAt(u,t))/((b-t)*size[1]),1]);
    }
    function mappedNormals(){
      const rgba=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)
        rgba.set([...chartNormal(x/(width-1),y/(height-1)).map(n=>128+Math.round(n*127)),255],(y*width+x)*4);
      return rgba;
    }
    const tint=[color>>16,color>>8&255,color&255];
    function paint(){
      if(authoredPaint)return {...authoredPaint,tint:color};
      const shaded=new Uint8Array(pigment.length), sample={roughness,emission:zeroEmission};
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*4;
        if(pigment[i+3]<128)continue;
        const [a,b,c]=chartNormal(x/(width-1),y/(height-1));
        const n=[0,1,2].map(k=>tangent[k]*a+vertical[k]*b+normal[k]*c);
        const rgb=tint.map((v,k)=>Math.round(v*pigment[i+k]/255)/255);
        const result=SemanticTextureMipmaps.shade(rgb,n,normal,sample,settings);
        shaded.set([...result.map(n=>Math.round(n*255)),255],i);
      }
      const chain=SemanticTextureMipmaps.build({width,height,pigment:shaded},{specular:0});
      const lod=chain.levels.find(level=>Math.max(level.width,level.height)<=paintedSize);
      const rank=SemanticTextureMipmaps.rank, rgba=lod.rgba.slice(0,lod.width*lod.height*4);
      for(let y=0;y<lod.height;y++)for(let x=0;x<lod.width;x++){
        const i=(y*lod.width+x)*4+3;
        rgba[i]=rgba[i]/255>=(rank[y%4*4+x%4]+.5)/16?255:0;
      }
      return {width:lod.width,height:lod.height,pixels:rgba,tint:0xffffff};
    }

    const assets=new Map();
    function mesh(tier){
      need(tiers.includes(tier),'a mesh needs a concrete tier');
      if(assets.has(tier))return assets.get(tier);
      const activeGeometry=tier==='geometry';
      const grid=tier==='painted'&&texelPaint?texelPaint:activeGeometry&&geometrySource?geometrySource:TexturedSurface.grid({
        segments:activeGeometry?meshSteps:[1,1],flip:true,point:(u,v)=>at(u,v,activeGeometry?heightAt(u,v):0)
      });
      const material={id:materialId,color,texture:{width,height,pixels:pigment},alphaCutoff:.5};
      if(tier==='painted'){
        const {width,height,pixels,tint=color}=texelPaint??paint();
        material.color=tint;
        material.texture={width,height,pixels};
      } else {
        material.roughness=roughness;
        material.mipmaps=settings;
        if(tier==='normal')material.normal=suppliedNormals??mappedNormals();
      }
      const out=Meshes.create({id,objectId,partId,positions:grid.points??grid.positions,uvs:grid.uvs,
        indices:grid.triangles??grid.indices,materials:[material]});
      const layer=Meshes.layer(out);
      if(tier!=='painted') layer.semanticMipmaps=layer.semanticMipmaps.map(row=>({...row,liveLight:true}));
      layer.surfaceMotionKey=JSON.stringify(['relief',id,tier]);
      assets.set(tier,out);
      return out;
    }

    function inspect(view,override){
      override=mode(override);
      const projected=preview.project(bounds,view,basis);
      const rows={id,objectId,partId,revision:asset.revision,projected};
      if(override===false||!projected.visible)
        return {...rows,tier:null,reason:override===false?'disabled':'visibility',featurePixels:0,profilePixels:0};
      const {view:m,ortho,focal,near=.4}=view;
      const screen=([x,y,z])=>{
        const p=[0,1,2].map(i=>m[i]*x+m[i+4]*y+m[i+8]*z+m[i+12]);
        const scale=focal/(ortho?1:Math.max(near,-p[2]));
        return [p[0]*scale,p[1]*scale];
      };
      // At grazing angles the surface chart can be subpixel while its
      // displaced edge remains large enough to change the profile.
      const [a,b]=profile.map(screen), profilePixels=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const featurePixels=feature*projected.pixelsPerWorld;
      const {eye,back}=CameraLens.fromView(m);
      const observer=V.mad(eye,back,-(view.setback??0));
      const [x,y]=screen(center);
      const camera={width:view.width,height:view.height,ortho:Boolean(ortho),distance:V.dist(observer,center),
        yaw:Math.atan2(V.dot(back,tangent),V.dot(back,normal)),pitch:Math.asin(clamp(V.dot(back,vertical),-1,1)),
        projectedHeight:projected.height,screenX:view.width*.5+x,screenY:view.height*.5-y};
      const forced=tiers.includes(override);
      const tier=forced?override:Math.max(featurePixels,profilePixels)>=geometryPixels?'geometry':
        featurePixels>=normalPixels?'normal':'painted';
      return {...rows,tier,reason:forced?'override':'screen-size',featurePixels,profilePixels,camera};
    }

    function select(view,override,protection,approval){
      const report=inspect(view,override);
      const choice=report.reason==='screen-size'&&approval?.choose(asset,report.camera);
      if(choice)Object.assign(report,{tier:choice.tier,reason:'approved-range',approvedRange:choice.range.id});
      const features=report.tier && protection?.features(objectId,partId,'relief-'+report.tier);
      if(features)Object.assign(report,{requestedTier:report.tier,tier:'geometry',reason:'protected-feature',features});
      const selected=report.tier?mesh(report.tier):null;
      const layer=selected&&Meshes.layer(selected);
      return {asset:selected,report:{...report,triangles:selected?.triangles??0,normalTexels:layer?.normalPixels?
        layer.width*layer.height:0,materialTexels:layer?layer.width*layer.height:0,
        ...(report.tier==='painted'&&{paintSource:texelPaint?'object-texels':'uv-texels'})}};
    }
    const plan=Object.freeze({id,asset,inspect,select,mesh});
    programs.add(plan);
    return plan;
  }

  function frame(world,settings,view,report){
    if(world.reliefLOD===undefined||settings.meshes===false)return [];
    const plans=world.reliefLOD;
    need(Array.isArray(plans)&&plans.length<=16&&Array.from(plans).every(plan=>programs.has(plan))&&
      new Set(plans.map(plan=>plan.id)).size===plans.length,'attach up to 16 distinct relief plans');
    const override=mode(settings.reliefLOD??world.look?.reliefLOD);
    const protection=ProtectedLOD.active(world,settings.protectedLOD);
    const approval=approvals.prepare(settings.reliefApproval??world.reliefApproval);
    const entries=plans.map(plan=>plan.select(view,override,protection,approval));
    report?.(entries.map(entry=>entry.report));
    return entries.flatMap(entry=>entry.asset?[entry.asset]:[]);
  }
  K.procedural.lod.relief=Object.freeze({create,frame});
})(KIT);
