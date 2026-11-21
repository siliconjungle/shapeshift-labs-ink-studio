/* Exact rectangular replacements from the original raster or named banks. */
(function (P) {
  const {view, channel, int, tuple, plane} = P.pixelEffectSupport;
  const record = P.graphTypes.validator('record');
  const isByte = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  const coordinates = value => int(value, -2147483648, 2147483647);

  function blockSubstitute(source, {blocks = [], banks = {}, mask, maskChannel = 'luma', maskThreshold = 128} = {}) {
    const {width, height, data, pivot} = view(source);
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    if (!record(banks) || !Array.isArray(blocks) || blocks.length > 4096 || !Number.isFinite(maskThreshold))
      throw new RangeError('Block substitutions need named banks, up to 4096 blocks, and a finite mask threshold');
    if (mask !== undefined && (mask?.width !== width || mask?.height !== height))
      throw new RangeError('Block substitution mask must align to the source');
    const gate = mask === undefined ? null : channel(mask, maskChannel);
    const channels = source.channels ?? data.length / (width * height);
    const original = {width, height, data: ArrayBuffer.isView(data) ? data : Float64Array.from(data)};
    const donors = new Map();
    let visits = 0, bytes = isByte(data);

    function donorFor(name) {
      if (name === undefined) return original;
      if (typeof name !== 'string' || !name.length || !Object.hasOwn(banks, name))
        throw new RangeError('Unknown block substitution bank ' + String(name));
      if (!donors.has(name)) {
        const bank = view(banks[name]);
        if ((bank.channels ?? bank.data.length / (bank.width * bank.height)) !== channels)
          throw new RangeError('Block substitution bank needs matching channel counts');
        donors.set(name, {width: bank.width, height: bank.height,
          data: ArrayBuffer.isView(bank.data) ? bank.data : Float64Array.from(bank.data)});
      }
      return donors.get(name);
    }

    const placements = [];
    for (const block of blocks) {
      if (!record(block) || !tuple(block.rect, 4, coordinates))
        throw new TypeError('Block substitution needs an integer rectangle');
      const [x, y, w, h] = block.rect;
      const {from = [x, y], bank} = block;
      if (!tuple(from, 2, coordinates) || w <= 0 || h <= 0)
        throw new RangeError('Block substitution needs a positive size and integer source origin');
      const donor = donorFor(bank);
      const dx = from[0] - x, dy = from[1] - y;
      const left = Math.max(x, 0, -dx), right = Math.min(x + w, width, donor.width - dx);
      const top = Math.max(y, 0, -dy), bottom = Math.min(y + h, height, donor.height - dy);
      if (right <= left || bottom <= top) continue;
      visits += (right - left) * (bottom - top);
      if (visits > 64e6) throw new RangeError('Block substitution exceeds its pixel visit budget');
      bytes &&= isByte(donor.data);
      placements.push({donor, dx, dy, left, right, top, bottom});
    }

    const result = bytes ? Uint8Array.from(data) : Float64Array.from(data);
    const replaced = new Uint8Array(width * height);
    for (const {donor, dx, dy, left, right, top, bottom} of placements) {
      for (let y = top; y < bottom; y++) {
        const to = y * width, from = (y + dy) * donor.width + dx;
        if (!gate) {
          result.set(donor.data.subarray((from + left) * channels, (from + right) * channels), (to + left) * channels);
          replaced.fill(255, to + left, to + right);
        } else {
          for (let x = left; x < right; x++) {
            if (gate[to + x] < maskThreshold) continue;
            result.set(donor.data.subarray((from + x) * channels, (from + x + 1) * channels), (to + x) * channels);
            replaced[to + x] = 255;
          }
        }
      }
    }
    return {
      value: {width, height, channels, data: result, ...(pivot !== undefined && {pivot: [...pivot]})},
      mask: plane(width, height, replaced)
    };
  }

  P.pixelEffects.blockSubstitute = blockSubstitute;
})(KIT.procedural);
