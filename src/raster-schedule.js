/* Output-row registers for indexed color, source addressing and pixel size. */
const RasterSchedule = (() => {
  const cycling = typeof PaletteCycles === 'undefined' ? require('./palette-cycles.js') : PaletteCycles;
  const drawing = typeof DrawingPrimitives === 'undefined' ? require('./drawing-primitives.js') : DrawingPrimitives;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const pair = (value, min, max) => Array.isArray(value) && value.length === 2 &&
    Array.from(value).every(n => integer(n, min, max));
  const mod = (n, size) => (n % size + size) % size;

  function color(value) {
    if (typeof value !== 'string') throw new TypeError('Raster schedule colors need hex RGB or RGBA');
    return drawing.color(value);
  }

  function entries(schedule, paletteSize) {
    if (!Array.isArray(schedule) || schedule.length > 1024)
      throw new TypeError('Raster schedule needs an array of up to 1024 entries');
    let previous = -1, paletteRow = 0;
    return Array.from(schedule, entry => {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype ||
          Object.keys(entry).some(key => !['row', 'offset', 'pixelScale', 'palette'].includes(key)))
        throw new TypeError('Invalid raster schedule entry');
      const { row, offset, pixelScale, palette: writes } = entry;
      if (!integer(row, 0, 65536) || row <= previous || offset === undefined && pixelScale === undefined && writes === undefined)
        throw new RangeError('Raster schedule needs strictly increasing nonnegative rows with register writes');
      if (offset !== undefined && !pair(offset, -65536, 65536) ||
          pixelScale !== undefined && !pair(pixelScale, 1, 1024))
        throw new RangeError('Raster schedule needs integer XY offsets and positive XY pixel sizes');
      previous = row;
      let edits;
      if (writes !== undefined) {
        if (!paletteSize || !Array.isArray(writes) || writes.length < 1 || writes.length > paletteSize)
          throw new RangeError('Raster schedule palette writes need an indexed palette and a list of slots');
        const seen = new Set();
        edits = Array.from(writes, write => {
          if (!Array.isArray(write) || write.length !== 2 || !integer(write[0], 0, paletteSize - 1) || seen.has(write[0]))
            throw new RangeError('Raster schedule palette writes need distinct in-range slots');
          seen.add(write[0]);
          return [write[0] * 4, color(write[1])];
        });
        paletteRow++;
      }
      return { row, offset: offset?.slice(), pixelScale: pixelScale?.slice(), paletteRow, edits };
    });
  }

  function palettes(rows, base, groups, time) {
    if (!base) return new Uint8Array(0);
    const step = base.length, data = new Uint8Array(step * ((rows.at(-1)?.paletteRow ?? 0) + 1));
    data.set(base);
    cycling.visit(groups, time, (index, source) => data.set(base.subarray(source * 4, source * 4 + 4), index * 4));
    for (const { paletteRow, edits } of rows) if (edits) {
      const at = paletteRow * step;
      data.copyWithin(at, at - step, at);
      for (const [offset, rgba] of edits) data.set(rgba, at + offset);
    }
    return data;
  }

  function prepare({ schedule = [], palette, cycles = {}, wrap = false } = {}) {
    if (typeof wrap !== 'boolean') throw new TypeError('Raster schedule wrap must be a boolean');
    if (palette !== undefined && (!Array.isArray(palette) || !integer(palette.length, 1, 256)))
      throw new RangeError('Raster schedule needs a palette of 1 to 256 colors');
    const base = palette === undefined ? null : Uint8Array.from(Array.from(palette, color).flat());
    const paletteSize = (base?.length ?? 0) / 4;
    const groups = cycling.prepare(cycles, index => {
      if (!integer(index, 0, paletteSize - 1)) throw new RangeError('Raster schedule cycle needs an in-range indexed palette slot');
      return index;
    });
    const program = typeof schedule === 'function' ? schedule : entries(schedule, paletteSize);
    const staticColors = typeof program !== 'function' && !groups.length ? palettes(program, base, groups, 0) : undefined;
    return { program, base, paletteSize, groups, staticColors, wrap };
  }

  function table(plan, width, height, time = 0) {
    const { program, base, paletteSize, groups, staticColors } = plan;
    const rows = typeof program === 'function' ? entries(program({ width, height, time }) ?? [], paletteSize) : program;
    const paletteData = staticColors ?? palettes(rows, base, groups, time);
    const registers = new Float32Array(height * 8);
    let offset = [0, 0], scale = [1, 1], anchor = 0, bank = 0, next = 0;
    for (let y = 0; y < height; y++) {
      if (rows[next]?.row === y) {
        const change = rows[next++];
        offset = change.offset ?? offset;
        if (change.pixelScale) { scale = change.pixelScale; anchor = y; }
        bank = Math.max(0, change.paletteRow);
      }
      const i = y * 8;
      registers[i] = offset[0];
      registers[i + 1] = offset[1];
      registers[i + 2] = scale[0];
      registers[i + 3] = scale[1];
      registers[i + 4] = anchor;
      registers[i + 5] = bank;
    }
    return { registers, paletteSize, paletteData };
  }

  function indexed(source, slots) {
    const { width: w, height: h, data, channels = data?.length / (w * h) } = source ?? {};
    if (!integer(w, 1, 8192) || !integer(h, 1, 8192) || w * h > 1048576 ||
        ![1, 2].includes(channels) || (!Array.isArray(data) && !ArrayBuffer.isView(data)) ||
        data.length !== w * h * channels)
      throw new RangeError('Raster schedule indices need a bounded one- or two-channel raster');
    const packed = new Uint8Array(w * h * 4);
    for (let p = 0, from = 0; p < w * h; p++, from += channels) {
      const index = data[from], alpha = channels === 2 ? data[from + 1] : 255;
      if (!integer(index, -1, slots - 1) || !integer(alpha, 0, 255))
        throw new RangeError('Raster schedule indices or coverage are out of range');
      packed[p * 4] = Math.max(0, index);
      packed[p * 4 + 3] = index < 0 ? 0 : alpha;
    }
    return { w, h, data: packed };
  }

  function sampler({ registers, paletteSize, paletteData }, { w, h, data }, width, height, wrap, straight = false) {
    return (x, y, out) => {
      const row = y * 8, u = registers[row + 2], v = registers[row + 3], anchor = registers[row + 4];
      let sx = Math.floor(x / u) * u + registers[row];
      let sy = anchor + Math.floor((y - anchor) / v) * v + registers[row + 1];
      if (wrap) { sx = mod(sx, width); sy = mod(sy, height); }
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) { out.fill(0); return; }
      const sample = (Math.floor((sy + .5) * h / height) * w + Math.floor((sx + .5) * w / width)) * 4;
      if (!paletteSize) {
        for (let c = 0; c < 4; c++) out[c] = data[sample + c];
        return;
      }
      const swatch = (registers[row + 5] * paletteSize + data[sample]) * 4;
      const alpha = Math.round(paletteData[swatch + 3] * data[sample + 3] / 255);
      out[3] = alpha;
      const gain = straight ? Number(alpha > 0) : alpha / 255;
      for (let c = 0; c < 3; c++) out[c] = Math.round(paletteData[swatch + c] * gain);
    };
  }

  return Object.freeze({ prepare, table, indexed, sampler });
})();
if (typeof module !== 'undefined') module.exports = RasterSchedule;
