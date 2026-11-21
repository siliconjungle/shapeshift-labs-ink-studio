/* Screen printing shares engraving's retained coordinates and animation bindings. */
(function (K) {
  const P = ScreenPrint,
    E = Engraving;
  const objects = new WeakMap(),
    simple = new Map();
  function chart(value) {
    if (value === undefined || value === false) return value;
    const original = value;
    if (value && typeof value === 'object' && objects.has(value)) return objects.get(value);
    if (simple.has(value)) return simple.get(value);
    if (value === true || typeof value === 'string')
      value = typeof value === 'string' ? P.preset(value) : P.prepare(true);
    const { chart = {}, ...recipe } = value;
    if (
      !chart ||
      Object.getPrototypeOf(chart) !== Object.prototype ||
      Object.keys(chart).some(k => !['projection', 'origin', 'along', 'across', 'radius', 'ambient'].includes(k))
    )
      throw new TypeError('Screen print: invalid surface chart');
    const result = E.prepare({ ...chart, screenPrint: P.prepare(recipe), tone: 'luminance' });
    if (original && typeof original === 'object') objects.set(original, result);
    else simple.set(original, result);
    return result;
  }
  function update(world, slot, patch) {
    const binding = E.validate(world),
      old = binding?.styles[slot - 1];
    if (!old?.screenPrint || !patch || Object.getPrototypeOf(patch) !== Object.prototype)
      throw new TypeError('Screen print: invalid plate edit');
    const { chart: geometry, ...paint } = patch;
    if (geometry !== undefined && (!geometry || Object.getPrototypeOf(geometry) !== Object.prototype))
      throw new TypeError('Screen print: invalid surface chart');
    const chartSettings = {
      projection: old.projection,
      origin: old.origin,
      along: old.along,
      across: old.across,
      radius: old.radius,
      ambient: old.ambient,
      ...geometry
    };
    const next = chart({ ...old.screenPrint, ...paint, chart: chartSettings });
    return E.update(world, slot, {
      ...old,
      projection: next.projection,
      origin: next.origin,
      along: next.along,
      across: next.across,
      radius: next.radius,
      ambient: next.ambient,
      screenPrint: next.screenPrint
    });
  }

  K.screenPrint = Object.freeze({
    ...P,
    chart,
    bind: (world, selection, settings = true) => E.bind(world, selection, chart(settings)),
    update
  });
})(KIT);
