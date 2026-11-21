/* Seeded remapping on a fixed raster tile grid. */
(function (K) {
  const P = K.procedural;
  const {view, channel, int, tuple, plane} = P.pixelEffectSupport;

  function tileGridSettings({tileSize = [8, 8], maskChannel = 'luma', maskThreshold = 128}) {
    if (!tuple(tileSize, 2, n => int(n, 1, 8192)) || !Number.isFinite(maskThreshold))
      throw new RangeError('Invalid tile effect settings');
    return {tileSize, maskChannel, maskThreshold};
  }

  function tileSettings(options) {
    const {amount = .25, seed = 1, rate = 0, time = 0} = options;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1 || !Number.isSafeInteger(seed) ||
        !Number.isFinite(rate) || rate < 0 || !Number.isFinite(time))
      throw new RangeError('Invalid tile effect settings');
    const tick = Math.floor(time * rate);
    if (!Number.isSafeInteger(tick)) throw new RangeError('Tile effect time exceeds its tick range');
    return {...tileGridSettings(options), amount, seed, tick};
  }

  function tileGrid(source, [tileWidth, tileHeight]) {
    const {width, height, data, pivot} = view(source);
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    const channels = source.channels ?? data.length / (width * height);
    return {
      width, height, data, pivot, channels, tileWidth, tileHeight,
      columns: Math.ceil(width / tileWidth), rows: Math.ceil(height / tileHeight),
      fullColumns: Math.floor(width / tileWidth), fullRows: Math.floor(height / tileHeight)
    };
  }

  function eligibleTiles(grid, mask, maskChannel, maskThreshold, enabled = true) {
    const {width, height, tileWidth, tileHeight, columns, fullColumns, fullRows} = grid;
    if (mask !== undefined && (mask?.width !== width || mask?.height !== height))
      throw new RangeError('Tile effect mask must align to its raster');
    const gate = mask === undefined ? null : channel(mask, maskChannel);
    if (!enabled) return new Int32Array(0);
    const eligible = new Int32Array(fullColumns * fullRows);
    let size = 0;

    function containsTile(col, row) {
      if (!gate) return true;
      const left = col * tileWidth, top = row * tileHeight;
      for (let y = top; y < top + tileHeight; y++) {
        for (let x = left; x < left + tileWidth; x++) {
          if (gate[y * width + x] < maskThreshold) return false;
        }
      }
      return true;
    }

    for (let row = 0; row < fullRows; row++) {
      for (let col = 0; col < fullColumns; col++) {
        if (containsTile(col, row)) eligible[size++] = row * columns + col;
      }
    }
    return eligible.subarray(0, size);
  }

  function pickTiles(eligible, count, random) {
    for (let i = 0; i < count; i++) {
      const next = i + Math.floor(random() * (eligible.length - i));
      const address = eligible[next];
      eligible[next] = eligible[i];
      eligible[i] = address;
    }
  }

  const isByte = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  const tileStart = ({columns, tileHeight, tileWidth, width, channels}, address) =>
    (Math.floor(address / columns) * tileHeight * width + address % columns * tileWidth) * channels;

  function paintTiles(target, donor, addresses, selected) {
    const {width, height, channels, pivot, tileWidth, tileHeight, data} = target;
    const bytes = isByte(data) && (!selected.length || isByte(donor.data));
    const result = bytes ? Uint8Array.from(data) : Float64Array.from(data);
    const original = ArrayBuffer.isView(donor.data) ? donor.data : Float64Array.from(donor.data);
    const span = tileWidth * channels, stride = width * channels, donorStride = donor.width * channels;
    for (const address of selected) {
      const from = addresses[address], toStart = tileStart(target, address);
      const fromStart = from < 0 ? 0 : tileStart(donor, from);
      for (let y = 0; y < tileHeight; y++) {
        const to = toStart + y * stride, offset = fromStart + y * donorStride;
        if (from < 0) result.fill(0, to, to + span);
        else result.set(original.subarray(offset, offset + span), to);
      }
    }
    return {width, height, channels, data: result, ...(pivot !== undefined && {pivot: [...pivot]})};
  }

  function tileScramble(source, options = {}) {
    const {mode = 'swap', mask} = options;
    if (!['swap', 'repeat', 'omit'].includes(mode)) throw new RangeError('Invalid tile scramble mode');
    const {tileSize, amount, seed, tick, maskChannel, maskThreshold} = tileSettings(options);
    const target = tileGrid(source, tileSize);
    const {columns, rows} = target;
    const addresses = Int32Array.from({length: columns * rows}, (_, index) => index);
    const eligible = eligibleTiles(target, mask, maskChannel, maskThreshold, amount > 0);
    const size = eligible.length;
    const random = K.grow.dice(P.data.hash(`tile-scramble/${seed}/${tick}`));
    let count = Math.round(size * amount);
    if (mode === 'swap') count -= count % 2;
    if (mode === 'repeat' && count === size && size > 0) count--;
    pickTiles(eligible, count, random);

    if (mode === 'swap') {
      for (let i = 0; i < count; i += 2) {
        const a = eligible[i], b = eligible[i + 1];
        addresses[a] = b;
        addresses[b] = a;
      }
    } else {
      for (let i = 0; i < count; i++) {
        addresses[eligible[i]] = mode === 'omit' ? -1 : eligible[count + Math.floor(random() * (size - count))];
      }
    }

    return {
      value: paintTiles(target, target, addresses, eligible.subarray(0, count)),
      addresses: plane(columns, rows, addresses)
    };
  }

  function tileBleed(source, bank, options = {}) {
    const {mask, bankMask, bankMaskChannel = 'luma', bankMaskThreshold = 128} = options;
    if (!Number.isFinite(bankMaskThreshold)) throw new RangeError('Invalid tile bank mask threshold');
    const {tileSize, amount, seed, tick, maskChannel, maskThreshold} = tileSettings(options);
    const target = tileGrid(source, tileSize), donor = tileGrid(bank, tileSize);
    if (donor.channels !== target.channels) throw new RangeError('Tile bleed needs matching channel counts');
    const targets = eligibleTiles(target, mask, maskChannel, maskThreshold, amount > 0);
    const donors = eligibleTiles(donor, bankMask, bankMaskChannel, bankMaskThreshold, amount > 0);
    const selected = targets.subarray(0, donors.length ? Math.round(targets.length * amount) : 0);
    const random = K.grow.dice(P.data.hash(`tile-bleed/${seed}/${tick}`));
    pickTiles(targets, selected.length, random);
    const {columns, rows} = target, addresses = new Int32Array(columns * rows).fill(-1);
    for (const address of selected) addresses[address] = donors[Math.floor(random() * donors.length)];
    return {
      value: paintTiles(target, donor, addresses, selected),
      addresses: plane(columns, rows, addresses)
    };
  }

  function tileStrideSlip(source, options = {}) {
    const {tileSize, maskChannel, maskThreshold} = tileGridSettings(options);
    const target = tileGrid(source, tileSize);
    const {columns, rows, fullColumns, fullRows} = target;
    const capacity = fullColumns * fullRows;
    const {stride = fullColumns, offset = 0, wrapAt = capacity, boundary = 'wrap', mask} = options;
    const signed = value => int(value, -2147483648, 2147483647);
    if (!signed(stride) || !signed(offset) || !['wrap', 'keep', 'omit'].includes(boundary) ||
        !int(wrapAt, capacity ? 1 : 0, capacity))
      throw new RangeError('Invalid tile stride, offset, wrap point or boundary');

    const addresses = Int32Array.from({length: columns * rows}, (_, index) => index);
    const eligible = eligibleTiles(target, mask, maskChannel, maskThreshold);
    let count = 0;
    for (const address of eligible) {
      const row = Math.floor(address / columns), col = address % columns;
      let read = offset + row * stride + col;
      if (read < 0 || read >= wrapAt) {
        if (boundary === 'keep') continue;
        read = boundary === 'wrap' ? ((read % wrapAt) + wrapAt) % wrapAt : -1;
      }
      const from = read < 0 ? -1 : Math.floor(read / fullColumns) * columns + read % fullColumns;
      if (from === address) continue;
      addresses[address] = from;
      // Compact changed tiles in place. The write never passes the current read.
      eligible[count++] = address;
    }
    return {
      value: paintTiles(target, target, addresses, eligible.subarray(0, count)),
      addresses: plane(columns, rows, addresses)
    };
  }

  Object.assign(P.pixelEffects, {tileScramble, tileBleed, tileStrideSlip});
})(KIT);
