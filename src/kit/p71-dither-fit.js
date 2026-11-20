/* Offline fitting of an approved pair to a target at the actual art resolution. */
(function (K) {
  const materials = K.procedural.materials;
  const linear = ColorSpace.prepare('srgb', 'srgb-linear');
  const display = ColorSpace.prepare('srgb-linear', 'srgb');
  const lab = ColorSpace.toOKLab;
  const hex = rgb => '#' + rgb.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16).padStart(2, '0')).join('');
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function fitDither(definition, { palette, roles } = {}) {
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype ||
        Object.keys(definition).some(key => !['target', 'policy', 'size'].includes(key)))
      throw new TypeError('A dither fit needs a target, palette policy and optional size');
    const { target, policy, size = [32, 24] } = definition;
    if (!(typeof target === 'string' && /^#[\da-f]{6}$/i.test(target) ||
        Array.isArray(target) && target.length === 3 && Array.from(target).every(n => Number.isFinite(n) && n >= 0 && n <= 1)))
      throw new TypeError('Dither fit target needs a hex swatch or normalized RGB');
    if (!Array.isArray(size) || size.length !== 2 ||
        !Array.from(size).every(n => Number.isSafeInteger(n) && n >= 1 && n <= 256))
      throw new RangeError('Dither fit width and height must be integers in [1, 256]');
    if (!Array.isArray(policy?.dither?.pairs))
      throw new TypeError('Dither fitting needs an explicit dither.pairs list');
    const plan = PixelLook.preparePalette(policy, { palette, roles, blueNoise: materials.blueNoise, prepareDitherTile: true, validateOnly: true });
    const [w, h] = size, area = w * h, pattern = policy.dither.pattern ?? 'bayer';
    const targetHex = typeof target === 'string' ? target.toLowerCase() : hex(target);
    const targetRgb = [1, 3, 5].map(i => parseInt(targetHex.slice(i, i + 2), 16) / 255);
    const targetLab = lab(targetRgb), lightness = Math.min(1, Math.max(0, targetLab[0]));
    const swatches = plan.swatches.map(hex), locked = plan.reservedIndex(targetRgb);
    let best = locked ?? 0, solidError = locked === undefined ? Infinity : 0;
    if (locked === undefined) for (const i of plan.matchSlots) {
      const error = distance(targetLab, lab(plan.swatches[i]));
      if (error < solidError) {
        best = i;
        solidError = error;
      }
    }

    const eligible = new Map();
    if (locked === undefined && solidError > 0 && pattern !== 'none') {
      for (const { slots, lightness: range } of plan.pairs) {
        if (range && (lightness < range[0] || lightness > range[1])) continue;
        const a = Math.min(...slots), b = Math.max(...slots);
        eligible.set(a * plan.swatches.length + b, [a, b]);
      }
    }

    const scale = plan.tuning?.scale ?? 1;
    const rankAt = (x, y) => plan.ranks[Math.floor(x / scale) % plan.width + (Math.floor(y / scale) % plan.height) * plan.width];
    let error = solidError, average = swatches[best], colors = [average], secondPixels = 0, cutoff = -1;
    if (eligible.size) {
      // All attainable coverages, counting repeated ranks and incomplete tiles at the edges.
      const counts = new Map();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const rank = rankAt(x, y);
        counts.set(rank, 1 + (counts.get(rank) ?? 0));
      }
      const shares = [];
      let pixels = 0;
      for (const [rank, count] of [...counts].sort(([a], [b]) => a - b)) {
        pixels += count;
        if (pixels < area) shares.push({ rank, pixels, share: pixels / area });
      }
      const linearSwatches = plan.swatches.map(rgb => linear(rgb));
      for (const [, [a, b]] of [...eligible].sort(([i], [j]) => i - j)) {
        const first = linearSwatches[a], delta = linearSwatches[b].map((n, i) => n - first[i]);
        for (const coverage of shares) {
          const mixed = display(first.map((n, i) => n + delta[i] * coverage.share));
          const difference = distance(targetLab, lab(mixed));
          if (difference >= error) continue;
          error = difference;
          average = hex(mixed);
          colors = [swatches[a], swatches[b]];
          secondPixels = coverage.pixels;
          cutoff = coverage.rank;
        }
      }
    }

    function indexed({ size = [1, h / w], wrap = false } = {}) {
      return { width: w, height: h, palette: colors.slice(), origin: 'top-left', size, wrap,
        slots: Array.from({ length: area }, (_, i) => Number(rankAt(i % w, Math.floor(i / w)) <= cutoff)) };
    }

    function preview() {
      const tile = indexed(), width = 3 * w + 4, slots = new Array(width * h).fill(null);
      for (let y = 0; y < h; y++) {
        const row = y * width;
        slots.fill(0, row, row + w);
        slots.fill(1, row + w + 2, row + 2 * w + 2);
        for (let x = 0; x < w; x++) slots[row + 2 * w + 4 + x] = 2 + tile.slots[y * w + x];
      }
      return { width, height: h, palette: [targetHex, swatches[best], ...colors], slots };
    }

    const report = K.procedural.data.freeze({ target: targetHex, lightness, pattern,
      solid: { color: swatches[best], error: solidError },
      fit: { colors, secondPixels, share: secondPixels / area, average, error } });
    return Object.freeze({ report, indexed, preview });
  }

  materials.fitDither = fitDither;
})(KIT);
