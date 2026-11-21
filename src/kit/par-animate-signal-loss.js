/* Signal lock, hold and reacquisition for raster and tracking inputs. */
(function (P) {
  const display = P.graphTypes.validator('displayRaster'), record = P.graphTypes.validator('record');
  const fields = ['loseBelow', 'lockAbove', 'lossFrames', 'lockFrames', 'blendSeconds', 'trackId'];
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const count = n => Number.isSafeInteger(n) && n >= 1 && n <= 120;

  function checkImage(image) {
    if (image != null && (!display(image) || image.width > 8192 || image.height > 8192 ||
        image.width * image.height > 1048576))
      throw new RangeError('Signal recovery needs bounded display rasters');
  }

  function crossfade(held, live, mix) {
    const data = new Uint8Array(live.data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = held.data[i + 3] * (1 - mix), b = live.data[i + 3] * mix, alpha = a + b;
      data[i + 3] = Math.round(alpha);
      if (data[i + 3]) for (let c = 0; c < 3; c++)
        data[i + c] = Math.round((held.data[i + c] * a + live.data[i + c] * b) / alpha);
    }
    return { ...live, data };
  }

  function create(options = {}) {
    if (!record(options) || Object.keys(options).some(key => !fields.includes(key)))
      throw new TypeError('Invalid signal recovery settings');
    const { loseBelow = .4, lockAbove = .65, lossFrames = 2, lockFrames = 3, blendSeconds = .2, trackId } = options;
    if (!unit(loseBelow) || !unit(lockAbove) || lockAbove < loseBelow || !count(lossFrames) || !count(lockFrames) ||
        !Number.isFinite(blendSeconds) || blendSeconds < 0 || blendSeconds > 60 ||
        (trackId !== undefined && (!Number.isSafeInteger(trackId) || trackId < 1 || trackId > 0xffffffff)))
      throw new RangeError('Invalid signal thresholds, frame counts, blend duration or track ID');
    let prior;

    function snapshot({ image, status, events }) {
      return {
        value: image && { ...image, data: image.data.slice(), ...(image.pivot && { pivot: image.pivot.slice() }) },
        status, events
      };
    }

    function sample(source, time, { available = true, quality = 1, tracks = [], fallback = null, reset = false } = {}) {
      if (!Number.isFinite(time) || typeof available !== 'boolean' || !unit(quality) || typeof reset !== 'boolean' ||
          !Array.isArray(tracks) || tracks.length > 128)
        throw new TypeError('Signal recovery needs finite time, unit quality, boolean flags and up to 128 tracks');
      checkImage(source);
      checkImage(fallback);
      if (source != null && fallback != null && (source.width !== fallback.width || source.height !== fallback.height))
        throw new RangeError('Signal fallback must match the source dimensions');
      const track = trackId === undefined ? undefined : tracks.find(item => item?.id === trackId);
      if (track && !unit(track.confidence)) throw new RangeError('Tracked signal confidence must be in [0, 1]');
      const stream = !reset && time >= prior?.time ? prior : undefined;
      const grid = source ?? fallback;
      // The first raster can establish a grid during acquisition without discarding its progress.
      const previous = !grid || !stream?.width || grid.width === stream.width && grid.height === stream.height
        ? stream : undefined;
      if (time === previous?.time) return snapshot(previous);

      const width = grid?.width ?? stream?.width, height = grid?.height ?? stream?.height;
      const from = previous?.status.stage, hasSignal = source != null && available && (trackId === undefined || track !== undefined);
      const confidence = hasSignal ? Math.min(quality, track?.confidence ?? 1) : 0;
      const canAcquire = hasSignal && confidence >= lockAbove;
      let stage = 'holding', mix = 0, misses = 0, confirmations = 0, blendAt;
      if (from === 'locked' || from === 'losing') {
        if (hasSignal && confidence >= loseBelow) stage = 'locked';
        else {
          misses = Math.min(lossFrames, previous.status.misses + 1);
          stage = misses < lossFrames ? 'losing' : 'holding';
        }
      } else if (canAcquire) {
        if (!previous) stage = 'locked';
        else {
          stage = 'relocking';
          confirmations = Math.min(lockFrames, previous.status.confirmations + 1);
          if (confirmations === lockFrames) {
            blendAt = previous.blendAt ?? time;
            mix = blendSeconds ? Math.min(1, (time - blendAt) / blendSeconds) : 1;
            if (mix >= 1 - 1e-9) stage = 'locked';
          }
        }
      } else misses = Math.min(lossFrames, (previous?.status.misses ?? 0) + 1);

      let good = previous?.good ?? null, lastUsableTime = previous?.status.lastUsableTime ?? null, image;
      if (stage === 'locked') {
        image = good = P.raster.rgba(source);
        lastUsableTime = time;
        mix = 1;
      } else {
        const held = good ?? (fallback != null ? P.raster.rgba(fallback) : width ? P.raster.canvas({ width, height }) : null);
        image = mix ? crossfade(held, P.raster.rgba(source), mix) : held;
      }
      const changed = from !== stage, since = changed ? time : previous.status.since;
      const status = Object.freeze({ stage, since, quality: confidence, hasSignal, misses, confirmations, mix, lastUsableTime,
        ...(trackId !== undefined && { trackId }) });
      const events = Object.freeze(changed ? [Object.freeze({ type: stage, from: from ?? null, time })] : []);
      prior = { time, width, height, good, image, status, events, blendAt };
      return snapshot(prior);
    }

    return Object.freeze({ sample, clear() { prior = undefined; } });
  }

  const optional = { type: 'any', default: null };
  const operation = {
    description: 'Respond to signal or tracking loss by holding the last usable frame and relocking on a stable feed.',
    inputs: { source: optional, fallback: optional, available: { type: 'boolean', default: true },
      quality: { type: 'number', default: 1 }, tracks: { type: 'array<record>', default: [] },
      options: { type: 'record', default: {} }, reset: { type: 'boolean', default: false } },
    outputs: { value: 'any', status: 'record', events: 'array<record>' }, time: true,
    instantiate() {
      let session, settings, priorSequence;
      const run = ({ source, options, reset, ...input }, { time, take, sequence }) => {
        if (!session || options !== settings || priorSequence !== sequence) {
          session = create(options);
          settings = options;
          priorSequence = sequence;
        }
        return session.sample(source, time, { ...input, reset: reset || Boolean(take?.cut) });
      };
      run.clear = () => { session = settings = priorSequence = undefined; };
      return run;
    }
  };
  P.signalRecovery = Object.freeze({ create, operations: Object.freeze({ 'fx.signalRecovery': operation }) });
})(KIT.procedural);
