const frameLimit = 512;

function schedule(clips, defaultFps) {
  if (!Array.isArray(clips) || !clips.length || clips.length > 64)
    throw new RangeError('A sprite clip plan needs 1–64 clips');
  const ids = new Set(), samples = [], tracks = [];
  let time = 0;
  for (const clip of clips) {
    const { id, name = id, playback = 'loop', range, cels, fps = defaultFps } = clip ?? {};
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id))
      throw new RangeError('Sprite clip IDs must be unique lowercase slugs');
    if (typeof name !== 'string' || !name.trim() || !['loop', 'once'].includes(playback) ||
        !Number.isFinite(fps) || fps <= 0 || fps > 240 || (range === undefined) === (cels === undefined))
      throw new RangeError('A sprite clip needs a name, playback mode, and exactly one range or cel list');
    ids.add(id);
    const frames = [];
    const start = time;
    function sample(sourceTime, duration) {
      if (!Number.isFinite(sourceTime) || sourceTime < 0 || !Number.isFinite(duration) || duration <= 0 ||
          !Number.isFinite(time + duration) || time + duration <= time)
        throw new RangeError('Sprite cels need a nonnegative source time and a positive exposure');
      if (samples.length === frameLimit) throw new RangeError('Sprite atlas supports up to 512 frames');
      const previous = samples.at(-1);
      const reset = !frames.length || sourceTime <= previous.sourceTime;
      frames.push(samples.length);
      samples.push({ time, sourceTime, duration, reset });
      time += duration;
    }
    if (range !== undefined) {
      if (!Array.isArray(range) || range.length !== 2 || !Array.from(range).every(Number.isFinite) ||
          range[0] < 0 || range[1] <= range[0])
        throw new RangeError('Sprite clip range needs two increasing nonnegative source times');
      const [from, to] = range, length = to - from;
      const count = Math.max(1, Math.ceil(length * fps - 1e-8));
      if (count > frameLimit - samples.length) throw new RangeError('Sprite atlas supports up to 512 frames');
      for (let i = 0; i < count; i++)
        sample(from + i / fps, i + 1 === count ? length - i / fps : 1 / fps);
    } else {
      if (!Array.isArray(cels) || !cels.length || cels.length > frameLimit - samples.length)
        throw new RangeError('Sprite clips need a nonempty cel list within the 512-frame atlas limit');
      for (const cel of cels) sample(cel?.at, cel?.duration);
    }
    tracks.push({ id, name, playback, frames, duration: time - start });
  }
  return { samples, tracks };
}

module.exports = { schedule };
