/* Place portable musical cues and recorded audio pulses on a scene timeline. */
(function (K) {
  const P = K.procedural, A = P.mediaGraph, T = P.takeTime;
  const { plain, id: channelId, range } = P.mediaGraphSupport;
  const zero = T.read(0), maxTime = 1e9;
  const only = (row, keys) => plain(row) && Object.keys(row).every(key => keys.includes(key));

  function cueTrackCompiler(limit) {
    let scanned = 0, imported = 0;
    return function cueTrackEvents(tracks) {
      if (!plain(tracks) || Object.keys(tracks).length > 32)
        throw new TypeError('Expected up to 32 named timeline cue tracks');
      const events = [];
      for (const name of Object.keys(tracks).sort()) {
        const track = tracks[name];
        if (!K.world.data.id(name) || !only(track, ['source', 'channels', 'offset']))
          throw new TypeError('Invalid timeline cue track ' + name);
        const { source, channels, offset = 0 } = track;
        const shift = T.read(offset), musical = source?.format === 'ink-studio/musical-events';
        if (!range(T.seconds(shift), -maxTime, maxTime) || !plain(source) || source.version !== 1 ||
            !Array.isArray(source.events) || !musical && source.format !== 'ink-studio/input-recording')
          throw new TypeError('Cue tracks need a portable musical-events or input-recording source and a finite offset');
        if (channels !== undefined && (musical || !Array.isArray(channels) || channels.length === 0 ||
            channels.length > 256 || !Array.from(channels).every(channelId) || new Set(channels).size !== channels.length))
          throw new RangeError('Cue track channels need unique input recording channel names');
        scanned += source.events.length;
        if (scanned > 100000) throw new RangeError('Timeline cue tracks exceed their source event budget');
        const selected = channels && new Set(channels);
        const rows = (musical ? A.musicalEventTrack(source) : A.recording(source)).events;
        for (const [index, row] of rows.entries()) {
          if (!musical && (row.kind !== 'pulse' || selected && !selected.has(row.channel))) continue;
          const time = T.add(T.read(row.timecode ?? row.time), shift);
          if (T.compare(time, zero) < 0) continue;
          if (T.seconds(time) > maxTime || ++imported > limit) throw new RangeError('Timeline cue tracks exceed the time or event budget');
          const sourceDetail = { cueTrack: name, sourceTime: row.time, ...(row.timecode && { sourceTimecode: row.timecode }) };
          const detail = musical ? { ...sourceDetail, cueId: row.id, name: row.name, ...(row.detected && { detected: row.detected }) } :
            { ...sourceDetail, channel: row.channel, value: row.value };
          events.push({ id: musical ? row.id : 'pulse-' + index, type: 'event', cueTrack: name, time,
            kind: musical ? 'music-cue' : 'audio-trigger', detail });
        }
      }
      return events;
    };
  }

  A.cueTrackCompiler = cueTrackCompiler;
})(KIT);
