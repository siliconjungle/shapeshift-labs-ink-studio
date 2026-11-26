// Rasterize opaque, cutout and translucent atlas triangles into the existing scene compositor.
const SpriteSurface = require('../src/sprite-surface.js');
const Mips = require('../src/semantic-texture-mipmaps.js');
const Simulation = require('../src/simulation-material-layers.js');
const uvSlip=Symbol.for('ink-studio.spriteSurface.uvSlip');
const clampTint = n=>Math.max(0,Math.min(1,n));
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

function triangleAxes([a,b,c]) {
  const right=unit(sub(b,a)), normal=unit(cross(right,sub(c,a)));
  return [right,cross(normal,right),normal];
}

function sampleRgba(pixels,stride,bounds,x,y,linear,opaque) {
  const texel = (u,v) => 4*(Math.max(bounds[1],Math.min(bounds[3],v))*stride + Math.max(bounds[0],Math.min(bounds[2],u)));
  if (!linear) {
    const at=texel(Math.floor(x),Math.floor(y));
    return [pixels[at]/255,pixels[at+1]/255,pixels[at+2]/255,opaque ? 1 : pixels[at+3]/255];
  }
  const u=Math.floor(x-.5), v=Math.floor(y-.5), fu=x-.5-u, fv=y-.5-v;
  const result=[0,0,0,0];
  for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
    const at=texel(u+i,v+j), weight=(i ? fu : 1-fu)*(j ? fv : 1-fv);
    const a=opaque ? weight : weight*pixels[at+3]/255;
    for (let k=0;k<3;k++) result[k]+=pixels[at+k]/255*a;
    result[3]+=a;
  }
  if (result[3]>0) for (let k=0;k<3;k++) result[k]/=result[3];
  return result;
}

function rasterize(atlas,{V,W,H,focal,ortho,near,far=Infinity,clip,paletteSampling,surfaceNormals=true,semanticMipmaps=true,simulationLayers,artScale=1,capture=false,motion=false,sourceBinding=false,captureRestNormal=false,trackMesh,allow,depthOnly=false,meshMask,spriteLOD,omit,lightingTargets,captureFogOwners,multiprojection,pbr,paintIndex,captureMeshTint}) {
  if(!atlas)return [];
  const depth=depthOnly && new Float32Array(W*H).fill(Infinity);
  const blended=[];
  const fragments=depthOnly ? null : new Array(W*H),eye=[0,1,2].map(k=>-(V[k*4]*V[12]+V[k*4+1]*V[13]+V[k*4+2]*V[14]));
  function transform(v, step, weights, local) {
    let x=V[0]*v[0]+V[4]*v[1]+V[8]*v[2]+V[12], y=V[1]*v[0]+V[5]*v[1]+V[9]*v[2]+V[13];
    const z=-(V[2]*v[0]+V[6]*v[1]+V[10]*v[2]+V[14]);
    let w=ortho?1:z;
    if (local) ({x,y,w}=local(v[0],v[1],v[2]));
    if (step && w > 0) {
      const scale=focal/w;
      x=(Math.floor((W*.5+x*scale)/step+.5)*step-W*.5)/scale;
      y=(H*.5-Math.floor((H*.5-y*scale)/step+.5)*step)/scale;
    }
    return {p:v.slice(0,3),uv:v.slice(3),x,y,z,w,weights};
  }
  function interpolate(a,b,t,affine,local) {
    const lerp=(x,y)=>x+(y-x)*t;
    // UV times clip W interpolates linearly across a clipped edge on the GPU.
    const w=local ? lerp(a.w,b.w) : ortho ? 1 : near;
    const uv=a.uv.map((n,k)=>affine&&!ortho?lerp(n*a.w,b.uv[k]*b.w)/w:lerp(n,b.uv[k]));
    return {p:a.p.map((n,k)=>lerp(n,b.p[k])),uv,x:lerp(a.x,b.x),y:lerp(a.y,b.y),z:near,w,
      weights:a.weights?.map((n,k)=>lerp(n,b.weights[k]))};
  }
  const project=v=>({ ...v,sx:W*.5+v.x*focal/v.w,sy:H*.5+v.y*focal/v.w });
  const edge=(a,b,x,y)=>(b.sx-a.sx)*(y-a.sy)-(b.sy-a.sy)*(x-a.sx);
  const identity = [[1,0,0],[0,1,0],[0,0,1]];
  for (const [slot,layer] of (Array.isArray(atlas) ? atlas : [atlas]).entries()) {
    if (!layer) continue;
    const code=meshMask?.get(layer.sceneMeshId);
    if (code && spriteLOD.hidden(code)) continue;
    const {vertices,pixels,normalPixels,cornerNormals,cornerTints,tintBlend,width,height}=layer;
    const tintStride = tintBlend===undefined ? 3 : 4;
    if(!(vertices instanceof Float32Array)||vertices.length%15||!Number.isSafeInteger(width)||width<1||
      !Number.isSafeInteger(height)||height<1||!(pixels instanceof Uint8Array)||pixels.length!==width*height*4||
      (normalPixels!==undefined&&(!(normalPixels instanceof Uint8Array)||normalPixels.length!==pixels.length))||
      (cornerNormals!==undefined&&(!(cornerNormals instanceof Float32Array)||cornerNormals.length!==vertices.length/5*3))||
      (cornerTints!==undefined&&(!(cornerTints instanceof Float32Array)||cornerTints.length!==vertices.length/5*tintStride))||
      !vertices.every(Number.isFinite))throw new RangeError('Invalid sprite surface atlas');
    const plan=depthOnly ? null : layer[uvSlip];
    const ranges=plan?.vertices===vertices&&plan.width===width&&plan.height===height ? plan.ranges : [];
    const filtered = depthOnly || paletteSampling === false ? null : SpriteSurface.samplingPlan(layer);
    const projections = depthOnly ? [] : SpriteSurface.projectionPlan(layer);
    const omitLayer=omit && layer.brickField;
    const lightingMesh=lightingTargets && layer.sceneMeshId;
    const sampleCharts=capture || omitLayer || simulationLayers?.size;
    const semantic=depthOnly ? [] : layer.semanticMipmaps??[];
    const charts=(allow || sampleCharts || lightingMesh || captureFogOwners || multiprojection || pbr ||
      semantic.some(row=>row.objectTexels)) && layer.surfaceCharts;
    const materials=layer.tilesetMaterials;
    let rangeIndex=0, filterIndex=0, projectionIndex=0, chartIndex=0, semanticIndex=0, materialIndex=0;
    for(let offset=0;offset<vertices.length;offset+=15){
      const first=offset/5;
      while(materials?.[materialIndex]?.end<=first)materialIndex++;
      const entry=materials?.[materialIndex]?.first<=first ? materials[materialIndex] : null;
      const settings=entry?.settings, frontOnly=layer.frontOnly || settings?.sidedness==='front';
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
      const affine = style?.affine, linearUV = affine || ortho;
      while(charts?.[chartIndex]?.end<=first)chartIndex++;
      const chart=charts?.[chartIndex]?.first<=first ? charts[chartIndex] : null;
      const pbrMaterial = pbr?.surface(chart);
      const pbrReceives = pbrMaterial && pbr.shadows?.receivesSurface(chart);
      if (allow && !allow({object:chart?.objectId,part:chart?.partId})) continue;
      const local=multiprojection?.project(layer,chart);
      const step=local ? 0 : (style?.vertexSnap ?? 0)*artScale;
      const fogObject=captureFogOwners ? chart?.objectId : undefined;
      const lightingTarget=lightingMesh && chart && {
        object:chart.objectId,entity:chart.objectId,material:chart.materialId,part:chart.partId
      };
      const authored = !depthOnly && surfaceNormals && cornerNormals?.subarray(first * 3, first * 3 + 9);
      const cornerColor = !depthOnly && cornerTints?.subarray(first*tintStride,(first+3)*tintStride);
      const tint = cornerColor && (tintBlend || cornerColor.some(value=>value!==1)) ? cornerColor : null;
      const trackWeights=authored || tint || sourceBinding || motion || chart && (sampleCharts || pbr?.materials[pbrMaterial-1]?.readBand);
      const input=identity.map((weights,i)=>transform(Array.from(vertices.subarray(offset+i*5,offset+i*5+5)),step,
        trackWeights ? weights : undefined,local));
      const mesh=capture && {object:chart?.objectId,material:chart?.materialId,part:chart?.partId,
        ...(motion && {key:JSON.stringify(['mesh',layer.surfaceMotionKey ?? layer.sceneMeshId ?? slot,chart?.id ?? chart?.first ?? 0,
          chart?.objectId ?? null,chart?.materialId ?? null,(chart?.end ?? vertices.length/5)-(chart?.first ?? 0),
          driven?.amounts??null]),
          triangle:(first-(chart?.first ?? 0))/3,points:input.map(v=>v.p),step, ...(local && {localProjection:local})})};
      const source = sourceBinding && {
        key:JSON.stringify([slot,chart?.first ?? 0]),
        identity:{ kind:'mesh',asset:layer.sceneMeshId ?? layer.surfaceMotionKey ?? null,
          chart:chart?.id ?? null,stageSlot:slot,primitive:chart?.first ?? 0,object:chart?.objectId,part:chart?.partId },
        triangle:(first-(chart?.first ?? 0))/3,
        face:layer.featureFaces?.[first/3]
      };
      const rest = source && chart?.rest?.subarray(source.triangle*9,source.triangle*9+9);
      if (source) {
        const at = source.triangle*6, uv = chart?.uv?.subarray(at,at+6);
        source.topology = JSON.stringify([rest ? Array.from(rest) : input.flatMap(v=>v.p),
          uv ? Array.from(uv) : input.flatMap(v=>v.uv)]);
      }
      const restNormal = captureRestNormal && rest && triangleAxes([0,3,6].map(i=>Array.from(rest.subarray(i,i+3))))[2];
      if (trackMesh && source?.identity.object) {
        const signature = JSON.stringify([(chart?.end ?? vertices.length/5)-(chart?.first ?? 0),
          input.map(row=>row.uv),rest ? Array.from(rest) : null]);
        trackMesh(source.identity,source.triangle,{ signature,project(weights) {
          const component = key=>input.reduce((total,row,i)=>total+row[key]*weights[i],0);
          const z = component('z'), w = component('w');
          return w > 0 && z >= near && z <= far ?
            [W/2+focal*component('x')/w,H/2-focal*component('y')/w,z] : null;
        } });
      }
      const uvTransform = shifted ? range.transform : [1,1,0,0];
      const axes = !depthOnly && surfaceNormals && !mip?.objectTexels &&
        (normalPixels || mip?.chain.normal || pbrMaterial) && textureAxes(input, uvTransform);
      let restAxes, posedAxes;
      if (mip?.objectTexels && surfaceNormals) {
        const at=(first-chart.first)*3;
        restAxes=triangleAxes(identity.map((_,i)=>Array.from(chart.rest.subarray(at+i*3,at+i*3+3))));
        posedAxes=triangleAxes(input.map(row=>row.p));
      }
      const polygon=[];
      for(let i=0;i<3;i++){
        const a=input[i],b=input[(i+1)%3];
        if(a.z>=near)polygon.push(a);
        if((a.z>=near)!==(b.z>=near))polygon.push(interpolate(a,b,(near-a.z)/(b.z-a.z),affine,local));
      }
      for(let tri=1;tri+1<polygon.length;tri++){
        const [a,b,c]=[polygon[0],polygon[tri],polygon[tri+1]].map(project),area=edge(a,b,c.sx,c.sy);
        if(Math.abs(area)<1e-10)continue;
        const loX=Math.max(0,Math.ceil(Math.min(a.sx,b.sx,c.sx)-.5)),hiX=Math.min(W-1,Math.floor(Math.max(a.sx,b.sx,c.sx)-.5));
        const loY=Math.max(0,Math.ceil(Math.min(a.sy,b.sy,c.sy)-.5)),hiY=Math.min(H-1,Math.floor(Math.max(a.sy,b.sy,c.sy)-.5));
        const face=(!depthOnly||frontOnly) && cross(sub(b.p,a.p),sub(c.p,a.p));
        if (frontOnly && (local ? area : dot(face,ortho ? [V[2],V[6],V[10]] : sub(eye,a.p)))<=0) continue;
        const normal=!depthOnly && unit(face);
        const facing=(settings || mip?.objectTexels) && ortho ? [V[2],V[6],V[10]] : sub(eye,a.p);
        if(normal && dot(normal,facing)<0)for(let k=0;k<3;k++)normal[k]=-normal[k];
        const bitangent = axes && cross(normal, axes.right);
        if (bitangent && dot(bitangent, axes.up)<0) for(let k=0;k<3;k++)bitangent[k]=-bitangent[k];
        const row=[a,b,c], transform=uvTransform;
        const region=entry?.region;
        const bounds = shifted ? range.bounds : region ? [region.x,region.y,region.x+region.width-1,region.y+region.height-1] : filter ? [filter.rect.x,filter.rect.y,
          filter.rect.x + filter.rect.width - 1,filter.rect.y + filter.rect.height - 1] : style?.bounds ?? [0,0,width-1,height-1];
        let gradients, worldWeights, restTriangle, maskTriangle;
        if(driven?.active){
          const firstCorner=(first-chart.first)*2, region=chart.region;
          const original=input.map((corner,i)=>chart.uv ? chart.uv.subarray(firstCorner+i*2,firstCorner+i*2+2) :
            [(corner.uv[0]-region.x-.5)/Math.max(1,region.width-1),
              (corner.uv[1]-region.y-.5)/Math.max(1,region.height-1)]);
          maskTriangle=row.map(v=>[0,1].map(k=>v.weights.reduce((n,w,i)=>n+w*original[i][k],0)));
        }
        if (filter || mip || entry) {
          const edges=[[b.sy-c.sy,c.sy-a.sy,a.sy-b.sy],[c.sx-b.sx,a.sx-c.sx,b.sx-a.sx]];
          gradients=edges.map(edge=>{
            const dw=edge.map((n,k)=>n*artScale/(area*(linearUV?1:row[k].w)));
            return [dw.reduce((n,v,k)=>n+v*row[k].uv[0],0),dw.reduce((n,v,k)=>n+v*row[k].uv[1],0),
              linearUV?0:dw[0]+dw[1]+dw[2]];
          });
          if(driven?.relief&&surfaceNormals){
            worldWeights=edges.map(edge=>edge.map((n,k)=>n/(area*(ortho?1:row[k].w))));
            const at=first-chart.first;
            restTriangle=row.map(v=>[0,1,2].map(k=>v.weights.reduce((n,w,i)=>n+w*chart.rest[(at+i)*3+k],0)));
          }
        }
        const blend=settings?.alphaMode==='blend';
        const sharedEdges=blend && [[b,c],[c,a],[a,b]].map(([u,v])=>area<0 ?
          v.sy<u.sy || v.sy===u.sy && v.sx>u.sx :
          u.sy<v.sy || u.sy===v.sy && u.sx>v.sx);
        for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
          if (code && !spriteLOD.geometry(code,x,y)) continue;
          const weights=[edge(b,c,x+.5,y+.5)/area,edge(c,a,x+.5,y+.5)/area,edge(a,b,x+.5,y+.5)/area];
          if(weights.some((n,i)=>n < -1e-7 || blend && Math.abs(n)<=1e-7 && !sharedEdges[i]))continue;
          const w=weights.map((n,k)=>ortho?n:n/row[k].w),sum=w[0]+w[1]+w[2];
          const z=local ? w.reduce((s,n,k)=>s+n*row[k].z,0)/sum :
            ortho ? weights.reduce((s,n,k)=>s+n*row[k].z,0) : 1/sum;
          const p=y*W+x;
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
          let ink, material, filteredPaint, rgba, alpha=1, linear;
          if (filter || mip || entry) {
            const [[dxU, dxV, dxZ], [dyU, dyV, dyZ]] = gradients;
            const dx=[transform[0]*(dxU-s*dxZ)/uvSum,transform[1]*(dxV-t*dxZ)/uvSum],
              dy=[transform[0]*(dyU-s*dyZ)/uvSum,transform[1]*(dyV-t*dyZ)/uvSum];
            if (entry) {
              const span=Math.max(Math.hypot(...dx),Math.hypot(...dy));
              linear=(span>1 ? settings.minFilter : settings.magFilter)==='linear';
              rgba=sampleRgba(pixels,width,bounds,S,T,linear,settings.alphaMode==='opaque');
              if (blend) {
                alpha=rgba[3];
                if (alpha<=0) continue;
              } else if (settings.alphaMode==='mask' && rgba[3]+1e-9<settings.alphaCutoff) continue;
            }
            if(mip){
              const {region,chain}=mip;
              const span=semanticMipmaps===false?1:Math.max(Math.hypot(...dx),Math.hypot(...dy));
              const scale=[Math.max(1,region.width-1),Math.max(1,region.height-1)];
              material=Mips.sample(chain,(S-region.x-.5)/scale[0],(T-region.y-.5)/scale[1],span);
              if(!entry && !material.visible)continue;
            } else if (filter && !entry) {
              ink=filter.sample(S,T,...dx,...dy);
              if(ink===null)continue;
              filteredPaint=ink!==undefined;
            }
          }
          if (!rgba && ink === undefined && !material) {
            if (pixels[texel+3] < 128) continue;
            ink = (pixels[texel] << 16) | (pixels[texel + 1] << 8) | pixels[texel + 2];
          }
          const position=[0,1,2].map(k=>row.reduce((s,n,i)=>s+n.p[k]*w[i]/sum,0));
          if(clip&&!clip(position) || omitLayer && omit(omitLayer,chart?.materialId,position))continue;
          const weights3=trackWeights && identity.map((_,k)=>row.reduce((s,v,i)=>s+v.weights[k]*w[i]/sum,0));
          const pigment = rgba?.slice(0,3) ?? material?.color ?? [ink>>>16,(ink>>>8)&255,ink&255].map(n=>n/255);
          let tinted = pigment;
          const channel = tint && (k=>clampTint(weights3[0]*tint[k]+weights3[1]*tint[tintStride+k]+weights3[2]*tint[2*tintStride+k]));
          if (tint) {
            if (tintBlend==='midpoint') tinted=pigment.map((base,k)=>{
              const shift=2*channel(k)-1;
              return base+shift*(shift<0 ? base : 1-base);
            });
            else if (tintBlend) {
              const remain=1-channel(3);
              tinted=pigment.map((base,k)=>clampTint(channel(k)+remain*base));
            } else tinted=pigment.map((base,k)=>base*channel(k));
          }
          if (material && (tint || rgba)) material.color=tinted;
          let meshTintInspection;
          if (captureMeshTint && layer.featureFaces) {
            // Tint-only displays the interpolated paint. Premultiplied modes use gray as the substrate.
            const gray = tintBlend ? .5 : 1;
            const remain = tint && tintBlend && tintBlend!=='midpoint' ? .5*(1-channel(3)) : 0;
            const color = tint ? [0,1,2].map(k=>clampTint(channel(k)+remain)) : [gray,gray,gray];
            meshTintInspection={texture:pigment,tint:color};
          }
          let base = normal, mapped;
          if (authored) {
            const mixed = unit(normal.map((_, k) => weights3.reduce((sum, weight, i) => sum + authored[i * 3 + k] * weight, 0)));
            if (mixed.some(Boolean)) base = mapped = dot(mixed, normal) < 0 ? mixed.map(n => -n) : mixed;
          }
          if (restAxes) {
            const weights=restAxes.map(axis=>dot(axis,material.normal));
            const sign=dot(posedAxes[2],normal)<0 ? -1 : 1;
            mapped=unit(normal.map((_,k)=>sign*weights.reduce((sum,n,i)=>sum+n*posedAxes[i][k],0)));
          } else if (bitangent && (material || normalPixels?.[texel+3]>=128)) {
            const local = material?.normal ?? [0,1,2].map(k => Math.max(-127, normalPixels[texel+k]-128));
            if (local.some(Boolean)) {
              let tangent = axes.right, up = bitangent;
              if (base !== normal) {
                const projection = dot(tangent, base);
                tangent = unit(tangent.map((n, i) => n - projection * base[i]));
                if (!tangent.some(Boolean)) tangent = unit(cross(bitangent, base));
                up = cross(base, tangent);
                if (dot(up, axes.up) < 0) up = up.map(n => -n);
              }
              mapped = unit(base.map((n,k) => local[0]*tangent[k]+local[1]*up[k]+local[2]*n));
            }
          }
          const at=chart && first-chart.first;
          const value=(data,components,k)=>weights3.reduce((s,n,i)=>s+n*data[(at+i)*components+k],0);
          let uv;
          if (chart && sampleCharts) {
            const {x,y,width:w,height:h}=chart.region;
            uv=chart.uv ? [value(chart.uv,2,0),value(chart.uv,2,1)] :
              [0,1].map(k=>(weights3.reduce((s,n,i)=>s+n*input[i].uv[k],0)-(k?y:x)-.5)/Math.max(1,(k?h:w)-1));
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
          let paint;
          const faceId = p===paintIndex && layer.featureFaces?.[first/3];
          if (faceId && chart) {
            const region = chart.region;
            const mode = linear ? 'linear' : filteredPaint ? 'palette' : material?.lod>=.5 ? 'mip' : 'texel';
            const uv = [(S-region.x-.5)/Math.max(1,region.width-1),(T-region.y-.5)/Math.max(1,region.height-1)];
            const at = material ? [region.width,region.height].map((n,k)=>Math.max(0,Math.min(n-1,
              Math.floor(.5+uv[k]*(n-1))))) : [tx-region.x,ty-region.y];
            paint = {face:faceId,mode,uv,...(mode==='texel' && {
              at,drawTriangle:first/3,barycentric:weights3,mesh:layer.sceneMeshId
            })};
          }
          const fragment={p,z,alpha,color:material?.color ?? tinted,position,
            ...(settings && {tilesetMaterial:settings}),
            ...(pbrMaterial && {pbrMaterial,pbrReceives,pbrTangent:axes?.right}),
            ...(material && {semantic:material,semanticRule:mip.chain.rule,scan:mip.chain.scan,objectTexels:mip.objectTexels,liveLight:mip.liveLight,
              semanticView:ortho ? [V[2],V[6],V[10]] : unit(sub(eye,position))}),
            normal:mapped??normal,...(mapped&&{biasNormal:normal}),objectPosition,surface:true,
            ...(local && {localProjection:true}),
            ...(lightingTarget&&{lightingTarget}),
            ...(fogObject!==undefined&&{fogObject}),
            ...(paint && {paint}),...(meshTintInspection && {meshTintInspection}),
            ...(source && {source:{ ...source,coordinate:weights3,
              restNormal:restNormal && (dot(face,normal) < 0 ?
                restNormal.map(n=>-n) : restNormal) }}),
            ...(mesh && {mesh,...(motion&&{weights:weights3}),...(uv&&{uv})})};
          if (alpha<1) blended.push(fragment);
          else fragments[p]=fragment;
        }
      }
    }
  }
  if (depthOnly) return depth;
  const opaque=fragments.filter(Boolean);
  return blended.length ? opaque.concat(blended.filter(sample=>
    !fragments[sample.p] || sample.z<fragments[sample.p].z)) : opaque;
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
