/* Standalone output-row register schedules for display and indexed rasters. */
(function (P) {
  const display = P.graphTypes.validator('displayRaster');
  const bounded = (width, height) => [width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) &&
    width * height <= 1048576;

  function rasterSchedule(source, { width = source?.width, height = source?.height, time = 0, ...settings } = {}) {
    if (!bounded(width, height) || !bounded(source?.width, source?.height) || !Number.isFinite(time))
      throw new RangeError('Raster schedule needs bounded input and output grids and a finite clock');
    const plan = RasterSchedule.prepare(settings), packet = RasterSchedule.table(plan, width, height, time);
    let input;
    if (packet.paletteSize) input = RasterSchedule.indexed(source, packet.paletteSize);
    else {
      if (!display(source)) throw new TypeError('Raster schedule needs a display or indexed raster');
      const { width: w, height: h, data } = P.raster.rgba(source);
      input = { w, h, data };
    }
    const read = RasterSchedule.sampler(packet, input, width, height, plan.wrap, true);
    const data = new Uint8Array(width * height * 4), color = new Uint8Array(4);
    for (let y = 0, p = 0; y < height; y++)
      for (let x = 0; x < width; x++, p += 4) {
        read(x, y, color);
        data.set(color, p);
      }
    return { width, height, channels: 4, data };
  }

  P.pixelEffects.rasterSchedule = rasterSchedule;
})(KIT.procedural);
