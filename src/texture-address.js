/* UV address policies shared by raster graphs and screen-space render passes. */
const TextureAddress = (() => {
  const modes = ['clamp', 'transparent', 'wrap', 'mirror'];
  const mod = (n, size) => (n % size + size) % size;
  const clamp = (n, limit) => Math.min(limit - 1, Math.max(0, n));

  function axis(mode) {
    if (mode === 'clamp') return clamp;
    if (mode === 'transparent') return (n, span) => n >= 0 && n < span ? n : -1;
    if (mode === 'wrap') return mod;
    if (mode === 'mirror') return (n, span) => {
      const p = mod(n, span * 2);
      return p < span ? p : span * 2 - 1 - p;
    };
    throw new RangeError('Warp edges need transparent, clamp, wrap or mirror addressing');
  }

  function settings({ filter = 'nearest', edge = 'clamp', edgeU = edge, edgeV = edge } = {}) {
    const edges = [modes.indexOf(edgeU), modes.indexOf(edgeV)];
    if (!['nearest', 'linear'].includes(filter) || edges.includes(-1))
      throw new RangeError('Texture addressing needs a valid filter and edge policies');
    return { filter, edges, axes: [axis(edgeU), axis(edgeV)] };
  }

  function raster(source, width, height) {
    const data = source?.data, channels = source?.channels ?? (data?.length / (width * height));
    if (source?.width !== width || source.height !== height || width * height > 1048576 ||
        ![2, 3].includes(channels) || (!Array.isArray(data) && !ArrayBuffer.isView(data)) ||
        data.length !== width * height * channels)
      throw new RangeError('Texture address field needs 2 or 3 aligned channels within its pixel budget');
    const values = new Float32Array(width * height * 4);
    for (let from = 0, to = 0; from < data.length; from += channels, to += 4) {
      const u = data[from], v = data[from + 1], coverage = channels === 3 ? data[from + 2] : 1;
      if (!Number.isFinite(u) || Math.abs(u) > 16384 || !Number.isFinite(v) || Math.abs(v) > 16384 ||
          !Number.isFinite(coverage) || coverage < 0 || coverage > 1)
        throw new RangeError('Invalid texture address coordinate or coverage');
      values[to] = u;
      values[to + 1] = v;
      values[to + 2] = coverage;
    }
    return values;
  }

  function sampler(data, width, height, { filter, axes: [ax, ay] }) {
    function add(x, y, weight, color) {
      const u = ax(x, width), v = ay(y, height);
      if (u < 0 || v < 0 || !weight) return;
      const p = (v * width + u) * 4;
      for (let c = 0; c < 4; c++) color[c] += data[p + c] * weight;
    }
    return (u, v, color) => {
      color.fill(0);
      const px = Math.fround(u * width), py = Math.fround(v * height);
      if (filter === 'nearest') add(Math.floor(px), Math.floor(py), 1, color);
      else {
        const x = Math.fround(px - .5), y = Math.fround(py - .5),
          i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
        add(i, j, (1 - a) * (1 - b), color);
        add(i + 1, j, a * (1 - b), color);
        add(i, j + 1, (1 - a) * b, color);
        add(i + 1, j + 1, a * b, color);
      }
    };
  }

  return Object.freeze({ axis, settings, raster, sampler });
})();
if (typeof module !== 'undefined') module.exports = TextureAddress;
