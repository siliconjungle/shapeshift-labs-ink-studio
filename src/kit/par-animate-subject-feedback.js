/* Retained feedback in a subject's chart, with optional screen-to-chart deposition. */
(function (P) {
  const display = P.graphTypes.validator('displayRaster'), record = P.graphTypes.validator('record');
  const pair = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);
  const fields = ['width', 'height', 'halfLife', 'gain', 'velocity', 'filter', 'wrapU', 'projection', 'extent'];
  const limit = 1048576;
  const resetOption = { type: 'boolean', default: false };

  function coordinatesOf(source, width, height, channels) {
    const { data } = source ?? {};
    if (source?.width !== width || source.height !== height || (source.channels ?? channels) !== channels ||
        (!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== width * height * channels)
      throw new RangeError('Subject feedback needs aligned chart coordinates with ' + channels + ' channels');
    return data;
  }

  function create(options = {}) {
    if (!record(options) || Object.keys(options).some(key => !fields.includes(key))) throw new TypeError('Invalid subject feedback settings');
    const { width: w, height: h, halfLife = .6, gain = 1, velocity = [0, 0], filter = 'nearest',
      wrapU = false, projection, extent = [1, 1] } = options;
    if (![w, h].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2048) || w * h > 262144 ||
        !Number.isFinite(halfLife) || halfLife <= 0 || halfLife > 60 || !Number.isFinite(gain) || gain < 0 || gain > 1 ||
        !pair(velocity) || velocity.some(value => Math.abs(value) > 4096) || !['nearest', 'linear'].includes(filter) ||
        typeof wrapU !== 'boolean' || !pair(extent) || extent.some(value => value <= 0) ||
        (projection !== undefined && !record(projection)))
      throw new RangeError('Invalid subject feedback dimensions, projection, or timing');
    const project = projection && SplatEffects.project(projection), [spanU, spanV] = extent;
    const mod = (value, size) => (value % size + size) % size;
    const [vx, vy] = velocity;
    let previous;

    function deposit(source, { coordinates, owners, owner, valid }) {
      const { width, height } = source;
      if (!display(source) || width > 8192 || height > 8192 || width * height > limit)
        throw new RangeError('Subject feedback needs a bounded display raster');
      if (coordinates == null && (width !== w || height !== h))
        throw new RangeError('Local feedback source must match the chart dimensions');
      if ((owner != null) !== (owners != null) || owner != null && (!Number.isSafeInteger(owner) || owner < 1 || owner > 0xffffffff))
        throw new RangeError('Subject feedback owner needs an aligned ID raster and a positive integer ID');

      const stride = project ? 3 : 2;
      const location = coordinates == null ? null : coordinatesOf(coordinates, width, height, stride);
      const mask = valid == null ? null : MotionSmear.plane(valid, width, height, 1, 0, 255, 'Subject visibility');
      const ids = owners == null ? null : MotionSmear.plane(owners, width, height, 1, 0, 0xffffffff, 'Subject owners');
      const color = FrameComposite.pixels({ w: width, h: height, rgba: P.raster.rgba(source).data }).data;
      const ink = new Float64Array(w * h * 4), samples = new Uint32Array(w * h);
      const position = [0, 0, 0];
      for (let p = 0; p < width * height; p++) {
        if ((mask && !mask[p]) || (ids && ids[p] !== owner)) continue;
        let texel = p;
        if (location) {
          for (let c = 0; c < stride; c++) {
            position[c] = location[p * stride + c];
            if (!Number.isFinite(position[c])) throw new RangeError('Visible subject coordinates must be finite');
          }
          let [u, v] = project ? project(position) : position;
          if (project) { u /= spanU; v /= spanV; }
          if (wrapU) u = mod(u, 1);
          if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
          texel = Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w));
        }
        samples[texel]++;
        for (let c = 0; c < 4; c++) ink[texel * 4 + c] += color[p * 4 + c];
      }
      return { ink, samples };
    }

    function readHistory(layer, x, y, out) {
      if (!wrapU) {
        FrameComposite.sample(layer, x, y, out);
      } else if (filter === 'nearest') {
        FrameComposite.sample(layer, mod(x, w), y, out);
      } else {
        // Interpolate across the seam in both directions without clamping U.
        const u = mod(x - .5, w), v = Math.max(0, Math.min(h - 1, y - .5));
        const a = Math.floor(u), b = (a + 1) % w, row = Math.floor(v), next = Math.min(h - 1, row + 1);
        const fx = u - a, fy = v - row, data = layer.data;
        for (let c = 0; c < 4; c++) {
          const top = data[(row * w + a) * 4 + c] * (1 - fx) + data[(row * w + b) * 4 + c] * fx;
          const bottom = data[(next * w + a) * 4 + c] * (1 - fx) + data[(next * w + b) * 4 + c] * fx;
          out[c] = top * (1 - fy) + bottom * fy;
        }
      }
    }

    function sample(source, time, { refresh, reset = false, ...input } = {}) {
      if (!Number.isFinite(time) || typeof reset !== 'boolean') throw new TypeError('Subject feedback needs a finite time and boolean reset');
      const prior = !reset && previous?.time <= time ? previous : undefined;
      if (prior?.time !== time) {
        const clear = refresh == null ? null : MotionSmear.plane(refresh, w, h, 1, 0, 255, 'Chart refresh');
        const fresh = source == null ? null : deposit(source, input);
        const elapsed = prior ? time - prior.time : 0, decay = prior ? 2 ** (-elapsed / halfLife) : 0;
        const stored = new Float32Array(w * h * 4), deposited = new Uint8Array(w * h);
        const old = { data: prior?.stored, w, h, filter }, color = new Float64Array(4);
        for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
          const u = x + .5 - vx * elapsed, v = y + .5 - vy * elapsed, q = p * 4;
          const weight = fresh?.samples[p] ? gain / fresh.samples[p] : 0;
          const alpha = weight ? weight * fresh.ink[q + 3] : 0;
          const remain = decay * (1 - (clear?.[p] ?? 0) / 255) * (1 - alpha / 255);
          const retain = remain && Number.isFinite(u) && (wrapU || u >= 0 && u < w) && v >= 0 && v < h;
          if (retain) readHistory(old, u, v, color);
          for (let c = 0; c < 4; c++)
            stored[q + c] = (retain ? color[c] * remain : 0) + (weight ? fresh.ink[q + c] * weight : 0);
          deposited[p] = Math.round(alpha);
        }
        previous = { time, stored, deposited };
      }
      const bytes = Uint8Array.from(previous.stored, Math.round);
      const value = P.sceneGraph.rasterFrame(FrameComposite.straight(bytes, w, h, true));
      return { value, deposited: { width: w, height: h, channels: 1, data: previous.deposited.slice() } };
    }
    return Object.freeze({ sample, clear() { previous = undefined; } });
  }

  function bindAtlas(atlas, region) {
    const { x, y, width, height } = region ?? {};
    const rect = { x, y, width, height };
    if (!(atlas?.pixels instanceof Uint8Array) || !atlas.vertices) throw new TypeError('Subject feedback needs a native sprite atlas');
    const base = P.raster.crop({ width: atlas.width, height: atlas.height, channels: 4, data: atlas.pixels }, rect);
    const update = ink => SpriteSurface.update(atlas, rect, { w: width, h: height, rgba: ink.data });
    return Object.freeze({
      apply(ink) {
        if (!display(ink) || ink.width !== width || ink.height !== height)
          throw new RangeError('Subject feedback texture must match the atlas region');
        return update(P.raster.blend(base, ink));
      },
      clear() { return update(base); }
    });
  }

  const optional = { type: 'any', default: null };
  const operation = {
    description: 'Retain a feedback texture in a subject’s UV chart or projected rest space.',
    inputs: { source: optional, coordinates: optional, valid: optional, owners: optional, owner: optional,
      refresh: optional, options: 'record', reset: resetOption },
    outputs: { value: 'displayRaster', deposited: 'raster' }, time: true,
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
  P.subjectFeedback = Object.freeze({ create, bindAtlas, operations: Object.freeze({ 'anim.subjectFeedback': operation }) });
})(KIT.procedural);
