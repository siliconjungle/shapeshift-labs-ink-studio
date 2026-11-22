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
    if (value && Object.keys(value).every(key => key === 'numerator' || key === 'denominator')) {
      if (integer(value.numerator, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
          integer(value.denominator, 1, Number.MAX_SAFE_INTEGER))
        return fraction(BigInt(value.numerator), BigInt(value.denominator));
      if (typeof value.numerator==='string'&&typeof value.denominator==='string'&&
          /^-?(0|[1-9]\d{0,127})$/.test(value.numerator)&&/^[1-9]\d{0,127}$/.test(value.denominator))
        return fraction(BigInt(value.numerator),BigInt(value.denominator));
    }
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
  const affine = (point,from,to,start,end) => add(start,mul(sub(point,from),div(sub(end,start),sub(to,from))));
  const roundDown = ([n, d]) => n / d - BigInt(n < 0n && n % d !== 0n);
  const roundUp = ([n, d]) => n / d + BigInt(n > 0n && n % d !== 0n);
  function index(value) {
    const out = Number(value);
    if (!Number.isSafeInteger(out)) throw new RangeError('Timecode index exceeds safe integer range');
    return out;
  }
  function pack([n,d]) {
    if(Number.isSafeInteger(Number(n))&&Number.isSafeInteger(Number(d)))
      return {numerator:Number(n),denominator:Number(d)};
    const numerator=String(n), denominator=String(d);
    if(numerator.replace('-','').length>128||denominator.length>128)
      throw new RangeError('Exact timecode exceeds its portable precision');
    return {numerator,denominator};
  }

  function period(value,rate) {
    if(rate!==undefined) {
      const exact=div(read(1),read(rate));
      if(seconds(exact)!==value) throw new RangeError('Simulation rate and timestep differ');
      return exact;
    }
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
    const rates={frame:picture,tick:simulation,sample:audio};
    function position(value) {
      if (value&&typeof value==='object') {
        const [key,...rest]=Object.keys(value);
        if (!rest.length&&Object.hasOwn(rates,key)) {
          if (!integer(value[key],0,Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid '+key+' address');
          return div(read(value[key]),rates[key]);
        }
      }
      return read(value);
    }
    function describe(point) {
      return {...locateExact(point),showFrame:index(roundUp(mul(point,picture))),seconds:seconds(point),timecode:pack(point)};
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
    const clock = Object.freeze({ at, locate: value => locateExact(position(value)), address:value=>describe(position(value)), dt });
    clocks.set(clock, {locate:locateExact,position,describe});
    return clock;
  }

  function clockOf(clock) {
    const internal=clocks.get(clock);
    if (!internal) throw new TypeError('Expected a take clock');
    return internal;
  }
  P.takeTime = Object.freeze({ read, seconds, compare, add, sub, mul, div, affine, pack, index, roundDown, period, requireFrame, create,
    locate:(clock,point)=>clockOf(clock).locate(point),position:(clock,value)=>clockOf(clock).position(value),
    describe:(clock,point)=>clockOf(clock).describe(point) });
})(KIT);
