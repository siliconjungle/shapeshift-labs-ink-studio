/* Stock graph operations for standalone pixel effects. */
(function (P) {
  const E=P.pixelEffects, options={type:'record',default:{}};
  const raster=(apply,outputs={value:'raster'})=>({
    inputs:{source:'raster',options},outputs,run({source,options}){return apply(source,options);}
  });
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
    'fx.tileScramble':{
      inputs:{source:'raster',options},outputs:{value:'raster',addresses:'raster'},time:true,
      run({source,options},{seed,time}){return E.tileScramble(source,{seed,time,...options});}
    },
    'fx.analyze':raster(E.analyze,{paths:'array<path>',points:'array<vec2>',regions:'array<record>',mask:'raster'})
  });
  delete P.pixelEffectSupport;
  Object.freeze(E);
})(KIT.procedural);
