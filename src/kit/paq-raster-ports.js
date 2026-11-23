/* Stock graph nodes for standalone canvases, composition, and sheet export. */
(function (P) {
  const R = P.raster;
  const options = {type: 'record', default: {}};
  const unary = (action, args = {options}) => ({
    inputs: {source: 'raster', ...args}, outputs: {value: 'raster'},
    run({source, options}) { return {value: action(source, options)}; }
  });
  const stack = ordering => ({
    inputs: {width: 'number', height: 'number', layers: 'array<record>', options},
    outputs: {value: 'raster', ...(ordering !== 'stack' && {[ordering]: 'raster'})},
    run({width, height, layers, options}) { return R.stack({...options, width, height, layers, ordering}); }
  });
  R.operations = Object.freeze({
    'raster.canvas': {
      inputs: {width: 'pixelCount', height: 'pixelCount', color: {type: 'rgb8', default: [0, 0, 0, 0]}},
      outputs: {value: 'displayRaster'}, run(inputs) { return {value: R.canvas(inputs)}; }
    },
    'raster.rgba': unary(R.rgba, {}),
    'raster.select': {
      description:'Select one raster from an ordered set of graph passes.',
      inputs:{sources:'array<raster>',index:'number'}, outputs:{value:'raster'},
      run({sources,index}) {
        if (!Number.isSafeInteger(index) || index<0 || index>=sources.length)
          throw new RangeError('Raster selection index is out of range');
        return {value:sources[index]};
      }
    },
    'raster.channel': unary(R.channel),
    'raster.crop': unary(R.crop),
    'raster.resize': unary(R.resize),
    'raster.nineSlice': unary(R.nineSlice),
    'raster.channels': {
      inputs: {planes: 'array'}, outputs: {value: 'raster'}, run({planes}) { return {value: R.channels(planes)}; }
    },
    'raster.math': {
      inputs: {a: 'raster', b: 'any', op: 'string'}, outputs: {value: 'raster'},
      run({a, b, op}) { return {value: R.math(a, b, op)}; }
    },
    'raster.mask': {
      inputs: {source: 'raster', mask: 'raster', options}, outputs: {value: 'raster'},
      run({source, mask, options}) { return {value: R.mask(source, mask, options)}; }
    },
    'raster.blend': {
      inputs: {background: 'raster', foreground: 'raster', options}, outputs: {value: 'raster'},
      run({background, foreground, options}) { return {value: R.blend(background, foreground, options)}; }
    },
    'raster.mix': {
      description:'Crossfade aligned raster samples with optional alpha or RGB-mean coverage.',
      inputs:{source:'raster',edited:'raster',mask:{type:'any',default:null},options},
      outputs:{value:'raster'},run({source,edited,mask,options}){return {value:R.mix(source,edited,mask,options)};}
    },
    'raster.stack': stack('stack'),
    'raster.depth': stack('depth'),
    'raster.height': stack('height'),
    'raster.spriteLayer': {
      inputs: {width: 'number', height: 'number', sprites: 'array<record>', options},
      outputs: {value: 'raster', report: 'record'}, time: true,
      run({width, height, sprites, options}, {time}) { return R.spriteLayer({time, ...options, width, height, sprites}); }
    },
    'raster.spriteStack': {
      inputs: {source: 'any', options}, outputs: {value: 'raster'},
      run({source, options}) { return {value: R.spriteStack(source, options)}; }
    },
    'raster.pack': {
      inputs: {sprites: 'array', options}, outputs: {value: 'raster', atlas: 'atlas', metadata: 'record'},
      run({sprites, options}) { return R.pack(sprites, options); }
    },
    'raster.frame': {
      inputs: {source: 'any', options}, outputs: {value: 'raster'}, time: true,
      instantiate() {
        let prior, asset;
        return ({source, options}, {time}) => {
          if (source !== prior || !asset) {
            asset = P.graph.raster(source);
            prior = source;
          }
          return {value: asset.composite(time, options)};
        };
      }
    }
  });
  delete P.rasterSupport;
  Object.freeze(R);
})(KIT.procedural);
