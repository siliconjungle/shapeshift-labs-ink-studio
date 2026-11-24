/* Stable frame tags and their duration-weighted playback order. */
const PixelPlaybackRanges = (() => {
  const directions = ['forward','reverse','ping-pong','ping-pong-reverse'];
  const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const fields = ['id','label','start','end','direction','loop','repeat'];
  const validRepeat = value=>Number.isInteger(value) && value >= 1 && value <= 65535;

  function resolve(frames,tags = []) {
    if (!Array.isArray(tags) || tags.length > 128) throw new RangeError('Use a list of up to 128 playback tags');
    if (!tags.length) return [];
    const frameIndex = new Map();
    frames.forEach(({ id },index)=>{
      if (id === undefined) return;
      if (!validId(id) || frameIndex.has(id)) throw new RangeError('Tagged animations need unique frame IDs');
      frameIndex.set(id,index);
    });
    const ids = new Set();
    return Array.from(tags,tag=>{
      if (!tag || Object.getPrototypeOf(tag) !== Object.prototype || Object.keys(tag).some(key=>!fields.includes(key)) ||
          !validId(tag.id) || ids.has(tag.id) ||
          tag.label !== undefined && (typeof tag.label !== 'string' || !tag.label.trim()) ||
          tag.direction !== undefined && !directions.includes(tag.direction) ||
          tag.loop !== undefined && typeof tag.loop !== 'boolean' ||
          tag.repeat !== undefined && (!validRepeat(tag.repeat) || tag.loop === true))
        throw new TypeError('Playback tags need unique IDs and valid labels, directions and repeat settings');
      const first = frameIndex.get(tag.start), last = frameIndex.get(tag.end);
      if (first === undefined || last === undefined || first > last)
        throw new RangeError('Playback tag '+tag.id+' needs known start and end frames in timeline order');
      ids.add(tag.id);
      return { ...tag,direction:tag.direction ?? 'forward',loop:tag.loop ?? (tag.repeat === undefined),first,last };
    });
  }

  // Durations and elapsed time use the same units. Frame indices always refer to the original timeline.
  function plan(durations,{ first = 0,last = durations.length-1,direction = 'forward',repeat,loop = repeat === undefined } = {}) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= durations.length || first > last ||
        !directions.includes(direction) || typeof loop !== 'boolean' || repeat !== undefined && (!validRepeat(repeat) || loop))
      throw new RangeError('Playback needs a valid frame range, direction and repeat setting');
    const reversed = direction === 'reverse' || direction === 'ping-pong-reverse';
    const bouncing = direction.startsWith('ping-pong') && first !== last;
    const length = last-first+1, passes = repeat ?? (bouncing ? 2 : 1);
    const exposures = length*passes-(bouncing ? passes-1+Number(loop) : 0);
    if (repeat !== undefined && exposures > 65536)
      throw new RangeError('A finite playback tag can contain up to 65,536 frame exposures');
    const order = [];
    for (let pass = 0; pass < passes; pass++) {
      const backward = reversed !== (bouncing && pass%2 === 1);
      const start = bouncing && pass > 0 ? 1 : 0;
      const end = bouncing && loop && pass === passes-1 ? length-1 : length;
      for (let step = start; step < end; step++) order.push(backward ? last-step : first+step);
    }
    let duration = 0, smallest = Infinity, fractional = false;
    const ends = order.map(frame=>{
      const span = durations[frame], next = duration+span;
      if (!Number.isFinite(span) || !(next > duration && next <= Number.MAX_SAFE_INTEGER))
        throw new RangeError('Playback steps need positive durations within the safe time range');
      smallest = Math.min(span,smallest);
      fractional ||= !Number.isInteger(span);
      return duration = next;
    });
    const tolerance = fractional ? Math.min(smallest*1e-7,duration*4*Number.EPSILON) : 0;
    function at(elapsed) {
      let time = Number.isFinite(elapsed) ? elapsed : 0;
      if (loop) {
        time %= duration;
        if (time < 0) time += duration;
        if (duration-time <= tolerance) time = 0;
      }
      if (time <= 0) return order[0];
      if (time >= duration) return order.at(-1);
      let left = 0, right = ends.length-1;
      while (left < right) {
        const mid = (left+right) >> 1;
        if (time+tolerance < ends[mid]) right = mid;
        else left = mid+1;
      }
      return order[left];
    }
    return { order,duration,loop,at };
  }

  return Object.freeze({ resolve,plan });
})();
if (typeof module !== 'undefined') module.exports = PixelPlaybackRanges;
else globalThis[Symbol.for('ink-studio.pixel-playback-ranges')] = PixelPlaybackRanges;
