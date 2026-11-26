/* Prepare shared directional maps from the same posed geometry in either renderer. */
const PbrShadows = (() => {
  let maps, art, curves, cutouts, patterns, sprites;
  try { maps=DirectionalShadowMap; } catch { maps=require('./directional-shadow-map.js'); }
  try { art=ShadowArt; } catch { art=require('./shadow-art.js'); }
  try { curves=CurveSplat; } catch { curves=require('./curve-splat.js'); }
  try { cutouts=ShadowCutouts; } catch { cutouts=require('./shadow-cutouts.js'); }
  try { patterns=CurvePattern; } catch { patterns=require('./curve-pattern.js'); }
  try { sprites=SpriteSurface; } catch { sprites=require('./sprite-surface.js'); }
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const slip=Symbol.for('ink-studio.spriteSurface.uvSlip');
  const subject=chart=>chart ? {
    object:chart.objectId,entity:chart.objectId,part:chart.partId,material:chart.materialId,surface:chart.id
  } : {};

  function meshTriangles(layers,settings) {
    const triangles=[];
    for (const layer of layers) {
      if (!(layer?.sceneMeshId || layer?.brickField)) continue;
      const {vertices,pixels,width,height,surfaceCharts:charts=[]}=layer;
      const shifts=layer[slip]?.vertices===vertices ? layer[slip].ranges : [];
      let chart=0, shift=0, tile=0, wrapIndex=0;
      for (let first=0;first<vertices.length/5;first+=3) {
        while(charts[chart]?.end<=first)chart++;
        const target=charts[chart]?.first<=first ? charts[chart] : null;
        if (!art.allows(settings?.cast,subject(target))) continue;
        while(shifts[shift]?.end<=first)shift++;
        const change=shifts[shift]?.first<=first?shifts[shift]:null;
        while(layer.tilesetMaterials?.[tile]?.end<=first)tile++;
        const material=layer.tilesetMaterials?.[tile]?.first<=first ? layer.tilesetMaterials[tile].settings : null;
        while(layer.tileWraps?.[wrapIndex]?.end<=first)wrapIndex++;
        const wrap=layer.tileWraps?.[wrapIndex]?.first<=first ? layer.tileWraps[wrapIndex].mapping : null;
        const points=[],uv=[];
        for (let k=0;k<3;k++){
          const at=(first+k)*5;
          points.push([vertices[at],vertices[at+1],vertices[at+2]]);
          uv.push([vertices[at+3],vertices[at+4]]);
        }
        const sample=(x,y)=>{
          if(change){
            const [sx,sy,tx,ty]=change.transform,[loX,loY,hiX,hiY]=change.bounds;
            x=Math.max(loX,Math.min(hiX+.99999,x*sx+tx));
            y=Math.max(loY,Math.min(hiY+.99999,y*sy+ty));
          }
          if (wrap) [x,y]=sprites.tileWrapPoint(wrap,x,y);
          const pixel=(value,k)=>wrap ? sprites.tileWrapIndex(Math.floor(value),wrap.start[k],wrap.size[k],wrap.modes[k]) :
            Math.floor(Math.max(0,Math.min((k ? height : width)-1,value)));
          const i=pixel(x,0),j=pixel(y,1);
          return material?.alphaMode==='opaque' ||
            pixels[(j*width+i)*4+3]/255>=(material?.alphaMode==='mask' ? material.alphaCutoff : .5);
        };
        triangles.push({points,uv,sample});
      }
    }
    return triangles;
  }

  function cutoutGeometry(planes) {
    const triangles=[],shells=[];
    for (const plane of planes) {
      const {origin,normal,u,v,image,mapping,cutoff,shellScale=1}=plane;
      const U=cross(v,normal), V=cross(normal,u), du=dot(U,u), dv=dot(V,v);
      const uv=[[0,0],[1,0],[0,1],[1,1]];
      const points=uv.map(([x,y])=>origin.map((value,k)=>value+x*U[k]/du+y*V[k]/dv));
      if(image.shell){
        shells.push({
          points:[image.shell.min,image.shell.max].flatMap(depth=>points.map(point=>
            point.map((n,k)=>n-depth*shellScale*normal[k]))),
          depth:(origin,direction,stop)=>cutouts.shellDepth(plane,origin,direction,stop)
        });
        continue;
      }
      const sample=(u,v)=>{
        const x=Math.max(0,Math.min(image.width-1,Math.floor(mapping[0]+u*mapping[2])));
        const y=Math.max(0,Math.min(image.height-1,Math.floor(mapping[1]+v*mapping[3])));
        return image.alpha[y*image.width+x]>=cutoff;
      };
      for(const corners of [[0,1,2],[2,1,3]])
        triangles.push({points:corners.map(i=>points[i]),uv:corners.map(i=>uv[i]),sample});
    }
    return {triangles,shells};
  }

  const curveLayers=4;
  function drawCurves(frame, strands) {
    const {map,right,up,light}=frame;
    return maps.rasterCurves(strands.values(),map,[right,up,light],frame,{maxLayers:curveLayers},{});
  }

  function prepare(plan, world, frames, {layers=[],surfaceOptions,shadowArt,footprint=0,enabled=true,curveMode}={}) {
    if (!plan || !enabled || !plan.lights.some(light=>light.shadows)) return null;
    const settings=art.prepare(shadowArt ?? world.look?.shadowArt);
    const casts=art.bind(settings,world,'cast'), receives=art.bind(settings,world,'receive');
    const small=art.small(settings,footprint), ramp=(small && settings.small.ramp) || settings?.ramp;
    const {triangles,shells}=cutoutGeometry(cutouts.prepare(world,{
      ...surfaceOptions,accepts:settings?.cast && (target=>art.allows(settings.cast,target))
    }));
    triangles.push(...meshTriangles(layers.flat(),settings));
    const {count,data}=world, x=new Float64Array(count),y=new Float64Array(count),z=new Float64Array(count),
      alpha=new Float64Array(count),scale=new Float64Array(count).fill(1);
    const normals=[],covariances=[],strandRows=[],curveGeometry=curveMode!=='splats';
    const programs=new Map(), back=new Set(world.back??[]), time=surfaceOptions?.time??0;
    for(let i=0;i<count;i++){
      if(back.has(i) || casts && !casts(i))continue;
      const q=i*16, isCurve=curves.isRow(data,q);
      if (isCurve && !(world.curveShadows?.[i]&curves.castShadow)) continue;
      if (!isCurve && (Math.round(data[q+11])&(16|64|256))) continue;
      const frame=frames(i);
      const opacity=frame.opacity();
      if (!(opacity>=1 || isCurve && curveGeometry && opacity>0)) continue;
      const at=frame.position();
      x[i]=at[0];y[i]=at[1];z[i]=at[2];alpha[i]=opacity;
      normals[i]=frame.normal;
      const covariance=covariances[i]=frame.covariance();
      if (isCurve && curveGeometry) {
        const packed=data.slice(q,q+16);
        packed.set(covariance.subarray(0,3),4);
        packed.set(covariance.subarray(3),8);
        const clips=curves.clipPlanes(world.curveClips,i,at,1,frame);
        const optics=world.curveShadowOptics?.[i];
        let casterOpacity=optics?(2-optics)*Math.min(1,opacity/data[q+3]):opacity;
        const timing=world.curveTiming,timingAt=i*curves.timingStride;
        const program=timing?.[timingAt] && world.curveTimePrograms?.[timing[timingAt]-1];
        let window;
        if(program){
          if(!programs.has(program))programs.set(program,program.sample(time));
          window=curves.timeWindow(timing,timingAt,programs.get(program),program.trail,time);
          if(window){
            casterOpacity=curves.timedOpacity(casterOpacity,window.fade,data[q+15]);
            const basis=frame.basis().anchor;
            window={...window,direction:[0,3,6].map(j=>dot(basis.slice(j,j+3),window.direction))};
          }else casterOpacity=0;
        }
        if(casterOpacity>0)strandRows[i]={at,packed,clips,frame,window,opacity:casterOpacity};
        else alpha[i]=0;
      }
    }
    const curveAt=strandRows.length ? (i,camera)=>{
      const row=strandRows[i];
      if(row)return curves.prepare(row.packed,0,row.at,1,row.opacity,camera,row.clips,row.window,undefined,
        patterns.attach(world,i,row.frame,camera,true));
    } : undefined;
    const depths=plan.lights.map(light=>light.shadows ? maps.build(light,world,{x,y,z,alpha,scale},
      i=>normals[i],casts,{triangles,shells,covarianceAt:i=>covariances[i],curveAt,drawCurves,DepthArray:Float32Array}) : null);
    if(!depths.some(Boolean))return null;
    return {
      depths,ramp,strength:small?settings.small.strength:1,receives,
      receivesSurface:chart=>art.allows(settings?.receive,subject(chart)),
      visibility(index,position,normal) {
        const depth=depths[index];
        if(!depth)return 1;
        const facing=dot(normal,depth.light), toward=facing<0 ? normal.map(n=>-n) : normal;
        return art.transfer(settings,maps.visibility(depth,...position,toward,Math.abs(facing)),small);
      }
    };
  }

  function pack(shadows, offset) {
    const u_pbrShadow=new Float32Array(4*16), u_pbrShadowRamp=new Float32Array(16);
    if (!shadows) return {rows:new Float32Array(0),uniforms:{u_pbrShadow}};
    const depthSize=depth=>Math.ceil(depth.map.length/4)*4;
    const layerSize=depth=>depth.curveDepth?.size ? depthSize(depth)+depth.curveDepth.size*curveLayers*2 : 0;
    const rows=new Float32Array(shadows.depths.reduce((size,depth)=>size+(depth?depthSize(depth)+layerSize(depth):0),0));
    let at=0;
    for(const [i,depth] of shadows.depths.entries()){
      if(!depth)continue;
      const {map,right,up,minU,minV,width,height,texel,filter,bias,curveDepth}=depth;
      rows.set(map,at);
      const start=at;
      at+=depthSize(depth);
      const layerTable=curveDepth?.size ? offset+at/4+1 : 0;
      if(layerTable){
        const pointers=at;
        at+=depthSize(depth);
        for(const [entry,layers] of curveDepth){
          rows[pointers+entry]=offset+at/4+1;
          for(const [layer,{range,opacity}] of layers.entries()){
            rows[at+layer*2]=range[1];
            rows[at+layer*2+1]=opacity;
          }
          at+=curveLayers*2;
        }
      }
      u_pbrShadow.set([...right,minU,...up,minV,width,height,texel,bias,offset+start/4,filter,layerTable,0],i*16);
    }
    if(shadows.ramp)u_pbrShadowRamp.set(shadows.ramp);
    return {rows,uniforms:{u_pbrShadow,u_pbrShadowRamp,u_pbrShadowRampCount:shadows.ramp?.length??0,
      u_pbrShadowStrength:shadows.strength}};
  }

  return Object.freeze({prepare,pack,curveLayers});
})();
if (typeof module !== 'undefined') module.exports = PbrShadows;
