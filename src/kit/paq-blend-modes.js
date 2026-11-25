/* Sample-domain blend functions shared by the byte compositor and typed images. */
const RasterBlendModes = (() => {
  const multiply = (a, b) => a * b;
  const screen = (a, b) => a + b - a * b;
  const overlay = (a, b) => a < .5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
  return Object.freeze({
    copy: (_, b) => b,
    multiply,
    screen,
    overlay,
    hardLight: (a, b) => overlay(b, a),
    softLight: (a, b) => b <= .5 ? a - (1 - 2 * b) * a * (1 - a) :
      a + (2 * b - 1) * ((a <= .25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a),
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    addSub: (a, b) => a + (b - .5),
    divide: (a, b) => a === 0 && b === 0 ? 0 : a / (b || 0),
    min: Math.min,
    max: Math.max,
    difference: (a, b) => Math.abs(a - b),
    exclusion: (a, b) => a + b - 2 * a * b
  });
})();
