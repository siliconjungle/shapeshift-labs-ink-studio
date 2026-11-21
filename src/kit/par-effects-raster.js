/* Stock graph operations for standalone pixel effects. */
(function (P) {
  const E=P.pixelEffects, options={type:'record',default:{}};
  const { image } = P.pixelEffectSupport;
  const raster=(apply,outputs={value:'raster'})=>({
    inputs:{source:'raster',options},outputs,run({source,options}){return apply(source,options);}
  });

  E.tvStatic = function tvStatic(source, options = {}) {
    const value = image(source), { width, height, data } = value;
    const { data: noise } = P.generator.tvStatic({ ...options, width, height });
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3] || !noise[i + 3]) continue;
      const weight = noise[i + 3] / 255;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] + (noise[i + c] - data[i + c]) * weight);
    }
    return value;
  };

  E.operations=Object.freeze({
    'fx.kernelBlur':raster((source,options)=>({value:E.kernelBlur(source,options)})),
    'fx.pathBlur':{
      inputs:{source:'raster',path:'path',options},outputs:{value:'raster'},
      run({source,path,options}){return {value:E.pathBlur(source,path,options)};}
    },
    'fx.outline':raster(E.outline,{value:'raster',outer:'raster',inner:'raster'}),
    'fx.bevel':raster(E.bevel,{value:'raster',height:'raster'}),
    'fx.glow':raster(E.glow,{value:'raster',glow:'raster',mask:'raster'}),
    'fx.erode':raster(E.erode,{value:'raster',mask:'raster'}),
    'fx.repair':raster(E.repair,{value:'raster',mask:'raster',added:'raster'}),
    'fx.pixelSort':raster((source,options)=>({value:E.pixelSort(source,options)})),
    'fx.tvStatic':{
      inputs:{source:'raster',options},outputs:{value:'raster'},time:true,
      run({source,options},{seed,time}){return {value:E.tvStatic(source,{seed,time,...options})};}
    },
    'fx.tileScramble':{
      inputs:{source:'raster',options},outputs:{value:'raster',addresses:'raster'},time:true,
      run({source,options},{seed,time}){return E.tileScramble(source,{seed,time,...options});}
    },
    'fx.tileBleed':{
      inputs:{source:'raster',bank:'raster',options},outputs:{value:'raster',addresses:'raster'},time:true,
      run({source,bank,options},{seed,time}){return E.tileBleed(source,bank,{seed,time,...options});}
    },
    'fx.tileStrideSlip':raster(E.tileStrideSlip,{value:'raster',addresses:'raster'}),
    'fx.scanlineRemap':raster(E.scanlineRemap,{value:'raster',addresses:'raster'}),
    'fx.blockSubstitute':{
      inputs:{source:'raster',banks:options,options},outputs:{value:'raster',mask:'raster'},
      run({source,banks,options}){return E.blockSubstitute(source,{...options,banks});}
    },
    'fx.bitplane':{
      inputs:{source:'raster',palette:'palette',bank:{type:'any',default:null},options},
      outputs:{value:'raster',indices:'raster'},
      run({source,palette,bank,options}){return E.bitplane(source,palette,{...options,bank:bank ?? options.bank});}
    },
    'fx.paletteFault':{
      inputs:{source:'raster',palette:'palette',options},outputs:{value:'raster',indices:'raster'},
      run({source,palette,options}){return E.paletteFault(source,palette,options);}
    },
    'fx.analyze':raster(E.analyze,{paths:'array<path>',points:'array<vec2>',regions:'array<record>',mask:'raster'})
  });
  delete P.pixelEffectSupport;
  Object.freeze(E);
})(KIT.procedural);
