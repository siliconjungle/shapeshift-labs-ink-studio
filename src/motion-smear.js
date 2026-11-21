/* Shared motion-smear settings, raw motion inputs and CPU history transport. */
const MotionSmear = (() => {
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const tuple = values => Array.isArray(values) && values.length === 2 && Array.from(values).every(Number.isFinite);
  const bounded = vector => tuple(vector) && vector.every(n => Math.abs(n) <= 4096);

  function settings({ halfLife = .45, velocity = [0, 0], fieldScale = [1, 1], blockSize = [1, 1] } = {}) {
    if (!Number.isFinite(halfLife) || halfLife <= 0 || halfLife > 60 ||
        !bounded(velocity) || !bounded(fieldScale) || !tuple(blockSize) ||
        !blockSize.every(n => Number.isInteger(n) && n >= 1 && n <= 4096))
      throw new RangeError('Motion smear needs bounded XY velocity, field scale, block size and halfLife');
    return { halfLife, velocity: velocity.slice(), fieldScale: fieldScale.slice(), blockSize: blockSize.slice() };
  }

  function convention({ direction = 'current-minus-previous', units = 'pixels/frame', minConfidence = 0 } = {}) {
    if (!['current-minus-previous', 'backward'].includes(direction) || !['pixels/frame', 'pixels/second'].includes(units) ||
        !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)
      throw new RangeError('Invalid motion direction, units or confidence threshold');
    return { direction, units, minConfidence };
  }

  function plane(source, width, height, channels, min, max, label) {
    const data = source?.data;
    if (source?.width !== width || source.height !== height || (source.channels ?? channels) !== channels ||
        (!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== width * height * channels)
      throw new RangeError(label + ' needs ' + channels + ' aligned channel(s)');
    for (let i = 0; i < data.length; i++) {
      const n = data[i];
      if (!Number.isFinite(n) || n < min || n > max)
        throw new RangeError(label + ' needs finite samples in [' + min + ', ' + max + ']');
    }
    return data;
  }

  function raw(source, { width, height, confidence, valid, minConfidence = 0 }) {
    if (source == null) return null;
    if (width * height > 1048576) throw new RangeError('Raw motion exceeds its pixel budget');
    const vectors = plane(source, width, height, 2, -16384, 16384, 'Raw motion');
    const likelihood = confidence == null ? null : plane(confidence, width, height, 1, 0, 1, 'Motion confidence');
    const validity = valid == null ? null : plane(valid, width, height, 1, 0, 255, 'Motion validity');
    const packed = new Float32Array(width * height * 4);
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      const strength = likelihood?.[p] ?? 1;
      if (strength < minConfidence || validity && validity[p] === 0) continue;
      packed[i] = vectors[p * 2];
      packed[i + 1] = vectors[p * 2 + 1];
      packed[i + 2] = strength;
      packed[i + 3] = 1;
    }
    return packed;
  }

  function address(node, { width: w, height: h, elapsed, field, raw: isRaw, refresh }) {
    const [bx, by] = node.blockSize, [vx, vy] = node.velocity, [sx, sy] = node.fieldScale;
    const sign = node.direction === 'backward' ? -1 : 1;
    const interval = node.units === 'pixels/second' ? elapsed : 1;
    return (x, y, donor) => {
      let dx = vx, dy = vy, strength = 1;
      if (isRaw && !field) return 0;
      if (field) {
        const left = Math.floor(x / bx) * bx, top = Math.floor(y / by) * by;
        const fx = Math.floor(left + Math.min(bx, w - left) * .5);
        const fy = Math.floor(top + Math.min(by, h - top) * .5);
        const p = (fy * w + fx) * 4;
        strength = field[p + 2];
        if (!field[p + 3] || !strength) return 0;
        if (isRaw) {
          dx = vx * elapsed + field[p] * sx * sign * interval;
          dy = vy * elapsed + field[p + 1] * sy * sign * interval;
        } else {
          const straight = 255 / field[p + 3];
          dx += sx * Math.max(-1, (Math.round(field[p] * straight) - 128) / 127);
          dy += sy * Math.max(-1, (Math.round(field[p + 1] * straight) - 128) / 127);
          strength /= 255;
        }
      }
      donor[0] = x - (isRaw ? dx : dx * elapsed);
      donor[1] = y - (isRaw ? dy : dy * elapsed);
      if (!(donor[0] >= 0 && donor[0] < w && donor[1] >= 0 && donor[1] < h)) return 0;
      const clean = refresh?.[Math.floor(y) * w + Math.floor(x)] ?? 0;
      return strength * (1 - clean / 255);
    };
  }

  function write(input, prior, { w, h, width, height, filter, decay, locate }, carry) {
    const result = new Uint8Array(width * height * 4), donor = [0, 0], color = new Float64Array(4);
    const old = { data: prior, w: width, h: height, filter };
    for (let j = 0, q = 0; j < height; j++) for (let i = 0; i < width; i++, q += 4) {
      const x = ((i + .5) * w) / width, y = ((j + .5) * h) / height;
      const from = (Math.floor(y) * w + Math.floor(x)) * 4;
      const amount = decay && locate(x, y, donor) * decay;
      if (carry) carry[q / 4] = amount;
      if (amount) composite.sample(old, donor[0] * width / w, donor[1] * height / h, color);
      // Round toward the clean sample so a fading residual can reach zero.
      for (let c = 0; c < 4; c++) {
        const clean = input[from + c], delta = (color[c] - clean) * amount;
        result[q + c] = clean + Math.sign(delta) * Math.floor(Math.abs(delta) + 1e-5);
      }
    }
    return result;
  }

  return Object.freeze({ settings, convention, raw, plane, address, write });
})();
if (typeof module !== 'undefined') module.exports = MotionSmear;
