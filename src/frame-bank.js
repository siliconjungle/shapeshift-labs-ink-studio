/* Shared refresh schedule and CPU update for screen-space frame banks. */
const FrameBank = (() => {
  const maxRegions = 8, maxPeriod = 4096;
  const name = value => typeof value === 'string' && value.trim() && !(value in Object.prototype);
  const int = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;
  const mod = (value, period) => (value % period + period) % period;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function check(value, fields, label) {
    if (!record(value) || Object.keys(value).some(key => !fields.includes(key)))
      throw new TypeError('Invalid frame bank ' + label);
  }
  function period(every, phase) {
    if (!int(every, 1, maxPeriod) || !int(phase, 0, every - 1))
      throw new RangeError('Frame bank cadence needs 1 to 4096 ticks and a phase within that period');
  }

  function prepare(settings = {}) {
    check(settings, ['fps', 'tiles', 'regions', 'refresh'], 'settings');
    const { fps = 12, tiles, regions = [], refresh } = settings;
    if (!Number.isFinite(fps) || fps < 1 || fps > 120 || !Array.isArray(regions) || regions.length > maxRegions ||
        (refresh !== undefined && !name(refresh)) || (tiles === undefined && !regions.length && refresh === undefined))
      throw new RangeError('Frame bank needs a capture rate from 1 to 120 and tiles, up to eight regions or a refresh mask');
    let grid;
    if (tiles !== undefined) {
      check(tiles, ['size', 'every', 'phase', 'step'], 'tiles');
      const { size, every = 4, phase = 0, step = every === 1 ? 0 : 1 } = tiles;
      period(every, phase);
      if (!Array.isArray(size) || size.length !== 2 || !Array.from(size).every(n => int(n, 1, 32768)) ||
          !int(step, 0, every - 1)) throw new RangeError('Frame bank tiles need a pixel size and a step within the period');
      grid = Object.freeze({ size: Object.freeze(size.slice()), every, phase, step });
    }
    const rules = Object.freeze(Array.from(regions, rule => {
      check(rule, ['rect', 'mask', 'every', 'phase'], 'region');
      const { rect, mask, every = 1, phase = 0 } = rule;
      period(every, phase);
      if (mask !== undefined && !name(mask)) throw new TypeError('Frame bank region mask needs a name');
      if (rect !== undefined && (!Array.isArray(rect) || rect.length !== 4 ||
          !Array.from(rect).every(n => Number.isFinite(n) && Math.abs(n) <= 32768) || rect[2] <= 0 || rect[3] <= 0))
        throw new RangeError('Frame bank region needs a rectangle with positive dimensions');
      return Object.freeze({ every, phase, mask, rect: rect && Object.freeze(rect.slice()) });
    }));
    const masks = Object.freeze([...new Set([refresh, ...rules.map(rule => rule.mask)].filter(Boolean))]);
    return Object.freeze({ fps, grid, rules, refresh, masks });
  }

  function schedule(plan, time, prior) {
    if (!Number.isFinite(time)) throw new TypeError('Frame bank time must be finite');
    if (!prior || time < prior.time) {
      const clock = { origin: time, time, tick: 0 };
      return { first: true, capture: true, clock, regions: [] };
    }
    const { origin } = prior, tick = Math.floor((time - origin) * plan.fps + 1e-8);
    if (!Number.isSafeInteger(tick)) throw new RangeError('Frame bank exceeds its capture tick range');
    const crossed = tick - prior.tick;
    const regions = crossed > 0 ? plan.rules.filter(rule => mod(tick - rule.phase, rule.every) < crossed) : [];
    const pulse = time > prior.time ? plan.refresh : undefined;
    const grid = crossed > 0 && plan.grid ? {
      ...plan.grid, head: mod(tick, plan.grid.every), span: Math.min(crossed, plan.grid.every)
    } : undefined;
    return { first: false, capture: Boolean(grid || regions.length || pulse), clock: { origin, time, tick }, grid, regions, pulse };
  }

  function write(step, source, previous, w, h, width, height, mask, diagnostic) {
    const { grid, first, pulse } = step;
    if (first && width === w && height === h) {
      diagnostic?.fill(255);
      return source.slice();
    }
    const regions = step.regions.map(rule => ({ rect: rule.rect, coverage: rule.mask && mask(rule.mask) }));
    const instant = pulse && mask(pulse);
    const cols = grid && Math.ceil(w / grid.size[0]);
    const result = new Uint8Array(width * height * 4);
    for (let j = 0, p = 0; j < height; j++) for (let i = 0; i < width; i++, p++) {
      const x = (i + .5) * w / width, y = (j + .5) * h / height;
      const q = Math.floor(y) * w + Math.floor(x);
      let weight = first ? 255 : instant?.[q] ?? 0;
      if (grid && weight < 255) {
        const index = Math.floor(y / grid.size[1]) * cols + Math.floor(x / grid.size[0]);
        if (mod(grid.head - grid.phase - index * grid.step, grid.every) < grid.span) weight = 255;
      }
      for (const { rect, coverage } of regions) {
        if (weight === 255) break;
        if (!rect || x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3])
          weight = Math.max(weight, coverage?.[q] ?? 255);
      }
      if (diagnostic) diagnostic[p] = weight;
      for (let c = 0; c < 4; c++) {
        const fresh = source[q * 4 + c], old = previous?.[p * 4 + c] ?? 0;
        result[p * 4 + c] = Math.floor((weight * fresh + (255 - weight) * old + 127) / 255);
      }
    }
    return result;
  }
  return Object.freeze({ prepare, schedule, write });
})();
if (typeof module !== 'undefined') module.exports = FrameBank;
