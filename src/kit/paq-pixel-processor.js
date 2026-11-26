/* Portable Pixel Processor documents, typed image bindings, and backend comparison. */
(function (P) {
  const K=PixelProcessorKernel, G=P.graphImages, {fields,id,types,i32,f32,clamp}=K, own=Object.hasOwn;
  const {literal}=GraphControlReferences, record=P.graphTypes.validator('record');
  const format='ink-studio/pixel-processor', version=1;
  const storage={unorm8:[Uint8Array,255],unorm16:[Uint16Array,65535],float32:[Float32Array,0]};
  const semanticKeys=['intent','layout','precision','units','colorSpace','alpha','normalSpace','normalOrientation'];
  const socketTypes={f32:'number',i32:'integer',bool:'boolean',vec2:'vec2',vec3:'vec3',vec4:'vec4'};
  const maxSamples=16777216, maxDispatchWork=100000000;
  const maxExtent=8192;
  const reserved=['program','width','height','time','seed'];
  const imageType=spec=>({color:'colorImage',height:'heightImage',normal:'normalImage'})[spec.intent]??
    (spec.layout==='r'&&spec.units==='unitless'?'grayImage':'typedImage');

  function imageContract(spec,label) {
    if(!record(spec)||!own(storage,spec.precision)||typeof spec.layout!=='string'||spec.layout.length<1||
        spec.layout.length>4||!own(spec,'intent')||spec.intent==='color'&&!own(spec,'colorSpace'))
      throw new TypeError('Pixel Processor '+label+' needs a descriptor with intent, layout, precision and color space for color');
    const channels=spec.layout.length, data=Array(channels).fill(0);
    return G.declare({width:1,height:1,channels,data},spec).descriptor;
  }

  function paramValue(type,value,label) {
    const check=P.graphTypes.validator(socketTypes[type]);
    if(!check(value)||type==='i32'&&!i32(value))throw new TypeError('Pixel Processor '+label+' needs '+type);
    if(type==='f32')return f32(value);
    return types[type]===1?value:Object.freeze(value.map(f32));
  }

  function entries(value,max,label,required=false) {
    if(!record(value))throw new TypeError('Pixel Processor '+label+' needs named entries');
    const list=Object.entries(value);
    if(list.length>max||required&&!list.length||list.some(([key])=>!id(key)||reserved.includes(key)))
      throw new RangeError('Pixel Processor invalid '+label+' names or count');
    return list;
  }

  function parameterCode(type,at) {
    if(type==='i32')return 'bitcast<i32>(pp_meta['+at+'u])';
    if(type==='bool')return '(pp_meta['+at+'u] != 0u)';
    const lane=index=>'bitcast<f32>(pp_meta['+index+'u])';
    if(type==='f32')return lane(at);
    return K.gpuType(type)+'('+Array.from({length:types[type]},(_,i)=>lane(at+i)).join(', ')+')';
  }

  function compile(program) {
    if(!fields(program,['format','version','precision','resources','parameters','outputs','body','result'])||
        program.format!==format||program.version!==version||program.precision!=='f32')
      throw new TypeError('Expected Ink Studio Pixel Processor version 1 with explicit f32 precision');
    let words=4, stride=0;
    const resources=new Map(entries(program.resources??{},8,'resources').map(([name,spec],index)=>{
      const descriptor=imageContract(spec,'resource '+name), meta=words;
      words+=3;
      return [name,{descriptor,index,meta}];
    }));
    const parameters=new Map(entries(program.parameters??{},32,'parameters').map(([name,spec],index)=>{
      if(resources.has(name)||!fields(spec,['type','default'])||!own(types,spec.type))
        throw new TypeError('Pixel Processor invalid parameter '+name);
      const {type}=spec, at=words;
      words+=types[type];
      const preset=own(spec,'default')?paramValue(type,spec.default,'parameter '+name+' default'):undefined;
      return [name,{type,index,at,code:parameterCode(type,at),preset}];
    }));
    const outputs=new Map(entries(program.outputs,4,'outputs',true).map(([name,spec])=>{
      if(!fields(spec,['descriptor','outOfRange'])||spec.outOfRange!==undefined&&!['error','clamp'].includes(spec.outOfRange))
        throw new TypeError('Pixel Processor invalid output '+name);
      const descriptor=imageContract(spec.descriptor,'output '+name), offset=stride;
      stride+=descriptor.layout.length;
      return [name,{descriptor,offset,outOfRange:spec.outOfRange??'error'}];
    }));
    if(!fields(program.result,[...outputs.keys()])||Object.keys(program.result).length!==outputs.size)
      throw new TypeError('Pixel Processor result must write every declared output exactly once');
    const kernel=K.compile({...program,body:program.body??[]},resources,parameters,outputs,stride);
    const sockets=Object.freeze({
      ...Object.fromEntries([...resources].map(([name,{descriptor}])=>[name,Object.freeze({type:imageType(descriptor)})])),
      ...Object.fromEntries([...parameters].map(([name,{type,preset}])=>[
        name,Object.freeze({type:socketTypes[type],...(preset!==undefined&&{default:preset})})
      ]))
    });
    const ports=Object.freeze(Object.fromEntries([...outputs].map(([name,{descriptor}])=>[name,imageType(descriptor)])));
    const report=Object.freeze({precision:'f32',workPerTexel:kernel.work,syntaxNodes:kernel.syntaxNodes,
      readsTime:kernel.systemReads.has('time'),readsSeed:kernel.systemReads.has('seed'),
      outputChannels:stride,resources:Object.freeze([...resources.keys()]),outputs:Object.freeze([...outputs.keys()])});

    function prepare(request) {
      if(!fields(request,['width','height','resources','parameters','time','seed']))
        throw new TypeError('Invalid Pixel Processor run request');
      const {width,height,resources:images={},parameters:uniforms={},time=0,seed=0}=request;
      if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=maxExtent))
        throw new RangeError('Pixel Processor extent exceeds its sample or dispatch work budget');
      const pixels=width*height, count=pixels*stride;
      if(count>maxSamples||pixels*kernel.work>maxDispatchWork)
        throw new RangeError('Pixel Processor extent exceeds its sample or dispatch work budget');
      if(!fields(images,[...resources.keys()])||!fields(uniforms,[...parameters.keys()])||
          !Number.isFinite(time)||!i32(seed))
        throw new TypeError('Pixel Processor needs declared bindings, finite time, and an i32 seed');
      const meta=new Uint32Array(words), floats=new Float32Array(meta.buffer);
      meta[0]=width;meta[1]=height;floats[2]=f32(time);meta[3]=seed;
      const params=new Array(parameters.size);
      for(const [name,row] of parameters){
        const {at,type,index,preset}=row;
        const value=paramValue(type,own(uniforms,name)?uniforms[name]:preset,'parameter '+name);
        params[index]=value;
        if(type==='i32'||type==='bool')meta[at]=Number(value);
        else if(type==='f32')floats[at]=value;
        else floats.set(value,at);
      }
      let used=0;
      const packed=[...resources].map(([name,{descriptor,meta:at}])=>{
        const value=images[name], grid=value?.raster;
        if(!grid||!Number.isInteger(grid.data?.length)||grid.data.length>maxSamples-used||!G.valid(value)||
            semanticKeys.some(key=>value.descriptor[key]!==descriptor[key]))
          throw new TypeError('Pixel Processor image '+name+' does not match its declared resource contract or sample budget');
        meta[at]=used;meta[at+1]=grid.width;meta[at+2]=grid.height;
        used+=grid.data.length;
        return {offset:meta[at],data:grid.data,scale:storage[descriptor.precision][1]};
      });
      const inputs=new Float32Array(Math.max(1,used));
      for(const {offset,data,scale} of packed){
        if(scale)for(let i=0;i<data.length;i++)inputs[offset+i]=data[i]/scale;
        else inputs.set(data,offset);
      }
      const packet={width,height,inputs,params,time:floats[2],seed,meta};

      function requireSamples(samples) {
        if(!(samples instanceof Float32Array)||samples.length!==count)
          throw new TypeError('Pixel Processor backend returned the wrong f32 sample buffer');
      }

      function resolve(samples) {
        requireSamples(samples);
        return Object.fromEntries([...outputs].map(([name,{descriptor,offset,outOfRange}])=>{
          const {layout,precision,alpha,domain}=descriptor, channels=layout.length, last=channels-1;
          const [Buffer,scale]=storage[precision], data=new Buffer(pixels*channels);
          for(let i=0;i<pixels;i++){
            const opacity=samples[i*stride+offset+last];
            for(let c=0;c<channels;c++){
              let value=samples[i*stride+offset+c];
              if(!Number.isFinite(value))throw new RangeError('Pixel Processor '+name+' returned a nonfinite value at texel '+i);
              const coverage=alpha!=='none'&&c===last;
              const low=!coverage&&domain==='signed-unit'?-1:0;
              const high=alpha==='premultiplied'&&!coverage&&domain==='unit'?clamp(opacity,0,1):1;
              const zero=alpha==='premultiplied'&&!coverage&&opacity<=0;
              const bounded=zero?0:coverage||domain!=='finite'?clamp(value,low,high):value;
              if(outOfRange==='error'&&value!==bounded)
                throw new RangeError('Pixel Processor '+name+' sample is outside its output contract at texel '+i+' lane '+c);
              data[i*channels+c]=scale?Math.round(bounded*scale):bounded;
            }
          }
          return [name,G.declare({width,height,channels,data},descriptor)];
        }));
      }

      function compare(a,b,tolerance={}) {
        requireSamples(a);
        requireSamples(b);
        if(!fields(tolerance,['absolute','relative']))throw new TypeError('Invalid Pixel Processor tolerance');
        const {absolute=1e-6,relative=1e-5}=tolerance;
        if(![absolute,relative].every(value=>Number.isFinite(value)&&value>=0))
          throw new RangeError('Pixel Processor tolerances must be finite and nonnegative');
        const cpu=resolve(a), gpu=resolve(b);
        const ports=Object.fromEntries([...outputs].map(([name,{descriptor,offset}])=>{
          const channels=descriptor.layout.length, left=cpu[name].raster.data, right=gpu[name].raster.data;
          let maxAbsolute=0, sumSquares=0, outsideTolerance=0, differentStoredSamples=0, first=null, worst=null;
          for(let i=0;i<pixels;i++)for(let c=0;c<channels;c++){
            const at=i*stride+offset+c, delta=Math.abs(a[at]-b[at]);
            if(left[i*channels+c]!==right[i*channels+c])differentStoredSamples++;
            sumSquares+=delta*delta;
            const location=()=>({x:i%width,y:Math.floor(i/width),lane:descriptor.layout[c],cpu:a[at],gpu:b[at]});
            if(delta>maxAbsolute){maxAbsolute=delta;worst=location();}
            if(delta>absolute+relative*Math.max(Math.abs(a[at]),Math.abs(b[at]))){
              outsideTolerance++;
              first??=location();
            }
          }
          return [name,{samples:pixels*channels,maxAbsolute,rms:Math.sqrt(sumSquares/(pixels*channels)),outsideTolerance,
            differentStoredSamples,first,worst}];
        }));
        return {cpu,gpu,report:{passed:Object.values(ports).every(row=>row.outsideTolerance===0),absolute,relative,width,height,outputs:ports}};
      }
      return Object.freeze({width,height,inputs,meta,count,executeCPU:()=>kernel.run(packet),resolve,compare});
    }

    return Object.freeze({wgsl:kernel.wgsl,report,sockets,ports,prepare,run(request){
      const prepared=prepare(request);
      return prepared.resolve(prepared.executeCPU());
    }});
  }

  const operations=Object.freeze({
    'image.pixelProcessor': {
      description:'Run a portable typed per-texel program with named images, parameters, bounded loops and native output precision.',
      specialize(node) {
        const program=literal(node,'program'), plan=compile(program);
        const imageNames=new Set(plan.report.resources);
        return {inputs:{program:'record',width:'pixelCount',height:'pixelCount',...plan.sockets},
          outputs:plan.ports,time:plan.report.readsTime,seed:plan.report.readsSeed,
          run({program,width,height,...values},{time,seed,functionExecution}){
            const resources={}, parameters={};
            for(const [key,value] of Object.entries(values))(imageNames.has(key)?resources:parameters)[key]=value;
            return plan.run({width,height,resources,parameters,time,seed:(functionExecution?.system.seed??seed)|0});
          }};
      }
    }
  });
  P.pixelProcessor=Object.freeze({format,version,compile,operations});
})(KIT.procedural);
