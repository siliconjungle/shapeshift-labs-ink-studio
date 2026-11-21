const range = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
const channel = name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(name);
const level = db => Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 0;

export function createLiveAudioRouter(context, { fftSize = 2048, bands = { low: [35, 180], mid: [180, 2200], high: [2200, 12000] } } = {}) {
  if (!context?.createAnalyser || !context.destination || !Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 ||
      (fftSize & (fftSize - 1))) throw new TypeError('A Web Audio context and power-of-two FFT size are required');
  if (!bands || typeof bands !== 'object' || Object.keys(bands).length > 16) throw new TypeError('Expected up to 16 frequency bands');
  const slices = Object.entries(bands).map(([name, limits]) => {
    if (!channel(name) || name === 'rms' || name === 'peak' || !Array.isArray(limits) || limits.length !== 2 ||
        !range(limits[0], 0, limits[1]) || !Number.isFinite(limits[1]) || limits[1] === limits[0])
      throw new TypeError('Audio bands require ascending frequency bounds');
    return [name, Math.ceil(limits[0] * fftSize / context.sampleRate),
      Math.ceil(limits[1] * fftSize / context.sampleRate)];
  });
  const buses = new Map(), sources = new Set(), sends = new Map();
  let disposed = false;
  const monitor = context.createGain();
  monitor.gain.value = 0;
  monitor.connect(context.destination);
  function bus(id) {
    if (disposed || !buses.has(id)) throw new Error('Unknown or disposed audio bus ' + id);
    return buses.get(id);
  }
  function addBus(id, { gain = 1, pan = 0 } = {}) {
    if (disposed || !channel(id) || buses.has(id) || buses.size >= 32 ||
        !range(gain, 0, 4) || !range(pan, -1, 1)) throw new TypeError('Invalid live audio bus');
    const input = context.createGain(), panner = context.createStereoPanner(), analyser = context.createAnalyser();
    input.gain.value = gain;
    panner.pan.value = pan;
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = .6;
    input.connect(panner).connect(analyser);
    /* A silent branch keeps analysis running even before a bus is routed. */
    const keep = context.createGain();
    keep.gain.value = 0;
    analyser.connect(keep).connect(context.destination);
    buses.set(id, { input, panner, analyser, keep, wave: new Float32Array(fftSize),
      spectrum: new Float32Array(analyser.frequencyBinCount) });
  }
  addBus('main');
  bus('main').analyser.connect(monitor);

  function tune(parameter, value, lo, hi) {
    if (!range(value, lo, hi)) throw new RangeError('Audio control is outside its range');
    parameter.setTargetAtTime(value, context.currentTime, .015);
  }
  function hasPath(from, to, seen = new Set()) {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...sends.values()].some(send => send.from === from && hasPath(send.to, to, seen));
  }
  function attach(id, source) {
    const { input } = bus(id);
    if (!source?.connect || source.context !== context) throw new TypeError('Source must belong to the router AudioContext');
    if ([...sources].some(entry => entry.source === source && entry.input === input))
      throw new Error('Audio source is already attached to this bus');
    source.connect(input);
    const row = { source, input };
    sources.add(row);
    return () => {
      if (sources.delete(row)) source.disconnect(input);
    };
  }
  function read(id) {
    const { analyser, wave, spectrum } = bus(id);
    analyser.getFloatTimeDomainData(wave);
    analyser.getFloatFrequencyData(spectrum);
    let peak = 0, square = 0;
    for (const sample of wave) {
      peak = Math.max(peak, Math.abs(sample));
      square += sample * sample;
    }
    const energy = Object.fromEntries(slices.map(([name, start, stop]) => {
      let max = -Infinity;
      for (let i = start; i < Math.min(stop, spectrum.length); i++) max = Math.max(max, spectrum[i]);
      return [name, level(max)];
    }));
    return { rms: Math.sqrt(square / wave.length), peak, bands: energy };
  }
  return {
    addBus,
    attach,
    input(id) { return bus(id).input; },
    tap(id, destination) {
      const { analyser } = bus(id);
      if (!destination?.connect || destination.context !== context) throw new TypeError('Tap must belong to the router AudioContext');
      analyser.connect(destination);
      let connected = true;
      return () => {
        if (!connected) return;
        connected = false;
        if (!disposed) analyser.disconnect(destination);
      };
    },
    send(from, to, gain = 1) {
      const a = bus(from), b = bus(to), key = JSON.stringify([from, to]);
      if (!range(gain, 0, 4)) throw new RangeError('Audio send gain is outside its range');
      if (hasPath(to, from)) throw new Error('Audio send would create a feedback cycle');
      if (sends.has(key)) {
        tune(sends.get(key).node.gain, gain, 0, 4);
        return;
      }
      const node = context.createGain();
      node.gain.value = gain;
      a.analyser.connect(node).connect(b.input);
      sends.set(key, { from, to, node });
    },
    removeSend(from, to) {
      const key = JSON.stringify([from, to]), send = sends.get(key);
      if (!send) return;
      bus(from).analyser.disconnect(send.node);
      send.node.disconnect();
      sends.delete(key);
    },
    setGain(id, value) { tune(bus(id).input.gain, value, 0, 4); },
    setPan(id, value) { tune(bus(id).panner.pan, value, -1, 1); },
    setMonitor(value) {
      bus('main');
      tune(monitor.gain, value, 0, 1);
    },
    read,
    waveform(id) {
      const { analyser, wave } = bus(id);
      analyser.getFloatTimeDomainData(wave);
      return wave.slice();
    },
    capture(recorder, ids = ['main'], at) {
      if (typeof recorder?.write !== 'function' || !Array.isArray(ids) || !ids.length ||
          ids.length * (slices.length + 2) > 128 || new Set(ids).size !== ids.length)
        throw new RangeError('Audio capture needs a recorder and up to 128 unique channels');
      const rows = ids.flatMap(id => {
        const { rms, peak, bands: energy } = read(id);
        return Object.entries({ ...energy, rms, peak }).map(([name, value]) => ({ channel: 'audio:' + id + ':' + name, value }));
      });
      return recorder.write(rows, at);
    },
    dispose() {
      if (disposed) return;
      for (const { source, input } of sources) source.disconnect(input);
      for (const { node } of sends.values()) node.disconnect();
      for (const row of buses.values()) for (const node of [row.input, row.panner, row.analyser, row.keep]) node.disconnect();
      sources.clear(); sends.clear(); buses.clear();
      monitor.disconnect();
      disposed = true;
    }
  };
}
