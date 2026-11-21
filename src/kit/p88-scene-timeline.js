/* One seconds clock for scene channels, reusable sequences, audio and events. */
(function (K) {
  const { clone, freeze } = K.procedural.data;
  const timeOK = value => Number.isFinite(value) && value >= 0;
  const vector = value => Array.isArray(value) && value.length > 0 && Array.from(value).every(Number.isFinite);
  const camera = Object.freeze({ target: { size: 3 }, dist: { mode: 'positive' },
    yaw: { mode: 'radians' }, pitch: { mode: 'number' }, sway: { mode: 'number' },
    fov: { mode: 'positive', validate: value => value < Math.PI },
    focalLength: {mode:'positive'}, sensorHeight:{mode:'positive'}, focusDistance:{mode:'positive'},
    composition:{size:2,validate:value=>value.every(n=>n>=0&&n<=1)},
    projection: { mode: 'step', validate: value => K.cameraRig.projectionOK(value) },
    railProgress: { mode: 'number', validate: value => value >= 0 && value <= 1 } });
  const own = (obj, key) => Object.hasOwn(obj, key);
  const has = (a, b) => Object.keys(a).every(key => b.includes(key));
  const maxItems = 10000;

  function compile(definition, { channel, exact = false } = {}) {
    const T = K.procedural.takeTime;
    const ops = exact ? T : {
      read: value => value, seconds: value => value,
      compare: (a, b) => a - b, add: (a, b) => a + b, sub: (a, b) => a - b,
      mul: (a, b) => a * b, div: (a, b) => a / b
    };
    const { read, seconds, compare, add, sub, mul, div } = ops;
    const zero = read(0), one = read(1), precise = new WeakMap();
    const min = (a, b) => compare(a, b) <= 0 ? a : b;
    const max = (a, b) => compare(a, b) >= 0 ? a : b;
    const valid = value => timeOK(seconds(value));
    const timing = K.procedural.musicTiming;
    function point(raw, clock) {
      const musical = timing.isPosition(raw);
      if (musical && !clock) throw new TypeError('A musical timeline position needs a tempo map');
      const value = !musical ? read(raw) : exact ? clock.resolve(raw) : clock.timeAt(raw);
      check(valid(value), 'Invalid timeline time');
      return value;
    }
    const { record, check, id, selector } = K.world.data;
    const root = clone(definition);
    const catalog = root?.sequences ?? {};
    const rootClock = root?.tempoMap === undefined ? undefined : timing.compile(root.tempoMap);
    check(record(catalog) && Object.keys(catalog).length <= 1024, 'Expected a bounded timeline sequence catalog');
    const compiled = new Map(), visiting = new Set(), points = [], sounds = [], lanes = [], targets = new Map();
    let budget = 0, importCueTracks;
    function spend(count = 1) {
      budget += count;
      check(budget <= maxItems, 'Timeline exceeds its expanded item budget');
    }
    function list(value, name) {
      check(value === undefined || Array.isArray(value) && value.length <= maxItems, 'Expected a bounded timeline ' + name + ' array');
      return value ?? [];
    }
    function items(input, type, clock, parse) {
      const ids = new Set();
      return list(input, type).map(row => {
        check(record(row) && id(row.id) && !ids.has(row.id), 'Invalid or duplicate timeline ' + type + ' ID or time');
        ids.add(row.id);
        return { type, ...parse(row), id: row.id, time: point(row.time, clock) };
      });
    }
    function track(row, clock) {
      check(record(row) && has(row, ['target', 'keys', 'mode']), 'Invalid timeline track');
      const target = freeze(selector(row.target).map(String));
      const settings = channel ? channel(target) : {};
      check(settings, 'Unsupported timeline target ' + target.join('/'));
      const raw = list(row.keys, 'keyframe');
      spend(raw.length);
      check(raw.length && raw.every(key => record(key) && own(key, 'value') && has(key, ['time', 'value', 'ease'])),
        'Timeline tracks need keyframes with times and values');
      const first = raw[0].value;
      const mode = settings.mode ?? row.mode ?? (settings.size || vector(first) ? 'vector' :
        Number.isFinite(first) ? 'number' : 'step');
      check(['number', 'positive', 'radians', 'vector', 'step', 'orientation'].includes(mode) &&
        (row.mode === undefined || row.mode === mode), 'Invalid interpolation for timeline target ' + target.join('/'));
      const size = settings.size ?? (mode === 'orientation' ? 9 : vector(first) ? first.length : 0);
      const discrete = mode === 'step', split = size && (mode === 'radians' || mode === 'positive');
      check(size <= 64, 'Timeline vectors support up to 64 components');
      const components = split ? Array.from({ length: size }, (_, i) => String(i)) : [];
      const schema = split ? Object.fromEntries(components.map(i => [i, mode])) : { value: discrete ? 'number' : mode };
      const times = raw.map(key => point(key.time, clock));
      const keys = raw.map(({ value, ease }, index) => {
        check((size ? vector(value) && value.length === size : discrete || Number.isFinite(value)) &&
          (mode !== 'step' || ease === undefined || ease === 'step') &&
          (!settings.validate || settings.validate(value)), 'Invalid keyframe value for ' + target.join('/'));
        const columns = split ? Object.fromEntries(components.map(i => [i, value[i]])) : { value: discrete ? index : value };
        return { time: seconds(times[index]), value: columns, ease: discrete ? 'step' : ease };
      });
      const keyed = K.anim.keyframeTrack.create(schema, keys);
      return { target, duration: exact ? times.reduce(max, zero) : keyed.duration, sample(time) {
        const columns = keyed.sample(time);
        return discrete ? freeze(raw[columns.value].value) : split ? components.map(i => columns[i]) : columns.value;
      } };
    }
    function sequence(input, name, depth) {
      check(depth <= 32 && record(input) && has(input, name === null ?
        ['duration', 'tempoMap', 'tracks', 'markers', 'audio', 'events', 'cueTracks', 'clips', 'sequences'] :
        ['duration', 'tempoMap', 'tracks', 'markers', 'audio', 'events', 'cueTracks', 'clips']), 'Invalid timeline sequence ' + (name ?? '(root)'));
      const clock = name === null || input.tempoMap === undefined ? rootClock : timing.compile(input.tempoMap);
      const tracks = list(input.tracks, 'tracks').map(row => track(row, clock));
      check(new Set(tracks.map(({ target }) => JSON.stringify(target))).size === tracks.length,
        'A timeline sequence needs one track per target');
      const markers = items(input.markers, 'marker', clock, row => {
        check(has(row, ['id', 'time', 'label']) && (row.label === undefined || typeof row.label === 'string'),
          'Invalid timeline marker label');
        return row.label === undefined ? {} : { label: row.label };
      });
      const events = items(input.events, 'event', clock, row => {
        check(has(row, ['id', 'time', 'kind', 'detail']) && id(row.kind) && record(row.detail ?? {}), 'Invalid timeline world event');
        return { kind: row.kind, detail: row.detail ?? {} };
      });
      const audio = items(input.audio, 'audio', clock, row => {
        const { cue, duration: rawDuration = 0, offset: rawOffset = 0, gain = 1 } = row;
        const duration = point(rawDuration), offset = point(rawOffset);
        check(has(row, ['id', 'time', 'cue', 'duration', 'offset', 'gain']) &&
          typeof cue === 'string' && cue.length > 0 && cue.length <= 512 &&
          timeOK(gain) && valid(add(offset, duration)), 'Invalid timeline audio cue');
        return { cue, duration, offset, gain };
      });
      const clips = items(input.clips, 'clip', clock, row => {
        check(has(row, ['id', 'time', 'sequence', 'in', 'out', 'duration']) &&
          id(row.sequence) && own(catalog, row.sequence), 'Unknown timeline sequence ' + row.sequence);
        const source = named(row.sequence, depth + 1);
        const start = point(row.in === undefined ? 0 : row.in, source.clock);
        const end = row.out === undefined ? source.duration : point(row.out, source.clock);
        const duration = row.duration === undefined ? sub(end, start) : point(row.duration);
        check(valid(duration) && compare(start, end) < 0 && compare(end, source.duration) <= 0 && compare(duration, zero) > 0,
          'Invalid trim or duration on timeline clip ' + row.id);
        return { source, start, end, duration };
      });
      const cueTracks = input.cueTracks;
      const imported = cueTracks === undefined ? [] : (importCueTracks ??= K.procedural.mediaGraph.cueTrackCompiler(maxItems))(cueTracks)
        .map(row => exact ? row : { ...row, time: T.seconds(row.time) });
      check(cueTracks === undefined || clips.every(clip => !own(cueTracks, clip.id)),
        'Timeline clips and cue tracks need distinct names within a sequence');
      const content = [...markers, ...audio, ...events, ...imported];
      let end = tracks.reduce((end, track) => max(end, track.duration), zero);
      for (const item of [...content, ...clips]) end = max(end, add(item.time, item.duration ?? zero));
      const duration = input.duration == null ? end : point(input.duration, clock);
      check(valid(duration) && compare(duration, end) >= 0, 'Timeline duration must contain its keys, cues and clips');
      return { duration, tracks, content, clips, clock };
    }
    function named(name, depth) {
      check(depth <= 32 && !visiting.has(name), 'Timeline sequence cycle or depth limit at ' + name);
      if (compiled.has(name)) return compiled.get(name);
      visiting.add(name);
      const next = sequence(catalog[name], name, depth);
      visiting.delete(name);
      compiled.set(name, next);
      return next;
    }
    for (const name of Object.keys(catalog)) {
      check(id(name), 'Invalid timeline sequence name ' + name);
      named(name, 1);
    }
    const graph = sequence(root, null, 0);

    function mappedPoint(item, path, time, fields) {
      const { cueTrack, ...entry } = item;
      const row = { ...entry, ...fields, path: cueTrack === undefined ? path : [...path, cueTrack], time: seconds(time) };
      if (exact) precise.set(row, time);
      points.push(row);
    }
    function expand(node, low, high, start, end, rate, path, depth) {
      check(depth <= 32 && Number.isFinite(seconds(rate)) && seconds(rate) > 0, 'Timeline nesting or retiming limit exceeded');
      spend(node.tracks.length + node.content.length + node.clips.length + 1);
      const mapped = local => !compare(local, low) ? start :
        !compare(local, high) ? end : add(start, div(sub(local, low), rate));
      for (const tr of node.tracks) {
        const key = JSON.stringify(tr.target);
        targets.set(key, tr.target);
        lanes.push({ key, tr, low, high, start, end, rate });
      }
      for (const item of node.content) {
        if (item.type === 'audio' && compare(item.duration, zero) > 0) {
          const from = max(low, item.time), to = min(high, add(item.time, item.duration));
          if (compare(from, to) >= 0) continue;
          const offset = add(item.offset, sub(from, item.time)), time = mapped(from), end = mapped(to);
          const fields = { end: seconds(end), duration: seconds(sub(end, time)), offset: seconds(offset), rate: seconds(rate) };
          const clip = { ...item, ...fields, path, time: seconds(time) };
          sounds.push({ clip, time, end, offset, rate });
          mappedPoint(item, path, time, { ...fields, phase: 'start' });
          mappedPoint(item, path, end, { ...fields, phase: 'end' });
        } else if (compare(item.time, low) >= 0 && compare(item.time, high) <= 0)
          mappedPoint(item, path, mapped(item.time), item.type === 'audio' ? { duration: 0, offset: seconds(item.offset) } : {});
      }
      for (const clip of node.clips) {
        const finish = add(clip.time, clip.duration);
        const from = max(low, clip.time), to = min(high, finish);
        if (compare(from, to) > 0) continue;
        const scale = div(sub(clip.end, clip.start), clip.duration);
        const local = time => !compare(time, clip.time) ? clip.start :
          !compare(time, finish) ? clip.end : add(clip.start, mul(sub(time, clip.time), scale));
        expand(clip.source, local(from), local(to), mapped(from), mapped(to), mul(rate, scale), [...path, clip.id], depth + 1);
      }
    }
    expand(graph, zero, graph.duration, zero, graph.duration, one, [], 0);
    for (const target of targets.values())
      for (let n = 1; n < target.length; n++)
        check(!targets.has(JSON.stringify(target.slice(0, n))), 'Timeline tracks cannot address both a property and its child');
    // A clip ending at a cut hands off before the next audio clip starts.
    const timeOf = exact ? row => precise.get(row) : row => row.time;
    points.sort((a, b) => compare(timeOf(a), timeOf(b)) || Number(b.phase === 'end') - Number(a.phase === 'end'));
    sounds.sort((a, b) => compare(a.time, b.time));
    freeze(points);
    freeze(sounds);
    function boundary(time, inclusive) {
      let low = 0, high = points.length;
      while (low < high) {
        const mid = (low + high) >>> 1, order = compare(timeOf(points[mid]), time);
        if (order < 0 || inclusive && order === 0) low = mid + 1;
        else high = mid;
      }
      return low;
    }
    function sampleAt(time) {
      const edits = new Map(), clamped = min(time, graph.duration);
      for (const { key, tr, low, high, start, end, rate } of lanes) {
        if (compare(clamped, start) >= 0 && compare(clamped, end) <= 0) {
          const at = !compare(clamped, end) ? high : add(low, mul(sub(clamped, start), rate));
          edits.set(key, { op: 'set', path: tr.target, value: tr.sample(seconds(at)) });
        }
      }
      const audio = sounds.filter(clip => compare(clip.time, time) <= 0 && compare(time, clip.end) < 0)
        .map(({ clip, time: from, offset, rate }) => ({ ...clip, position: seconds(add(offset, mul(sub(time, from), rate))) }));
      return { time: seconds(time), edits: [...edits.values()], audio };
    }
    function audioSchedule(clock) {
      const coordinate = exact ? value => T.locate(clock, value).sample : value => clock.locate(value).sample;
      return [
        ...sounds.map(({ clip, time, end }) => ({ ...clip, firstSample: coordinate(time), endSample: coordinate(end) })),
        ...points.filter(row => row.type === 'audio' && !row.phase)
          .map(row => ({ ...row, firstSample: coordinate(timeOf(row)) }))
      ].sort((a, b) => a.firstSample - b.firstSample);
    }
    return freeze({
      audioSchedule,
      duration: seconds(graph.duration), targets: [...targets.values()], markers: points.filter(row => row.type === 'marker'),
      events: points.filter(row => row.type === 'event'), audio: sounds.map(row => row.clip),
      sample(time) {
        check(timeOK(time), 'Timeline sample time must be finite and nonnegative');
        return sampleAt(read(time));
      },
      between(from, to) {
        check(Number.isFinite(from) && timeOK(to) && from <= to, 'Timeline range must be finite and ordered');
        if (exact) return points.filter(row => row.time > from && row.time <= to);
        return points.slice(boundary(from, true), boundary(to, true));
      },
      ...(exact && {
        locate(row, clock) {
          const time = precise.get(row);
          check(time, 'Expected a cue from this exact timeline');
          return T.locate(clock, time);
        },
        forTake(frame) {
          const timing = T.requireFrame(frame);
          const cues = points.slice(boundary(timing.start, false), boundary(timing.end, false))
            .map(row => ({ ...row, ...timing.locate(timeOf(row)) }));
          return { ...sampleAt(timing.start), cues };
        }
      })
    });
  }
  K.timeline = Object.freeze({ compile, camera, maxItems });
})(KIT);
