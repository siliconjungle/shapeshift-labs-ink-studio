const modulo = (n, d) => (n % d + d) % d;
const nominal = fps => Math.round(fps);
const rates = [24, 25, 30000 / 1001, 30];
const supported = [24000 / 1001, 24, 25, 30000 / 1001, 30];
const int = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;

export function readTimecode({ hours, minutes, seconds, frames, fps, drop = false }) {
  if (!supported.includes(fps) || typeof drop !== 'boolean' || drop && fps !== 30000 / 1001 ||
      !int(hours, 0, 23) || !int(minutes, 0, 59) || !int(seconds, 0, 59) || !int(frames, 0, nominal(fps) - 1) ||
      drop && minutes % 10 !== 0 && seconds === 0 && frames < 2)
    throw new RangeError('Invalid SMPTE timecode or frame rate');
  const minute = hours * 60 + minutes;
  const frame = (minute * 60 + seconds) * nominal(fps) + frames - (drop ? 2 * (minute - Math.floor(minute / 10)) : 0);
  const label = [hours, minutes, seconds, frames].map(n => String(n).padStart(2, '0'));
  return { hours, minutes, seconds, frames, fps, drop, frame, time: frame / fps,
    label: label.slice(0, 3).join(':') + (drop ? ';' : ':') + label[3] };
}

export function timecodeAt(frame, { fps, drop = false }) {
  if (!Number.isSafeInteger(frame) || !supported.includes(fps) || typeof drop !== 'boolean' || drop && fps !== 30000 / 1001)
    throw new RangeError('Invalid timecode frame or frame rate');
  const rate = nominal(fps);
  let label = modulo(frame, 86400 * rate - (drop ? 2592 : 0));
  if (drop) {
    const remainder = label % 17982;
    label += 18 * Math.floor(label / 17982) + 2 * Math.max(0, Math.floor((remainder - 2) / 1798));
  }
  const seconds = Math.floor(label / rate);
  return readTimecode({ hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60, frames: label % rate, fps, drop });
}

export function createMidiTimecode() {
  let direction = 0, previous = -1, length = 0;
  const parts = new Uint8Array(8);
  const reset = () => { direction = 0; previous = -1; length = 0; };
  const read = (hoursByte, minutes, seconds, frames) => {
    const rate = hoursByte >>> 5;
    try { return readTimecode({ hours: hoursByte & 31, minutes, seconds, frames, fps: rates[rate], drop: rate === 2 }); }
    catch { return null; }
  };
  return {
    reset,
    push(bytes) {
      if (bytes?.length === 10 && bytes[0] === 0xf0 && bytes[1] === 0x7f && bytes[3] === 1 &&
          bytes[4] === 1 && bytes[9] === 0xf7 && Array.from(bytes).slice(2, 9).every(n => int(n, 0, 127))) {
        reset();
        const code = read(bytes[5], bytes[6], bytes[7], bytes[8]);
        return code && { ...code, source: 'MTC', direction: 0 };
      }
      if (bytes?.length !== 2 || bytes[0] !== 0xf1 || !int(bytes[1], 0, 127)) return null;
      const part = bytes[1] >> 4;
      if (previous < 0 || part !== modulo(previous + direction, 8)) {
        reset();
        if (part !== 0 && part !== 7) return null;
        direction = part === 0 ? 1 : -1;
      }
      parts[part] = bytes[1] & 15;
      previous = part;
      if (++length < 8) return null;
      const step = direction;
      reset();
      if (parts[1] > 1 || parts[3] > 3 || parts[5] > 3 || parts[7] > 7) return null;
      const code = read(parts[6] + 16 * parts[7], parts[4] + 16 * parts[5], parts[2] + 16 * parts[3], parts[0] + 16 * parts[1]);
      return code && { ...timecodeAt(code.frame + step * 2, code), source: 'MTC', direction: step, encodedLabel: code.label };
    }
  };
}

export function createMidiBeatClock({ timeout = 0.5 } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Clock timeout must be positive');
  let tick = 0, lastTick = null, anchor = null, period = null, playing = false, lastMessage = -Infinity;
  return {
    push(bytes, at) {
      if (!Number.isFinite(at) || at < lastMessage) return;
      switch (bytes?.[0]) {
        case 0xf8: {
          if (bytes.length !== 1) return;
          const delta = lastTick === null ? 0 : at - lastTick;
          if (delta >= 60 / (400 * 24) && delta <= 60 / (20 * 24))
            period = period === null ? delta : period * .86 + delta * .14;
          else if (lastTick !== null && delta > timeout) period = null;
          lastTick = at;
          if (playing) {
            if (anchor !== null) tick++;
            anchor = at;
          }
          break;
        }
        case 0xfa:
        case 0xfb:
        case 0xfc:
          if (bytes.length !== 1) return;
          if (bytes[0] === 0xfa) tick = 0;
          playing = bytes[0] !== 0xfc;
          anchor = null;
          break;
        case 0xf2:
          if (bytes.length !== 3 || !int(bytes[1], 0, 127) || !int(bytes[2], 0, 127)) return;
          tick = (bytes[1] + 128 * bytes[2]) * 6;
          anchor = null;
          break;
        default: return;
      }
      lastMessage = at;
    },
    sample(at) {
      if (!Number.isFinite(at)) throw new TypeError('MIDI clock needs a finite time');
      const locked = period !== null && lastTick !== null && at - lastTick <= timeout;
      const subTick = playing && locked && anchor !== null ? Math.min(1, Math.max(0, (at - anchor) / period)) : 0;
      const beat = (tick + subTick) / 24;
      return { source: 'MIDI Clock', playing, locked, beat, phase: modulo(beat, 1), bpm: period === null ? null : 60 / (24 * period) };
    }
  };
}

export function sampleLinkClock(snapshot, now = Date.now(), { timeout = 500 } = {}) {
  const { bpm, beat, sentAt, playing, peers } = snapshot ?? {};
  if (![bpm, beat, sentAt, now, timeout].every(Number.isFinite) || bpm < 20 || bpm > 400 ||
      !int(peers, 0, 65535) || typeof playing !== 'boolean' || timeout <= 0) return null;
  const delay = Math.max(0, now - sentAt), locked = delay <= timeout;
  const position = beat + Math.min(delay, timeout) * bpm / 60000;
  return { source: 'Ableton Link', beat: position, phase: modulo(position, 1), bpm, peers, playing, locked };
}

export function createLtcDecoder({ sampleRate, fps = 30, threshold = .08 } = {}) {
  if (!supported.includes(fps) || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
      !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1)
    throw new RangeError('Invalid LTC sample rate, frame rate or threshold');
  const bitLength = sampleRate / (80 * fps), ring = new Uint8Array(80);
  let elapsed = 0, edge = null, polarity = 0, half = false, seen = 0, position = 0, sync = 0;
  function bit(value) {
    ring[position] = value;
    position = (position + 1) % 80;
    seen = Math.min(80, seen + 1);
    sync = ((sync << 1) | value) & 65535;
    if (seen < 80 || sync !== 0x3ffd) return null;
    function field(start, count) {
      let result = 0;
      for (let i = 0; i < count; i++) result |= ring[(position + start + i) % 80] << i;
      return result;
    }
    const units = [0, 16, 32, 48].map(start => field(start, 4));
    if (units.some(n => n > 9)) return null;
    const drop = Boolean(field(10, 1));
    try {
      const code = readTimecode({ frames: units[0] + 10 * field(8, 2), seconds: units[1] + 10 * field(24, 3),
        minutes: units[2] + 10 * field(40, 3), hours: units[3] + 10 * field(56, 2), fps, drop });
      return { ...code, source: 'LTC', sample: elapsed, receivedTime: elapsed / sampleRate };
    } catch { return null; }
  }
  return {
    push(samples) {
      const frames = [];
      for (const sample of samples) {
        const next = sample >= threshold ? 1 : sample <= -threshold ? -1 : polarity;
        if (next !== polarity) {
          if (edge !== null) {
            const length = (elapsed - edge) / bitLength;
            let frame;
            if (length >= .28 && length < .74) {
              if (half) frame = bit(1);
              half = !half;
            } else if (length >= .74 && length <= 1.28 && !half) {
              frame = bit(0);
            } else {
              half = false;
              seen = 0;
              sync = 0;
            }
            if (frame) frames.push(frame);
          }
          polarity = next;
          edge = elapsed;
        }
        elapsed++;
      }
      return frames;
    },
    reset() {
      elapsed = 0; edge = null; polarity = 0; half = false; seen = 0; position = 0; sync = 0;
    }
  };
}
