/* Integer bit operations on palette slots, with straight-alpha preview. */
(function (P) {
  const {view, channel, int, tuple, plane} = P.pixelEffectSupport;
  const validPalette = P.graphTypes.validator('palette');

  function samples(source, label, min, max, shape) {
    const {width, height, data} = view(source);
    if ((source.channels ?? data.length / (width * height)) !== 1 ||
        (shape && (width !== shape.width || height !== shape.height)))
      throw new RangeError('Bitplane ' + label + ' needs one channel on the source grid');
    for (const sample of data) {
      if (!int(sample, min, max)) throw new RangeError('Bitplane ' + label + ' has an invalid sample');
    }
    return data;
  }

  function bitplane(source, palette, {
    bit = 0, mode = 'flip', bank, bankBit = bit, alpha,
    mask, maskChannel = 'luma', maskThreshold = 128
  } = {}) {
    if (!validPalette(palette)) throw new TypeError('Bitplane effects need an indexed palette');
    if (!['flip', 'clear', 'borrow'].includes(mode) || !int(bit, 0, 7) ||
        !int(bankBit, 0, 7) || !Number.isFinite(maskThreshold))
      throw new RangeError('Invalid bitplane settings');
    if (mode === 'borrow' && !bank) throw new TypeError('Borrowing a bitplane needs a donor bank');
    const swatches = Array.from(palette.palette ?? palette, color =>
      P.materials.perceptual.parse(color).map(value => Math.round(value * 255)));
    const original = samples(source, 'indices', -1, swatches.length - 1);
    const {width, height, pivot} = source;
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    const donor = mode === 'borrow' ? samples(bank, 'bank', -1, 255, source) : null;
    const coverage = alpha === undefined ? null : samples(alpha, 'alpha', 0, 255, source);
    if (mask !== undefined && (mask?.width !== width || mask?.height !== height))
      throw new RangeError('Bitplane mask must align to the source');
    const gate = mask === undefined ? null : channel(mask, maskChannel);
    const indices = Int16Array.from(original);
    const rgba = new Uint8Array(indices.length * 4);
    const flag = 1 << bit;
    for (let i = 0; i < indices.length; i++) {
      const index = original[i];
      if (index < 0) continue;
      const opacity = coverage?.[i] ?? 255;
      if (opacity && (!gate || gate[i] >= maskThreshold)) {
        const cleared = index & ~flag;
        let candidate = index;
        if (mode === 'flip') candidate = index ^ flag;
        else if (mode === 'clear') candidate = cleared;
        else if (donor[i] >= 0) candidate = cleared | (((donor[i] >> bankBit) & 1) << bit);
        if (candidate < swatches.length) indices[i] = candidate;
      }
      const offset = i * 4;
      rgba.set(swatches[indices[i]], offset);
      rgba[offset + 3] = opacity;
    }
    const geometry = pivot === undefined ? {} : {pivot: [...pivot]};
    return {
      value: {width, height, channels: 4, data: rgba, ...geometry},
      indices: {...plane(width, height, indices), ...geometry}
    };
  }

  P.pixelEffects.bitplane = bitplane;
})(KIT.procedural);
