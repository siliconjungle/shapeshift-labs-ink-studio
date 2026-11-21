/* Stateful datamosh for live rasters, captured motion and procedural graphs. */
(function (P) {
  const raster = P.graphTypes.validator('raster');
  const fields = ['halfLife', 'velocity', 'fieldScale', 'blockSize', 'direction', 'units', 'minConfidence', 'filter'];
  function create(options = {}) {
    if (!P.graphTypes.validator('record')(options) || Object.keys(options).some(key => !fields.includes(key)))
      throw new TypeError('Invalid datamosh settings');
    const node = { ...MotionSmear.settings(options), ...MotionSmear.convention(options) };
    const { filter = 'nearest' } = options;
    if (!['nearest', 'linear'].includes(filter)) throw new TypeError('Datamosh filter needs nearest or linear sampling');
    let prior;
    function sample(source, motion, time, { confidence, valid, refresh, reset = false } = {}) {
      const { width: w, height: h } = source ?? {};
      if (!Number.isFinite(time) || typeof reset !== 'boolean' || !raster(source) || w > 8192 || h > 8192 ||
          w * h > 1048576 || source.colorSpace === 'srgb-linear')
        throw new RangeError('Datamosh needs a bounded display raster, finite time and a boolean reset');
      const previous = !reset && prior?.w === w && prior?.h === h && time >= prior.time ? prior : undefined;
      if (time !== previous?.time) {
        const elapsed = previous ? time - previous.time : 0;
        const gate = refresh == null ? undefined : MotionSmear.plane(refresh, w, h, 1, 0, 255, 'Datamosh refresh');
        const field = MotionSmear.raw(motion, { width: w, height: h, confidence, valid, minConfidence: node.minConfidence });
        const fresh = FrameComposite.pixels({ w, h, rgba: P.raster.rgba(source).data }).data;
        const carry = new Float32Array(w * h);
        const decay = elapsed && field ? 2 ** (-elapsed / node.halfLife) : 0;
        const locate = MotionSmear.address(node, { width: w, height: h, elapsed, field, raw: true, refresh: gate });
        const image = decay ? MotionSmear.write(fresh, previous.image, { w, h, width: w, height: h, filter, decay, locate }, carry) : fresh;
        prior = { w, h, time, carry, image };
      }
      const value = P.sceneGraph.rasterFrame(FrameComposite.straight(prior.image, w, h, true));
      return { value, carry: { width: w, height: h, channels: 1, data: prior.carry.slice() } };
    }
    return Object.freeze({ sample, clear() { prior = undefined; } });
  }

  const options = { type: 'record', default: {} }, optional = { type: 'any', default: null };
  const operation = {
    description: 'Transport the previous image with signed motion, selective refresh and half-life decay.',
    inputs: { source: 'raster', motion: optional, confidence: optional, valid: optional, refresh: optional, options,
      reset: { type: 'boolean', default: false } },
    outputs: { value: 'displayRaster', carry: 'raster' }, time: true,
    instantiate() {
      let session, settings, previousSequence;
      const run = ({ source, motion, options, reset, ...planes }, { time, take, sequence }) => {
        if (!session || options !== settings || sequence !== previousSequence) {
          session = create(options);
          settings = options;
          previousSequence = sequence;
        }
        return session.sample(source, motion, time, { ...planes, reset: reset || Boolean(take?.cut) });
      };
      run.clear = () => { session = settings = previousSequence = undefined; };
      return run;
    }
  };
  P.datamosh = Object.freeze({ create, operations: Object.freeze({ 'anim.datamosh': operation }) });
})(KIT.procedural);
