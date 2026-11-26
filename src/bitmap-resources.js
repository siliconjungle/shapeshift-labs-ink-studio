/* Portable bitmap authoring, interpretation and member selection. */
const BitmapResources = (() => {
  const format = 'bitmap';
  const maxPixels = 2 ** 24, maxFileBytes = 32 * 1024 ** 2, maxResourceBytes = 128 * 1024 ** 2;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const dimensions = (w, h) => integer(w, 1, 8192) && integer(h, 1, 8192) && w * h <= maxPixels;
  const filename = value => typeof value === 'string' && !!value.trim() && value.length <= 4096 && !value.includes('\0');
  const encodings = ['png', 'pfm', 'tiff', 'exr'];
  const precisions = { unorm8: Uint8Array, unorm16: Uint16Array, float32: Float32Array };
  const spaces = ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'];
  const borders = ['clamp', 'wrap', 'mirror', 'transparent'];
  const isTile = tile => Array.isArray(tile) && tile.length === 2 && Array.from(tile).every(n => integer(n, -32768, 32767));
  const tileKey = tile => tile.join(',');
  const encoding = member => {
    const file = member.file ?? member.origin ?? '';
    const suffix = /\.(pfm|exr|tiff?)$/i.exec(file)?.[1]?.toLowerCase();
    return member.encoding ?? (suffix === 'tif' ? 'tiff' : suffix ?? 'png');
  };
  const coordinate = udim => [(udim - 1001) % 10, Math.floor((udim - 1001) / 10)];

  function pixels(value) {
    if (!Array.isArray(value) || value.length > 65536) throw new TypeError('Bitmap pixel edits need up to 65,536 samples');
    const seen = new Set();
    for (const row of value) {
      if (!fields(row, ['x', 'y', 'value']) || !integer(row.x, 0, 8191) || !integer(row.y, 0, 8191) ||
          !Array.isArray(row.value) || ![1, 3, 4].includes(row.value.length) || !Array.from(row.value).every(Number.isFinite))
        throw new TypeError('Bitmap edits need integer x and y and one, three or four finite samples');
      const key = row.y * 8192 + row.x;
      if (seen.has(key)) throw new RangeError('Duplicate bitmap pixel edit at ' + row.x + ',' + row.y);
      seen.add(key);
    }
  }
  function member(source) {
    if (!fields(source, ['file', 'base64', 'origin', 'encoding', 'rowOrder', 'page', 'channels', 'pixels']) ||
        Object.hasOwn(source, 'file') === Object.hasOwn(source, 'base64') ||
        (Object.hasOwn(source, 'file') ? !filename(source.file) || Object.hasOwn(source, 'origin') :
          typeof source.base64 !== 'string' || !source.base64.length || source.base64.length % 4 ||
          source.base64.length > Math.ceil(maxFileBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.base64) ||
          source.origin !== undefined && !filename(source.origin)) ||
        !encodings.includes(encoding(source)) ||
        source.rowOrder !== undefined && (encoding(source) !== 'pfm' || !['bottom-up', 'top-down'].includes(source.rowOrder)) ||
        source.page !== undefined && (encoding(source) !== 'tiff' || !integer(source.page,0,63)) ||
        source.channels !== undefined && (encoding(source) !== 'exr' || !Array.isArray(source.channels) ||
          !integer(source.channels.length,1,4) || !Array.from(source.channels).every(name=>typeof name==='string'&&/^[!-~]{1,255}$/.test(name))))
      throw new TypeError('Bitmap member needs one linked or embedded PNG, TIFF, OpenEXR or PFM payload with matching selection');
    if (source.pixels !== undefined) pixels(source.pixels);
    return source;
  }
  function interpretation(settings = {}) {
    if (!fields(settings, ['intent', 'colorSpace', 'channel', 'units', 'alpha', 'sampling', 'tiling', 'normalSpace', 'normalOrientation', 'heightRange', 'layout']))
      throw new TypeError('Invalid bitmap interpretation settings');
    const { intent = 'color', colorSpace, channel, units, alpha, sampling, tiling, normalSpace, normalOrientation, heightRange, layout } = settings;
    if (!['color', 'data', 'mask', 'height', 'normal'].includes(intent) ||
        layout!==undefined&&(intent!=='data'||layout!=='xyz'||channel!==undefined) ||
        normalSpace !== undefined && (intent !== 'normal' || !['tangent','world'].includes(normalSpace)) ||
        normalOrientation !== undefined && (intent !== 'normal' || normalSpace==='world' || !['opengl','directx'].includes(normalOrientation)) ||
        heightRange !== undefined && (intent!=='height'||!Array.isArray(heightRange)||heightRange.length!==2||
          !Array.from(heightRange).every(n=>Number.isFinite(n)&&Number.isFinite(Math.fround(n)))||heightRange[1]<=heightRange[0]) ||
        intent === 'normal' && (channel !== undefined || units !== undefined && units !== 'unitless') ||
        (intent === 'color' ? colorSpace !== undefined && !spaces.includes(colorSpace) || channel !== undefined ||
          alpha !== undefined && !['straight', 'premultiplied'].includes(alpha) :
          colorSpace !== undefined && colorSpace !== 'none' || channel !== undefined && !['r', 'g', 'b', 'a'].includes(channel) ||
          alpha !== undefined) ||
        units !== undefined && (typeof units !== 'string' || !units.trim() || units.trim() !== units || units.length > 64 ||
          ['color', 'mask'].includes(intent) && units !== 'unitless') ||
        sampling !== undefined && !['nearest', 'linear'].includes(sampling) ||
        tiling !== undefined && (!fields(tiling, ['u', 'v']) || Object.values(tiling).some(mode => !borders.includes(mode))))
      throw new TypeError('Invalid bitmap interpretation, channels, units, alpha or sampling');
    return settings;
  }

  function layout(definition) {
    if (!fields(definition, ['format', 'source', 'sequence', 'tiles', 'interpretation', 'missing']) ||
        definition.format !== format || ['source', 'sequence', 'tiles'].filter(key => Object.hasOwn(definition, key)).length !== 1)
      throw new TypeError('Bitmap resource needs exactly one source, sequence or tile set');
    interpretation(definition.interpretation);
    const missing = definition.missing === undefined ? { policy: 'error' } : definition.missing;
    if (!fields(missing, ['policy', 'width', 'height', 'precision']) ||
        !['error', 'blank', 'hold'].includes(missing.policy) ||
        missing.policy === 'hold' && !definition.sequence ||
        (missing.width !== undefined || missing.height !== undefined || missing.precision !== undefined) &&
        (missing.policy !== 'blank' || !dimensions(missing.width, missing.height) ||
          missing.precision !== undefined && !Object.hasOwn(precisions, missing.precision)))
      throw new TypeError('Invalid bitmap missing policy or blank dimensions');
    if (Object.hasOwn(definition, 'source')) return { kind: 'single', missing, rows: [{ key: 'single', ...member(definition.source) }] };
    if (Object.hasOwn(definition, 'sequence')) {
      const sequence = definition.sequence;
      if (!fields(sequence, ['first', 'fps', 'playback', 'frames']) ||
          !integer(sequence.first ?? 0, 0, Number.MAX_SAFE_INTEGER - 512) ||
          !Number.isFinite(sequence.fps) || sequence.fps < .001 || sequence.fps > 1000 ||
          !['loop', 'clamp', 'pingpong'].includes(sequence.playback ?? 'clamp') ||
          !Array.isArray(sequence.frames) || !integer(sequence.frames.length, 1, 512))
        throw new TypeError('Bitmap sequence needs 1–512 frames, a positive frame rate and a valid playback mode');
      const first = sequence.first ?? 0, playback = sequence.playback ?? 'clamp';
      const rows = Array.from(sequence.frames, (source, i) => ({ key: String(first + i), frame: first + i,
        ...(source === null ? {} : member(source)) }));
      return { kind: 'sequence', rows, missing, first, fps: sequence.fps, playback };
    }
    if (!Array.isArray(definition.tiles) || !integer(definition.tiles.length, 1, 512))
      throw new TypeError('Bitmap tile set needs 1–512 tiles');
    const seen = new Set();
    const rows = Array.from(definition.tiles, tile => {
      if (!fields(tile, ['uv', 'udim', 'source']) || Object.hasOwn(tile, 'uv') === Object.hasOwn(tile, 'udim') ||
          (tile.uv !== undefined ? !isTile(tile.uv) : !integer(tile.udim, 1001, 9999)))
        throw new TypeError('Bitmap tile needs signed integer UVs or a UDIM from 1001 through 9999');
      const uv = tile.uv ?? coordinate(tile.udim), key = tileKey(uv);
      if (seen.has(key)) throw new RangeError('Duplicate bitmap tile ' + key);
      seen.add(key);
      return { key, tile: uv, ...(tile.udim !== undefined && { udim: tile.udim }), ...member(tile.source) };
    });
    return { kind: 'tiles', rows, missing };
  }

  function mapMembers(definition, map) {
    const { kind, rows } = layout(definition);
    if (kind === 'single') return { ...definition, source: map(definition.source, rows[0].key) };
    if (kind === 'sequence') return { ...definition, sequence: { ...definition.sequence,
      frames: definition.sequence.frames.map((source, i) => map(source, rows[i].key)) } };
    return { ...definition, tiles: definition.tiles.map((tile, i) => ({ ...tile, source: map(tile.source, rows[i].key) })) };
  }

  function memberKey(definition, { frame, tile } = {}) {
    const { kind, rows } = layout(definition);
    if (kind === 'single' && frame === undefined && tile === undefined) return 'single';
    if (kind === 'sequence' && tile === undefined && Number.isSafeInteger(frame) && rows.some(row => row.frame === frame))
      return String(frame);
    if (kind === 'tiles' && frame === undefined && isTile(tile) && rows.some(row => row.key === tileKey(tile))) return tileKey(tile);
    throw new RangeError('Select an authored bitmap member by its exact frame or tile');
  }

  // Three-line portable float map. The optional row-order override supports top-down writers.
  function pfm(bytes, { rowOrder = 'bottom-up', layoutOnly = false } = {}) {
    const lines = [], decoder = new TextDecoder();
    let start = 0;
    for (let i = 0; i < 3; i++) {
      const stop = bytes.subarray(start, start + 128).indexOf(10);
      if (stop < 0) throw new TypeError('Invalid PFM header');
      lines.push(decoder.decode(bytes.subarray(start, start + stop)).trim());
      start += stop + 1;
    }
    const [code, size, order] = lines, match = /^(\d+)\s+(\d+)$/.exec(size);
    const width = Number(match?.[1]), height = Number(match?.[2]), channels = code === 'PF' ? 3 : code === 'Pf' ? 1 : 0;
    const scale = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(order) ? Number(order) : NaN;
    if (!channels || !dimensions(width, height) || !Number.isFinite(scale) || scale === 0 ||
        bytes.length - start !== width * height * channels * 4)
      throw new TypeError('Invalid PFM dimensions, scale or sample length');
    if (layoutOnly) return { width, height, channels, precision: 'float32' };
    const data = new Float32Array(width * height * channels), stride = width * channels;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start);
    const little = scale < 0, multiplier = Math.abs(scale);
    for (let y = 0; y < height; y++) {
      const target = (rowOrder === 'top-down' ? y : height - y - 1) * stride;
      for (let i = 0; i < stride; i++) {
        const value = Math.fround(view.getFloat32((y * stride + i) * 4, little) * multiplier);
        if (!Number.isFinite(value)) throw new RangeError('PFM samples must resolve to finite floats');
        data[target + i] = value;
      }
    }
    return { width, height, channels, precision: 'float32', data };
  }

  function png({ w, h, data, max, bitDepth }) {
    return { width: w, height: h, channels: 4, precision: (max === 65535 || bitDepth === 16) ? 'unorm16' : 'unorm8',
      ...(data && { data: max === 255 || max === 65535 ? data : Uint8Array.from(data, n => Math.round(n * 255 / max)) }) };
  }

  function contract(raw, settings = {}) {
    const { width, height, precision: native, encoding: codec } = raw;
    if (!dimensions(width, height)) throw new RangeError('Bitmap exceeds the 8192-axis or 16-million-pixel budget');
    const { intent = 'color', colorSpace = raw.colorSpace ?? (codec === 'pfm' || codec === 'exr' ? 'srgb-linear' : 'srgb'), units,
      sampling = 'nearest', tiling = {}, alpha = raw.alpha === 'premultiplied' ? 'premultiplied' : 'straight' } = settings;
    const color = intent === 'color', normal = intent === 'normal', vector=settings.layout==='xyz';
    if ((normal||vector) && raw.channels!==undefined && raw.channels<3) throw new TypeError('Normal and XYZ bitmaps need three source lanes');
    const normalSpace=settings.normalSpace??'tangent';
    return { width, height, channels: color ? 4 : normal||vector ? 3 : 1, descriptor: {
      intent, layout: color ? 'rgba' : normal||vector ? 'xyz' : 'r', colorSpace: color ? colorSpace : 'none',
      ...(normal && { normalSpace,...(normalSpace==='tangent'&&{normalOrientation:settings.normalOrientation??'opengl'}) }),
      alpha: color ? alpha : 'none', sampling, tiling: { u: tiling.u ?? 'clamp', v: tiling.v ?? 'clamp' },
      units: units ?? (intent === 'height' ? 'shape-units' : 'unitless'),
      precision: intent === 'height'||vector ? 'float32' : native
    } };
  }

  function image(raw, spec, settings, edits, declare) {
    const { width, height, channels, descriptor } = spec, count = width * height;
    const Data = precisions[descriptor.precision], src = raw?.data, stride = raw?.channels ?? 0;
    const copy = !edits?.length && src instanceof Data && channels === 4 && stride === 4 && raw.alpha !== 'none';
    const data = copy ? src : new Data(count * channels);
    const sourceMax = src instanceof Uint16Array ? 65535 : src instanceof Uint8Array ? 255 : 1;
    const targetMax = Data === Uint16Array ? 65535 : Data === Uint8Array ? 255 : 1;
    if (!src && descriptor.intent==='normal') for(let i=0;i<count;i++)
      data.set(targetMax===1?[0,0,1]:[Math.round(targetMax/2),Math.round(targetMax/2),targetMax],i*3);
    if (src && !copy) {
      const lane = ['r', 'g', 'b', 'a'].indexOf(settings?.channel ?? 'r');
      function read(p, c) {
        if (c === 3) {
          if (stride === 2 && raw.alpha !== 'none') return src[p * stride + 1];
          if (stride === 4 && (channels === 1 || raw.alpha !== 'none')) return src[p * stride + 3];
          return sourceMax;
        }
        const lane = stride >= 3 || channels === 1 && stride === 2 && raw.alpha === 'none' && c === 1 ? c : 0;
        return src[p * stride + lane];
      }
      const ratio = targetMax / sourceMax, range=settings?.heightRange;
      const decodeHeight=n=>{
        const unit=n/sourceMax;
        if(unit<0||unit>1)throw new RangeError('Encoded bitmap height range needs samples in [0, 1]');
        return range[0]+unit*(range[1]-range[0]);
      };
      function decodeVector(n) {
        if(sourceMax!==1)return n===Math.round(sourceMax/2)?0:n/sourceMax*2-1;
        if(n< -1||n>1)throw new RangeError('XYZ bitmap components must be in [-1, 1]');
        return n;
      }
      for (let p = 0; p < count; p++) {
        if (channels === 1) data[p] = range?decodeHeight(read(p,lane)):read(p, lane) * ratio;
        else if(settings?.layout==='xyz')for(let c=0;c<3;c++)data[p*3+c]=decodeVector(read(p,c));
        else for (let c = 0; c < channels; c++) data[p * channels + c] = read(p, c) * ratio;
      }
    }
    for (const { x, y, value } of edits ?? []) {
      if (x >= width || y >= height || value.length !== channels || value.some((n, i) =>
        !Number.isFinite(Math.fround(n)) || settings?.layout==='xyz'&&Math.abs(n)>1 ||
        (targetMax !== 1 || descriptor.intent === 'mask' || channels === 4 &&
          (i === 3 || !descriptor.colorSpace.endsWith('-linear'))) && (n < 0 || n > 1)))
        throw new RangeError('Bitmap pixel edit does not fit its source image or sample range at ' + x + ',' + y);
      const at = (y * width + x) * channels;
      for (let c = 0; c < channels; c++) data[at + c] = targetMax === 1 ? value[c] : Math.round(value[c] * targetMax);
    }
    return declare({ width, height, channels, data }, descriptor);
  }

  function compile(definition, loaded, declare) {
    const { kind, rows, missing, first, fps, playback } = layout(definition);
    const entries = new Map();
    let expected, bytes = 0;
    for (const row of rows) {
      const raw = loaded.get(row.key);
      if (!raw) continue;
      const spec = contract({ ...raw, encoding: encoding(row) }, definition.interpretation);
      const signature = JSON.stringify(spec);
      if (expected && expected.signature !== signature)
        throw new RangeError('Bitmap members must have the same extent and interpreted image contract at ' + row.key);
      const sampleBytes = precisions[spec.descriptor.precision].BYTES_PER_ELEMENT;
      const size = spec.width * spec.height * spec.channels * sampleBytes;
      if ((bytes += size) > maxResourceBytes) throw new RangeError('Bitmap resource exceeds its decoded sample budget');
      expected ??= { signature, spec };
      entries.set(row.key, { raw, spec, row, profile:raw.profile });
    }
    let blankSpec = expected?.spec;
    if (missing.width !== undefined) {
      const precision = missing.precision ?? expected?.spec.descriptor.precision ?? 'unorm8';
      const dimensions = { width: missing.width, height: missing.height };
      const spec = expected ? { ...expected.spec, ...dimensions, descriptor: { ...expected.spec.descriptor, precision } } :
        contract({ ...dimensions, precision, encoding: encoding(rows.find(row => row.file || row.base64) ?? {}) },
          definition.interpretation);
      if (expected && JSON.stringify(spec) !== expected.signature)
        throw new RangeError('Bitmap blank dimensions or precision differ from available members');
      blankSpec = spec;
    }
    if (missing.policy === 'blank' && !blankSpec)
      throw new RangeError('A completely missing bitmap needs explicit blank dimensions');
    let blank;
    const needsBlank = missing.policy === 'blank' && (kind === 'tiles' || entries.size < rows.length);
    if (needsBlank) {
      const { width, height, channels, descriptor } = blankSpec;
      if ((bytes += width * height * channels * precisions[descriptor.precision].BYTES_PER_ELEMENT) > maxResourceBytes)
        throw new RangeError('Bitmap resource exceeds its decoded sample budget');
      if (declare) blank = image(null, blankSpec, definition.interpretation, undefined, declare);
    }
    if (declare) for (const entry of entries.values()) {
      entry.value = image(entry.raw, entry.spec, definition.interpretation, entry.row.pixels, declare);
      delete entry.raw;
    }
    function select({ time = 0, frame = -1, tile = [0, 0] } = {}) {
      if (!Number.isFinite(time) || !integer(frame, -1, Number.MAX_SAFE_INTEGER) || !isTile(tile))
        throw new RangeError('Bitmap selection requires finite time, an integer frame and integer tile coordinates');
      let key = 'single', index;
      if (kind === 'sequence') {
        const count = rows.length;
        const offset = frame === -1 ? Math.floor(time * fps) : frame - first;
        if (!Number.isSafeInteger(offset)) throw new RangeError('Bitmap sequence time is out of range');
        const mod = (n, divisor) => ((n % divisor) + divisor) % divisor;
        const cycle = Math.max(1, 2 * (count - 1)), bounce = mod(offset, cycle);
        index = playback === 'loop' ? mod(offset, count) : playback === 'pingpong' ? Math.min(bounce, cycle - bounce) :
          Math.max(0, Math.min(count - 1, offset));
        key = rows[index].key;
      } else if (kind === 'tiles') key = tileKey(tile);
      let found = entries.get(key);
      if (!found && missing.policy === 'hold' && entries.size) {
        let i = index - 1;
        while (i >= 0 && !entries.has(rows[i].key)) i--;
        found = i >= 0 ? entries.get(rows[i].key) : entries.values().next().value;
      }
      if (!found && !blank) throw new RangeError('Missing bitmap member ' + key);
      return { value: found?.value ?? blank, info: { requested: key, resolved: found?.row.key ?? null,
        status: !found ? 'blank' : found.row.key === key ? 'ready' : 'held',
        ...(found?.profile && Object.keys(found.profile).length && { profile:found.profile }),
        ...(kind === 'sequence' && { frame: rows[index].frame }),
        ...(kind === 'tiles' && { tile: tile.slice() }) } };
    }
    const info = { kind, decodedBytes: bytes, ...blankSpec, ...(kind === 'sequence' && { first, fps, playback }),
      missing: missing.policy,
      members: rows.map(({ key, file, origin, base64, frame, tile, udim, pixels, page, channels }) => ({
        key, storage: file ? 'linked' : base64 ? 'embedded' : 'missing', available: entries.has(key),
        ...(file && { file }), ...(origin && { origin }), ...(frame !== undefined && { frame }), ...(tile && { tile }),
        ...(udim !== undefined && { udim }), ...(page !== undefined && {page}), ...(channels && {channels}), edits: pixels?.length ?? 0
      })) };
    return { select, info };
  }

  function operation(resolve, validate) {
    return {
      description: 'Sample a linked or embedded bitmap at graph time, an explicit frame, or a tile.',
      inputs: { name: 'string', frame: { type: 'integer', default: -1 }, tile: { type: 'vec2', default: [0, 0] } },
      outputs: { value: 'typedImage', info: 'record' }, time: true, asset: 'name', workerLocal: true, validateAsset: validate,
      run({ name, frame, tile }, { time }) { return resolve(name).select({ time, frame, tile }); }
    };
  }

  return Object.freeze({ format, maxFileBytes, maxResourceBytes, layout, member, memberKey, mapMembers, interpretation,
    pixels, encoding, pfm, png, compile, operation });
})();
if (typeof module !== 'undefined') module.exports = BitmapResources;
