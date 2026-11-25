/* Consume shared material defaults at generator and output nodes. */
(function (P) {
  function fit(source, settings) {
    const base = MaterialBaseSettings.resolve(settings);
    const { width, height } = base.size;
    const { pixelPitchMm } = MaterialBaseSettings.measure(base);
    const images = P.graphImages;
    if (!images.valid(source)) throw new TypeError('Material image output needs a typed image');
    const prior = source.descriptor;
    const descriptor = { ...prior, tiling: base.tiling, pixelPitchMm };
    const prepared = prior.tiling.u === base.tiling.u && prior.tiling.v === base.tiling.v &&
      prior.pixelPitchMm?.every((value, axis) => value === pixelPitchMm[axis]) ?
      source : images.declare(source.raster, descriptor);
    return prepared.raster.width === width && prepared.raster.height === height ? prepared : images.resize(prepared, width, height);
  }

  const operations = Object.freeze({
    'material.base': {
      description: 'Read the resolved shared material settings and derive pixel and physical sampling extents.',
      inputs: { settings: 'record' }, outputs: { value: 'record', width: 'pixelCount', height: 'pixelCount',
        samples: 'record', pixelPitchMm: 'vec2', physicalSizeMm: 'vec2', tiling: 'record', seed: 'number' },
      run({ settings }) {
        const value = MaterialBaseSettings.resolve(settings);
        const { width, height } = value.size;
        const { pixelPitchMm, physicalSizeMm } = MaterialBaseSettings.measure(value);
        return { value, width, height, pixelPitchMm, physicalSizeMm, tiling: value.tiling, seed: value.seed,
          samples: { width, height, u: [physicalSizeMm[0], 0, 0], v: [0, physicalSizeMm[1], 0] } };
      }
    },
    'material.imageOutput': {
      description: 'Fit a typed image to the shared material extent, tiling and physical pixel pitch.',
      inputs: { source: 'typedImage', settings: 'record' },
      outputs: { value: { type: 'typedImage', typeFrom: 'source' } },
      run({ source, settings }) { return { value: fit(source, settings) }; }
    }
  });
  P.materialBase = Object.freeze({ ...MaterialBaseSettings, fit, operations });
})(KIT.procedural);
