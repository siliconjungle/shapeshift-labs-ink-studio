/* Capture live modulation on a shared clock with explicitly attached sources. */
(function (P) {
  const A = P.mediaGraph, T = P.takeTime;
  const { id, int, plain, range } = P.mediaGraphSupport;
  const maxExact = BigInt(Number.MAX_SAFE_INTEGER);
  const held = (channel, value) => ({ channel, value });
  const pulse = (channel, value) => ({ kind: 'pulse', channel, value });
  const eventSeconds = event => event.timeStamp / 1000;

  function prefixOf(prefix) {
    if (!id(prefix) || prefix.length > 48) throw new RangeError('Modulation sources need a bounded channel prefix');
    return prefix;
  }

  function midiRows(prefix, bytes) {
    if (bytes === null || bytes === undefined) return [];
    if (!Array.isArray(bytes) && !ArrayBuffer.isView(bytes) || !int(bytes.length, 1, 65536) || !int(bytes[0], 128, 255))
      throw new TypeError('MIDI modulation needs a complete MIDI message');
    const status = bytes[0], command = status >> 4;
    if (command === 15 || command === 12) return [];
    if (bytes.length !== (command === 13 ? 2 : 3) || !int(bytes[1], 0, 127) ||
        bytes.length === 3 && !int(bytes[2], 0, 127)) throw new RangeError('Malformed MIDI channel message');
    const channel = prefix + ':ch' + ((status & 15) + 1), param = bytes[1], value = bytes[2] / 127;
    switch (command) {
      case 8:
      case 9: {
        const note = channel + ':note' + param, velocity = command === 9 ? value : 0;
        return velocity ? [held(note, velocity), pulse(note + ':on', velocity)] : [held(note, 0)];
      }
      case 10: return [held(channel + ':pressure' + param, value)];
      case 11: return [held(channel + ':cc' + param, value)];
      case 13: return [held(channel + ':pressure', param / 127)];
      case 14: {
        const bend = param + bytes[2] * 128 - 8192;
        return [held(channel + ':bend', bend / (bend < 0 ? 8192 : 8191))];
      }
      default: return [];
    }
  }

  function modulationCapture({ now = () => globalThis.performance.now() / 1000, origin, initial } = {}) {
    if (typeof now !== 'function') throw new TypeError('Modulation capture needs a host clock');
    const start = T.read(origin ?? now());
    if (!range(T.seconds(start), -1e12, 1e12)) throw new RangeError('Invalid modulation clock origin');
    const storage = A.recorder(initial);

    function write(rows, at = now()) {
      if (!Array.isArray(rows) || rows.length > 128 || !Array.from(rows).every(row => plain(row) &&
        Object.keys(row).every(key => ['channel', 'kind', 'value'].includes(key))))
        throw new TypeError('Modulation writes need up to 128 named samples');
      const point = T.sub(T.read(at), start), [n, d] = point, time = T.seconds(point);
      if (n < 0n || !range(time, 0, 1e9)) throw new RangeError('Modulation samples must follow the capture origin');
      const exact = n <= maxExact && d <= maxExact ? { timecode: { numerator: Number(n), denominator: Number(d) } } : {};
      return storage.appendBatch(rows.map(row => ({ ...row, time, ...exact })));
    }

    function midi(bytes, { prefix = 'midi', at } = {}) {
      const rows = midiRows(prefixOf(prefix), bytes);
      return rows.length ? write(rows, at) : [];
    }

    function gesture({ phase, x, y, pressure = .5 } = {}, { prefix = 'gesture', at } = {}) {
      prefixOf(prefix);
      if (!['start', 'move', 'end', 'cancel'].includes(phase) || !Number.isFinite(x) || !Number.isFinite(y) ||
          !range(pressure, 0, 1)) throw new RangeError('Gestures need a phase, finite coordinates and normalized pressure');
      const terminal = phase === 'end' || phase === 'cancel';
      const rows = [held(prefix + ':x', x), held(prefix + ':y', y), held(prefix + ':pressure', terminal ? 0 : pressure)];
      if (phase !== 'move') rows.push(held(prefix + ':active', !terminal), pulse(prefix + ':' + phase, { x, y }));
      return write(rows, at);
    }

    function microphone(analyser, { prefix = 'mic', bands = {} } = {}) {
      prefixOf(prefix);
      const sampleRate = analyser?.context?.sampleRate;
      if (!range(sampleRate, 1, 768000) || typeof analyser.getFloatTimeDomainData !== 'function' ||
          !plain(bands) || Object.keys(bands).length > 32)
        throw new TypeError('Microphone modulation needs an analyser and bounded named bands');
      const definitions = Object.entries(bands).map(([name, hz]) => {
        if (!id(name) || name.length > 32 || !Array.isArray(hz) || hz.length !== 2 ||
            !range(hz[0], 0, sampleRate / 2) || !range(hz[1], 0, 384000) || hz[1] <= hz[0])
          throw new RangeError('Microphone bands need bounded names and increasing Hz endpoints');
        return [name, hz[0], hz[1]];
      });
      if (definitions.length && typeof analyser.getFloatFrequencyData !== 'function')
        throw new TypeError('Microphone bands need frequency data');
      let waveform, spectrum;
      return at => {
        const size = analyser.fftSize;
        if (!int(size, 32, 32768) || (size & (size - 1)) || definitions.length && analyser.frequencyBinCount !== size / 2)
          throw new RangeError('Invalid microphone analyser dimensions');
        if (waveform?.length !== size) {
          waveform = new Float32Array(size);
          if (definitions.length) spectrum = new Float32Array(size / 2);
        }
        analyser.getFloatTimeDomainData(waveform);
        let power = 0, peak = 0;
        for (const value of waveform) {
          power += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
        const rows = [held(prefix + ':rms', Math.sqrt(power / size)), held(prefix + ':peak', peak)];
        if (spectrum) {
          analyser.getFloatFrequencyData(spectrum);
          for (const [name, low, high] of definitions) {
            let highest = -Infinity;
            const binHz = sampleRate / size, first = Math.ceil(low / binHz);
            const end = Math.min(spectrum.length, Math.ceil(high / binHz));
            for (let i = first; i < end; i++) highest = Math.max(highest, spectrum[i]);
            rows.push(held(prefix + ':band:' + name, 10 ** (highest / 20)));
          }
        }
        return write(rows, at);
      };
    }

    function attachMIDI(input, { prefix = 'midi', time = eventSeconds } = {}) {
      prefixOf(prefix);
      if (typeof input?.addEventListener !== 'function' || typeof input.removeEventListener !== 'function' || typeof time !== 'function')
        throw new TypeError('MIDI capture needs a MIDI input and timestamp mapping');
      const handle = event => midi(event.data, { prefix, at: time(event) });
      input.addEventListener('midimessage', handle);
      return () => input.removeEventListener('midimessage', handle);
    }

    function attachPointer(element, { prefix = 'pointer', time = eventSeconds, project = pointerPoint } = {}) {
      prefixOf(prefix);
      if (typeof element?.addEventListener !== 'function' || typeof element.removeEventListener !== 'function' ||
          typeof time !== 'function' || typeof project !== 'function')
        throw new TypeError('Pointer capture needs an element, projection, and timestamp mapping');
      let pointer = null, last;
      function sample(event, phase) {
        const point = phase === 'cancel' ? last : project(event, element);
        gesture({ ...point, phase }, { prefix, at: time(event) });
        last = point;
      }
      function end(event, phase) {
        if (event.pointerId !== pointer || pointer === null) return;
        sample(event, phase);
        pointer = null;
      }
      const handlers = {
        pointerdown(event) {
          if (pointer !== null || event.button !== 0 || !Number.isSafeInteger(event.pointerId)) return;
          const key = event.pointerId;
          element.setPointerCapture?.(key);
          try {
            sample(event, 'start');
            pointer = key;
          } catch (error) {
            if (element.hasPointerCapture?.(key)) element.releasePointerCapture?.(key);
            throw error;
          }
        },
        pointermove(event) {
          if (pointer !== null && event.pointerId === pointer) sample(event, 'move');
        },
        pointerup: event => end(event, 'end'),
        pointercancel: event => end(event, 'cancel'),
        lostpointercapture: event => end(event, 'cancel')
      };
      for (const [kind, handler] of Object.entries(handlers)) element.addEventListener(kind, handler);
      return () => {
        for (const [kind, handler] of Object.entries(handlers)) element.removeEventListener(kind, handler);
        if (pointer === null) return;
        const released = pointer;
        pointer = null;
        try { gesture({ ...last, phase: 'cancel' }, { prefix }); }
        finally { if (element.hasPointerCapture?.(released)) element.releasePointerCapture?.(released); }
      };
    }

    return Object.freeze({ write, midi, gesture, microphone, attachMIDI, attachPointer, snapshot: storage.snapshot });
  }

  function pointerPoint(event, element) {
    const box = element.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) throw new RangeError('Pointer capture needs a visible element');
    const clamp = n => Math.max(0, Math.min(1, n));
    return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height),
      pressure: event.pressure ?? .5 };
  }

  A.modulationCapture = modulationCapture;
})(KIT.procedural);
