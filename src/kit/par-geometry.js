/* Stock typed geometry, signed-field, camera, light and sprite rig nodes. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph;
  const {sdfExtent,sdfSampler}=P.sceneGraphSupport;
  const param = (type, value) => ({ type, default: value });
  const options = param('record', {});
  const lights = param('array<record>', []);
  const value = (type, evaluate) => ({ outputs: { value: type }, run: (inputs, ctx) => ({ value: evaluate(inputs, ctx) }) });
  const clock = (options, ctx) => ({ time: ctx.time, ...options });
  const slices = { value: 'mesh', bounds: 'record', report: 'record' };

  A.operations = Object.freeze({
    'geo.mesh': { inputs: { source: 'mesh' }, ...value('mesh', ({ source }) => A.mesh(source)) },
    'geo.box': { inputs: { options }, ...value('mesh', ({ options }) => A.box(options)) },
    'geo.tube': {
      inputs: { start: 'worldPosition', end: 'worldPosition', options },
      ...value('mesh', ({ start, end, options }) => A.tube(start, end, options))
    },
    'geo.triangulate': {
      inputs: { rings: 'array<points>', options },
      ...value('mesh', ({ rings, options }) => A.triangulate(rings, options))
    },
    'geo.transform': {
      inputs: { source: 'mesh', options },
      ...value('mesh', ({ source, options }) => A.transform(source, options))
    },
    'geo.merge': { inputs: { sources: 'array<mesh>' }, ...value('mesh', ({ sources }) => A.merge(sources)) },
    'geo.clip': {
      inputs: { source: 'mesh', planes: 'array<record>', options },
      ...value('mesh', ({ source, planes, options }) => A.clip(source, planes, options))
    },
    'geo.scrambleIndices': {
      seed: 'options',
      inputs: { source: 'mesh', options },
      outputs: { value: 'mesh', changes: 'array<record>', report: 'record' },
      run: ({ source, options }, { seed }) => A.scrambleIndices(source, { seed, ...options })
    },
    'geo.extrudeImage': {
      inputs: { source: 'raster', options }, outputs: { ...slices, front: 'mesh' },
      run: ({ source, options }) => A.extrudeImage(source, options)
    },
    'geo.sliceStack': {
      inputs: { slices: 'array<raster>', options }, outputs: slices,
      run: ({ slices, options }) => A.sliceStack(slices, options)
    },
    'paper.stack': {inputs:{layers:'array<record>',options},...value('record',({layers,options})=>K.paper.stack(layers,options))},
    'paper.relief': {inputs:{source:'field',options},time:true,...value('record',({source,options},ctx)=>{
      const {levels=[.1,.3,.5],bounds,slice=0,...rest}=options;
      if(!Number.isFinite(slice))throw new RangeError('Paper relief slice must be finite');
      const box=sdfExtent(source),sample=sdfSampler(source,options.time??ctx.time);
      return K.paper.relief((x,y)=>-sample(x,y,slice),{...rest,levels,bounds:bounds??{min:box.min.slice(0,2),max:box.max.slice(0,2)}});
    })},
    'paper.world': {inputs:{source:'record',options},...value('world',({source,options})=>K.paper.world(source,options))},
    'sdf.shape': {
      inputs: { kind: param('string', 'sphere'), options },
      ...value('field', ({ kind, options }) => A.shape(kind, options))
    },
    'sdf.bound': {
      inputs: { source: 'field', bounds: 'record' },
      ...value('field', ({ source, bounds }) => A.boundSDF(source, bounds))
    },
    'sdf.transform': {
      inputs: { source: 'field', options },
      ...value('field', ({ source, options }) => A.transformSDF(source, options))
    },
    'sdf.combine': {
      inputs: { sources: 'array<field>', options },
      ...value('field', ({ sources, options }) => A.combineSDF(sources, options))
    },
    'sdf.mesh': {
      inputs: { source: 'field', options }, time: true,
      ...value('mesh', ({ source, options }, ctx) => A.sdfMesh(source, clock(options, ctx)))
    },
    'sdf.facets': {
      inputs:{source:'field',options},outputs:{value:'record',mesh:'mesh'},time:true,
      run:({source,options},ctx)=>A.facetedSDF(source,clock(options,ctx))
    },
    'sdf.slices': {
      inputs: { source: 'field', options }, outputs: { value: 'array<raster>', layout: 'record' }, time: true,
      run: ({ source, options }, ctx) => A.sdfSlices(source, clock(options, ctx))
    },
    'sdf.render': {
      inputs: { source: 'field', camera: options, lights, options },
      outputs: { value: 'displayRaster', frame: 'renderFrame', report: 'record' }, time: true,
      run: ({ source, camera, lights, options }, ctx) => A.renderSDF(source, { ...clock(options, ctx), camera, lights })
    },
    'scene.camera': { inputs: { options }, ...value('record', ({ options }) => A.camera(options)) },
    'scene.cameraTrack': {
      inputs: { definition: 'record', options }, outputs: { value: 'record', sample: 'record' }, time: true,
      run({ definition, options }, ctx) {
        const sample = A.cameraTrack(definition, clock(options, ctx));
        return { value: sample.camera, sample };
      }
    },
    'scene.light': {
      inputs: { kind: param('string', 'sun'), options },
      ...value('record', ({ kind, options }, { node }) => A.light(kind, { id: node, ...options }))
    },
    'scene.object': { inputs: { source: 'mesh', options },
      ...value('record', ({ source, options }, { node }) => A.object(source, { id: node, ...options }))
    },
    'scene.world': {
      seed: 'options',
      inputs: { objects: 'array<record>', options },
      ...value('world', ({ objects, options }, { seed }) => A.world(objects, { seed, ...options }))
    },
    'scene.diorama': {
      seed: 'definition',
      inputs: { definition: 'record', parameters: options }, time: true,
      ...value('world', ({ definition, parameters }, { time, seed }) => K.diorama.build(
        { seed, ...definition }, { parameterInputs: { ...parameters, time } }))
    },
    'rig.bindSprite': {
      inputs: { source: 'raster', bones: 'array<record>', options },
      ...value('record', ({ source, bones, options }) => A.bindSprite(source, bones, options))
    },
    'rig.pose': {
      inputs: { tracks: 'record', options }, time: true,
      ...value('record', ({ tracks, options }, { time }) => A.spritePose(tracks, options.time ?? time))
    },
    'rig.skinSprite': {
      inputs: { source: 'raster', bind: 'record', pose: options,
        motion: { type: 'record', default: {}, description: 'Optional rest and posed XY landmarks in output pixels.' },
        options },
      outputs: { value: 'raster', field: 'raster', points: 'points', joints: 'record' },
      run: ({ source, bind, pose, motion, options }) => A.skinSprite(source, bind, pose,
        Object.keys(motion).length ? { ...options, motion } : options)
    }
  });
  delete P.sceneGraphSupport;
})(KIT);
