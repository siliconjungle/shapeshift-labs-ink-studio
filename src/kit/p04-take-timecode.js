/* Integer time coordinates for takes. Public seconds remain ordinary numbers. */
(function (K) {
  const P = K.procedural, frames = new WeakMap(), clocks = new WeakMap();
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  function fraction(n, d) {
    if (d === 0n) throw new RangeError('Timecode denominator must be positive');
    if (d < 0n) [n, d] = [-n, -d];
    let a = n < 0n ? -n : n, b = d;
    while (b) [a, b] = [b, a % b];
    return [n / a, d / a];
  }
  function read(value) {
    if (Number.isFinite(value)) {
      const [mantissa, exponent = '0'] = String(value).split('e');
      const [whole, rest = ''] = mantissa.split('.');
      const power = Number(exponent) - rest.length;
      const units = BigInt(whole + rest);
      return power >= 0 ? [units * 10n ** BigInt(power), 1n] : fraction(units, 10n ** BigInt(-power));
    }
    if (value && integer(value.numerator, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
        integer(value.denominator, 1, Number.MAX_SAFE_INTEGER) &&
        Object.keys(value).every(key => key === 'numerator' || key === 'denominator'))
      return fraction(BigInt(value.numerator), BigInt(value.denominator));
    throw new TypeError('Expected finite seconds or an integer numerator and positive denominator');
  }
  function seconds([n, d]) {
    if (Number.isFinite(Number(n)) && Number.isFinite(Number(d))) return Number(n) / Number(d);
    const shift = a => BigInt(Math.max(0, a.toString(2).length - 55));
    const a = n < 0n ? -n : n, up = shift(a), down = shift(d);
    return (n < 0n ? -1 : 1) * Number(a >> up) / Number(d >> down) * 2 ** Number(up - down);
  }
  const compare = ([a, b], [c, d]) => a * d < c * b ? -1 : a * d > c * b ? 1 : 0;
  const add = ([a, b], [c, d]) => fraction(a * d + c * b, b * d);
  const sub = ([a, b], [c, d]) => fraction(a * d - c * b, b * d);
  const mul = ([a, b], [c, d]) => fraction(a * c, b * d);
  const div = ([a, b], [c, d]) => fraction(a * d, b * c);
  const roundDown = ([n, d]) => n / d - BigInt(n < 0n && n % d !== 0n);
  const roundUp = ([n, d]) => n / d + BigInt(n > 0n && n % d !== 0n);
  function index(value) {
    const out = Number(value);
    if (!Number.isSafeInteger(out)) throw new RangeError('Timecode index exceeds safe integer range');
    return out;
  }

  function period(value) {
    const reciprocal = Math.round(1 / value);
    return reciprocal >= 1 && 1 / reciprocal === value ? [1n, BigInt(reciprocal)] : read(value);
  }
  function requireFrame(frame) {
    const timing = frames.get(frame);
    if (!timing) throw new TypeError('Expected a frame from KIT.timeDomains.take');
    return timing;
  }
  function create(settings = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new TypeError('Expected named take clock settings');
    const { fps = 24, simulationRate = 60, sampleRate = 48000, cuts = [] } = settings;
    if (Object.keys(settings).some(key => !['fps', 'simulationRate', 'sampleRate', 'cuts'].includes(key)))
      throw new TypeError('Unknown take clock setting');
    const picture = read(fps), simulation = read(simulationRate), hz = seconds(picture), ticks = seconds(simulation);
    if (hz < .001 || hz > 1000 || ticks < 1 / 60 || ticks > 1000000 || !integer(sampleRate, 1, 768000))
      throw new RangeError('Invalid take frame, simulation or sample rate');
    const step = div([1n, 1n], simulation);
    const dt = seconds(step), frameDt = seconds(div([1n, 1n], picture));
    if (!Array.isArray(cuts) || cuts.length > 10000 || Array.from(cuts).some(row =>
      !integer(row?.frame, 0, 1000000000) || typeof row.id !== 'string' || !row.id || row.id.length > 96 || Object.keys(row).some(key => key !== 'frame' && key !== 'id')))
      throw new RangeError('Take cuts need bounded frame indices and named shots');
    const edits = Array.from(cuts, ({ frame, id }) => ({ frame, id })).sort((a, b) => a.frame - b.frame);
    if (edits.some((row, i) => i && row.frame === edits[i - 1].frame))
      throw new RangeError('Take cuts must have distinct frame indices');
    const audio = [BigInt(sampleRate), 1n];
    const boundary = frame => div([BigInt(frame), 1n], picture);
    const coordinate = (point, rate) => index(roundDown(mul(point, rate)));

    function locateExact(point) {
      return {
        frame: coordinate(point, picture),
        tick: coordinate(point, simulation),
        cueTick: Math.max(1, index(roundUp(mul(point, simulation)))),
        sample: coordinate(point, audio)
      };
    }
    let latest;
    function at(frame) {
      if (latest && latest.frame === frame) return latest;
      if (!integer(frame, 0, 1000000000)) throw new RangeError('Invalid take frame index');
      const start = boundary(frame), end = boundary(frame + 1);
      const time = seconds(start), next = seconds(end);
      if (next > 1e9) throw new RangeError('Take exceeds its time budget');
      let low = 0, high = edits.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (edits[mid].frame <= frame) low = mid + 1;
        else high = mid;
      }
      const cut = edits[low - 1];
      const tick = coordinate(start, simulation), endTick = coordinate(end, simulation);
      const snapshot = Object.freeze({
        frame, fps: hz, start: time, end: next,
        tick, endTick, simulationTime: seconds(mul([BigInt(tick), 1n], step)),
        sampleRate, firstSample: coordinate(start, audio), endSample: coordinate(end, audio),
        cut: cut?.frame === frame, shot: cut?.id ?? null
      });
      frames.set(snapshot, { start, end, dt, frameDt, locate: locateExact });
      latest = snapshot;
      return snapshot;
    }
    const clock = Object.freeze({ at, locate: value => locateExact(read(value)), dt });
    clocks.set(clock, locateExact);
    return clock;
  }

  P.takeTime = Object.freeze({ read, seconds, compare, add, sub, mul, div, index, roundDown, period, requireFrame, create, locate(clock, point) {
    const locate = clocks.get(clock);
    if (!locate) throw new TypeError('Expected a take clock');
    return locate(point);
  } });
})(KIT);
