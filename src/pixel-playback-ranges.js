/* Stable frame tags and their duration-weighted playback order. */
const PixelPlaybackRanges = (() => {
  const directions = ['forward','reverse','ping-pong'];
  const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const fields = ['id','label','start','end','direction','loop'];

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
          tag.loop !== undefined && typeof tag.loop !== 'boolean')
        throw new TypeError('Playback tags need unique IDs and valid labels, directions and loop settings');
      const first = frameIndex.get(tag.start), last = frameIndex.get(tag.end);
      if (first === undefined || last === undefined || first > last)
        throw new RangeError('Playback tag '+tag.id+' needs known start and end frames in timeline order');
      ids.add(tag.id);
      return { ...tag,direction:tag.direction ?? 'forward',loop:tag.loop ?? true,first,last };
    });
  }

  // Durations and elapsed time use the same units. Frame indices always refer to the original timeline.
  function plan(durations,{ first = 0,last = durations.length-1,direction = 'forward',loop = true } = {}) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= durations.length || first > last ||
        !directions.includes(direction) || typeof loop !== 'boolean')
      throw new RangeError('Playback needs a valid frame range, direction and loop setting');
    const order = Array.from({ length:last-first+1 },(_,i)=>first+i);
    if (direction === 'reverse') order.reverse();
    if (direction === 'ping-pong' && first !== last)
      for (let frame = last-1; frame >= first+Number(loop); frame--) order.push(frame);
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
