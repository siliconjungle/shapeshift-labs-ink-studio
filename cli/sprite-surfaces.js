// Rasterize opaque, cutout atlas triangles into the existing scene compositor.
const SpriteSurface = require('../src/sprite-surface.js');
const Mips = require('../src/semantic-texture-mipmaps.js');
const Simulation = require('../src/simulation-material-layers.js');
const uvSlip=Symbol.for('ink-studio.spriteSurface.uvSlip');
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub = (a, b) => a.map((n, i) => n-b[i]);
const unit = a => { const length=Math.hypot(...a); return a.map(n => n/(length || 1)); };

function textureAxes([a, b, c], transform) {
  const du = sub(b.uv, a.uv), dv = sub(c.uv, a.uv);
  const det = du[0]*dv[1]-du[1]*dv[0];
  if (!transform[0] || !transform[1] || Math.abs(det) <= 1e-5*Math.hypot(...du)*Math.hypot(...dv)) return null;
  const u = sub(b.p, a.p), v = sub(c.p, a.p);
  const right = unit(u.map((n, i) => (n*dv[1]-v[i]*du[1])*Math.sign(det*transform[0])));
  const up = u.map((n, i) => (n*dv[0]-v[i]*du[0])*Math.sign(det*transform[1]));
  return { right, up };
}

function rasterize(atlas,{V,W,H,focal,ortho,near,far=Infinity,clip,paletteSampling,surfaceNormals=true,semanticMipmaps=true,simulationLayers,artScale=1,capture=false,motion=false,depthOnly=false,meshMask,spriteLOD,omit,lightingTargets,captureFogOwners}) {
  if(!atlas)return [];
  const depth=depthOnly && new Float32Array(W*H).fill(Infinity);
  const fragments=depthOnly ? null : new Array(W*H),eye=[0,1,2].map(k=>-(V[k*4]*V[12]+V[k*4+1]*V[13]+V[k*4+2]*V[14]));
  function transform(v, step, weights) {
    let x=V[0]*v[0]+V[4]*v[1]+V[8]*v[2]+V[12], y=V[1]*v[0]+V[5]*v[1]+V[9]*v[2]+V[13];
    const z=-(V[2]*v[0]+V[6]*v[1]+V[10]*v[2]+V[14]), w=ortho?1:z;
    if (step && w > 0) {
      const scale=focal/w;
      x=(Math.floor((W*.5+x*scale)/step+.5)*step-W*.5)/scale;
      y=(H*.5-Math.floor((H*.5-y*scale)/step+.5)*step)/scale;
    }
    return {p:v.slice(0,3),uv:v.slice(3),x,y,z,weights};
  }
  function interpolate(a,b,t,affine) {
    const lerp=(x,y)=>x+(y-x)*t;
    // UV times clip W interpolates linearly across a clipped edge on the GPU.
    const uv=a.uv.map((n,k)=>affine&&!ortho?lerp(n*a.z,b.uv[k]*b.z)/near:lerp(n,b.uv[k]));
    return {p:a.p.map((n,k)=>lerp(n,b.p[k])),uv,x:lerp(a.x,b.x),y:lerp(a.y,b.y),z:near,
      weights:a.weights?.map((n,k)=>lerp(n,b.weights[k]))};
  }
  const project=v=>({ ...v,sx:W*.5+v.x*focal/(ortho?1:v.z),sy:H*.5+v.y*focal/(ortho?1:v.z) });
  const edge=(a,b,x,y)=>(b.sx-a.sx)*(y-a.sy)-(b.sy-a.sy)*(x-a.sx);
  const identity = [[1,0,0],[0,1,0],[0,0,1]];
  for (const [slot,layer] of (Array.isArray(atlas) ? atlas : [atlas]).entries()) {
    if (!layer) continue;
    const code=meshMask?.get(layer.sceneMeshId);
    if (code && spriteLOD.hidden(code)) continue;
    const {vertices,pixels,normalPixels,width,height}=layer;
    if(!(vertices instanceof Float32Array)||vertices.length%15||!Number.isSafeInteger(width)||width<1||
      !Number.isSafeInteger(height)||height<1||!(pixels instanceof Uint8Array)||pixels.length!==width*height*4||
      (normalPixels!==undefined&&(!(normalPixels instanceof Uint8Array)||normalPixels.length!==pixels.length))||
      !vertices.every(Number.isFinite))throw new RangeError('Invalid sprite surface atlas');
    const plan=depthOnly ? null : layer[uvSlip];
    const ranges=plan?.vertices===vertices&&plan.width===width&&plan.height===height ? plan.ranges : [];
    const filtered = depthOnly || paletteSampling === false ? null : SpriteSurface.samplingPlan(layer);
    const projections = depthOnly ? [] : SpriteSurface.projectionPlan(layer);
    const omitLayer=omit && layer.brickField;
    const lightingMesh=lightingTargets && layer.sceneMeshId;
    const sampleCharts=capture || omitLayer || simulationLayers?.size;
    const charts=(sampleCharts || lightingMesh || captureFogOwners) && layer.surfaceCharts;
    const semantic=depthOnly ? [] : layer.semanticMipmaps??[];
    let rangeIndex=0, filterIndex=0, projectionIndex=0, chartIndex=0, semanticIndex=0;
    for(let offset=0;offset<vertices.length;offset+=15){
      const first=offset/5;
      while(ranges[rangeIndex]?.end<=first)rangeIndex++;
      const range=ranges[rangeIndex];
      const shifted=range&&range.first<=first;
      while(filtered?.[filterIndex]?.end<=first)filterIndex++;
      const filter = filtered?.[filterIndex]?.filter;
      while(semantic[semanticIndex]?.end<=first)semanticIndex++;
      const mip=semantic[semanticIndex]?.first<=first ? semantic[semanticIndex] : null;
      const driven=mip?.simulation && simulationLayers?.get(mip.simulation);
      while(projections[projectionIndex]?.end<=first)projectionIndex++;
      const style = projections[projectionIndex]?.first <= first ? projections[projectionIndex] : undefined;
      const affine = style?.affine, linearUV = affine || ortho, step = (style?.vertexSnap ?? 0) * artScale;
      while(charts?.[chartIndex]?.end<=first)chartIndex++;
      const chart=charts?.[chartIndex]?.first<=first ? charts[chartIndex] : null;
      const fogObject=captureFogOwners ? chart?.objectId : undefined;
      const lightingTarget=lightingMesh && chart && {
        object:chart.objectId,entity:chart.objectId,material:chart.materialId,part:chart.partId
      };
      const input=identity.map((weights,i)=>transform(Array.from(vertices.subarray(offset+i*5,offset+i*5+5)),step,
        motion || chart && sampleCharts ? weights : undefined));
      const mesh=capture && {object:chart?.objectId,material:chart?.materialId,part:chart?.partId,
        ...(motion && {key:JSON.stringify(['mesh',layer.surfaceMotionKey ?? layer.sceneMeshId ?? slot,chart?.id ?? chart?.first ?? 0,
          chart?.objectId ?? null,chart?.materialId ?? null,(chart?.end ?? vertices.length/5)-(chart?.first ?? 0),
          driven?.amounts??null]),
          triangle:(first-(chart?.first ?? 0))/3,points:input.map(v=>v.p),step})};
      const uvTransform = shifted ? range.transform : [1,1,0,0];
      const axes = !depthOnly && surfaceNormals && (normalPixels || mip?.chain.normal) && textureAxes(input, uvTransform);
      const polygon=[];
      for(let i=0;i<3;i++){
        const a=input[i],b=input[(i+1)%3];
        if(a.z>=near)polygon.push(a);
        if((a.z>=near)!==(b.z>=near))polygon.push(interpolate(a,b,(near-a.z)/(b.z-a.z),affine));
      }
      for(let tri=1;tri+1<polygon.length;tri++){
        const [a,b,c]=[polygon[0],polygon[tri],polygon[tri+1]].map(project),area=edge(a,b,c.sx,c.sy);
        if(Math.abs(area)<1e-10)continue;
        const loX=Math.max(0,Math.ceil(Math.min(a.sx,b.sx,c.sx)-.5)),hiX=Math.min(W-1,Math.floor(Math.max(a.sx,b.sx,c.sx)-.5));
        const loY=Math.max(0,Math.ceil(Math.min(a.sy,b.sy,c.sy)-.5)),hiY=Math.min(H-1,Math.floor(Math.max(a.sy,b.sy,c.sy)-.5));
        const face=(!depthOnly||layer.frontOnly) && cross(sub(b.p,a.p),sub(c.p,a.p));
        if (layer.frontOnly && dot(face,ortho ? [V[2],V[6],V[10]] : sub(eye,a.p))<=0) continue;
        const normal=!depthOnly && unit(face);
        if(normal && dot(normal,sub(eye,a.p))<0)for(let k=0;k<3;k++)normal[k]=-normal[k];
        const bitangent = axes && cross(normal, axes.right);
        if (bitangent && dot(bitangent, axes.up)<0) for(let k=0;k<3;k++)bitangent[k]=-bitangent[k];
        const row=[a,b,c], transform=uvTransform;
        const bounds = shifted ? range.bounds : filter ? [filter.rect.x,filter.rect.y,
          filter.rect.x + filter.rect.width - 1,filter.rect.y + filter.rect.height - 1] : style?.bounds ?? [0,0,width-1,height-1];
        let gradients, worldWeights, restTriangle, maskTriangle;
        if(driven?.active){
          const firstCorner=(first-chart.first)*2, region=chart.region;
          const original=input.map((corner,i)=>chart.uv ? chart.uv.subarray(firstCorner+i*2,firstCorner+i*2+2) :
            [(corner.uv[0]-region.x-.5)/Math.max(1,region.width-1),
              (corner.uv[1]-region.y-.5)/Math.max(1,region.height-1)]);
          maskTriangle=row.map(v=>[0,1].map(k=>v.weights.reduce((n,w,i)=>n+w*original[i][k],0)));
        }
        if (filter || mip) {
          const edges=[[b.sy-c.sy,c.sy-a.sy,a.sy-b.sy],[c.sx-b.sx,a.sx-c.sx,b.sx-a.sx]];
          gradients=edges.map(edge=>{
            const dw=edge.map((n,k)=>n*artScale/(area*(linearUV?1:row[k].z)));
            return [dw.reduce((n,v,k)=>n+v*row[k].uv[0],0),dw.reduce((n,v,k)=>n+v*row[k].uv[1],0),
              linearUV?0:dw[0]+dw[1]+dw[2]];
          });
          if(driven?.relief&&surfaceNormals){
            worldWeights=edges.map(edge=>edge.map((n,k)=>n/(area*(ortho?1:row[k].z))));
            const at=first-chart.first;
            restTriangle=row.map(v=>[0,1,2].map(k=>v.weights.reduce((n,w,i)=>n+w*chart.rest[(at+i)*3+k],0)));
          }
        }
        for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
          if (code && !spriteLOD.geometry(code,x,y)) continue;
          const weights=[edge(b,c,x+.5,y+.5)/area,edge(c,a,x+.5,y+.5)/area,edge(a,b,x+.5,y+.5)/area];
          if(weights.some(n=>n < -1e-7))continue;
          const w=weights.map((n,k)=>ortho?n:n/row[k].z),sum=w[0]+w[1]+w[2];
          const z=ortho?weights.reduce((s,n,k)=>s+n*row[k].z,0):1/sum,p=y*W+x;
          if ((layer.sceneMeshId || layer.frontOnly || depthOnly) && z>far) continue;
          if (depthOnly) {
            if (z<depth[p] && (!clip || clip([0,1,2].map(k=>row.reduce((s,n,i)=>s+n.p[k]*w[i]/sum,0)))))
              depth[p]=z;
            continue;
          }
          if (fragments[p] && z>=fragments[p].z) continue;
          const uvWeights = linearUV ? weights : w, uvSum = linearUV ? 1 : sum;
          const sample=k=>row.reduce((s,n,i)=>s+n.uv[k]*uvWeights[i]/uvSum,0);
          const s=sample(0),t=sample(1);
          const S = s * transform[0] + transform[2], T = t * transform[1] + transform[3];
          const tx = Math.max(bounds[0], Math.min(bounds[2], Math.floor(S)));
          const ty = Math.max(bounds[1], Math.min(bounds[3], Math.floor(T)));
          const texel = (ty * width + tx) * 4;
          let ink, material;
          if (filter || mip) {
            const [[dxU, dxV, dxZ], [dyU, dyV, dyZ]] = gradients;
            const dx=[transform[0]*(dxU-s*dxZ)/uvSum,transform[1]*(dxV-t*dxZ)/uvSum],
              dy=[transform[0]*(dyU-s*dyZ)/uvSum,transform[1]*(dyV-t*dyZ)/uvSum];
            if(mip){
              const {region,chain}=mip;
              const span=semanticMipmaps===false?1:Math.max(Math.hypot(...dx),Math.hypot(...dy));
              const scale=[Math.max(1,region.width-1),Math.max(1,region.height-1)];
              material=Mips.sample(chain,(S-region.x-.5)/scale[0],(T-region.y-.5)/scale[1],span);
              if(!material.visible)continue;
            } else {
              ink=filter.sample(S,T,...dx,...dy);
              if(ink===null)continue;
            }
          }
          if (ink === undefined && !material) {
            if (pixels[texel+3] < 128) continue;
            ink = (pixels[texel] << 16) | (pixels[texel + 1] << 8) | pixels[texel + 2];
          }
          const position=[0,1,2].map(k=>row.reduce((s,n,i)=>s+n.p[k]*w[i]/sum,0));
          if(clip&&!clip(position) || omitLayer && omit(omitLayer,chart?.materialId,position))continue;
          let mapped;
          if (bitangent && (material || normalPixels?.[texel+3]>=128)) {
            const local = material?.normal ?? [0,1,2].map(k => Math.max(-127, normalPixels[texel+k]-128));
            if (local.some(Boolean)) mapped = unit(normal.map((n,k) =>
              local[0]*axes.right[k]+local[1]*bitangent[k]+local[2]*n));
          }
          const weights3=(motion || chart && sampleCharts) && identity.map((_,k)=>row.reduce((s,v,i)=>s+v.weights[k]*w[i]/sum,0));
          const at=chart && first-chart.first;
          const value=(data,components,k)=>weights3.reduce((s,n,i)=>s+n*data[(at+i)*components+k],0);
          let uv;
          if (chart && sampleCharts) {
            const {x,y,width:w,height:h}=chart.region;
            uv=chart.uv ? [value(chart.uv,2,0),value(chart.uv,2,1)] :
              [0,1].map(k=>(weights3.reduce((s,n,i)=>s+n*input[i].uv[k],0)-(k?y:x)-.5)/((k?h:w)-1));
            uv=uv.map(n=>Math.max(0,Math.min(1,n)));
          }
          const objectPosition=chart?.rest && weights3 ? [0,1,2].map(k=>value(chart.rest,3,k)) : position;
          if(driven?.active){
            const maskUV=[0,1].map(k=>w.reduce((total,n,i)=>total+n*maskTriangle[i][k],0)/sum);
            const state=Simulation.apply(mip.simulation,driven,maskUV,objectPosition,{
              color:material.color,roughness:material.roughness,sheen:mip.chain.rule.specular
            });
            material.color=state.color;
            material.roughness=state.roughness;
            material.sheen=state.sheen;
            if(worldWeights){
              const derivative=(positions,center,weights)=>center.map((v,k)=>
                weights.reduce((total,w,i)=>total+w*(positions[i][k]-v),0)/sum);
              const [dx,dy]=worldWeights.map(dw=>derivative(row.map(v=>v.p),position,dw));
              const perps=[cross(dy,normal),cross(normal,dx)], determinant=dot(dx,perps[0]);
              if(Math.abs(determinant)>1e-12){
                const slopes=worldWeights.map(dw=>Simulation.slope(mip.simulation,driven,maskUV,objectPosition,
                  derivative(maskTriangle,maskUV,dw),derivative(restTriangle,objectPosition,dw)));
                mapped=unit((mapped??normal).map((n,k)=>n-(perps[0][k]*slopes[0]+perps[1][k]*slopes[1])/determinant));
              }
            }
          }
          fragments[p]={p,z,alpha:1,color:material?.color ?? [ink >>> 16, (ink >>> 8) & 255, ink & 255].map(n=>n/255),position,
            ...(material && {semantic:material,semanticRule:mip.chain.rule,
              semanticView:ortho ? [V[2],V[6],V[10]] : unit(sub(eye,position))}),
            normal:mapped??normal,...(mapped&&{biasNormal:normal}),objectPosition,surface:true,
            ...(lightingTarget&&{lightingTarget}),
            ...(fogObject!==undefined&&{fogObject}),
            ...(mesh && {mesh,...(motion&&{weights:weights3}),...(uv&&{uv})})};
        }
      }
    }
  }
  return depthOnly ? depth : fragments.filter(Boolean);
}
function labels(atlas,bricks=[]) {
  const objects=new Set(), materials=new Set(), parts=new Map();
  for (const layer of Array.isArray(atlas) ? atlas : [atlas]) for (const chart of layer?.surfaceCharts ?? []) {
    if (chart.objectId!==undefined) objects.add(chart.objectId);
    if (chart.materialId!==undefined) materials.add(chart.materialId);
    if (chart.objectId!==undefined && chart.partId!==undefined)
      parts.set(JSON.stringify([chart.objectId,chart.partId]),{object:chart.objectId,part:chart.partId});
  }
  for (const row of bricks) {
    objects.add(row.objectId);
    for (const material of row.materials) materials.add(material);
  }
  return {objects:[...objects].sort(),materials:[...materials].sort(),parts:[...parts.values()]};
}

module.exports={rasterize,labels};
