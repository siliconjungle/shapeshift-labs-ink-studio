/* Exact palette slot edits with straight-alpha preview. */
(function (P) {
  const {view, channel, int, tuple, plane} = P.pixelEffectSupport;
  const validPalette = P.graphTypes.validator('palette');

  function samples(source, label, min, max, shape) {
    const {width, height, data} = view(source);
    if ((source.channels ?? data.length / (width * height)) !== 1 ||
        (shape && (width !== shape.width || height !== shape.height)))
      throw new RangeError(label + ' needs one channel on the source grid');
    for (const sample of data) {
      if (!int(sample, min, max)) throw new RangeError(label + ' has an invalid sample');
    }
    return data;
  }

  function paletteBytes(palette, label) {
    if (!validPalette(palette)) throw new TypeError(label + ' needs an indexed palette');
    return Array.from(palette.palette ?? palette, color =>
      P.materials.perceptual.parse(color).map(value => Math.round(value * 255)));
  }

  function editIndices(source, swatches, {alpha, mask, maskChannel = 'luma', maskThreshold = 128}, label, remap) {
    const original = samples(source, label + ' indices', -1, swatches.length - 1);
    const {width, height, pivot} = source;
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    const coverage = alpha === undefined ? null : samples(alpha, label + ' alpha', 0, 255, source);
    if (!Number.isFinite(maskThreshold)) throw new RangeError(label + ' mask threshold must be finite');
    if (mask !== undefined && (mask?.width !== width || mask?.height !== height))
      throw new RangeError(label + ' mask must align to the source');
    const gate = mask === undefined ? null : channel(mask, maskChannel);
    const indices = Int16Array.from(original);
    const rgba = new Uint8Array(indices.length * 4);
    for (let i = 0; i < indices.length; i++) {
      const index = original[i];
      if (index < 0) continue;
      const opacity = coverage?.[i] ?? 255;
      if (opacity && (!gate || gate[i] >= maskThreshold)) {
        const candidate = remap(index, i);
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

  function bitplane(source, palette, options = {}) {
    const {bit = 0, mode = 'flip', bank, bankBit = bit} = options;
    if (!['flip', 'clear', 'borrow'].includes(mode) || !int(bit, 0, 7) || !int(bankBit, 0, 7))
      throw new RangeError('Invalid bitplane settings');
    if (mode === 'borrow' && !bank) throw new TypeError('Borrowing a bitplane needs a donor bank');
    const swatches = paletteBytes(palette, 'Bitplane effect');
    const donor = mode === 'borrow' ? samples(bank, 'Bitplane bank', -1, 255, source) : null;
    const flag = 1 << bit;
    return editIndices(source, swatches, options, 'Bitplane', (index, i) => {
      if (mode === 'flip') return index ^ flag;
      const cleared = index & ~flag;
      if (mode === 'clear') return cleared;
      return donor[i] < 0 ? index : cleared | (((donor[i] >> bankBit) & 1) << bit);
    });
  }

  function paletteFault(source, palette, options = {}) {
    const {swaps = [], stuck} = options;
    const swatches = paletteBytes(palette, 'Palette fault');
    const validSlot = slot => int(slot, 0, swatches.length - 1);
    const destinations = Uint8Array.from({length: swatches.length}, (_, slot) => slot);
    const assigned = new Set();
    function assign(from, to) {
      if (assigned.has(from)) throw new RangeError('Palette fault rules overlap at source slot ' + from);
      assigned.add(from);
      destinations[from] = to;
    }
    if (!Array.isArray(swaps)) throw new TypeError('Palette fault swaps need pairs of palette slots');
    for (const pair of swaps) {
      if (!tuple(pair, 2, validSlot) || pair[0] === pair[1])
        throw new RangeError('Palette fault swap needs two distinct palette slots');
      const [a, b] = pair;
      assign(a, b);
      assign(b, a);
    }
    if (stuck !== undefined) {
      if (!P.graphTypes.validator('record')(stuck) || !validSlot(stuck.to) ||
          (stuck.from !== undefined && (!Array.isArray(stuck.from) || stuck.from.length > swatches.length ||
            !Array.from(stuck.from).every(validSlot))))
        throw new RangeError('Palette fault stuck rule needs valid from and to slots');
      const from = stuck.from ?? Array.from(destinations.keys());
      for (const slot of from) assign(slot, stuck.to);
    }
    return editIndices(source, swatches, options, 'Palette fault', index => destinations[index]);
  }

  Object.assign(P.pixelEffects, {bitplane, paletteFault});
})(KIT.procedural);
