/* Seeded remapping on a fixed raster tile grid. */
(function (K) {
  const P = K.procedural;
  const {view, channel, int, tuple, plane} = P.pixelEffectSupport;

  function tileScramble(source, {
    tileSize = [8, 8], mode = 'swap', amount = .25, seed = 1, rate = 0, time = 0,
    mask, maskChannel = 'luma', maskThreshold = 128
  } = {}) {
    if (!['swap', 'repeat', 'omit'].includes(mode) || !tuple(tileSize, 2, n => int(n, 1, 8192)) ||
        !Number.isFinite(amount) || amount < 0 || amount > 1 || !Number.isSafeInteger(seed) ||
        !Number.isFinite(rate) || rate < 0 || !Number.isFinite(time) || !Number.isFinite(maskThreshold))
      throw new RangeError('Invalid tile scramble settings');
    const tick = Math.floor(time * rate);
    if (!Number.isSafeInteger(tick)) throw new RangeError('Tile scramble time exceeds its tick range');

    const {width, height, data, pivot} = view(source);
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    const channels = source.channels ?? data.length / (width * height);
    const [tileWidth, tileHeight] = tileSize;
    const columns = Math.ceil(width / tileWidth), rows = Math.ceil(height / tileHeight);
    const fullColumns = Math.floor(width / tileWidth), fullRows = Math.floor(height / tileHeight);
    if (mask !== undefined && (mask?.width !== width || mask?.height !== height))
      throw new RangeError('Tile scramble mask must align to the source');
    const gate = mask === undefined ? null : channel(mask, maskChannel);
    const addresses = Int32Array.from({length: columns * rows}, (_, index) => index);
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

    if (amount > 0) {
      for (let row = 0; row < fullRows; row++) {
        for (let col = 0; col < fullColumns; col++) {
          if (containsTile(col, row)) eligible[size++] = row * columns + col;
        }
      }
    }

    const random = K.grow.dice(P.data.hash(`tile-scramble/${seed}/${tick}`));
    let count = Math.round(size * amount);
    if (mode === 'swap') count -= count % 2;
    if (mode === 'repeat' && count === size && size > 0) count--;
    for (let i = 0; i < count; i++) {
      const next = i + Math.floor(random() * (size - i));
      const address = eligible[next];
      eligible[next] = eligible[i];
      eligible[i] = address;
    }

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

    const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
    const original = ArrayBuffer.isView(data) ? data : Float64Array.from(data);
    const result = bytes ? Uint8Array.from(original) : Float64Array.from(original);
    const span = tileWidth * channels;
    const start = address => (Math.floor(address / columns) * tileHeight * width + address % columns * tileWidth) * channels;
    const stride = width * channels;
    for (let i = 0; i < count; i++) {
      const address = eligible[i], from = addresses[address], toStart = start(address);
      const fromStart = from < 0 ? 0 : start(from);
      for (let y = 0; y < tileHeight; y++) {
        const offset = y * stride, to = toStart + offset;
        if (from < 0) result.fill(0, to, to + span);
        else result.set(original.subarray(fromStart + offset, fromStart + offset + span), to);
      }
    }

    return {
      value: {width, height, channels, data: result, ...(pivot !== undefined && {pivot: [...pivot]})},
      addresses: plane(columns, rows, addresses)
    };
  }

  P.pixelEffects.tileScramble = tileScramble;
})(KIT);
