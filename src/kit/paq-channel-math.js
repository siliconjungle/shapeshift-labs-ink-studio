/* Numeric operators shared by legacy rasters and typed channels. */
const RasterChannelMath = Object.freeze({
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b,
    min: Math.min,
    max: Math.max,
    difference: (a, b) => Math.abs(a - b),
    power: (a, b) => a ** b,
    greater: (a, b) => +(a > b),
    less: (a, b) => +(a < b),
    equal: (a, b) => +(a === b)
  });
