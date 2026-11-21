/* Exact row moves on standalone color and numeric rasters. */
(function (P) {
  const {view, tuple, plane} = P.pixelEffectSupport;

  function scanlineRemap(source, {edits} = {}) {
    const {width, height, data, pivot} = view(source);
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Raster pivot needs two finite coordinates');
    const channels = source.channels ?? data.length / (width * height);
    const addresses = RenderGraph.scanlineMap(RenderGraph.prepareRowEdits(edits), height);
    const original = ArrayBuffer.isView(data) ? data : Float64Array.from(data);
    const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
    const output = bytes ? new Uint8Array(data.length) : new Float64Array(data.length);
    const stride = width * channels;
    for (let y = 0; y < height; y++) {
      if (addresses[y] < 0) continue;
      const from = addresses[y] * stride;
      output.set(original.subarray(from, from + stride), y * stride);
    }
    return {
      value: {width, height, channels, data: output, ...(pivot !== undefined && {pivot: [...pivot]})},
      addresses: plane(1, height, addresses)
    };
  }

  P.pixelEffects.scanlineRemap = scanlineRemap;
})(KIT.procedural);
