/* Explicit show bindings from device signals to named world intervention grants. */
const { encodeOsc } = require('./show-protocols.js');

function prepare(W, source, { midi, osc, dimensions }) {
  if (source === undefined) return;
  const { check, id, record } = W.data;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const table = (row, key, max) => record(row) && Object.keys(row).length <= max &&
    Object.entries(row).every(([name, grant]) => key(name) && id(grant));
  const midiNumber = key => /^(0|[1-9]\d{0,2})$/.test(key) && integer(Number(key), 0, 127);
  check(fields(source, ['tracking', 'midi', 'osc']) && Object.keys(source).length > 0,
    'Installation needs tracking, MIDI, or OSC bindings');
  const result = {};
  if (source.tracking !== undefined) {
    const row = source.tracking;
    check(fields(row, ['output', 'size', 'zones', 'dwellFrames', 'minConfidence']), 'Invalid installation tracking binding');
    const { output, size = [dimensions.width, dimensions.height], zones, dwellFrames = 3, minConfidence = .5 } = row;
    check(id(output) && Array.isArray(size) && size.length === 2 && size.every(n => integer(n, 1, 4096)) &&
      integer(dwellFrames, 1, 120) && unit(minConfidence) && record(zones) &&
      Object.keys(zones).length >= 1 && Object.keys(zones).length <= 32, 'Invalid installation tracking output, size, or dwell');
    const entries = Object.entries(zones);
    for (const [name, zone] of entries) {
      check(id(name) && fields(zone, ['rect', 'grant']) && id(zone.grant) &&
        Array.isArray(zone.rect) && zone.rect.length === 4 && zone.rect.every(unit), 'Invalid installation tracking zone ' + name);
      const [x, y, w, h] = zone.rect;
      check(w > 0 && h > 0 && x + w <= 1 && y + h <= 1, 'Tracking zones need positive rectangles inside the unit frame');
    }
    result.tracking = { output, size, zones: entries, dwellFrames, minConfidence };
  }
  if (source.midi !== undefined) {
    const row = source.midi;
    check(midi && fields(row, ['notes', 'programs']), 'Installation MIDI needs show MIDI and a note or program map');
    const { notes = {}, programs = {} } = row;
    check(table(notes, midiNumber, 128) && table(programs, midiNumber, 128) &&
      Object.keys(notes).length + Object.keys(programs).length > 0, 'Installation MIDI maps need numbers 0–127 and named grants');
    result.midi = { notes, programs };
  }
  if (source.osc !== undefined) {
    const row = source.osc;
    check(osc && fields(row, ['address', 'choices']) && typeof row.address === 'string' &&
      row.address !== osc.address && table(row.choices, id, 128) && Object.keys(row.choices).length > 0,
    'Installation OSC needs the show OSC receiver, a separate address, and named choices');
    encodeOsc(row.address);
    result.osc = row;
  }
  return result;
}

function open(config, capture) {
  const occupied = new Map(), held = new Set();
  const tracking = config.tracking;
  let lastFrame;
  return {
    resetMidi() { held.clear(); },
    midi(data) {
      if (!config.midi) return;
      const [status, key, velocity] = data, type = status & 0xf0;
      if (data.length === 3 && (type === 0x80 || type === 0x90 && velocity === 0)) held.delete(key);
      if (data.length === 3 && type === 0x90 && velocity > 0 && !held.has(key) && Object.hasOwn(config.midi.notes, key)) {
        if (capture(config.midi.notes[key], { kind: 'midi', data })) held.add(key);
      }
      if (data.length === 2 && type === 0xc0 && Object.hasOwn(config.midi.programs, key))
        capture(config.midi.programs[key], { kind: 'midi', data });
    },
    osc(address, args) {
      const settings = config.osc, choice = args[0];
      return settings && address === settings.address && args.length === 1 && typeof choice === 'string' &&
        Object.hasOwn(settings.choices, choice) && capture(settings.choices[choice], { kind: 'osc', address, choice });
    },
    sample(frame, tracks) {
      if (!tracking) return;
      if (!Array.isArray(tracks) || tracks.length > 128) throw new TypeError('Installation tracking needs up to 128 visible tracks');
      const seen = new Set();
      for (const { id, center, confidence } of tracks) {
        if (!Number.isSafeInteger(id) || id < 1 || seen.has(id) || !Array.isArray(center) ||
            center.length !== 2 || !center.every(Number.isFinite) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
          throw new TypeError('Installation tracking needs distinct positive IDs, finite XY centers, and confidence in [0,1]');
        seen.add(id);
      }
      const [width, height] = tracking.size;
      const ordered = tracks.slice().sort((a, b) => a.id - b.id);
      for (const [zone, { rect: [x, y, w, h], grant }] of tracking.zones) {
        const prior = occupied.get(zone);
        const inside = ordered.filter(({ center: [px, py] }) =>
          px / width >= x && px / width < x + w && py / height >= y && py / height < y + h);
        if (!inside.length) { occupied.delete(zone); continue; }
        if (prior?.latched) continue;
        const eligible = inside.filter(row => row.confidence >= tracking.minConfidence);
        const track = eligible.find(row => row.id === prior?.track) ?? eligible[0];
        if (!track) { occupied.delete(zone); continue; }
        const frames = prior?.track === track.id && lastFrame + 1 === frame ? prior.frames + 1 : 1;
        const latched = frames >= tracking.dwellFrames && capture(grant, {
          kind: 'tracking', zone, track: track.id, center: track.center, confidence: track.confidence, dwellFrames: frames
        });
        occupied.set(zone, { track: track.id, frames, latched });
      }
      lastFrame = frame;
    }
  };
}
module.exports = { prepare, open };
