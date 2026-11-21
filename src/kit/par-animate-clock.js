/* Reusable graph clocks, authored channels and deterministic raster frame selection. */
(function (K) {
  const P = K.procedural, S = P.rasterSimSupport;
  const A = P.animationGraph = {};
  const { int, range, clamp, wrap, record, vector } = S;

  const T = P.takeTime;
  const validRate = rate => rate === 0 || range(rate, 1e-5, 1e5);
  const zero = T.read(0);
  const max = (a, b) => T.compare(a, b) < 0 ? b : a;

  // Each segment stores its source position at the cue, so holds, seeks and
  // rate changes have the same result in playback and in a direct seek.
  function compileCues(cues, phase, rate, delay) {
    function authoredTime(value) {
      const point = T.read(value);
      if (!range(T.seconds(point), -1e9, 1e9)) throw new RangeError('Layer clock cue or phase exceeds its time budget');
      return point;
    }
    if (!Array.isArray(cues) || cues.length > 4096) throw new RangeError('Expected up to 4096 layer clock cues');
    const rows = Array.from(cues, cue => {
      if (!record(cue) || Object.keys(cue).some(key => !['time', 'rate', 'seek'].includes(key)) ||
          (cue.rate === undefined && cue.seek === undefined) || (cue.rate !== undefined && !validRate(cue.rate)))
        throw new TypeError('Layer clock cues need a time and a valid rate or seek');
      const { time, rate, seek } = cue;
      return { at: authoredTime(time), rate: rate === undefined ? undefined : T.read(rate),
        seek: seek === 'parent' ? 'parent' : seek === undefined ? undefined : authoredTime(seek) };
    }).sort((a, b) => T.compare(a.at, b.at));
    const advance = (segment, time) =>
      T.add(segment.phase, T.mul(T.sub(max(time, delay), max(segment.at, delay)), segment.rate));
    const initial = { at: delay, phase: authoredTime(phase), rate, cut: 0 };
    let prior = initial;
    const segments = rows.map(({ at, rate, seek }, i) => {
      if (i && T.compare(at, prior.at) === 0) throw new RangeError('Layer clock cue times must be unique');
      const position = seek === 'parent' ? at : seek ?? advance(prior, at);
      // Keep unusual mixtures of unrelated timebases bounded. Cue comparisons remain exact.
      const phase = position[1] > (1n << 128n) ? T.read(T.seconds(position)) : position;
      prior = { at, phase, rate: rate ?? prior.rate, cut: seek === undefined ? prior.cut : i + 1 };
      return prior;
    });
    return time => {
      let low = 0, high = segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (T.compare(segments[middle].at, time) <= 0) low = middle + 1;
        else high = middle;
      }
      const segment = segments[low - 1] ?? initial;
      return { elapsed: advance(segment, time), cut: segment.cut };
    };
  }

  function compile(spanOptions = {}, { end: exactEnd, rate: exactRate } = {}) {
    const { range: span = [0, 1], rate = 1, delay = 0, reverse = false, mode = 'hold', phase, cues } = spanOptions;
    if (!vector(span, 2) || span[1] <= span[0] || !validRate(rate) || !range(delay, -1e6, 1e6) ||
        typeof reverse !== 'boolean' || !['hold', 'loop', 'pingpong'].includes(mode))
      throw new RangeError('Invalid animation clock range, delay, rate or playback');
    const [start, end] = span, duration = end - start;
    if (phase === undefined && cues === undefined) return time => {
      if (!Number.isFinite(time)) throw new RangeError('Animation clock time must be finite');
      const elapsed = Math.max(0, time - delay) * rate;
      if (!Number.isFinite(elapsed)) throw new RangeError('Animation clock overflows its playback range');
      let amount = Math.min(elapsed, duration), direction = 1;
      if (mode === 'loop') amount = wrap(elapsed, duration);
      if (mode === 'pingpong') {
        amount = wrap(elapsed, duration * 2);
        if (amount >= duration) { amount = duration * 2 - amount; direction = -1; }
      }
      if (reverse) { amount = duration - amount; direction *= -1; }
      return { value: start + amount, progress: amount / duration, direction,
        active: time >= delay && (mode !== 'hold' || elapsed <= duration), cut: 0 };
    };

    const source = T.read(start), spanTime = T.sub(exactEnd ?? T.read(end), source), delayTime = T.read(delay);
    const period = mode === 'pingpong' ? T.add(spanTime, spanTime) : spanTime;
    const schedule = compileCues(cues === undefined ? [] : cues, phase === undefined ? 0 : phase,
      exactRate ?? T.read(rate), delayTime);
    return (time, exact = T.read(time)) => {
      const { elapsed, cut } = schedule(exact);
      let direction = 1;
      let amount = mode === 'hold' ? max(zero, T.compare(elapsed, spanTime) > 0 ? spanTime : elapsed)
        : T.sub(elapsed, T.mul(period, [T.roundDown(T.div(elapsed, period)), 1n]));
      if (mode === 'pingpong' && T.compare(amount, spanTime) >= 0) {
        amount = T.sub(period, amount);
        direction = -1;
      }
      if (reverse) { amount = T.sub(spanTime, amount); direction *= -1; }
      return { value: T.seconds(T.add(source, amount)), progress: T.seconds(T.div(amount, spanTime)), direction,
        active: T.compare(exact, delayTime) >= 0 && (mode !== 'hold' || T.compare(elapsed, spanTime) <= 0), cut };
    };
  }
  function publicSample({ cut, ...sample }) { return sample; }
  function compileClock(options, exact) {
    const at = compile(options, exact);
    return Object.freeze({
      sample(time) {
        if (Number.isFinite(time)) return publicSample(at(time));
        const exact = T.read(time);
        return publicSample(at(T.seconds(exact), exact));
      },
      forTake: take => publicSample(at(take.start, T.requireFrame(take).start))
    });
  }
  function clock(time, options) { return publicSample(compile(options)(time)); }
  function exactStart(take, override) {
    return take !== undefined && override == null ? T.requireFrame(take).start : undefined;
  }

  function stagger(time, { count, interval = .1, offset = 0, reverseOrder = false, ...timing } = {}, exact) {
    if (!int(count, 0, 8192) || !range(interval, 0, 1200) || !range(offset, 0, 1e6) || typeof reverseOrder !== 'boolean')
      throw new RangeError('Invalid animation stagger count, interval or order');
    if (count * (timing.cues?.length ?? 0) > 32768) throw new RangeError('Stagger exceeds its layer clock cue budget');
    const clocks = Array.from({ length: count }, (_, i) => {
      const delay = offset + (timing.delay ?? 0) + (reverseOrder ? count - i - 1 : i) * interval;
      return publicSample(compile({ ...timing, delay })(time, exact));
    });
    return { value: clocks.map(entry => entry.value), clocks };
  }

  function track(schema, keys) {
    if (!record(schema) || !int(Object.keys(schema).length, 1, 64) ||
        !Array.isArray(keys) || !int(keys.length, 1, 8192)) throw new RangeError('Expected named channels and a bounded key array');
    return K.anim.keyframeTrack.create(schema, keys);
  }

  function frameIndex(length, time, { fps = 12, mode = 'hold', first = 0, end = length, ...timing } = {}, exact) {
    const rate = typeof fps === 'object' ? T.seconds(T.read(fps)) : fps;
    if (!int(length, 1, 8192) || !range(rate, .01, 1000) || !int(first, 0, length - 1) || !int(end, first + 1, length))
      throw new RangeError('Invalid raster frame range or rate');
    const authored = timing.phase !== undefined || timing.cues !== undefined || typeof fps === 'object';
    const exactEnd = authored ? T.div(T.read(end - first), T.read(fps)) : undefined;
    const sampled = compile({ ...timing, ...(authored && { phase: timing.phase === undefined ? 0 : timing.phase }),
      range: [0, (end - first) / rate], mode }, { end: exactEnd })(time, exact);
    const frame = sampled.direction < 0 ? Math.ceil(sampled.value * rate - 1e-8) - 1 : Math.floor(sampled.value * rate + 1e-8);
    return { index: clamp(first + frame, first, end - 1), time: sampled.value };
  }

  function spriteDesync(source, settings) {
    return P.graph.raster(source).spriteDesync(settings);
  }

  const options = { type: 'record', default: {} };
  function groupOp(spec, groups) {
    const group = Object.hasOwn(groups, spec.group) && groups[spec.group];
    if (!group?.instantiate || Object.hasOwn(group.inputs, 'timing'))
      throw new TypeError('anim.retime needs a reusable group without an input named timing');
    return { inputs: { ...group.inputs, timing: options }, outputs: group.outputs, time: true, workerGroup: true,
      instantiate() {
        const evaluate = group.instantiate();
        let priorTiming, at, parentSequence, localSequence, segment;
        const run = ({ timing, ...inputs }, { time, take, sequence, ...ctx }, workers) => {
          if (timing !== priorTiming) { at = compile(timing); priorTiming = timing; }
          const { value, cut } = at(timing.time ?? time, exactStart(take, timing.time));
          if (parentSequence !== sequence || segment !== cut) {
            localSequence = sequence !== undefined && cut ? Object.freeze({}) : sequence;
            parentSequence = sequence;
            segment = cut;
          }
          return evaluate(inputs, { ...ctx, time: value, sequence: localSequence }, workers);
        };
        run.clear = () => {
          priorTiming = parentSequence = localSequence = segment = undefined;
          evaluate.clear?.();
        };
        run.inspect = () => evaluate.inspect?.();
        return run;
      }
    };
  }

  Object.assign(A, { clock, compileClock, stagger, track, frameIndex, spriteDesync, operations: {
    'anim.clock': {
      inputs: { options }, outputs: { value: 'seconds', progress: 'number', direction: 'number', active: 'boolean' }, time: true,
      instantiate() {
        let prior, at;
        return ({ options }, { time, take }) => {
          if (options !== prior) { at = compile(options); prior = options; }
          return publicSample(at(options.time ?? time, exactStart(take, options.time)));
        };
      }
    },
    'anim.stagger': {
      inputs: { count: 'number', options }, outputs: { value: 'array<number>', clocks: 'array<record>' }, time: true,
      run({ count, options }, { time, take }) {
        return stagger(options.time ?? time, { ...options, count }, exactStart(take, options.time));
      }
    },
    'anim.keyframes': {
      inputs: { channels: 'record', keys: 'array<record>', options }, outputs: { value: 'record', duration: 'number' }, time: true,
      instantiate() {
        let compiled, priorKeys, priorChannels;
        return ({ channels, keys, options }, { time }) => {
          if (keys !== priorKeys || channels !== priorChannels) {
            compiled = track(channels, keys);
            priorKeys = keys;
            priorChannels = channels;
          }
          return { value: compiled.sample(options.time ?? time), duration: compiled.duration };
        };
      }
    },
    'anim.frame': {
      inputs: { frames: 'array<raster>', options }, outputs: { value: 'raster', index: 'frames', time: 'seconds' }, time: true,
      run({ frames, options }, { time, take }) {
        const sample = frameIndex(frames.length, options.time ?? time, options, exactStart(take, options.time));
        return { index: sample.index, time: sample.time, value: frames[sample.index] };
      }
    },
    'anim.spriteDesync': {
      inputs: { source: 'any', options }, outputs: { value: 'raster', frames: 'record' }, time: true,
      instantiate() {
        let asset, previous;
        return ({ source, options }, { time, take }) => {
          if (!asset || source !== previous) {
            asset = P.graph.raster(source);
            previous = source;
          }
          return asset.spriteDesync({ ...options, time: options.time ?? time }, exactStart(take, options.time));
        };
      }
    },
    'anim.retime': { specialize: groupOp }
  } });
})(KIT);
