/* RGB test patterns and seekable television interference. */
(function (K) {
  const P = K.procedural;
  const { dimensions, clock, integer, range, unit, wrap, raster } = P.generatorSupport;
  const gray = level => [level, level, level];
  const black = gray(0), white = gray(1);
  const bars75 = [
    gray(.75), [.75, .75, 0], [0, .75, .75], [0, .75, 0], [.75, 0, .75], [.75, 0, 0], [0, 0, .75]
  ];
  const reverseBlue = [bars75[6], black, bars75[4], black, bars75[2], black, bars75[0]];
  const [minusI, plusQ] = [[0, .242, .41], [.264, 0, .47]];
  const strips = (colors, cuts) => x => colors[cuts.findIndex(end => x < end)] ?? colors.at(-1);

  const sdPluge = strips(
    [minusI, white, plusQ, black, gray(-.04), black, gray(.04), black],
    [5 / 4, 5 / 2, 15 / 4, 5, 16 / 3, 17 / 3, 6]
  );
  const eg1 = [
    [.67, x => bars75[Math.floor(x * 7)]],
    [3 / 4, x => reverseBlue[Math.floor(x * 7)]],
    [1, x => sdPluge(x * 7)]
  ];

  // The HD pattern places seven bars in the center 4:3 area of a 16:9 frame.
  const hdX = x => (x - 1 / 8) * 28 / 3;
  const hdRamp = x => {
    if (x < 0) return [1, 1, 0];
    if (x >= 7) return [1, 0, 0];
    return gray(unit((x - 1) / 5));
  };
  const hdPluge = strips(
    [gray(.15), black, white, black, gray(-.02), black, gray(.02), black, gray(.04), black, gray(.15)],
    [0, 3 / 2, 7 / 2, 13 / 3, 14 / 3, 5, 16 / 3, 17 / 3, 6, 7]
  );
  const rp219 = [
    [7 / 12, u => bars75[Math.floor(hdX(u))] ?? gray(.4)],
    [8 / 12, u => u < 1 / 8 ? [0, 1, 1] : u >= 7 / 8 ? [0, 0, 1] : bars75[0]],
    [9 / 12, u => hdRamp(hdX(u))],
    [1, u => hdPluge(hdX(u))]
  ];

  function smpteColorBars({ pattern = 'eg1', levels = 'full', blueOnly = false, width = 128,
    height = Math.max(1, Math.round(width * (pattern === 'rp219' ? 9 / 16 : 3 / 4))) } = {}) {
    dimensions({ width, height });
    if (!['eg1', 'rp219'].includes(pattern) || !['full', 'limited'].includes(levels) || typeof blueOnly !== 'boolean')
      throw new RangeError('Invalid SMPTE color bar pattern, levels or blue-only setting');

    const limited = levels === 'limited';
    const encode = value => limited ? Math.round(16 + 219 * value) : Math.round(255 * unit(value));
    const data = new Uint8Array(width * height * 4), row = new Uint8Array(width * 4);
    let y = 0;
    for (const [end, sample] of pattern === 'eg1' ? eg1 : rp219) {
      const bottom = Math.ceil(height * end - .5);
      if (bottom === y) continue;
      for (let x = 0; x < width; x++) {
        const [r, g, b] = sample((x + .5) / width), offset = x * 4;
        row[offset] = encode(blueOnly ? 0 : r);
        row[offset + 1] = encode(blueOnly ? 0 : g);
        row[offset + 2] = encode(b);
        row[offset + 3] = 255;
      }
      for (; y < bottom; y++) data.set(row, y * row.length);
    }
    return raster(width, height, data, 4);
  }

  const staticPresets = {
    snow: { rate: 30, grain: [1, 1], contrast: 1, chroma: 0, rowNoise: .12, scanlines: .08, band: {} },
    chroma: { rate: 24, grain: [2, 2], contrast: .96, chroma: .9, rowNoise: .08, scanlines: .13, band: {} },
    'weak-signal': { rate: 15, grain: [10, 1], contrast: .85, chroma: .12, rowNoise: .7, scanlines: .24,
      band: { height: .15, speed: .2, strength: .28 } },
    tracking: { rate: 18, grain: [5, 2], contrast: .82, chroma: .22, rowNoise: .42, scanlines: .25,
      band: { height: .25, speed: .4, strength: .84 } }
  };

  function tvStatic({ preset = 'snow', ...options } = {}) {
    if (typeof preset !== 'string' || !Object.hasOwn(staticPresets, preset)) throw new RangeError('Unknown TV static preset');
    const defaults = staticPresets[preset];
    const { width, height } = dimensions(options);
    const { time = 0, seed = 0, opacity = 1, density = 1, rate = defaults.rate, grain = defaults.grain,
      contrast = defaults.contrast, chroma = defaults.chroma, rowNoise = defaults.rowNoise,
      scanlines = defaults.scanlines, band = {} } = options;
    clock(time, seed);
    if (!band || typeof band !== 'object' || Array.isArray(band)) throw new TypeError('TV static band needs a record');
    const { height: bandHeight = .18, speed: bandSpeed = 0, strength: bandStrength = 0 } = { ...defaults.band, ...band };
    if ((rate !== 0 && !range(rate, .01, 240)) || !range(contrast, 0, 2) ||
        ![opacity, density, chroma, rowNoise, scanlines, bandStrength].every(value => range(value, 0, 1)) ||
        !range(bandHeight, .001, 1) || !range(bandSpeed, -10, 10) ||
        !Array.isArray(grain) || grain.length !== 2 || !integer(grain[0], 1, 128) || !integer(grain[1], 1, 128))
      throw new RangeError('Invalid TV static grain, clock or appearance');

    const data = new Uint8Array(width * height * 4), alpha = Math.round(255 * opacity);
    if (!alpha || !density) return raster(width, height, data, 4);

    const [grainX, grainY] = grain, frame = Math.floor(time * rate);
    const seedKey = 'tv-static:' + seed + ':' + frame;
    const noise = K.grow.dice(P.data.hash(seedKey + ':grain'));
    const lines = K.grow.dice(P.data.hash(seedKey + ':lines'));
    const bandCenter = rate ? wrap(.5 + frame / rate * bandSpeed, 1) : .5;
    const row = new Float32Array(Math.ceil(width / grainX) * 4);
    for (let y = 0; y < height; y++) {
      if (y % grainY === 0) {
        for (let i = 0; i < row.length; i += 4) {
          const luma = noise();
          for (let c = 0; c < 3; c++) row[i + c] = K.mix(luma, noise(), chroma);
          row[i + 3] = noise() < density ? alpha : 0;
        }
      }
      const distance = wrap((y + .5) / height - bandCenter + .5, 1) - .5;
      const shape = unit(1 - 2 * Math.abs(distance) / bandHeight);
      const gain = 1 - (y % 2) * scanlines;
      const bias = (lines() - .5) * rowNoise + shape * bandStrength * (distance < 0 ? -.6 : .8);
      for (let x = 0; x < width; x++) {
        const cell = Math.floor(x / grainX) * 4, dst = (y * width + x) * 4;
        if (!row[cell + 3]) continue;
        for (let c = 0; c < 3; c++)
          data[dst + c] = Math.round(255 * unit((.5 + (row[cell + c] - .5) * contrast + bias) * gain));
        data[dst + 3] = row[cell + 3];
      }
    }
    return raster(width, height, data, 4);
  }

  Object.assign(P.generator, { smpteColorBars, tvStatic });
})(KIT);
