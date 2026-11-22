const { footageNodes } = require('./patch-footage.js');

const options = { type: 'record', default: {} };
const scalar = value => ({ type: 'number', default: value });
const raster = { value: 'raster' };
const bounded = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;

function patchNodes(kit, media = {}, gpu) {
  const P = kit.KIT.procedural;
  const after = (source, accent, opacity = 1) => P.raster.blend(source, accent, { opacity });
  return {
    ...footageNodes(P),
    'patch.video': {
      inputs: {}, outputs: raster, time: true, description: 'Read the current RGBA frame from the patch video source.',
      run() {
        if (!media.frame) throw new Error('patch.video needs --video FILE or --video -');
        return { value: media.frame };
      }
    },
    'patch.audio': {
      inputs: {}, outputs: { value: 'audio' }, description: 'Read the patch soundtrack supplied with --audio.',
      run() {
        if (!media.audio) throw new Error('patch.audio needs --audio FILE.wav or --audio video');
        return { value: media.audio };
      }
    },
    'patch.band': {
      inputs: { bands: 'record', name: 'string' }, outputs: { value: 'number' },
      description: 'Expose a named FFT band as an ordinary numeric connection.',
      run({ bands, name }) {
        if (!Object.hasOwn(bands, name) || !Number.isFinite(bands[name])) throw new RangeError('Unknown numeric band ' + name);
        return { value: bands[name] };
      }
    },
    'patch.map': {
      inputs: { value: 'number', sourceMin: scalar(0), sourceMax: scalar(1), min: scalar(0), max: scalar(1) },
      outputs: { value: 'number' }, description: 'Map a signal to a parameter range, clamped at the source bounds.',
      run({ value, sourceMin, sourceMax, min, max }) {
        if (sourceMax <= sourceMin) throw new RangeError('Patch map needs ascending source bounds');
        const t = Math.min(1, Math.max(0, (value - sourceMin) / (sourceMax - sourceMin)));
        return { value: min + (max - min) * t };
      }
    },
    'patch.track': {
      inputs: { source: 'raster', options },
      outputs: { value: 'array<record>', labels: 'raster', events: 'array<record>', generation: 'number' },
      time: true, description: 'Track regions from successive raster frames with persistent IDs.',
      instantiate() {
        let tracker, last = -Infinity, shape, settings, generation = 0;
        const run = ({ source, options }, { time }) => {
          const size = source.width + 'x' + source.height;
          const reset = !tracker || time <= last || shape !== size || settings !== options;
          const active = reset ? P.pixelEffects.createRegionTracker(options) : tracker;
          const { value, labels, events } = active.update(source, time);
          if (tracker && reset) generation++;
          tracker = active;
          last = time; shape = size; settings = options;
          return { value, labels, events, generation };
        };
        run.clear = () => { tracker = undefined; generation = 0; };
        return run;
      }
    },
    'patch.overlay': {
      inputs: { source: 'raster', tracks: 'array<record>', options }, outputs: { value: 'raster', ink: 'raster' },
      description: 'Draw tracked bounds, crosshairs, stable IDs, and optional links over a source.',
      run({ source, tracks, options: { color = '#ffe5b0', links = true, labels = true } }) {
        if (tracks.length > 128) throw new RangeError('Patch overlays support up to 128 tracked regions');
        const { width, height } = source, commands = [];
        let previous;
        const line = points => ({ type: 'path', points, color, width: 1 });
        for (const { id, bounds, center } of tracks) {
          const { x:x0, y:y0, width:w, height:h } = bounds ?? {};
          if (!Number.isSafeInteger(id) || !Array.isArray(center) || center.length !== 2 ||
              ![x0,y0,w,h,...center].every(Number.isFinite) || w <= 0 || h <= 0)
            throw new TypeError('Overlay requires tracker IDs, bounds and centers');
          const x1 = x0 + w, y1 = y0 + h, [x, y] = center;
          commands.push({ ...line([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]), closed:true },
            line([[x-4,y],[x+4,y]]), line([[x,y-4],[x,y+4]]));
          if (labels) commands.push({ type:'text', at:[Math.max(0,Math.min(width-21,Math.round(x0))),Math.max(0,Math.round(y0-10))],
            text:String(id).padStart(2,'0'), color });
          if (links && previous) commands.push(line([previous, center]));
          previous = center;
        }
        const ink = P.drawing2d.render({ width, height, commands, edges:'hard' });
        return { value: after(source, ink), ink };
      }
    },
    'patch.trail': {
      inputs: { source: 'raster', length: scalar(.25) }, outputs: raster, time: true,
      description: 'Accumulate a transparent trail with a live half-life in seconds.',
      instantiate() {
        let previous, last;
        const run = ({ source, length }, { time }) => {
          if (!bounded(length, 0, 10)) throw new RangeError('Trail length must be from 0 to 10 seconds');
          const decay = length && previous && time > last && previous.width === source.width && previous.height === source.height
            ? 2 ** (-(time - last) / length) : 0;
          const value = decay ? P.raster.stack({ width:source.width, height:source.height,
            layers:[{ source:previous, opacity:decay }, { source }] }).value : source;
          previous = value; last = time;
          return { value };
        };
        run.clear = () => { previous = undefined; };
        return run;
      }
    },
    'patch.composite': {
      inputs: { source: 'raster', layer: 'raster', opacity: scalar(1) }, outputs: raster,
      description: 'Alpha-composite an image or isolated effect over a background.',
      run({ source, layer, opacity }) { return { value: after(source, layer, opacity) }; }
    },
    'patch.shader': {
      inputs: { source: 'raster', wgsl: 'string', amount: scalar(1), position: { type: 'vec3', default: [0, 0, 0] } }, outputs: raster, time: true,
      description: 'Run a WGSL image kernel using an optional native WebGPU device.',
      instantiate() {
        const run = () => { throw new Error('Use ink-studio patch run for asynchronous WGSL nodes'); };
        run.async = async ({ source, wgsl, amount, position }, { time }) => {
          if (!gpu) throw new Error('Patch shader runtime is unavailable');
          const { width, height } = source;
          const rgba = P.raster.rgba(source);
          const data = await gpu.process({ width, height, data: rgba.data, wgsl, amount, time, position });
          return { value: { width, height, channels:4, data } };
        };
        return run;
      }
    }
  };
}
module.exports = { patchNodes };
