/* Named, seekable cue documents with immutable edits and native timeline and pulse outputs. */
(function (P) {
  const A = P.mediaGraph, T = P.takeTime;
  const { int, plain, id, range } = P.mediaGraphSupport;
  const format = 'ink-studio/musical-events', maxEvents = 4096;
  const cueId = value => id(value) && !value.includes(':');
  const only = (row, keys) => plain(row) && Object.keys(row).every(key => keys.includes(key));

  function cue(raw) {
    if (!only(raw, ['id', 'name', 'time', 'timecode', 'detected']))
      throw new TypeError('Musical cues need named fields');
    const { id: key, name, time, timecode, detected } = raw;
    const point = T.read(timecode ?? time), seconds = timecode === undefined ? time : T.seconds(point);
    if (!cueId(key) || typeof name !== 'string' || !name.trim() || name.length > 128 || /[\u0000-\u001f]/.test(name) ||
        !range(seconds, 0, 1e9) || time !== undefined && time !== seconds || timecode !== undefined && !plain(timecode))
      throw new RangeError('Musical cues need a unique ID, name, and nonnegative time');
    let origin;
    if (detected !== undefined) {
      if (!only(detected, ['sample', 'sampleRate', 'strength', 'channel']) || !int(detected.sample, 0, 32000000) ||
          !int(detected.sampleRate, 1, 768000) || !Number.isFinite(detected.strength) || detected.strength < 0 ||
          !(detected.channel === 'mix' || int(detected.channel, 0, 63)))
        throw new RangeError('Invalid transient detection metadata');
      origin = Object.freeze({ ...detected });
    }
    const row = Object.freeze({ id: key, name, time: seconds,
      ...(timecode !== undefined && { timecode: Object.freeze({ ...timecode }) }), ...(origin && { detected: origin }) });
    return { row, point };
  }

  function musicalEventTrack(source) {
    if (!only(source, ['format', 'version', 'events']) ||
        source.format !== format || source.version !== 1 || !Array.isArray(source.events) || source.events.length > maxEvents)
      throw new TypeError('Expected a bounded version 1 musical event track');
    const ordered = Array.from(source.events, cue).sort((a, b) => T.compare(a.point, b.point));
    const events = ordered.map(({ row }) => row);
    if (new Set(events.map(row => row.id)).size !== events.length) throw new RangeError('Duplicate musical cue ID');
    return Object.freeze({ format, version: 1, events: Object.freeze(events) });
  }

  function makeMusicalEvents(events) {
    return musicalEventTrack({ format, version: 1, events });
  }

  function editMusicalEvents(source, edits = [], { exact = false } = {}) {
    if (!Array.isArray(edits) || edits.length > maxEvents || typeof exact !== 'boolean')
      throw new TypeError('Expected a bounded musical edit list and a boolean exact-timeline option');
    const baseline = musicalEventTrack(source), entries = new Map(baseline.events.map(row => [row.id, row]));
    for (const raw of edits) {
      if (!plain(raw)) throw new TypeError('Musical edits need named operation records');
      const { op, id: key, ...changes } = raw, previous = entries.get(key);
      if (op === 'add' && !previous && only(changes, ['name', 'time', 'timecode'])) {
        entries.set(key, cue({ id: key, ...changes }).row);
      } else if (op === 'move' && previous && only(changes, ['time', 'timecode'])) {
        const { time, timecode, ...keep } = previous;
        entries.set(key, cue({ ...keep, ...changes }).row);
      } else if (op === 'rename' && previous && only(changes, ['name'])) {
        entries.set(key, cue({ ...previous, name: changes.name }).row);
      } else if (op === 'delete' && previous && only(changes, [])) {
        entries.delete(key);
      } else throw new RangeError('Invalid musical cue edit or ID for ' + String(op));
      if (entries.size > maxEvents) throw new RangeError('Musical edits exceed the event budget');
    }

    const value = edits.length ? makeMusicalEvents([...entries.values()]) : baseline, { events } = value;
    const payload = ({ id, name, detected }) => ({ id, name, ...(detected && { detected }) });
    const when = row => exact ? row.timecode ?? row.time : row.time;
    const timeline = P.data.freeze({
      markers: events.map(row => ({ id: row.id, time: when(row), label: row.name })),
      events: events.map(row => ({ id: row.id, time: when(row), kind: 'music-cue', detail: payload(row) }))
    });
    const recording = A.recording({ events: events.map(row => ({ time: row.time,
      ...(row.timecode && { timecode: row.timecode }), channel: 'music:cue', kind: 'pulse', value: payload(row) })) });
    return { value, events, timeline, recording };
  }

  Object.assign(A, { makeMusicalEvents, musicalEventTrack, editMusicalEvents });
})(KIT.procedural);
