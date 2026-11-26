/* Stateless, spatially coherent line boil for retained painting marks. */
(function (K) {
  const P = K.procedural;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && range(n, lo, hi);

  function prepare(raw) {
    if (raw === undefined) return;
    if (!fields(raw, ['seed', 'amplitude', 'scale', 'axes', 'cadence', 'protect', 'drawing']))
      throw new TypeError('Boil needs a seed, amplitude, scale, axes, cadence, protection or drawing');
    const { seed = 0, amplitude = .02, scale = .28, axes = [1, 1, 0], cadence = {}, protect = [], drawing } = raw;
    if (!integer(seed, 0, 4294967295) || !range(amplitude, 0, 10) || !range(scale, .001, 100) ||
        !Array.isArray(axes) || axes.length !== 3 || !Array.from(axes).every(n => range(n, 0, 1)) ||
        drawing !== undefined && !integer(drawing, 0, Number.MAX_SAFE_INTEGER))
      throw new RangeError('Boil needs a 32-bit seed, bounded local amplitude and scale, XYZ weights in 0–1, and an optional drawing index');
    if (!fields(cadence, ['fps', 'holds', 'loop', 'phase', 'clock']))
      throw new TypeError('Boil cadence needs fps, holds, loop, phase or clock');
    const { fps = 12, holds = [2], loop = false, phase = 0, clock = 'scene' } = cadence;
    if (!integer(fps, 1, 120) || !Array.isArray(holds) || holds.length < 1 || holds.length > 120 ||
        !Array.from(holds).every(n => integer(n, 1, 65535)) || typeof loop !== 'boolean' ||
        !integer(phase, 0, 65535) || !['scene', 'cel'].includes(clock))
      throw new RangeError('Boil cadence needs integer fps and holds, a loop switch, phase ticks and a scene or cel clock');
    if (!Array.isArray(protect) || protect.length > 32)
      throw new TypeError('Boil supports up to 32 local contour protection paths');
    const mask = P.channelEraser.surface(Array.from(protect, (path, i) => {
      if (!fields(path, ['points', 'radius', 'feather']))
        throw new TypeError('Boil protection needs a local point or path, radius and optional feather');
      return { ...path, id: 'contour-' + i, channels: ['paint'] };
    }));
    let total = 0;
    const ends = holds.map(hold => total += hold);
    return { seed, amplitude, scale, axes, fps, ends, total, loop, phase, clock, drawing, mask,
      active: amplitude > 0 && axes.some(Boolean) };
  }

  function state(plan, time = 0, celTime) {
    if (plan.drawing !== undefined) return { drawing: plan.drawing, start: -Infinity, next: Infinity };
    const anchored = plan.clock === 'cel' && celTime !== undefined;
    const { fps, total, ends, loop, phase } = plan;
    const scaled = Math.max(0, anchored ? celTime : time) * fps;
    const tick = Math.floor(scaled + Math.min(1e-7, Math.max(1, scaled) * 4 * Number.EPSILON)) + phase;
    if (!Number.isSafeInteger(tick)) throw new RangeError('Boil sample time exceeds its tick range');
    const cycle = Math.floor(tick / total), inside = tick % total;
    const index = ends.findIndex(end => inside < end);
    const held = anchored || loop && ends.length === 1;
    return { drawing: loop ? index : cycle * ends.length + index,
      start: held ? -Infinity : (cycle * total + (ends[index - 1] ?? 0) - phase) / fps,
      next: held ? Infinity : (cycle * total + ends[index] - phase) / fps };
  }

  function apply(form, plan, mark, drawing) {
    const span = plan.axes.map(n => n * plan.amplitude);
    const lanes = span.map((n, axis) => n && P.fields.simplex({
      seed: P.data.hash(mark + '/' + drawing + '/' + axis, plan.seed)
    }));
    const { bounds, sd, opacityAt, cost } = form;
    const frequency = 1 / plan.scale;
    function sample(fn, x, y, z) {
      const point = [x, y, z], weight = plan.mask?.remaining('paint', point) ?? 1;
      if (!weight) return fn(x, y, z);
      const u = x * frequency + 1.731, v = y * frequency + 4.182, w = z * frequency + 7.521;
      for (let axis = 0; axis < 3; axis++) if (lanes[axis])
        point[axis] += span[axis] * weight * K.clamp(lanes[axis].value(u, v, w), -1, 1);
      return fn(...point);
    }
    return { ...form, bounds: { min: bounds.min.map((n, i) => n - span[i]), max: bounds.max.map((n, i) => n + span[i]) },
      cost: cost + lanes.filter(Boolean).length, sd: (x, y, z) => sample(sd, x, y, z),
      ...(opacityAt && { opacityAt: (x, y, z) => sample(opacityAt, x, y, z) }) };
  }

  P.paintBoil = Object.freeze({ prepare, state, apply });
})(KIT);
