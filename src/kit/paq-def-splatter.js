/* Scatter signed relief assets and resolve one coherent top surface on the native material grid. */
const TypedShapeSplatter = ({V,M,planar,volume,scatter,descriptor,wrap,dimensions,fields,freeze,
  requireImage,integerMax,sampler,hash,hash01}) => {
  const geometry=SplatterGeometry({V,M,planar,volume}), up=[0,1,0], phaseUnits=2**40;
  const streams=['layout','density','shape','scale','rotation','height'];
  const within=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&within(n,a,b);
  const tuple=(v,n,test)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(test);
  const mod=(n,p)=>((n%p)+p)%p;
  const unit=n=>Math.min(1,Math.max(0,n));

  function settings(options,root,background) {
    if(!fields(options,['span','crop','wrap','mapFilter','units','jitter','density','scale','scaleJitter',
      'rotation','rotationJitter','slopeAlignment','heightOffset','heightJitter','extrusion','rounding',
      'maskThreshold','clipThreshold','samples','steps','epsilon','safety','orientation','uv','seed','seeds']))
      throw new TypeError('Unknown Shape Splatter option');
    const {span=[1,1],crop=[0,0,1,1],wrap:periodic=[true,true],mapFilter='image',units=background?.descriptor.units??'shape-units',
      jitter=.88,density=1,scale=[.16,.16,.16],scaleJitter=[0,0,0],rotation=[0,0,0],rotationJitter=[0,0,0],
      slopeAlignment=1,heightOffset=0,heightJitter=0,extrusion=.25,rounding=Math.min(.035,extrusion/2),maskThreshold=.5,clipThreshold=.5,
      samples=1,steps=64,epsilon=.0006,safety=.78,orientation='opengl',uv={},seed=root,seeds={}}=options;
    if(!tuple(span,2,n=>within(n,1e-4,1e4))||!tuple(crop,4,n=>within(n,-16,16))||
      crop[2]-crop[0]<1/8192||crop[3]-crop[1]<1/8192||!tuple(periodic,2,n=>typeof n==='boolean')||
      !['image','nearest','linear'].includes(mapFilter)||typeof units!=='string'||!units.trim()||units.length>64||
      background&&units!==background.descriptor.units)
      throw new RangeError('Shape Splatter needs a bounded texture domain and matching height units');
    const resolvedScale=typeof scale==='number'?[scale,scale,scale]:scale;
    if(!tuple(resolvedScale,3,n=>within(n,1e-5,1e4))||!tuple(scaleJitter,3,n=>within(n,0,.95))||
      !tuple(rotation,3,Number.isFinite)||!tuple(rotationJitter,3,n=>within(n,0,360))||
      ![jitter,density,slopeAlignment,maskThreshold,clipThreshold].every(n=>within(n,0,1))||
      !within(heightOffset,-1e4,1e4)||!within(heightJitter,0,1e4)||
      !within(extrusion,.01,2)||!within(rounding,0,extrusion/2))
      throw new RangeError('Invalid Shape Splatter placement, transform, mask threshold or extrusion');
    if(![1,2,4].includes(samples)||!integer(steps,8,128)||!within(epsilon,1e-6,.025)||!within(safety,.1,1)||
      !['opengl','directx'].includes(orientation)||!Number.isSafeInteger(seed)||
      !fields(seeds,streams)||!Object.values(seeds).every(Number.isSafeInteger))
      throw new RangeError('Invalid Shape Splatter tracing, normal orientation or seed controls');
    if(!fields(uv,['mode','scale','offset','angle','address'])) throw new TypeError('Unknown Shape Splatter UV control');
    const uvSettings={mode:'planar',scale:[1,1],offset:[0,0],angle:0,address:'raw',...uv};
    if(!['planar','cylindrical','spherical'].includes(uvSettings.mode)||!['raw','wrap','clamp'].includes(uvSettings.address)||
      !tuple(uvSettings.scale,2,n=>within(n,-64,64)&&n!==0)||!tuple(uvSettings.offset,2,n=>within(n,-64,64))||
      !Number.isFinite(uvSettings.angle))
      throw new RangeError('Invalid Shape Splatter UV mode, scale, offset, angle or addressing');
    return {span,crop,periodic,mapFilter,units,jitter,density,scale:resolvedScale,scaleJitter,rotation,rotationJitter,
      slopeAlignment,heightOffset,heightJitter,extrusion,rounding,maskThreshold,clipThreshold,samples,steps,epsilon,
      safety,orientation,uv:uvSettings,seed,seeds:Object.fromEntries(streams.map(name=>[name,seeds[name]??seed]))};
  }

  function plane(source,intent,axes,filter) {
    const {raster:{width,height,data},descriptor:spec}=requireImage(source);
    if(spec.layout!=='r'||(intent==='height'?spec.intent!=='height':
      !['mask','data'].includes(spec.intent)||spec.units!=='unitless'))
      throw new TypeError('Shape Splatter '+intent+' needs a scalar typed '+(intent==='height'?'height':'unitless')+' image');
    const divisor=integerMax(spec.precision)||1, value=[0];
    const read=sampler({width,height,accumulate(i,out,weight){
      out[0]+=(intent==='height'?data[i]:unit(data[i]/divisor))*weight;
    }},1,filter==='image'?spec.sampling:filter,...(axes??[spec.tiling.u,spec.tiling.v]).map(TextureAddress.axis));
    return (u,v)=>{
      value[0]=0;read(u,v,1,value);
      if(intent==='height'&&!within(value[0],-1e6,1e6)) throw new RangeError('Shape Splatter height exceeds its coordinate range');
      return value[0];
    };
  }

  function terrain(background,config) {
    if(!background) return {height:()=>0,normal:()=>up};
    const sample=plane(background,'height',config.periodic.map(n=>n?'wrap':'clamp'),'linear');
    const uvStep=[.5/background.raster.width,.5/background.raster.height];
    const [dx,dz]=uvStep.map((n,i)=>2*n*config.span[i]);
    return {height:sample,normal(u,v){
      const gradientX=(sample(u+uvStep[0],v)-sample(u-uvStep[0],v))/dx;
      const gradientZ=(sample(u,v+uvStep[1])-sample(u,v-uvStep[1]))/dz;
      return V.norm([-gradientX,1,-gradientZ],up);
    }};
  }

  function placements(columns,rows,library,ground,density,mask,config,edits) {
    const {span,jitter,periodic,scale,rotation,scaleJitter,rotationJitter,slopeAlignment,epsilon,heightOffset,heightJitter}=config;
    const keys=Object.fromEntries(Object.entries(config.seeds).map(([k,n])=>[k,hash('shape splatter/'+k+'/'+n)]));
    const drawn=(id,name,axis=0)=>hash01(id+'/'+axis,keys[name]);
    const grid=scatter({id:'shape-splatter',bounds:{min:[0,0],max:[1,1]},origin:[.5/columns,.5/rows],
      step:[1/columns,1/rows],jitter,seed:keys.layout});
    const cells=[columns,rows], bins=Array.from({length:columns*rows},()=>[]), items=[];
    const rejected={mask:0,density:0,...(edits.hide.size&&{hidden:0})};
    let visits=0,maxCandidates=0;
    for(const {point,cell:[c,r]} of grid.samples){
      if(c<0||r<0||c>=columns||r>=rows)continue;
      const id=1+r*columns+c, [u,v]=point;
      if(mask&&mask(u,v)<config.maskThreshold) { rejected.mask++;continue; }
      if(drawn(id,'density')>=config.density*(density?.(u,v)??1)) { rejected.density++;continue; }
      if(edits.hide.has(id)){rejected.hidden++;continue;}
      const index=edits.replace.get(id)??Math.floor(drawn(id,'shape')*library.length), shape=library[index];
      const sizes=scale.map((n,i)=>n*(1+scaleJitter[i]*(2*drawn(id,'scale',i)-1)));
      const angles=rotation.map((n,i)=>n%360+rotationJitter[i]*(2*drawn(id,'rotation',i)-1));
      const h=ground.height(u,v)+heightOffset+heightJitter*(2*drawn(id,'height')-1), base=[u*span[0],h,v*span[1]];
      const slope=slopeAlignment?ground.normal(u,v):up;
      const asset={...geometry.pose(shape,base,sizes,angles,slope,slopeAlignment,epsilon),id,shapeId:index+1};
      const center=[asset.center[0],asset.center[2]], radius=[asset.extent[0],asset.extent[2]];
      const bounds=sign=>center.map((n,i)=>Math.floor(((n+sign*radius[i])/span[i]+sign/phaseUnits)*cells[i]));
      const lo=bounds(-1),hi=bounds(1);
      for(let i=0;i<2;i++) if(!periodic[i]){lo[i]=Math.max(0,lo[i]);hi[i]=Math.min(cells[i]-1,hi[i]);}
      visits+=Math.max(0,hi[0]-lo[0]+1)*Math.max(0,hi[1]-lo[1]+1);
      if(visits>8e5) throw new RangeError('Shape Splatter placement exceeds its spatial bucket budget');
      for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
        const a=mod(x,columns), b=mod(y,rows), bin=bins[b*columns+a];
        bin.push({asset,cx:center[0]-(x-a)/columns*span[0],cz:center[1]-(y-b)/rows*span[1]});
        maxCandidates=Math.max(maxCandidates,bin.length);
      }
      items.push({id,shapeId:index+1,kind:shape.kind,uv:[u,v],base,center:asset.center,scale:sizes,rotation:angles,slope});
    }
    return {bins,maxCandidates,layout:{columns,rows,span:span.slice(),crop:config.crop.slice(),wrap:periodic.slice(),
      seeds:config.seeds,units:config.units,placements:items,rejected}};
  }

  function project(bins,columns,rows,ground,clip,config) {
    const {span,periodic}=config;
    const phase=(n,i)=>{
      const q=Math.round(n*phaseUnits);
      return (periodic[i]?mod(q,phaseUnits):q)/phaseUnits;
    };
    return (s,t)=>{
      const u=phase(s,0),v=phase(t,1),x=u*span[0],z=v*span[1];
      let height=ground.height(u,v),target=null;
      if(u>=0&&u<1&&v>=0&&v<1&&(!clip||clip(u,v)>=config.clipThreshold)){
        const candidates=bins[Math.floor(v*rows)*columns+Math.floor(u*columns)];
        // Candidates retain ID order. Equal-height hits keep the first instance.
        for(const copy of candidates){
          const hit=geometry.trace(copy,x,z,height,config);
          if(hit>height){height=hit;target=copy;}
        }
      }
      return {u,v,x,z,height,target};
    };
  }

  function geometryEdits(source,count,librarySize) {
    if(!fields(source,['hide','replace'])) throw new TypeError('Unknown Shape Splatter edit option');
    const {hide=[],replace=[]}=source;
    const list=data=>Array.isArray(data)&&data.length<=count;
    if(!list(hide)||!Array.from(hide).every(id=>integer(id,1,count))||new Set(hide).size!==hide.length||
      !list(replace)||!Array.from(replace).every(row=>fields(row,['id','shapeId'])&&
        integer(row.id,1,count)&&integer(row.shapeId,1,librarySize))||new Set(replace.map(row=>row.id)).size!==replace.length)
      throw new RangeError('Shape Splatter edits need unique instance IDs and valid replacement shape IDs');
    return {hide:new Set(hide),replace:new Map(replace.map(({id,shapeId})=>[id,shapeId-1]))};
  }

  function generate(width,height,columns=8,rows=6,shapes=[],volumes=[],maps={},options={},root=0,time=0,edits={}) {
    if(![width,height].every(n=>integer(n,1,8192))||!dimensions({width,height})||width*height>1e6)
      throw new RangeError('Shape Splatter bake exceeds its million-texel budget');
    if(![columns,rows].every(n=>integer(n,1,128))||columns*rows>4096||!Number.isFinite(time))
      throw new RangeError('Shape Splatter needs a bounded scatter grid and finite time');
    if(!fields(maps,['background','density','mask','clip'])) throw new TypeError('Unknown Shape Splatter input map');
    const {background,density,mask,clip}=maps;
    const bg=background==null?null:requireImage(background,'height'), config=settings(options,root,bg);
    const {span,periodic,samples,steps,crop,units,seed:materialSeed,orientation}=config;
    const map=(source,name)=>source==null?null:plane(source,name,undefined,config.mapFilter);
    const ground=terrain(bg,config), shapeLibrary=geometry.library(shapes,volumes,config,time);
    const changes=geometryEdits(edits,columns*rows,shapeLibrary.length);
    const {bins,maxCandidates,layout}=placements(columns,rows,shapeLibrary,ground,map(density,'density'),map(mask,'mask'),config,changes);
    const cut=map(clip,'clip'), count=width*height, extra=samples===1?0:samples*samples;
    if(count*(1+extra)*maxCandidates*(steps+6)>220e6) throw new RangeError('Shape Splatter bake exceeds its trace budget');
    const [left,top,right,bottom]=crop, extents=[right-left,bottom-top];
    const [du,dv]=[extents[0]/width,extents[1]/height], spacing=[du*span[0],dv*span[1]];
    const attrs=extents.map((n,i)=>periodic[i]&&Math.abs(n-Math.round(n))<1e-12?'wrap':'clamp');
    const tiling={u:attrs[0],v:attrs[1]}, pixelPitchMm=units==='mm'?spacing:undefined;
    const yMap=new Float32Array(count), normals=new Float32Array(count*3), uv=new Float32Array(count*2);
    const coverage=new Float32Array(count), instanceId=new Float32Array(count), shapeId=new Float32Array(count);
    const at=project(bins,columns,rows,ground,cut,config);
    for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++){
      const center=at(left+(x+.5)*du,top+(y+.5)*dv);
      let chosen=center, hits=Number(!!center.target), closest=Infinity;
      if(extra) {
        hits=0;
        for(let j=0;j<samples;j++)for(let i=0;i<samples;i++){
          const a=(i+.5)/samples,b=(j+.5)/samples;
          const hit=at(left+(x+a)*du,top+(y+b)*dv);
          if(!hit.target) continue;
          hits++;
          const proximity=(a-.5)**2+(b-.5)**2;
          if(!center.target&&proximity<closest){closest=proximity;chosen=hit;}
        }
        if(!hits&&center.target) chosen={...center,target:null,height:ground.height(center.u,center.v)};
      }
      yMap[p]=chosen.height;
      coverage[p]=hits/(extra||1);
      const {target}=chosen;
      let direction;
      if(target){
        const q=geometry.local(target,chosen.x,chosen.z,chosen.height), {asset}=target;
        direction=geometry.normal(asset,q,config.epsilon);
        uv.set(geometry.uv(asset.shape,q,config.uv),2*p);
        instanceId[p]=asset.id; shapeId[p]=asset.shapeId;
      } else direction=ground.normal(center.u,center.v);
      normals.set([direction[0],orientation==='directx'?direction[2]:-direction[2],direction[1]],3*p);
    }
    function image(data,channels,intent,extra={}) {
      const grid={width,height,channels,data};
      return wrap(grid,descriptor(grid,{intent,precision:'float32',tiling,materialSeed,pixelPitchMm,...extra}));
    }
    return {value:image(yMap,1,'height',{units}),normal:image(normals,3,'normal',{normalSpace:'tangent',normalOrientation:orientation}),
      instanceId:image(instanceId,1,'data'),shapeId:image(shapeId,1,'data'),uv:image(uv,2,'data',{units:'uv'}),
      coverage:image(coverage,1,'mask'),layout:freeze({...layout,spacing,trace:{steps,epsilon:config.epsilon,samples},uv:config.uv})};
  }
  return generate;
};
