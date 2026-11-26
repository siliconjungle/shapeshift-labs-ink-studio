/* Simulation output adapters for sampled fields, point buffers, meshes and rasters. */
(function(K){
  const W=K.world,P=K.procedural,{check,record,read,selector}=W.data,{fields}=W.boundarySignals;
  const validate=(type,value,message)=>{
    check(P.graphTypes.validator(type)(value),message??'Invalid simulation '+type+' output');
    return value;
  };
  const list=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';
  const index=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<max;
  const all=(data,valid)=>list(data)&&Array.from(data).every(valid);
  const format={field:'ink-studio/grid-field',points:'ink-studio/point-buffer'};

  function unwrap(source){
    if(source?.status===undefined||!record(source)||!('value' in source||'reason' in source))return source;
    check(source.status==='ok','Simulation probe is '+source.status+(source.reason?' ('+source.reason+')':''));
    return source.value;
  }
  function select(source,path){
    const result=unwrap(source);
    const value=path===undefined?result:unwrap(read(result,selector(path)));
    check(value!==undefined&&value!==null,'Simulation output path is unavailable');
    return value;
  }

  function grid(source,options={}){
    check(fields(options,['path','shape','origin','spacing','components','unit','frame']),'Invalid simulation field options');
    const raw=select(source,options.path);
    const image=Number.isSafeInteger(raw.width)&&Number.isSafeInteger(raw.height)&&raw.shape===undefined;
    const shape=options.shape??raw.shape??(image?[raw.width,raw.height]:undefined);
    check(Array.isArray(shape),'Simulation field needs an explicit regular grid shape');
    const data=raw.data??raw.values??raw;
    const field={format:format.field,version:1,shape,components:options.components??raw.components??raw.channels??
      (image?data.length/(raw.width*raw.height):1),
      origin:options.origin??raw.origin??shape.map(()=>image ? .5 : 0),
      spacing:options.spacing??raw.spacing??shape.map(()=>1),
      unit:options.unit??raw.unit??'1',frame:options.frame??raw.frame??(image?'art-pixels':'world'),data};
    validate('gridField',field,'Expected a finite regular grid with one to four components and matching data');
    return {...field,shape:shape.slice(),origin:field.origin.slice(),spacing:field.spacing.slice(),data:Float64Array.from(data)};
  }

  function sliceInfo(source,options,settings=[]){
    validate('gridField',source);
    check(fields(options,['axis','index','component',...settings]),'Invalid field slice options');
    const {shape,components}=source, dimensions=shape.length, cut=dimensions===3;
    const {axis=cut?'z':undefined,index:at=0,component}=options;
    const direction=['x','y','z'].indexOf(axis), axes=cut?[0,1,2].filter(i=>i!==direction):[0,1].slice(0,dimensions);
    check((cut?direction>=0&&index(at,shape[direction]):axis===undefined&&at===0)&&
      (component===undefined||index(component,components)),'Field slice is outside the grid or component range');
    const [u,v]=axes, width=shape[u], height=shape[v]??1;
    const strides=[1,shape[0],shape[0]*(shape[1]??1)];
    const offset=cut?strides[direction]*at:0, column=strides[u], row=strides[v]??0;
    return {width,height,axes,axis,at,channels:component===undefined?components:1,
      offset:offset*components,contiguous:(!cut||direction===2)&&(component===undefined||components===1),
      sample(x,y,c){return source.data[(offset+x*column+y*row)*components+(component??c)];}};
  }

  function slice(source,options={}){
    const {share=false}=options;
    check(typeof share==='boolean','Field slice share must be a boolean');
    const {width,height,axes,axis,at,channels,sample,offset,contiguous}=sliceInfo(source,options,['share']);
    const borrowed=share&&contiguous&&source.data instanceof Float64Array, count=width*height*channels;
    const data=borrowed?source.data.subarray(offset,offset+count):new Float64Array(count);
    if(!borrowed)for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++)data[i++]=sample(x,y,c);
    return {value:{width,height,channels,data},report:{axes,origin:axes.map(i=>source.origin[i]),
      spacing:axes.map(i=>source.spacing[i]),unit:source.unit,frame:source.frame,...(share&&{borrowed}),
      ...(axis!==undefined&&{axis,index:at})}};
  }

  function surface(source,options={}){
    const {width,height,channels,axes,sample}=sliceInfo(source,options,['heightScale','heightOffset']);
    const {heightScale=1,heightOffset=0}=options;
    check(channels===1&&width>=2&&height>=2&&width*height<=250000&&[heightScale,heightOffset].every(Number.isFinite),
      'Field surface needs a scalar plane, finite height settings and at least a two-by-two grid');
    const positions=new Float64Array(width*height*3), triangles=new Uint32Array((width-1)*(height-1)*6);
    const uvs=new Float32Array(width*height*2);
    const [u,v]=axes;
    for(let y=0,p=0,t=0;y<height;y++)for(let x=0;x<width;x++,p++){
      positions[p*3]=source.origin[u]+x*source.spacing[u];
      positions[p*3+1]=heightOffset+heightScale*sample(x,y,0);
      positions[p*3+2]=source.origin[v]+y*source.spacing[v];
      uvs[p*2]=x/(width-1);
      uvs[p*2+1]=y/(height-1);
      if(x+1<width&&y+1<height){
        triangles.set([p,p+width,p+1,p+1,p+width,p+width+1],t);
        t+=6;
      }
    }
    return P.sceneGraph.mesh({positions,indices:triangles,uvs});
  }

  function points(source,options={}){
    check(fields(options,['path','unit','frame']),'Invalid simulation point buffer options');
    const data=select(source,options.path), packed=list(data)&&(!Array.isArray(data)||typeof data[0]==='number');
    const rows=Array.isArray(data)&&!packed?data:undefined;
    let {positions,velocities,velocityValid,ids}=data;
    if(packed)positions=data;
    if(rows){
      check(rows.length<=250000,'Simulation point buffer exceeds its point budget');
      positions=new Float64Array(rows.length*3);
      const moving=rows.some(point=>point?.velocity!==undefined), named=rows.some(point=>point?.id!==undefined);
      if(moving){velocities=new Float64Array(positions.length); velocityValid=new Uint8Array(rows.length);}
      if(named)ids=new Array(rows.length);
      function xyz(value){
        check(list(value)&&[2,3].includes(value.length)&&all(value,Number.isFinite),'A point needs finite XY or XYZ coordinates');
        return [value[0],value[1],value[2]??0];
      }
      for(const [i,row] of rows.entries()){
        positions.set(xyz(row?.point??row?.position??row),i*3);
        if(row?.velocity!==undefined){velocities.set(xyz(row.velocity),i*3);velocityValid[i]=1;}
        if(named)ids[i]=row?.id??i;
      }
    }
    const value={format:format.points,version:1,count:positions?.length/3,positions,
      unit:options.unit??data.unit??'world',frame:options.frame??data.frame??'world',
      ...(ids!==undefined&&{ids}),...(velocities!==undefined&&{velocities}),...(velocityValid!==undefined&&{velocityValid})};
    validate('pointBuffer',value);
    if(rows)return value;
    return {...value,positions:Float64Array.from(positions),...(ids!==undefined&&{ids:ids.slice()}),
      ...(velocities!==undefined&&{velocities:Float64Array.from(velocities)}),
      ...(velocityValid!==undefined&&{velocityValid:Uint8Array.from(velocityValid)})};
  }

  function mesh(source,options={}){
    check(fields(options,['path']),'Invalid simulation mesh output options');
    return P.sceneGraph.mesh(select(source,options.path));
  }

  function raster(source,options={}){
    check(fields(options,['path']),'Invalid simulation raster output options');
    const raw=select(source,options.path);
    validate('raster',raw);
    check(raw.data.length<=16777216,'Simulation raster exceeds its sample budget');
    return {width:raw.width,height:raw.height,channels:raw.channels??raw.data.length/(raw.width*raw.height),
      data:raw.data.slice(),...(raw.colorSpace!==undefined&&{colorSpace:raw.colorSpace})};
  }

  W.outputGeometry=Object.freeze({select,validate,grid,slice,surface,points,mesh,raster});
})(KIT);
