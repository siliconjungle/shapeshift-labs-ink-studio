/* Unit-gain derivatives on texel centers. A unit ramp returns a unit slope. */
const RasterDerivatives = (method, read) => {
  if (method === 'central') return (x, y, out) => {
    out[0] = .5 * read(x + 1, y) - .5 * read(x - 1, y);
    out[1] = .5 * read(x, y + 1) - .5 * read(x, y - 1);
  };
  const [a, b] = method === 'scharr' ? [3 / 32, 10 / 32] : [1 / 8, 2 / 8];
  return (x, y, out) => {
    const tl = read(x - 1, y - 1), tr = read(x + 1, y - 1);
    const bl = read(x - 1, y + 1), br = read(x + 1, y + 1);
    out[0] = a * tr + b * read(x + 1, y) + a * br - (a * tl + b * read(x - 1, y) + a * bl);
    out[1] = a * bl + b * read(x, y + 1) + a * br - (a * tl + b * read(x, y - 1) + a * tr);
  };
};
