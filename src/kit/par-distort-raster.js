/* Versioned graph entry points for warps, independently timed pixels and projections. */
(function(P) {
  const W=P.rasterWarp, {prepareTime}=P.rasterWarpSupport;
  const options={type:'record',default:{}}, mapped={value:'raster',field:'raster'};
  const confidence={type:'any',default:null};
  W.operations=Object.freeze({
    'warp.field':{
      inputs:{width:'number',height:'number',matrix:{type:'array<vec3>',default:[[1,0,0],[0,1,0]]}},
      outputs:{value:'raster'},run(input){return {value:W.field(input)};}
    },
    'warp.sample':{
      inputs:{source:'raster',field:'raster',options},outputs:{value:'raster'},
      run({source,field,options}){return {value:W.sample(source,field,options)};}
    },
    'warp.opticalFlow':{
      inputs:{before:'raster',after:'raster',options},outputs:{value:'raster',confidence:'raster'},
      run({before,after,options}){return W.opticalFlow(before,after,options);}
    },
    'warp.cameraMotion':{
      inputs:{motion:'raster',confidence,mask:{type:'any',default:null},options},
      outputs:{value:'raster',camera:'raster',field:'raster',inliers:'raster',transform:'record'},
      run({motion,confidence,mask,options}){
        return W.cameraMotion(motion,{...options,confidence:confidence ?? options.confidence,mask:mask ?? options.mask});
      }
    },
    'warp.flow':{
      inputs:{source:'raster',motion:'raster',confidence,options},outputs:mapped,
      run({source,motion,confidence,options}){return W.flow(source,motion,{...options,confidence:confidence ?? options.confidence});}
    },
    'warp.flowPoints':{
      inputs:{points:'array<vec2>',motion:'raster',confidence,options},outputs:{value:'array<vec2>'},
      run({points,motion,confidence,options}){return {value:W.flowPoints(points,motion,{...options,confidence:confidence ?? options.confidence})};}
    },
    'warp.mesh':{
      inputs:{source:'raster',control:'record',options},outputs:mapped,
      run({source,control,options}){return W.mesh(source,control,options);}
    },
    'warp.grid':{
      inputs:{source:'raster',control:'record',options},outputs:mapped,
      run({source,control,options}){return W.grid(source,control,options);}
    },
    'warp.polar':{
      inputs:{source:'raster',options},outputs:mapped,
      run({source,options}){return W.polar(source,options);}
    },
    'warp.displace':{
      inputs:{source:'raster',map:'raster',options},outputs:mapped,
      run({source,map,options}){return W.displace(source,map,options);}
    },
    'warp.refract':{
      inputs:{source:'raster',map:'raster',options},outputs:mapped,
      run({source,map,options}){return W.refract(source,map,options);}
    },
    'warp.morph':{
      inputs:{a:'raster',b:'raster',control:'record',amount:{type:'number',default:.5},options},outputs:{value:'raster'},
      run({a,b,control,amount,options}){return {value:W.morph(a,b,control,amount,options)};}
    },
    'warp.frames':{
      inputs:{source:'any',options},outputs:{value:'array<raster>',fps:'number',times:'array<number>',loop:'boolean'},
      run({source,options}){return W.frames(source,options);}
    },
    'warp.timeRemap':{
      inputs:{frames:{type:'array<raster>',default:[]},history:{type:'any',default:null},map:'raster',
        mask:{type:'any',default:null},valid:{type:'any',default:null},options},outputs:{value:'raster'},time:true,
      instantiate(){
        let prepared,priorSource,priorOptions,cache;
        return ({frames,history,map,mask,valid,options},{time})=>{
          if (history!=null && frames.length) throw new TypeError('Time remap needs frames or bank history');
          const source=history ?? frames;
          if (!prepared || priorSource!==source || priorOptions!==options) {
            if (priorOptions!==options) cache=new WeakMap();
            // Bank snapshots share immutable frames as the window advances.
            prepared=prepareTime(source,options,history!=null && Object.isFrozen(history) ? cache : undefined);
            priorSource=source; priorOptions=options;
          }
          return {value:prepared(map,time,{mask,valid})};
        };
      }
    },
    'warp.surface':{
      inputs:{source:'raster',mesh:'mesh',options},outputs:{value:'record'},
      run({source,mesh,options}){return {value:W.surface(source,mesh,options)};}
    },
    'warp.project':{
      inputs:{source:'raster',options},outputs:{value:'record'},
      run({source,options}){return {value:W.project(source,options)};}
    }
  });
  delete P.rasterWarpSupport;
  Object.freeze(W);
})(KIT.procedural);
