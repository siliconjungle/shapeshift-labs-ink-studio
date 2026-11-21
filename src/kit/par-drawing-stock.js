/* Drawing, layout, and region operations for versioned graph projects. */
(function (P) {
  const D = P.drawing2d;
  const options = {type:'record',default:{}};
  D.operations = Object.freeze({
    'draw.render': {
      inputs:{width:'number',height:'number',commands:'array<record>',edges:{type:'string',default:'smooth'}},
      outputs:{value:'raster'},run(inputs){return {value:D.render(inputs)};}
    },
    'draw.trackedAnchors': {
      description: 'Attach local drawing and mask commands to observed features over time.',
      inputs: {
        observations: { type: 'array<record>', description: 'Timestamped feature sets with stable IDs and pixel centers.' },
        bindings: { type: 'array<record>', description: 'Feature IDs, local commands, and per-anchor position and timing settings.' },
        options
      },
      outputs: { value: 'array<record>', masks: 'array<record>', anchors: 'array<record>' },
      time: true,
      instantiate() {
        let clip, observed, bound;
        const run = ({ observations, bindings, options }, { time }) => {
          if (observations !== observed || bindings !== bound) {
            clip = D.trackedAnchors(observations, bindings);
            [observed, bound] = [observations, bindings];
          }
          return clip.sample(options.time ?? time);
        };
        run.clear = () => { clip = observed = bound = undefined; };
        return run;
      }
    },
    'draw.path': {
      inputs:{d:'string',options},outputs:{value:'path'},run({d,options}){return {value:D.path(d,options)};}
    },
    'draw.ribbon': {
      inputs:{source:'path',options},outputs:{value:'record'},run({source,options}){return {value:D.ribbon(source,options)};}
    },
    'draw.text': {
      inputs:{text:'string',options},outputs:{value:'raster',metrics:'record',anchors:'record'},run({text,options}){return D.text(text,options);}
    },
    'layout.boxes': {
      inputs:{width:'number',height:'number',boxes:'array<record>'},outputs:{value:'record'},
      run(inputs){return {value:D.boxes(inputs)};}
    },
    'layout.place': {
      inputs:{source:'raster',box:'record',options},outputs:{value:'record'},
      run({source,box,options}){return {value:D.place(source,box,options)};}
    },
    'raster.floodFill': {
      inputs:{source:'raster',options},outputs:{value:'raster',mask:'raster',stats:'record'},
      run({source,options}){return D.floodFill(source,options);}
    },
    'raster.components': {
      inputs:{source:'raster',options},outputs:{value:'array<record>',labels:'raster'},
      run({source,options}){return D.components(source,options);}
    },
    'raster.extractComponent': {
      inputs:{source:'raster',labels:'raster',component:'record'},outputs:{value:'raster'},
      run({source,labels,component}){return {value:D.extract(source,labels,component)};}
    }
  });
  Object.freeze(D);
})(KIT.procedural);
