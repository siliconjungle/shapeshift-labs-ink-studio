/* Ordered palette rotation shared by projected and screen-space indexed art. */
const PaletteCycles = (() => {
  const fract = n => n - Math.floor(n);

  function prepare(cycles, slot, roles) {
    if (!cycles || Object.getPrototypeOf(cycles) !== Object.prototype)
      throw new TypeError('Palette cycles must be named in an object');
    const claimed = new Set();
    return Object.entries(cycles).map(([name, cycle]) => {
      if (!name.trim() || !cycle || Object.getPrototypeOf(cycle) !== Object.prototype ||
          Object.keys(cycle).some(key => !['role', 'slots', 'range', 'period', 'direction', 'phase'].includes(key)))
        throw new TypeError('Each palette cycle needs a name and cycle settings');
      const { role, slots, range, period, direction = 'forward', phase = 0 } = cycle;
      if (role !== undefined && roles === undefined)
        throw new TypeError('Palette cycles with a local palette need explicit slots or ranges');
      if ([role, slots, range].filter(value => value !== undefined).length !== 1)
        throw new TypeError('Palette cycle ' + name + ' needs one role, list of slots or inclusive range');
      let order = slots;
      if (role !== undefined) order = typeof role === 'string' && Object.hasOwn(roles, role) && roles[role];
      if (range !== undefined) {
        if (!Array.isArray(range) || range.length !== 2 || !Array.from(range).every(Number.isSafeInteger) ||
            range[0] < 0 || range[1] <= range[0] || range[1] - range[0] >= 256)
          throw new RangeError('Palette cycle ' + name + ' needs an increasing range of up to 256 slots');
        order = Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i);
      }
      if (!Array.isArray(order) || order.length < 2 || !Number.isFinite(period) || period <= 0 ||
          !['forward', 'reverse'].includes(direction) || !Number.isFinite(phase))
        throw new RangeError('Palette cycle ' + name + ' needs two or more slots, a positive period and valid direction and phase');
      const indices = Array.from(order, slot);
      for (const index of indices) {
        if (claimed.has(index)) throw new RangeError('Palette cycles cannot share a slot within one raster');
        claimed.add(index);
      }
      return { indices, period, direction: direction === 'forward' ? 1 : -1, phase: fract(phase) };
    });
  }

  function visit(groups, time, write) {
    for (const { indices, period, direction, phase } of groups) {
      const length = indices.length;
      const position = fract((time % period) / period + phase) * length;
      // Tolerate a decimal period landing just below the step at its loop boundary.
      const step = Math.floor(position + 4 * Number.EPSILON * length);
      const offset = length + direction * step;
      for (let i = 0; i < length; i++) write(indices[i], indices[(i + offset) % length]);
    }
  }

  return Object.freeze({ prepare, visit });
})();
if (typeof module !== 'undefined') module.exports = PaletteCycles;
