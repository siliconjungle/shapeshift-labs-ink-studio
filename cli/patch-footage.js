const number = value => ({ type: 'number', default: value });
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integerInRange = (value, min, max) => Number.isInteger(value) && inRange(value, min, max);
const plane = (width, height, data) => ({ width, height, channels: 1, data });

function estimateOffsets(read, background, framePixel, platePixel, length, maxDrift) {
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(511));
  let count = 0;
  for (let p = 0; p < length; p++) {
    read(p, framePixel);
    background(p, platePixel);
    if (framePixel[3] !== 255 || platePixel[3] !== 255) continue;
    for (let c = 0; c < 3; c++) histograms[c][framePixel[c] - platePixel[c] + 255]++;
    count++;
  }
  return histograms.map(histogram => {
    if (!count) return 0;
    let seen = 0, bin = 0;
    while ((seen += histogram[bin]) <= (count - 1) / 2) bin++;
    return Math.max(-maxDrift, Math.min(maxDrift, bin - 255));
  });
}

function subtractPlate(raster, { source, plate, threshold, maxDrift }) {
  if (!inRange(threshold, 1, 255) || !integerInRange(maxDrift, 0, 64))
    throw new RangeError('Plate threshold must be 1–255 and maxDrift must be an integer from 0–64');
  if (source.width !== plate.width || source.height !== plate.height)
    throw new RangeError('Clean plate and video frame must have matching dimensions; match the plate PNG to --size');
  if (source.colorSpace === 'srgb-linear' || plate.colorSpace === 'srgb-linear')
    throw new TypeError('Clean-plate subtraction needs display RGB; use color.rasterToDisplay first');
  const { width, height, read } = raster.rgbaReader(source), { read: background } = raster.rgbaReader(plate);
  const length = width * height, mask = new Uint8Array(length), difference = new Uint8Array(length);
  const framePixel = new Uint8Array(4), platePixel = new Uint8Array(4);
  const offsets = maxDrift ? estimateOffsets(read, background, framePixel, platePixel, length, maxDrift) : [0, 0, 0];
  for (let p = 0; p < length; p++) {
    read(p, framePixel);
    background(p, platePixel);
    const opaque = framePixel[3] === 255 && platePixel[3] === 255;
    let delta = Math.abs(framePixel[3] - platePixel[3]);
    for (let c = 0; c < 3; c++) {
      const distance = opaque ? Math.abs(framePixel[c] - Math.min(255, Math.max(0, platePixel[c] + offsets[c]))) :
        Math.abs(framePixel[c] * framePixel[3] - platePixel[c] * platePixel[3]) / 255;
      delta = Math.max(delta, distance);
    }
    difference[p] = Math.round(delta);
    mask[p] = difference[p] >= threshold ? 255 : 0;
  }
  return { value: plane(width, height, mask), difference: plane(width, height, difference) };
}

// A sliding window gives square morphology two linear passes, with clipped windows at the frame edge.
function sweepMask(source, result, length, lines, stride, step, radius, erode) {
  for (let line = 0; line < lines; line++) {
    const start = line * step;
    let count = 0;
    for (let i = 0; i < Math.min(length, radius + 1); i++) count += source[start + i * stride] > 0;
    for (let i = 0; i < length; i++) {
      const left = Math.max(0, i - radius), right = Math.min(length - 1, i + radius);
      result[start + i * stride] = (erode ? count === right - left + 1 : count > 0) ? 255 : 0;
      if (i >= radius) count -= source[start + (i - radius) * stride] > 0;
      if (i + radius + 1 < length) count += source[start + (i + radius + 1) * stride] > 0;
    }
  }
}

function cleanMask(P, { source, threshold, open, close, minArea, connectivity }) {
  if (!inRange(threshold, 1, 255) || !integerInRange(open, 0, 32) || !integerInRange(close, 0, 32) ||
      !Number.isSafeInteger(minArea) || minArea < 1 || ![4, 8].includes(connectivity))
    throw new RangeError('Mask cleanup needs threshold 1–255, integer radii 0–32, positive integer minArea and connectivity 4 or 8');
  const { width, height, data } = P.raster.channel(source, { channel: 'luma' });
  const mask = Uint8Array.from(data, sample => sample >= threshold ? 255 : 0);
  const value = plane(width, height, mask);
  if (open || close) {
    const scratch = new Uint8Array(mask.length);
    function morph(radius, erode) {
      sweepMask(mask, scratch, width, height, 1, width, radius, erode);
      sweepMask(scratch, mask, height, width, width, 1, radius, erode);
    }
    if (open) { morph(open, true); morph(open, false); }
    if (close) { morph(close, false); morph(close, true); }
  }
  if (minArea > 1) {
    const { labels } = P.drawing2d.components(value, { minArea, connectivity });
    for (let p = 0; p < mask.length; p++) mask[p] = labels.data[p] ? 255 : 0;
  }
  return { value };
}

const pair = value => Array.isArray(value) && value.length === 2 &&
  Number.isFinite(value[0]) && Number.isFinite(value[1]);

function smoothTracks() {
  let previous = new Map(), last = -Infinity, lastGeneration;
  const run = ({ tracks, halfLife, snapDistance, generation }, { time }) => {
    if (!inRange(halfLife, 0, 10) || !inRange(snapDistance, 0, 16384) || !Number.isSafeInteger(generation))
      throw new RangeError('Track smoothing needs halfLife 0–10 seconds, snapDistance 0–16384 pixels and an integer generation');
    const dt = time - last, sameGeneration = dt > 0 && generation === lastGeneration;
    const weight = halfLife && sameGeneration ? -Math.expm1(-Math.LN2 * dt / halfLife) : 1;
    const blend = (a, b) => a * (1 - weight) + b * weight;
    const next = new Map();
    const value = tracks.map(track => {
      const { id, center, bounds, velocity } = track;
      const { x, y, width, height } = bounds ?? {};
      if (!integerInRange(id, 1, 0xffffffff) || next.has(id) || !pair(center) || !pair(velocity) ||
          ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
        throw new TypeError('Track smoothing needs unique tracker IDs, finite centers and velocities, and positive bounds');
      const prior = sameGeneration ? previous.get(id) : undefined;
      const jump = prior && snapDistance && Math.hypot(center[0] - prior.center[0], center[1] - prior.center[1]) > snapDistance;
      let smoothed = track;
      if (prior && weight < 1 && !jump) {
        smoothed = { ...track,
          center: center.map((value, i) => blend(prior.smoothed.center[i], value)),
          velocity: velocity.map((value, i) => blend(prior.smoothed.velocity[i], value)),
          bounds: { ...bounds, x: blend(prior.smoothed.bounds.x, x), y: blend(prior.smoothed.bounds.y, y),
            width: blend(prior.smoothed.bounds.width, width), height: blend(prior.smoothed.bounds.height, height) }
        };
      }
      next.set(id, { center, smoothed });
      return smoothed;
    });
    previous = next;
    last = time;
    lastGeneration = generation;
    return { value };
  };
  run.clear = () => { previous.clear(); last = -Infinity; lastGeneration = undefined; };
  return run;
}

function trackIds({ labels }) {
  const { width, height, channels = 1, data } = labels;
  if (channels !== 1 || data.length !== width * height || data.length > 2 ** 24)
    throw new TypeError('Track ID preview needs a bounded one-channel label raster');
  const palette = new Map([[0, [0, 0, 0]]]), pixels = new Uint8Array(data.length * 3);
  for (let p = 0; p < data.length; p++) {
    const id = data[p];
    let rgb = palette.get(id);
    if (!rgb) {
      if (!integerInRange(id, 1, 0xffffffff)) throw new RangeError('Track labels must be unsigned 32-bit integers');
      if (palette.size > 128) throw new RangeError('Track ID preview supports up to 128 visible IDs');
      const shades = 192, colors = shades ** 3;
      // Permute sequential IDs across the palette before extracting the RGB digits.
      const color = ((id % colors) * 2654431) % colors;
      rgb = [1, shades, shades ** 2].map(place => 64 + Math.floor(color / place) % shades);
      palette.set(id, rgb);
    }
    pixels.set(rgb, p * 3);
  }
  palette.delete(0);
  const key = [...palette].sort(([a], [b]) => a - b).map(([id, rgb]) => ({ id, rgb }));
  return { value: { width, height, channels: 3, data: pixels }, key };
}

function footageNodes(P) {
  return {
    'patch.cleanPlate': {
      inputs: { source: 'raster', plate: 'raster', threshold: number(30), maxDrift: number(0) },
      outputs: { value: 'raster', difference: 'raster' },
      description: 'Subtract an aligned clean plate. Output a binary foreground mask and a grayscale difference image.',
      run(args) { return subtractPlate(P.raster, args); }
    },
    'patch.cleanMask': {
      inputs: { source: 'raster', threshold: number(128), open: number(0), close: number(1),
        minArea: number(8), connectivity: number(4) },
      outputs: { value: 'raster' },
      description: 'Open and close a thresholded mask with square kernels, then remove small foreground regions.',
      run(args) { return cleanMask(P, args); }
    },
    'patch.smoothTracks': {
      inputs: { tracks: 'array<record>', halfLife: number(.1), snapDistance: number(24), generation: number(0) },
      outputs: { value: 'array<record>' }, time: true,
      description: 'Smooth track centers, bounds and velocities by ID with a half-life in seconds.',
      instantiate: smoothTracks
    },
    'patch.trackIds': {
      inputs: { labels: 'raster' }, outputs: { value: 'raster', key: 'array<record>' },
      description: 'Colorize tracker labels and output a key mapping the colors to numeric track IDs.',
      run: trackIds
    }
  };
}

module.exports = { footageNodes };
