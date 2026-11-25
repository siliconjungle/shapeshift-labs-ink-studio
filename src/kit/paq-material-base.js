/* Consume shared material defaults at generator and output nodes. */
(function (P) {
  function primaryImage(id, image) {
    if (!P.graphImages.valid(image)) throw new TypeError('Material primary input ' + id + ' needs a typed image');
    const { width, height } = image.raster, { precision, pixelPitchMm, tiling } = image.descriptor;
    const bitDepth = { unorm8: 8, unorm16: 16 }[precision];
    const output = bitDepth === undefined ? { format: 'json' } : { format: 'png', bitDepth };
    const ratio = pixelPitchMm && MaterialBaseSettings.ratioFromPitch(pixelPitchMm);
    return { id, settings: { size: { width, height }, output, tiling,
      ...(pixelPitchMm && { pixelSizeMm: pixelPitchMm[0] }), ...(ratio && { pixelRatio: ratio }),
      ...(image.descriptor.materialSeed !== undefined && { seed: image.descriptor.materialSeed }) } };
  }

  function fit(source, settings) {
    const base = MaterialBaseSettings.resolve(settings);
    const { width, height } = base.size;
    const { pixelPitchMm } = MaterialBaseSettings.measure(base);
    const images = P.graphImages;
    if (!images.valid(source)) throw new TypeError('Material image output needs a typed image');
    const prior = source.descriptor;
    const descriptor = { ...prior, tiling: base.tiling, pixelPitchMm, materialSeed: base.seed };
    const prepared = prior.materialSeed === base.seed && prior.tiling.u === base.tiling.u && prior.tiling.v === base.tiling.v &&
      prior.pixelPitchMm?.every((value, axis) => value === pixelPitchMm[axis]) ?
      source : images.declare(source.raster, descriptor);
    return prepared.raster.width === width && prepared.raster.height === height ? prepared : images.resize(prepared, width, height);
  }

  const operations = Object.freeze({
    'material.inherit': {
      description: 'Resolve local material settings from a parent or primary input and report their sources.',
      inputs: { settings: { type: 'record', default: {} }, rules: 'record', context: { type: 'record', default: {} },
        primary: { type: 'any', default: null }, primaryId: { type: 'string', default: 'primary-input' } },
      outputs: { value: 'record', provenance: 'record' },
      run({ settings, rules, context, primary, primaryId }) {
        if (primary !== null && Object.hasOwn(context, 'primary'))
          throw new TypeError('Choose a primary image or a primary settings provider');
        const { base, provenance } = MaterialBaseSettings.inherit(settings, rules,
          primary === null ? context : { ...context, primary: primaryImage(primaryId, primary) });
        return { value: base, provenance };
      }
    },
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
  P.materialBase = Object.freeze({ ...MaterialBaseSettings, fit, primaryImage, operations });
})(KIT.procedural);
