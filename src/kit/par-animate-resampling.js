/* Portable, seekable raster spans with aligned auxiliary planes. */
(function (P) {
  const format = 'ink-studio/visual-sample', version = 1, maxFrames = 512, maxBytes = 64 * 1024 * 1024;
  const T = P.takeTime, R = P.raster;
  const raster = P.graphTypes.validator('raster');
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const rasterOf = (width, height, channels, data) => ({ width, height, channels, data });

  function frameRate(input) {
    const [n, d] = T.read(input).map(Number);
    if (!integer(n, 1, Number.MAX_SAFE_INTEGER) || !integer(d, 1, Number.MAX_SAFE_INTEGER) || n / d < .01 || n / d > 1000)
      throw new RangeError('Visual sample needs a portable frame rate from 0.01 to 1000');
    return Object.freeze({ numerator: n, denominator: d });
  }
  function size(width, height) {
    if (!integer(width, 1, 8192) || !integer(height, 1, 8192) || width * height > 1048576)
      throw new RangeError('Visual sample dimensions exceed the pixel budget');
  }
  function pack(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }
  function unpack(text, length) {
    if (typeof text !== 'string' || text.length !== 4 * Math.ceil(length / 3))
      throw new TypeError('Visual sample buffer has the wrong encoded length');
    const binary = atob(text);
    if (binary.length !== length) throw new TypeError('Visual sample buffer length does not match its grid');
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  function packNumbers(numbers) {
    const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer);
    for (let i = 0; i < numbers.length; i++) view.setFloat64(i * 8, numbers[i], true);
    return pack(bytes);
  }
  function unpackNumbers(text, length) {
    const view = new DataView(unpack(text, length * 8).buffer);
    const numbers = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      numbers[i] = view.getFloat64(i * 8, true);
      if (!Number.isFinite(numbers[i])) throw new TypeError('Visual sample contains a non-finite channel');
    }
    return numbers;
  }
  function view(source, width, height, channels, label) {
    if (!raster(source) || source.width !== width || source.height !== height)
      throw new TypeError(label + ' needs a finite raster aligned with the visual sample');
    const count = source.data.length / (width * height);
    if (channels && channels !== count) throw new TypeError(label + ' needs ' + channels + ' channels');
    return { data: source.data, channels: count, colorSpace: source.colorSpace };
  }
  const measure = (pixels, rawChannels, depth, motion) =>
    pixels * (4 + rawChannels * 8 + (depth ? 9 : 0) + (motion ? 17 : 0));

  function create({ fps = 24, startFrame = 0, crop, region } = {}) {
    const rate = frameRate(fps);
    if (!integer(startFrame, 0, 1000000000) || (region !== undefined && !integer(region, 1, 0xffffffff)) ||
        (crop !== undefined && (!Array.isArray(crop) || crop.length !== 4 || !Array.from(crop).every(Number.isSafeInteger) ||
          crop[0] < 0 || crop[1] < 0 || crop[2] < 1 || crop[3] < 1)))
      throw new TypeError('Visual sample needs a valid starting frame, crop rectangle and optional region ID');
    const rectangle = crop?.slice();
    const frames = [];
    let sourceWidth, sourceHeight, bytes = 0;

    function append(value, { data, depth, depthValid, motion, motionValid, labels } = {}) {
      const { width, height } = value ?? {};
      size(width, height);
      if (frames.length >= maxFrames || startFrame + frames.length > 1000000000)
        throw new RangeError('Visual sample exceeds its frame budget');
      if (frames.length && (width !== sourceWidth || height !== sourceHeight))
        throw new RangeError('Visual sample frames need a common source grid');
      if (value.colorSpace === 'srgb-linear') throw new TypeError('Visual sample needs a display preview and optional raw channels');
      const [x, y, w, h] = rectangle ?? [0, 0, width, height];
      if (x + w > width || y + h > height) throw new RangeError('Visual sample crop must lie inside the source');
      const preview = R.rgba(value);
      const raw = data && view(data, width, height, undefined, 'Raw pass');
      const ids = region !== undefined ? view(labels, width, height, 1, 'Region labels').data : undefined;
      const layer = (plane, valid, channels, name) => {
        if (valid != null && plane == null) throw new TypeError(name + ' validity needs its matching plane');
        if (plane == null) return null;
        return { data: view(plane, width, height, channels, name).data,
          valid: valid == null ? null : view(valid, width, height, 1, name + ' validity').data, channels };
      };
      const depthPlane = layer(depth, depthValid, 1, 'Depth'), motionPlane = layer(motion, motionValid, 2, 'Motion');
      const used = measure(w * h, raw?.channels ?? 0, depthPlane, motionPlane);
      if (bytes + used > maxBytes) throw new RangeError('Visual sample exceeds its byte budget');

      const rgba = new Uint8Array(w * h * 4);
      const rawData = raw && new Float64Array(w * h * raw.channels);
      const buffer = plane => plane && { ...plane, values: new Float64Array(w * h * plane.channels), mask: new Uint8Array(w * h) };
      const depths = buffer(depthPlane), motions = buffer(motionPlane);
      const copy = (source, target, channels, from, to) => {
        for (let c = 0; c < channels; c++) target[to * channels + c] = source[from * channels + c];
      };
      const aux = (plane, from, to) => {
        if (!plane || preview.data[from * 4 + 3] === 0 || plane.valid && plane.valid[from] <= 0) return;
        plane.mask[to] = 255;
        copy(plane.data, plane.values, plane.channels, from, to);
      };
      for (let row = 0, to = 0; row < h; row++) for (let col = 0; col < w; col++, to++) {
        const from = (y + row) * width + x + col;
        if (ids && ids[from] !== region) continue;
        copy(preview.data, rgba, 4, from, to);
        if (raw) copy(raw.data, rawData, raw.channels, from, to);
        aux(depths, from, to);
        aux(motions, from, to);
      }
      const row = Object.freeze({ rgba: pack(rgba),
        ...(raw && { raw: Object.freeze({ channels: raw.channels, samples: packNumbers(rawData),
          ...(raw.colorSpace === 'srgb-linear' && { colorSpace: raw.colorSpace }) }) }),
        ...(depths && { depth: packNumbers(depths.values), depthValid: pack(depths.mask) }),
        ...(motions && { motion: packNumbers(motions.values), motionValid: pack(motions.mask) }) });
      frames.push(row);
      [sourceWidth, sourceHeight] = [width, height];
      bytes += used;
    }
    return Object.freeze({ append, snapshot() {
      if (!frames.length) throw new RangeError('Visual sample has no frames');
      const [x, y, width, height] = rectangle ?? [0, 0, sourceWidth, sourceHeight];
      return Object.freeze({ format, version, width, height, fps: rate, startFrame, origin: Object.freeze([x, y]),
        ...(region !== undefined && { region }), frames: Object.freeze(frames.slice()) });
    } });
  }

  function compile(source) {
    const { format: kind, version: revision, width, height, fps, startFrame, origin, region, frames } = source ?? {};
    if (kind !== format || revision !== version || !integer(startFrame, 0, 1000000000) ||
        !Array.isArray(origin) || origin.length !== 2 || !Array.from(origin).every(n => integer(n, 0, 8191)) ||
        (region !== undefined && !integer(region, 1, 0xffffffff)) ||
        !Array.isArray(frames) || !integer(frames.length, 1, maxFrames) || startFrame + frames.length - 1 > 1000000000)
      throw new TypeError('Expected an ink-studio/visual-sample version 1 with a bounded frame span');
    size(width, height);
    const rate = frameRate(fps), period = T.div(T.read(1), T.read(rate)), offset = origin.slice(), pixels = width * height;
    let bytes = 0;
    const storage = Array.from(frames, frame => {
      if (!record(frame) || (frame.raw !== undefined && (!record(frame.raw) || !integer(frame.raw.channels, 1, 4) ||
          (frame.raw.colorSpace !== undefined && frame.raw.colorSpace !== 'srgb-linear'))) ||
          (frame.depth === undefined) !== (frame.depthValid === undefined) ||
          (frame.motion === undefined) !== (frame.motionValid === undefined))
        throw new TypeError('Visual sample has an invalid frame or auxiliary plane');
      bytes += measure(pixels, frame.raw?.channels ?? 0, frame.depth !== undefined, frame.motion !== undefined);
      if (bytes > maxBytes) throw new RangeError('Visual sample exceeds its byte budget');
      return frame;
    }).map(({ rgba, raw, depth, depthValid, motion, motionValid }) => ({
      rgba: unpack(rgba, pixels * 4),
      ...(raw && { raw: { channels: raw.channels, colorSpace: raw.colorSpace, data: unpackNumbers(raw.samples, pixels * raw.channels) } }),
      ...(depth !== undefined && { depth: unpackNumbers(depth, pixels), depthValid: unpack(depthValid, pixels) }),
      ...(motion !== undefined && { motion: unpackNumbers(motion, pixels * 2), motionValid: unpack(motionValid, pixels) })
    }));
    function sample(time, options = {}, take) {
      const { time: override, phase = 0, ...timing } = options;
      const exact = take !== undefined && override == null ? T.requireFrame(take).start : undefined;
      const { index, time: localTime } = P.animationGraph.frameIndex(storage.length, override ?? time,
        { ...timing, first: 0, end: storage.length, fps: rate, phase }, exact);
      const { rgba, raw, depth, depthValid, motion, motionValid } = storage[index];
      const read = (samples, channels) => samples ? rasterOf(width, height, channels, samples.slice()) : null;
      const value = read(rgba, 4), sourceFrame = startFrame + index;
      const data = raw ? read(raw.data, raw.channels) : read(rgba, 4);
      if (raw?.colorSpace) data.colorSpace = raw.colorSpace;
      return { value, data,
        depth: read(depth, 1), depthValid: read(depthValid, 1), motion: read(motion, 2), motionValid: read(motionValid, 1),
        frame: index, info: { localTime, sourceFrame, sourceTime: T.seconds(T.mul(period, T.read(sourceFrame))),
          origin: offset.slice(), ...(region !== undefined && { region }) } };
    }
    return Object.freeze({ sample });
  }

  const operations = {
    'anim.visualSample': {
      description: 'Replay a captured visual span with its raw pass, depth, and motion.',
      inputs: { source: 'record', options: { type: 'record', default: {} } },
      outputs: { value: 'displayRaster', data: 'raster', depth: 'any', depthValid: 'any',
        motion: 'any', motionValid: 'any', frame: 'frames', info: 'record' },
      time: true,
      instantiate() {
        let prior, clip;
        return ({ source, options }, { time, take }) => {
          if (source !== prior) { clip = compile(source); prior = source; }
          return clip.sample(time, options, take);
        };
      }
    }
  };
  P.visualResampling = Object.freeze({ create, compile, maxFrames, operations: Object.freeze(operations) });
})(KIT.procedural);
