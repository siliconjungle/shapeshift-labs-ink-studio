'use strict';

// Use the clip's integer exposure clock for seeking and PNG delays.
const down = n => Math.floor(n + Math.min(1e-7, Math.max(1, Math.abs(n)) * 4 * Number.EPSILON));
const up = n => -down(-n);
const wrap = (n, count) => ((n % count) + count) % count;

module.exports = function paintingCelBoil(entries, { fps, playback, placement }, ticks, api) {
  const presets = placement.painting.presets;
  const byEntry = new Map(entries.map(entry => [entry, entry.marks.flatMap((mark, index) => {
    const authored = Object.hasOwn(mark, 'boil') ? mark.boil :
      Object.hasOwn(presets ?? {}, mark.preset) ? presets[mark.preset]?.boil : undefined;
    const plan = api.prepare(authored);
    return mark.enabled !== false && plan?.active ? [{ index, id: mark.id, authored, plan }] : [];
  })]));
  if (![...byEntry.values()].some(rows => rows.length)) return;

  function evaluate(entry, tick, end) {
    const rows = byEntry.get(entry), marks = entry.marks.slice(), drawings = [];
    const time = tick / fps;
    let start = entry.tick, next = end;
    for (const { index, id, authored, plan } of rows) {
      const state = api.state(plan, time, entry.time);
      marks[index] = { ...marks[index], boil: { ...authored, drawing: state.drawing } };
      drawings.push({ id, drawing: state.drawing });
      start = Math.max(start, Math.min(tick, up(state.start * fps)));
      next = Math.min(next, Math.max(tick + 1, up(state.next * fps)));
    }
    return { entry, time: start / fps, tick: start, hold: next - start, marks, drawings };
  }

  let cached;
  function frames() {
    if (cached) return cached;
    const result = [];
    for (const entry of entries) {
      const end = entry.tick + entry.hold;
      for (let cursor = entry.tick; cursor < end;) {
        const exposure = evaluate(entry, cursor, end);
        result.push(exposure);
        if (result.length > 240) throw new RangeError('Painting boil export supports up to 240 resolved exposures');
        cursor = exposure.tick + exposure.hold;
      }
    }
    return cached = result;
  }

  return {
    start: entry => evaluate(entry, entry.tick, entry.tick + entry.hold),
    frames,
    at(entry, time) {
      const elapsed = down(time * fps);
      if (!Number.isSafeInteger(elapsed)) throw new RangeError('Painting seek exceeds the clip tick range');
      const local = playback === 'loop' ? wrap(elapsed, ticks) : Math.min(elapsed, ticks - 1);
      // The existing cel clock owns boundary rounding when a time is within a floating point epsilon of a cut.
      const tick = Math.max(entry.tick, Math.min(entry.tick + entry.hold - 1, local));
      return evaluate(entry, tick, entry.tick + entry.hold);
    }
  };
};
