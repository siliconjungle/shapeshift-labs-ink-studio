/* Selective screen refresh for live rasters and graph clips. */
(function (P) {
  const raster = P.graphTypes.validator('raster');
  function create(settings) {
    const plan = FrameBank.prepare(settings);
    let clock, stored, refreshed, width, height;
    function clear() { clock = stored = refreshed = width = height = undefined; }
    function sample(source, time, { masks = {}, reset = false } = {}) {
      const { width: w, height: h } = source ?? {};
      if (!raster(source) || w > 8192 || h > 8192 || w * h > 1048576 || source.colorSpace === 'srgb-linear')
        throw new RangeError('Frame bank source needs a bounded display raster');
      if (typeof reset !== 'boolean') throw new TypeError('Frame bank reset must be a boolean');
      const prior = reset || w !== width || h !== height ? undefined : clock;
      const step = FrameBank.schedule(plan, time, prior);
      let pixels = stored, coverage = refreshed;
      if (time !== prior?.time) {
        coverage = new Uint8Array(w * h);
        if (step.capture) {
          const { data } = P.raster.rgba(source);
          function lookup(name) {
            const signal = Object.hasOwn(masks, name) && masks[name];
            if (!raster(signal) || signal.width !== w || signal.height !== h || signal.data.length !== w * h ||
                !signal.data.every(value => value >= 0 && value <= 255))
              throw new RangeError('Frame bank needs an aligned one-channel byte mask: ' + name);
            return Uint8Array.from(signal.data, Math.round);
          }
          const fresh = FrameComposite.pixels({ w, h, rgba: data }).data;
          pixels = FrameBank.write(step, fresh, step.first ? undefined : stored, w, h, w, h, lookup, coverage);
        }
      }
      [clock, stored, refreshed, width, height] = [step.clock, pixels, coverage, w, h];
      return { value: P.sceneGraph.rasterFrame(FrameComposite.straight(stored, w, h, true)),
        refreshed: { width: w, height: h, channels: 1, data: refreshed.slice() }, tick: clock.tick };
    }
    return Object.freeze({ sample, clear });
  }

  const operation = {
    description: 'Keep previous image pixels and refresh selected tiles or masks on independent cadences.',
    inputs: { source: 'raster', masks: { type: 'record', default: {} }, options: 'record',
      reset: { type: 'boolean', default: false } },
    outputs: { value: 'displayRaster', refreshed: 'raster', tick: 'frames' }, time: true,
    instantiate() {
      let bank, settings, previousSequence;
      const run = ({ source, masks, options, reset }, { time, take, sequence }) => {
        if (options !== settings || sequence !== previousSequence || !bank) {
          bank = create(options);
          settings = options;
          previousSequence = sequence;
        }
        return bank.sample(source, time, { masks, reset: reset || Boolean(take?.cut) });
      };
      run.clear = () => { bank = settings = previousSequence = undefined; };
      return run;
    }
  };
  P.frameBanks = Object.freeze({ create, operations: Object.freeze({ 'anim.frameBank': operation }) });
})(KIT.procedural);
