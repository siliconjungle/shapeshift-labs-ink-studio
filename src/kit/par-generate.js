/* Stock typed graph ports for the headless generator library. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const options = { type: 'record', default: {} };
  const input = (type, value) => ({ type, default: value });
  const value = (type, generate) => ({ outputs: { value: type }, run: (inputs, context) => ({ value: generate(inputs, context) }) });
  const seeded = (options, context) => ({ seed: context.seed, ...options });
  const timed = (options, context) => ({ time: context.time, ...seeded(options, context) });

  G.operations = Object.freeze({
    'proc.noise': {
      seed: 'options',
      inputs: { definition: input('record', { type: 'simplex', axes: ['x', 'y'] }), options },
      ...value('field', ({ definition, options }, context) => G.noise(definition, seeded(options, context)))
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
