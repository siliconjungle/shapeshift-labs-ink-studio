/* Weighted oscillating fields and indexed color for procedural plasma. */
(function (P) {
  const { dimensions, clock, range, vector, integer, wrap, unit, raster } = P.generatorSupport;
  const validPalette = P.graphTypes.validator('palette');
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const tau = Math.PI * 2;
  const geometry = Object.freeze([
    Object.freeze({ id: 'cross', type: 'plane', frequency: 2.4, angle: .10, weight: .85 }),
    Object.freeze({ id: 'rings', type: 'radial', frequency: 3.2, center: Object.freeze([.35, .53]) }),
    Object.freeze({ id: 'curl', type: 'spiral', frequency: 1.6, arms: 2, center: Object.freeze([.65, .39]), weight: .6 })
  ]);
  const defaultPalette = ['#181731', '#292347', '#44325d', '#684066', '#90516d', '#b56774',
    '#d3857c', '#e8a787', '#f2c98f', '#f9e7b7'];
  const kinds = { plane: ['angle'], radial: [], spiral: ['arms'] };
  const pair = (values, min, max) => vector(values, 2) && values.every(value => range(value, min, max));

  function oscillator(source, motion, time) {
    const { id, type = 'plane', frequency = 2, angle = 0, arms = 1, center = [.5, .5], weight = 1, wave = 'sine' } = source;
    if (!Object.hasOwn(kinds, type) || Object.keys(source).some(key =>
      !['id', 'type', 'frequency', 'center', 'weight', 'wave', ...kinds[type]].includes(key)) ||
      !range(frequency, 0, 4096) || !range(angle, -1e6, 1e6) || !integer(arms, -32, 32) ||
      !pair(center, -16, 16) || !range(weight, -64, 64) || !['sine', 'triangle'].includes(wave))
      throw new RangeError('Invalid plasma geometry for field ' + id);
    const { phase = 0, rate = 0, velocity = [0, 0] } = motion;
    if (!range(phase, -1e6, 1e6) || !range(rate, -4096, 4096) || !pair(velocity, -64, 64))
      throw new RangeError('Invalid plasma motion for field ' + id);
    const start = wrap(phase + rate * time, 1), theta = wrap(angle, 1) * tau;
    const a = Math.cos(theta), b = Math.sin(theta);
    const oscillate = wave === 'sine' ? turns => Math.sin(tau * turns) :
      turns => 1 - 4 * Math.abs(wrap(turns, 1) - .5);
    const cycles = type === 'plane' ? (x, y) => frequency * (a * x + b * y) :
      type === 'radial' ? (x, y) => frequency * Math.hypot(x, y) :
      (x, y) => frequency * Math.hypot(x, y) + arms * Math.atan2(y, x) / tau;
    const [cx, cy] = center, [vx, vy] = velocity;
    return { cx, cy, vx: vx * time, vy: vy * time, weight, sample: (x, y) => oscillate(cycles(x, y) + start) };
  }

  function plasma({ geometry: fields = geometry, motion = {}, palette = defaultPalette, range: remap = [-1, 1],
    time = 0, ...size } = {}) {
    const { width, height } = dimensions(size), pixels = width * height;
    clock(time, 0);
    if (!Array.isArray(fields) || !integer(fields.length, 1, 16) || pixels * fields.length > 24e6 ||
        !record(motion) || !validPalette(palette) || !pair(remap, -16, 16) || remap[0] >= remap[1])
      throw new RangeError('Plasma needs a bounded field program, indexed palette and increasing remap range');

    const ids = new Set();
    for (const field of fields) {
      const id = field?.id;
      if (!record(field) || typeof id !== 'string' || !id.trim() || ids.has(id))
        throw new TypeError('Plasma fields need unique names');
      ids.add(id);
    }
    for (const [id, track] of Object.entries(motion)) {
      if (!ids.has(id) || !record(track) || Object.keys(track).some(key => !['phase', 'rate', 'velocity'].includes(key)))
        throw new TypeError('Plasma motion must name an existing field and use phase, rate or velocity');
    }
    const fit = Math.min(width, height);
    const layers = fields.map(source => {
      const { cx, cy, vx, vy, ...layer } = oscillator(source, Object.hasOwn(motion, source.id) ? motion[source.id] : {}, time);
      return { ...layer, x: cx * width / fit + vx, y: cy * height / fit + vy };
    });
    const scale = layers.reduce((total, layer) => total + Math.abs(layer.weight), 0);
    if (!scale) throw new RangeError('Plasma needs at least one nonzero field weight');

    const [low, high] = remap, slots = (palette.palette ?? palette).length;
    const values = new Float32Array(pixels), indices = new Uint8Array(pixels);
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const u = (x + .5) / fit, v = (y + .5) / fit;
      let value = 0;
      for (const layer of layers) value += layer.weight * layer.sample(u - layer.x, v - layer.y);
      values[p] = value / scale;
      indices[p] = Math.min(slots - 1, Math.floor(unit((values[p] - low) / (high - low)) * slots));
    }
    const resolved = P.pixelEffects.paletteCycle(raster(width, height, indices), palette);
    return { ...resolved, field: raster(width, height, values) };
  }

  P.generator.plasma = plasma;
  P.generatorSupport.plasmaGeometry = geometry;
  P.generatorSupport.plasmaPalette = Object.freeze(defaultPalette);
})(KIT.procedural);
