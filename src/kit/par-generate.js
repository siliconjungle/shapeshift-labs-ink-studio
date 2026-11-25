/* Stock typed graph ports for the headless generator library. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const options = { type: 'record', default: {} };
  const input = (type, value) => ({ type, default: value });
  const value = (type, generate) => ({ outputs: { value: type }, run: (inputs, context) => ({ value: generate(inputs, context) }) });
  const seeded = (options, context) => ({ seed: context.seed, ...options });
  const timed = (options, context) => ({ time: context.time, ...seeded(options, context) });
  const fieldMaterials=input('array<fieldSpriteMaterial>',[]);
  const fieldPaint={value:'raster',materialId:'raster'};

  G.operations = Object.freeze({
    'proc.noise': {
      seed: 'options',
      inputs: { definition: input('record', { type: 'simplex', axes: ['x', 'y'] }), options },
      ...value('field', ({ definition, options }, context) => G.noise(definition, seeded(options, context)))
    },
    'proc.noiseFamily': {
      description: 'Evaluate a named two-, three- or four-coordinate noise field for procedural sampling.',
      seed: 'options', inputs: { family: input('string','perlin'), options },
      outputs: { value: 'field', info: 'record' },
      run({ family,options }, context) {
        const field = P.namedNoise.create(family, seeded(options,context));
        return { value:field, info:field.spec };
      }
    },
    'proc.pattern': { inputs: { options }, ...value('field', ({ options }) => G.pattern(options)) },
    'proc.sample': {
      inputs: { source: 'field', options }, time: true,
      ...value('raster', ({ source, options }, { time }) => G.sample(source, { time, ...options }))
    },
    'proc.plasma': {
      description: 'Combine independently animated oscillators and map the result to indexed color.',
      inputs: { geometry: input('array<record>', P.generatorSupport.plasmaGeometry), motion: options,
        palette: input('palette', P.generatorSupport.plasmaPalette), options },
      outputs: { value: 'displayRaster', indices: 'raster', palette: 'palette', field: 'raster' }, time: true,
      run({ geometry, motion, palette, options }, { time }) {
        return G.plasma({ time, ...options, geometry, motion, palette });
      }
    },
    'proc.scatter': {
      seed: 'options',
      inputs: { options }, outputs: { value: 'points', samples: 'array<record>', report: 'record' }, time: true,
      run: ({ options }, context) => G.scatter(timed(options, context))
    },
    'proc.reaction': {
      seed: 'options',
      inputs: { steps: input('number', 400), options },
      outputs: { value: 'raster', u: 'raster', report: 'record' },
      run: ({ steps, options }, context) => G.reaction({ ...seeded(options, context), steps })
    },
    'proc.fieldSprite': {
      description: 'Trace a signed field with editable materials and expose native-grid position, normal, depth, light and coverage.',
      inputs:{source:'field',materials:fieldMaterials,options},
      outputs:{...fieldPaint,depth:'raster',normal:'raster',position:'raster',
        illumination:'raster',coverage:'raster',surface:'fieldSpriteSurface'},time:true,
      run({source,materials,options},{time}){return G.fieldSprite(source,{time,...options,materials});}
    },
    'proc.fieldMaterial': {
      description:'Prepare a reusable field-sprite material with object-space texture, optional masks and a light ramp.',
      inputs:{texture:input('raster',P.generatorSupport.fieldMaterialTexture),
        mask:input('any',null),maskTexture:input('any',null),ramp:input('any',null),options},
      ...value('fieldSpriteMaterial',({texture,mask,maskTexture,ramp,options})=>
        G.fieldMaterial({...options,texture,mask,maskTexture,ramp}))
    },
    'proc.fieldSpriteShade': {
      description:'Repaint an existing field-sprite trace without evaluating the signed field again.',
      inputs:{surface:'fieldSpriteSurface',materials:fieldMaterials,options},outputs:fieldPaint,time:true,
      run({surface,materials,options},{time}){return G.shadeFieldSprite(surface,materials,{time,...options});}
    },
    'proc.sphereMap': {
      description: 'Project an orthographic sphere into a UV atlas, with view normals, depth and banded light.',
      inputs: { options }, outputs:{ value:'raster', normal:'raster', depth:'raster', illumination:'raster' },
      run: ({ options }) => G.sphereMap(options)
    },
    'proc.projectSphere': {
      description: 'Rotate and light a equirectangular source on the native pixel grid.',
      inputs: { source:'raster', options }, outputs:{ value:'raster', uv:'raster', normal:'raster', depth:'raster', illumination:'raster' },
      run: ({ source, options }) => G.projectSphere(source, options)
    },
    'proc.discharge': {
      description: 'Trace a seeded looping discharge along a path and return independently composable core, edge and halo rasters.',
      seed:'options', time:true, inputs: { options },
      outputs:{ value:'raster', filament:'raster', fringe:'raster', halo:'raster', paths:'array<record>' },
      run: ({ options }, context) => G.discharge(timed(options, context))
    },
    'proc.cellEdges': {
      description: 'Sample seeded Voronoi boundary distances, center distances and stable cell addresses.',
      seed:'options', inputs:{ options }, outputs:{ value:'raster', center:'raster', index:'raster' },
      run: ({ options }, context) => G.cellEdges(seeded(options, context))
    },
    'proc.flowPlume': {
      description: 'Draw an oriented, shaped plume with looping turbulence, pressure bands and separate heat and coverage.',
      seed:'options', time:true, inputs:{ options }, outputs:{ value:'raster', heat:'raster', coverage:'raster' },
      run: ({ options }, context) => G.flowPlume(timed(options, context))
    },
    'proc.vortex': {
      description: 'Advect a layer of shaded looped contours around a tapered vortex, with reusable near and far passes.',
      seed:'options', time:true, inputs:{ options }, outputs:{ value:'raster', back:'raster', front:'raster', paths:'array<record>' },
      run: ({ options }, context) => G.vortex(timed(options, context))
    },
    'proc.repeat': {
      inputs: { source: 'raster', options },
      ...value('raster', ({ source, options }) => G.repeat(source, options))
    },
    'proc.tiles': {
      seed: 'options',
      inputs: { definitions: 'array<record>', options },
      ...value('record', ({ definitions, options }, context) => G.tiles(definitions, seeded(options, context)))
    },
    'proc.tileImage': {
      inputs: { layout: 'record', images: 'record' },
      ...value('raster', ({ layout, images }) => G.tileImage(layout, images))
    },
    'proc.path': {
      inputs: { points: 'points', options }, outputs: { value: 'path', points: 'points', length: 'number' },
      run: ({ points, options }) => G.path(points, options)
    },
    'proc.smpteColorBars': { inputs: { options }, ...value('raster', ({ options }) => G.smpteColorBars(options)) },
    'proc.tvStatic': {
      seed: 'options',
      inputs: { options }, time: true,
      ...value('raster', ({ options }, context) => G.tvStatic(timed(options, context)))
    },
    'proc.rain': {
      seed: 'options',
      inputs: { options }, outputs: { value: 'raster', particles: 'array<record>' }, time: true,
      run: ({ options }, context) => G.rain(timed(options, context))
    },
    'proc.sparks': {
      seed: 'options',
      inputs: { options }, outputs: { value: 'raster', particles: 'array<record>' }, time: true,
      run: ({ options }, context) => G.sparks(timed(options, context))
    },
    'proc.plume': {
      seed: 'options',
      inputs: { options }, outputs: { value: 'raster', recipe: 'record' }, time: true,
      run: ({ options }, context) => G.plume(timed(options, context))
    },
    'proc.tree': {
      seed: 'options',
      inputs: { options }, outputs: { value: 'raster', branches: 'array<record>', leaves: 'points' },
      run: ({ options }, context) => G.tree(seeded(options, context))
    },
    'proc.cable': {
      inputs: { start: 'worldPosition', end: 'worldPosition', options },
      outputs: { value: 'raster', path: 'path', length: 'number' },
      run: ({ start, end, options }) => G.cable(start, end, options)
    },
    'proc.parallax': {
      inputs: { layers: 'array<record>', options }, time: true,
      ...value('raster', ({ layers, options }, { time }) => G.parallax(layers, { time, ...options }))
    },
    'proc.horizon': {
      inputs: { bands: 'array<record>', options },
      ...value('record', ({ bands, options }) => G.horizon(bands, options))
    }
  });
  delete P.generatorSupport;
})(KIT);
