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

  const zero = param('vec3', [0, 0, 0]), one = param('vec3', [1, 1, 1]);
  const has = (spec, name) => Object.hasOwn(spec.inputs ?? {}, name) || Object.hasOwn(spec.params ?? {}, name);
  const geometryOptions = (inputs, typed, build) => {
    const config = spec => ({
      inputs: { ...inputs, options, ...typed },
      ...value('mesh', ({ options, ...given }) =>
        build(given, { ...options, ...Object.fromEntries(Object.keys(typed)
          .filter(key => spec ? has(spec, key) : Object.hasOwn(given, key)).map(key => [key, given[key]])) }))
    });
    return { ...config(), specialize: config };
  };
  const primitiveInputs = {
    sphere: { radius: param('number', .7) },
    box: { half: param('vec3', [.6, .6, .6]), round: param('number', 0) },
    torus: { major: param('number', .68), minor: param('number', .19) },
    capsule: { radius: param('number', .32), length: param('number', 1) },
    cylinder: { radius: param('number', .55), length: param('number', 1) }
  };
  const primitive = kind => ({
    description: 'Construct a bounded signed primitive with typed size and pose inputs.',
    inputs: { kind: param('string', kind), center: zero, rotation: zero, ...primitiveInputs[kind] },
    ...value('field', ({ kind, ...dimensions }) => A.shape(kind, dimensions))
  });
  const bound = {
    description: 'Replace the sampling bounds of a signed field.',
    inputs: { source: 'field', min: param('vec3', [-1, -1, -1]), max: one },
    ...value('field', ({ source, min, max }) => A.boundSDF(source, { min, max }))
  };
  const transform = {
    description: 'Translate, rotate or scale a signed field and its attributes.',
    inputs: { source: 'field', options, position: zero, rotation: zero, scale: one },
    ...value('field', ({ source, options, ...pose }) => A.transformSDF(source, { ...pose, ...options }))
  };
  const attributes = {
    description: 'Assign a stable object ID, material ID, or normalized RGB to a signed field.',
    inputs: { source: 'field', objectId: param('string', ''), materialId: param('string', ''),
      color: param('srgb', [1, 1, 1]) },
    ...value('field', ({ source, ...settings }) => A.tagSDF(source, settings))
  };
  A.sdfOperations = Object.freeze({
    'sdf.shape': {
      inputs: { kind: param('string', 'sphere'), options },
      ...value('field', ({ kind, options }) => A.shape(kind, options))
    },
    'sdf.primitive': {
      ...primitive('sphere'),
      specialize(spec) {
        const kind = GraphControlReferences.literal(spec, 'kind', 'sphere');
        if (typeof kind !== 'string' || !Object.hasOwn(primitiveInputs, kind)) throw new RangeError('SDF primitive needs a literal shape kind');
        return primitive(kind);
      }
    },
    'sdf.bound': { ...bound, specialize: spec => has(spec, 'bounds') ? {
      inputs: { source: 'field', bounds: 'record' },
      ...value('field', ({ source, bounds }) => A.boundSDF(source, bounds))
    } : bound },
    'sdf.bounds': {
      description: 'Read the minimum, maximum, center and size of a field domain.',
      inputs: { source: 'field' }, outputs: { value: 'vec3', min: 'vec3', max: 'vec3', center: 'vec3' },
      run({ source }) {
        const { min, max } = sdfExtent(source);
        return { value: max.map((n, i) => n - min[i]), min, max, center: max.map((n, i) => (n + min[i]) / 2) };
      }
    },
    'sdf.transform': {
      ...transform,
      specialize: spec => ({ ...transform, ...value('field', ({ source, options, ...pose }) =>
        A.transformSDF(source, { ...options, ...Object.fromEntries(Object.entries(pose).filter(([key]) => has(spec, key))) })) })
    },
    'sdf.combine': {
      inputs: { sources: 'array<field>', options },
      ...value('field', ({ sources, options }) => A.combineSDF(sources, options))
    },
    'sdf.boolean': {
      description: 'Union, intersect or subtract two signed fields with deterministic surface ownership.',
      inputs: { a: 'field', b: 'field', operation: param('string', 'union') },
      ...value('field', ({ a, b, operation }) => A.combineSDF([a, b], { operation }))
    },
    'sdf.repeat': {
      description: 'Repeat a bounded field in a finite grid, optionally assigning object IDs from the cell indices.',
      inputs: { source: 'field', count: param('vec3', [2, 1, 1]), spacing: param('vec3', [1.5, 1.5, 1.5]),
        center: zero, idPrefix: param('string', '') },
      ...value('field', ({ source, ...settings }) => A.repeatSDF(source, settings))
    },
    'sdf.symmetry': {
      description: 'Union a field with its reflection across an axis-aligned plane.',
      inputs: { source: 'field', axis: param('string', 'x'), plane: param('number', 0) },
      ...value('field', ({ source, ...settings }) => A.symmetrySDF(source, settings))
    },
    'sdf.attributes': {
      ...attributes,
      specialize(spec) {
        if (has(spec, 'color')) return attributes;
        const { color, ...inputs } = attributes.inputs;
        return { ...attributes, inputs };
      }
    },
    'sdf.sample': {
      description: 'Query signed distance and surface attributes at a point.',
      inputs: { source: 'field', position: zero }, outputs: { value: 'number', objectId: 'string',
        materialId: 'string', color: 'srgb', hasColor: 'boolean' }, time: true, system: true,
      run({ source, position }, { time }) {
        const tags = A.sdfTags(source, time)?.(...position);
        return { value: sdfSampler(source, time)(...position), objectId: tags?.objectId ?? '',
          materialId: tags?.materialId ?? '', color: tags?.color ?? [1, 1, 1], hasColor: !!tags?.color };
      }
    }
  });

  A.operations = Object.freeze({
    'textile.pattern': {
      inputs: { kind: param('string', 'stitch'), options },
      ...value('record', ({ kind, options }) => {
        if (!['stitch', 'knit', 'weave'].includes(kind)) throw new RangeError('Unknown textile pattern: ' + kind);
        return K.textile[kind](options);
      })
    },
    'textile.world': {
      inputs: { source: 'record', options },
      ...value('world', ({ source, options }) => K.textile.world(source, options))
    },
    'geo.mesh': { inputs: { source: 'mesh' }, ...value('mesh', ({ source }) => A.mesh(source)) },
    'geo.box': {
      description: 'Build an indexed box with typed center and half sizes.',
      ...geometryOptions({}, { center: zero, half: param('vec3', [.5, .5, .5]) }, (_, settings) => A.box(settings))
    },
    'geo.tube': {
      description: 'Construct an indexed tube with typed endpoints, radius and side count.',
      ...geometryOptions({ start: 'worldPosition', end: 'worldPosition' },
        { radius: param('number', .2), sides: param('integer', 12) },
        ({ start, end }, settings) => A.tube(start, end, settings))
    },
    'geo.triangulate': {
      inputs: { rings: 'array<points>', options },
      ...value('mesh', ({ rings, options }) => A.triangulate(rings, options))
    },
    'geo.transform': {
      description: 'Transform an indexed mesh with typed translation, rotation and scale.',
      ...geometryOptions({ source: 'mesh' }, { position: zero, rotation: zero, scale: one },
        ({ source }, settings) => A.transform(source, settings))
    },
    'geo.measure': {
      description: 'Measure indexed geometry bounds, topology counts, materials and attribute channels.',
      inputs: { source: 'mesh' }, outputs: { value: 'record', min: 'vec3', max: 'vec3', center: 'vec3', size: 'vec3' },
      run({ source }) {
        const value = A.measure(source), { min, max } = value.bounds;
        return { value, min, max, center: max.map((n, i) => (n + min[i]) / 2), size: max.map((n, i) => n - min[i]) };
      }
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
    ...A.sdfOperations,
    'sdf.mesh': {
      inputs: { source: 'field', options }, time: true,
      ...value('mesh', ({ source, options }, ctx) => A.sdfMesh(source, {...clock(options, ctx),onModelingWork:ctx.recordWork}))
    },
    'sdf.voxels': {
      inputs:{source:'field',options}, time:true, ...value('record',({source,options},ctx)=>{
        const {bounds,time=ctx.time,...rest}=options;
        return K.voxelSurface.fromSdf(sdfSampler(source,time),{...rest,bounds:bounds??sdfExtent(source)});
      })
    },
    'voxels.world': {inputs:{source:'record',options},...value('world',({source,options})=>K.voxelSurface.world(source,options))},
    'voxels.mesh': {inputs:{source:'record',options},...value('mesh',({source,options})=>K.voxelSurface.toMesh(source,options))},
    'sdf.facets': {
      inputs:{source:'field',options},outputs:{value:'record',mesh:'mesh'},time:true,
      run:({source,options},ctx)=>A.facetedSDF(source,clock(options,ctx))
    },
    'sdf.slices': {
      inputs: { source: 'field', options }, outputs: { value: 'array<raster>', objectId: 'array<raster>', materialId: 'array<raster>', layout: 'record' }, time: true,
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
