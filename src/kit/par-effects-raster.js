/* Stock graph operations for standalone pixel effects. */
(function (P) {
  const E=P.pixelEffects, options={type:'record',default:{}};
  const { image } = P.pixelEffectSupport;
  const raster=(apply,outputs={value:'raster'})=>({
    inputs:{source:'raster',options},outputs,run({source,options}){return apply(source,options);}
  });

  function trackSequence(frames) {
    if (!Array.isArray(frames) || !frames.length || frames.length > 8192)
      throw new RangeError('Region tracking needs 1 to 8192 frames');
    const { width, height } = frames[0] ?? {};
    if (frames.length * width * height > 64e6 ||
        Array.from(frames).some(frame => !frame || frame.width !== width || frame.height !== height))
      throw new RangeError('Region tracking needs same-size frames within its sequence pixel budget');
  }

  E.regionObservations = function regionObservations(frames, { fps = 12, contours = false, ...settings } = {}) {
    if (typeof contours !== 'boolean') throw new TypeError('Region observation contours must be a boolean');
    trackSequence(frames);
    P.animationGraph.frameIndex(frames.length, 0, { fps });
    const tracker = E.createRegionTracker(settings);
    let regions = 0, vertices = 0;
    return P.data.freeze(frames.map((source, frame) => {
      const time = frame / fps, { value } = tracker.update(source, time);
      regions += value.length;
      if (regions > 262144) throw new RangeError('Region observations exceed the tracking record budget');
      return { time, regions: value.map(({ id, center, bounds, confidence, contours: outline }) => {
        if (contours) {
          for (const ring of outline) vertices += ring.points.length;
          if (vertices > 262144) throw new RangeError('Region observations exceed the contour vertex budget');
        }
        return { id, center, bounds, confidence, ...(contours && { contours: outline }) };
      }) };
    }));
  };

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
      seed: 'options',
      inputs:{source:'raster',options},outputs:{value:'raster'},time:true,
      run({source,options},{seed,time}){return {value:E.tvStatic(source,{seed,time,...options})};}
    },
    'fx.tileScramble':{
      seed: 'options',
      inputs:{source:'raster',options},outputs:{value:'raster',addresses:'raster'},time:true,
      run({source,options},{seed,time}){return E.tileScramble(source,{seed,time,...options});}
    },
    'fx.tileBleed':{
      seed: 'options',
      inputs:{source:'raster',bank:'raster',options},outputs:{value:'raster',addresses:'raster'},time:true,
      run({source,bank,options},{seed,time}){return E.tileBleed(source,bank,{seed,time,...options});}
    },
    'fx.tileStrideSlip':raster(E.tileStrideSlip,{value:'raster',addresses:'raster'}),
    'fx.scanlineRemap':raster(E.scanlineRemap,{value:'raster',addresses:'raster'}),
    'fx.rasterSchedule':{
      description:'Write palette slots, source offsets and pixel sizes on specified output rows.',
      inputs:{source:'raster',options},outputs:{value:'displayRaster'},time:true,
      run({source,options},{time}){return {value:E.rasterSchedule(source,{time,...options})};}
    },
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
    'fx.trackRegions': {
      inputs: { frames: 'array<raster>', options },
      outputs: { value: 'array<record>', labels: 'raster', time: 'number', frame: 'number', events: 'array<record>' },
      time: true,
      instantiate() {
        let tracker, priorFrames, priorOptions, last = -1, result;
        const run = ({ frames, options }, { time }) => {
          const { fps = 12, time: localTime = time, mode, ...settings } = options;
          const { index } = P.animationGraph.frameIndex(frames.length, localTime, { fps, mode });
          if (frames !== priorFrames || options !== priorOptions || index < last) {
            trackSequence(frames);
            tracker = E.createRegionTracker(settings);
            [priorFrames, priorOptions, last] = [frames, options, -1];
          }
          while (last < index) {
            const frame = last + 1;
            result = { ...tracker.update(frames[frame], frame / fps), frame };
            last = frame;
          }
          return result;
        };
        run.clear = () => { tracker = priorFrames = priorOptions = result = undefined; last = -1; };
        return run;
      }
    },
    'fx.regionObservations': {
      description: 'Measure timestamped region centers, bounds, and confidence across raster frames.',
      inputs: { frames: 'array<raster>', options }, outputs: { value: 'array<record>' },
      run({ frames, options }) { return { value: E.regionObservations(frames, options) }; }
    },
    'fx.analyze':raster(E.analyze,{paths:'array<path>',points:'array<vec2>',regions:'array<record>',mask:'raster'})
  });
  delete P.pixelEffectSupport;
  Object.freeze(E);
})(KIT.procedural);
