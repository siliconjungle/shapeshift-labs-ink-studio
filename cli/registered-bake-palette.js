const PNG = require('./png.js');
const PixelPalette = require('../src/pixel-palette.js');
const { nearest } = require('../src/pixel-look.js');

const key = (r, g, b) => (r << 16) | (g << 8) | b;
const record = (row, names) => row && Object.getPrototypeOf(row) === Object.prototype &&
  Object.keys(row).every(name => names.includes(name));

function compile(asset) {
  const { swatches } = PixelPalette.validate(asset);
  const colors = swatches.map(({ color }) => {
    const n = parseInt(color.slice(1), 16);
    return [n >> 16, n >> 8 & 255, n & 255];
  });
  const exact = new Map(colors.map((rgb, i) => [key(...rgb), i]));
  if (exact.size !== colors.length) throw new RangeError('A bake palette needs distinct RGB values to preserve ordered slots');
  const identifiers = new Map(swatches.map(({ id }, i) => [id, i]));
  return { asset, colors, identifiers, exact };
}

function page(compiled, pins, size) {
  const { asset, colors, identifiers, exact } = compiled;
  const locks = new Map(), seen = new Set(), pending = new Set();
  if (!Array.isArray(pins) || pins.length > 4096) throw new RangeError('Use up to 4096 palette pins per page');
  for (const row of pins) {
    if (!record(row, ['id', 'swatch', 'at']) || typeof row.id !== 'string' || !row.id ||
        seen.has(row.id) || !identifiers.has(row.swatch) || !Array.isArray(row.at) || row.at.length !== 2 ||
        !row.at.every(v => Number.isSafeInteger(v) && v >= 0 && v < size)) throw new RangeError('Invalid registered palette pin');
    const i = row.at[0] + row.at[1] * size;
    if (locks.has(i)) throw new RangeError('Multiple palette pins resolve to texel ' + row.at.join(','));
    const slot = identifiers.get(row.swatch);
    locks.set(i, { ...row, slot, color: colors[slot] });
    seen.add(row.id);
    pending.add(i);
  }
  const choices = new Map();
  function apply(base, i, lock = true) {
    const at = 3 * i, r = base[at], g = base[at + 1], b = base[at + 2], code = key(r, g, b);
    const pin = lock && locks.get(i);
    let slot = pin ? pin.slot : exact.get(code) ?? choices.get(code);
    if (slot === undefined) {
      slot = nearest([r, g, b], colors, false);
      if (choices.size < 65536) choices.set(code, slot);
    }
    if (pin) pending.delete(i);
    base.set(colors[slot], at);
  }
  function finish() {
    if (pending.size) throw new RangeError('Palette pins need covered receiver texels: ' +
      [...pending].slice(0, 8).map(i => locks.get(i).id).join(', '));
  }
  function encode(base, owners) {
    const slots = Array.from(owners, (owner, i) => {
      if (!owner) return null;
      const at = i * 3, slot = exact.get(key(base[at], base[at + 1], base[at + 2]));
      if (slot === undefined) throw new Error('An occupied texel escaped its registered palette');
      return slot;
    });
    return PNG.encodeIndexed(size, size, slots, colors);
  }
  return { apply, finish, encode, asset, pins: [...locks.values()] };
}

module.exports = { compile, page };
