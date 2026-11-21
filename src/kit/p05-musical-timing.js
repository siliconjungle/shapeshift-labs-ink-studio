/* A reversible, exact musical clock for authored timelines. */
(function (P) {
  const T = P.takeTime;
  const { read, seconds, compare, add, sub, mul, div, roundDown } = T;
  const zero = read(0), half = read(.5), one = read(1), two = read(2), minute = read(60);
  const limit = 1e9;
  const record = value => value !== null && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const only = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const bounded = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  const isPosition = row => record(row) && ['beat', 'bar', 'phrase'].some(key => Object.hasOwn(row, key));

  function checked(raw, low, high, label) {
    const exact = read(raw);
    if (compare(exact, read(low)) < 0 || compare(exact, read(high)) > 0)
      throw new RangeError('Invalid musical ' + label);
    return exact;
  }

  function latest(rows, reached) {
    let low = 1, high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (reached(rows[mid])) low = mid + 1;
      else high = mid;
    }
    return rows[low - 1];
  }

  function compile(map = {}) {
    if (!only(map, ['tempo', 'beatsPerBar', 'barsPerPhrase', 'swing', 'origin', 'changes']))
      throw new TypeError('Expected a musical tempo map');
    const { tempo = 120, beatsPerBar = 4, barsPerPhrase = 4, swing = .5, origin = 0, changes = [] } = map;
    if (!integer(beatsPerBar, 1, 32) || !integer(barsPerPhrase, 1, 64) || !Array.isArray(changes) || changes.length > 512)
      throw new RangeError('Invalid musical meter or tempo map length');
    const phraseBeats = beatsPerBar * barsPerPhrase, start = checked(origin, -limit, limit, 'origin');
    function segment(beat, time, bpm, ratio) {
      return { beat, at: read(beat), time, wall: seconds(time), tempo: bpm, swing: ratio,
        length: div(minute, bpm), firstHalf: mul(two, ratio), secondHalf: mul(two, sub(one, ratio)) };
    }
    const rows = [segment(0, start, checked(tempo, 1, 1000, 'tempo'), checked(swing, .05, .95, 'swing'))];
    let lastBeat = -1;
    for (const change of changes) {
      if (!only(change, ['beat', 'tempo', 'swing']) || !integer(change.beat, 0, limit) || change.beat <= lastBeat ||
          change.tempo === undefined && change.swing === undefined)
        throw new RangeError('Tempo changes need increasing whole beats and a tempo or swing value');
      const previous = rows.at(-1), beat = change.beat;
      const time = add(previous.time, mul(read(beat - previous.beat), previous.length));
      if (!bounded(seconds(time), -limit, limit)) throw new RangeError('Tempo change exceeds the musical time range');
      const next = segment(beat, time, change.tempo === undefined ? previous.tempo : checked(change.tempo, 1, 1000, 'tempo'),
        change.swing === undefined ? previous.swing : checked(change.swing, .05, .95, 'swing'));
      if (beat === 0) rows[0] = next;
      else rows.push(next);
      lastBeat = beat;
    }

    function beatTime(beat) {
      const row = latest(rows, entry => compare(beat, entry.at) >= 0);
      const whole = [roundDown(beat), 1n], frac = sub(beat, whole);
      // Swing divides each beat into two straight spans with a movable midpoint.
      const played = compare(frac, half) <= 0 ? mul(frac, row.firstHalf) :
        add(row.swing, mul(sub(frac, half), row.secondHalf));
      return add(row.time, mul(add(sub(whole, row.at), played), row.length));
    }

    function resolve(position) {
      if (!isPosition(position) || !only(position, ['beat', 'bar', 'phrase', 'offset']))
        throw new TypeError('Musical positions need a beat, bar, or phrase address');
      const { beat = 0, bar, phrase, offset = 0 } = position;
      const local = checked(beat, 0, limit, 'beat');
      const width = bar !== undefined ? beatsPerBar : phrase !== undefined ? phraseBeats : Infinity;
      if (bar !== undefined && !integer(bar, 0, phrase !== undefined ? barsPerPhrase - 1 : limit) ||
          phrase !== undefined && !integer(phrase, 0, limit) || width !== Infinity && compare(local, read(width)) >= 0)
        throw new RangeError('Musical bar, phrase or local beat is outside its range');
      const absolute = add(read((phrase ?? 0) * phraseBeats + (bar ?? 0) * beatsPerBar), local);
      if (compare(absolute, read(limit)) > 0) throw new RangeError('Musical address exceeds the beat range');
      const time = add(beatTime(absolute), checked(offset, -limit, limit, 'offset'));
      if (!bounded(seconds(time), -limit, limit)) throw new RangeError('Musical address exceeds the time range');
      return time;
    }

    function samplePoint(time, numeric) {
      const row = latest(rows, entry => numeric !== undefined ? numeric >= entry.wall : compare(time, entry.time) >= 0);
      const linear = add(row.at, div(sub(time, row.time), row.length));
      let whole = [roundDown(linear), 1n], frac = sub(linear, whole);
      if (numeric !== undefined) {
        // Public seconds can round down from the exact instant of a beat.
        const approximate = seconds(linear), rounded = Math.round(approximate);
        const precision = 4 * Number.EPSILON * Math.max(1, Math.abs(approximate), Math.abs(numeric) / seconds(row.length));
        if (Math.abs(approximate - rounded) <= precision && numeric === seconds(beatTime(read(rounded)))) {
          whole = read(rounded);
          frac = zero;
        }
      }
      const swung = compare(frac, row.swing) <= 0 ? div(frac, row.firstHalf) :
        add(half, div(sub(frac, row.swing), row.secondHalf));
      const position = seconds(add(whole, swung));
      if (!bounded(position, -limit, limit)) throw new RangeError('Musical clock exceeds its beat range');
      const index = T.index(whole[0]), bar = Math.floor(index / beatsPerBar), phrase = Math.floor(bar / barsPerPhrase);
      return { time: numeric ?? seconds(time), beat: position, beatInBar: index - bar * beatsPerBar + seconds(swung),
        bar, barInPhrase: bar - phrase * barsPerPhrase, phrase, tempo: seconds(row.tempo), swing: seconds(row.swing) };
    }

    return Object.freeze({
      resolve,
      timeAt: position => seconds(resolve(position)),
      timecodeAt(position) {
        const [n, d] = resolve(position);
        return { numerator: T.index(n), denominator: T.index(d) };
      },
      sample: raw => samplePoint(checked(raw, -limit, limit, 'time'), typeof raw === 'number' ? raw : undefined),
      forTake: frame => samplePoint(T.requireFrame(frame).start)
    });
  }

  function resolveItems(clock, items) {
    if (!Array.isArray(items) || items.length > 10000) throw new RangeError('Expected a bounded array of musical items');
    return Array.from(items, row => {
      if (!record(row)) throw new TypeError('Musical items need named fields');
      if (!isPosition(row.time)) return row;
      const time = clock.timeAt(row.time);
      if (time < 0) throw new RangeError('Resolved musical items need nonnegative time');
      return { ...row, time };
    });
  }

  P.musicTiming = Object.freeze({ compile, isPosition, resolveItems });
})(KIT.procedural);
