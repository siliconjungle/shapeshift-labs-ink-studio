/* Serializable TrueType faces and deterministic resource-backed text layout. */
const FontResources = (() => {
  const T = typeof Typography === 'undefined' ? require('./typography.js') : Typography;
  const TrueType = typeof TrueTypeFont === 'undefined' ? require('./typography-truetype.js') : TrueTypeFont;
  const format = 'ink-studio/font-face', version = 1, maxBytes = 8 * 1024 ** 2;
  const maxEncoded = 4 * Math.ceil(maxBytes / 3), faceFields = ['format', 'version', 'family', 'style', 'data'];
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const label = value => typeof value === 'string' && value.trim() === value && value.length > 0 &&
    value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
  const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

  function valid(face) {
    return !!(fields(face, faceFields) && face.format === format && face.version === version &&
      label(face.family) && label(face.style) && typeof face.data === 'string' &&
      face.data.length >= 16 && face.data.length <= maxEncoded && face.data.length % 4 === 0);
  }

  function decode(data) {
    if (typeof data !== 'string' || data.length > maxEncoded || data.length % 4 ||
        !data.length || /[^A-Za-z0-9+/=]/.test(data))
      throw new TypeError('Font data needs bounded Base64 TrueType bytes');
    const binary = atob(data);
    if (binary.length > maxBytes || btoa(binary) !== data)
      throw new RangeError('Font data exceeds its byte budget or uses noncanonical Base64');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function bytesOf(input) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ?
      new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
    if (!bytes || bytes.length < 12 || bytes.length > maxBytes)
      throw new RangeError('Font resource needs TrueType bytes within 8 MiB');
    return bytes;
  }

  function create(input, { family, style } = {}) {
    const bytes = bytesOf(input), names = TrueType.names(bytes);
    family ??= names.family;
    style ??= names.style ?? 'Regular';
    if (!label(family) || !label(style)) throw new TypeError('Font face needs a family and style');
    let binary = '';
    for (let first = 0; first < bytes.length; first += 16384)
      binary += String.fromCharCode(...bytes.subarray(first, first + 16384));
    const face = Object.freeze({ format, version, family, style, data: btoa(binary) });
    open(face);
    return face;
  }

  // Key by immutable bytes so graph copies of one face share outlines and pair metrics.
  const readers = new Map();
  function open(face) {
    if (!valid(face)) throw new TypeError('Expected a version 1 Ink font face');
    if (!readers.has(face.data)) {
      if (readers.size >= 8) readers.delete(readers.keys().next().value);
      readers.set(face.data, T.trueType(decode(face.data)));
    }
    return readers.get(face.data);
  }

  function select(faces, { family, style, fallback = [] }) {
    if (!Array.isArray(faces) || !faces.length || faces.length > 32 || !Array.from(faces).every(valid) ||
        (family !== undefined && !label(family)) || (style !== undefined && !label(style)) ||
        !Array.isArray(fallback) || fallback.length > 16 || !Array.from(fallback).every(face =>
          fields(face, ['family', 'style']) && label(face.family) && (face.style === undefined || label(face.style))))
      throw new TypeError('Choose explicit font faces and an ordered family/style fallback list');
    const catalog = new Map();
    for (const face of faces) {
      const styles = catalog.get(face.family) ?? new Map();
      if (styles.has(face.style)) throw new RangeError('Duplicate font face ' + face.family + ' / ' + face.style);
      styles.set(face.style, face);
      catalog.set(face.family, styles);
    }
    function find(family, style) {
      const styles = catalog.get(family);
      const face = style === undefined ? styles?.get('Regular') ?? styles?.values().next().value : styles?.get(style);
      if (!face) throw new RangeError('Unknown font face ' + family + ' / ' + (style ?? 'default'));
      return face;
    }
    const primary = family === undefined && style === undefined ? faces[0] : find(family ?? faces[0].family, style);
    return [...new Set([primary, ...fallback.map(face => find(face.family, face.style))])].map(face => ({
      family: face.family, style: face.style, font: open(face)
    }));
  }

  function composite(stack) {
    const primary = stack[0].font, choices = new Map();
    function pick(character) {
      if (!choices.has(character)) {
        const exact = stack.find(face => face.font.has(character));
        const face = exact ?? stack.find(face => face.font.has('?')) ?? stack[0];
        choices.set(character, { face, code: exact ? character : '?', missing: !exact });
      }
      return choices.get(character);
    }
    const font = T.font({
      unitsPerEm: primary.unitsPerEm, ascender: primary.ascender, descender: primary.descender, lineGap: primary.lineGap,
      glyphs(character) {
        const { face, code, missing } = pick(character);
        if (character === ' ' && missing) return { advance: primary.unitsPerEm / 4, commands: [] };
        const glyph = face.font.glyph(code);
        const scale = primary.unitsPerEm / face.font.unitsPerEm;
        return {
          id: glyph.id, advance: glyph.advance * scale,
          commands: scale === 1 ? glyph.commands : glyph.commands.map(([command, ...values]) =>
            [command, ...values.map(value => value * scale)])
        };
      },
      kerning(left, right) {
        const a = pick(left === '\t' ? ' ' : left), b = pick(right === '\t' ? ' ' : right);
        if (a.face !== b.face || a.missing || b.missing || left === '\t' || right === '\t') return 0;
        return a.face.font.kerning(a.code, b.code) * primary.unitsPerEm / a.face.font.unitsPerEm;
      }
    });
    return { font, pick };
  }

  function wrapped(text, font, { size, tracking, kerning, maxWidth, wrap }) {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (maxWidth === undefined || wrap === 'none') return normalized;
    const scale = size / font.unitsPerEm, output = [], breakable = character => character === ' ' || character === '\t';
    for (const line of normalized.split('\n')) {
      const chars = Array.from(line);
      let first = 0, wordBreak = -1, x = 0, previous = null;
      for (let index = 0; index < chars.length;) {
        const character = chars[index], advance = scale * font.glyph(character === '\t' ? ' ' : character).advance *
          (character === '\t' ? 4 : 1);
        if (wrap === 'word' && breakable(character) && index > first) wordBreak = index;
        const next = x + advance + (previous === null ? 0 : tracking + (kerning ? scale * font.kerning(previous, character) : 0));
        if (next > maxWidth && index > first) {
          const end = wordBreak > first ? wordBreak : index;
          const segment = chars.slice(first, end).join('');
          output.push(wrap === 'word' ? segment.replace(/[ \t]+$/, '') : segment);
          first = end;
          if (wrap === 'word') while (first < chars.length && breakable(chars[first])) first++;
          index = first;
          x = 0;
          previous = null;
          wordBreak = -1;
          continue;
        }
        x = next;
        previous = character;
        index++;
      }
      if (first < chars.length || !chars.length) output.push(chars.slice(first).join(''));
    }
    return output.join('\n');
  }

  const layoutFields = ['family', 'style', 'fallback', 'size', 'tracking', 'lineHeight', 'align',
    'kerning', 'wrap', 'maxWidth', 'vertical', 'at'];
  function layout(text, faces, settings = {}) {
    if (!fields(settings, layoutFields) || typeof text !== 'string' || text.length > 4096 || Array.from(text).length > 2048)
      throw new TypeError('Font layout needs a bounded string and typography settings');
    const { size = 32, tracking = 0, lineHeight, align = 'left', kerning = true, maxWidth,
      wrap = 'word', vertical = 'top', at = [0, 0] } = settings;
    if (!finite(size, 1 / 1024, 4096) || !finite(tracking, -4096, 4096) ||
        lineHeight !== undefined && !finite(lineHeight, 1 / 1024, 32768) ||
        maxWidth !== undefined && !finite(maxWidth, 1 / 1024, 32768) ||
        !['left', 'center', 'right'].includes(align) || !['top', 'middle', 'bottom', 'baseline'].includes(vertical) ||
        !['word', 'character', 'none'].includes(wrap) || typeof kerning !== 'boolean' ||
        !Array.isArray(at) || at.length !== 2 || !Array.from(at).every(n => finite(n, -65536, 65536)))
      throw new RangeError('Invalid font size, spacing, alignment, wrapping or placement');
    const stack = select(faces, settings), { font, pick } = composite(stack);
    const arranged = wrapped(text, font, { size, tracking, kerning, maxWidth, wrap });
    const run = T.layout(arranged, font, { size, tracking, lineHeight, align, kerning });
    const baseline = at[1] + (vertical === 'baseline' ? 0 : font.ascender * size / font.unitsPerEm -
      (vertical === 'middle' ? run.height / 2 : vertical === 'bottom' ? run.height : 0));
    const choice = ({ family, style }) => ({ family, style });
    const glyphs = run.glyphs.map(g => {
      const { face, missing } = pick(g.char === '\t' ? ' ' : g.char);
      return { char: g.char, index: g.index, line: g.line, x: at[0] + g.x, y: baseline - g.y,
        advance: g.advance, ...choice(face), fallback: face !== stack[0], missing };
    });
    return {
      run, glyphs,
      layout: { text, arranged, ...choice(stack[0]), fallback: stack.slice(1).map(choice),
        align, vertical, at: at.slice(), size, tracking, kerning, wrap, ...(maxWidth !== undefined && {maxWidth}),
        lineHeight: lineHeight ?? (font.ascender - font.descender + font.lineGap) * size / font.unitsPerEm,
        width: run.width, height: run.height,
        lines: run.lines.map(line => ({ width: line.width, baseline: baseline - line.baseline })), glyphs }
    };
  }

  return Object.freeze({ format, version, maxBytes, label, valid, create, decode, open, layout });
})();
if (typeof module !== 'undefined') module.exports = FontResources;
