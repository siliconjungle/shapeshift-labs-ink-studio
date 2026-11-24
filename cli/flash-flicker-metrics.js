// Track short excursions with two opposing transitions at the same picture pixel.
const linear = Float64Array.from({ length: 256 }, (_, n) => {
  const v = n / 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
});

function crossings(size, threshold, maxFrames) {
  const base = new Float32Array(size), extreme = new Float32Array(size);
  const direction = new Int8Array(size), started = new Int32Array(size), peaked = new Int32Array(size);
  return {
    started, peaked,
    sample(i, value, frame) {
      if (frame === 0) {
        base[i] = value;
        return 0;
      }
      let sign = direction[i];
      if (sign && frame - started[i] > maxFrames) {
        base[i] = extreme[i];
        direction[i] = sign = 0;
      }
      if (!sign) {
        const delta = value - base[i];
        if (Math.abs(delta) >= threshold) {
          direction[i] = Math.sign(delta);
          extreme[i] = value;
          started[i] = peaked[i] = frame;
        }
        return 0;
      }
      const change = sign * (value - extreme[i]);
      if (change > 0) {
        extreme[i] = value;
        peaked[i] = frame;
      }
      if (change > -threshold) return 0;
      const amplitude = Math.min(sign * (extreme[i] - base[i]), -change);
      direction[i] = 0;
      base[i] = value;
      return amplitude;
    }
  };
}

function scanner(width, height, fps, settings, captureHeat = false) {
  const size = width * height, span = Math.floor(fps * settings.maxPulseSeconds + 1e-7);
  const luminance = crossings(size, settings.minLumaDelta, span), red = crossings(size, settings.minRedDelta, span);
  const columns = Math.min(12, width), rows = Math.min(8, height);
  const tileAt = new Uint8Array(size);
  for (let p = 0; p < size; p++)
    tileAt[p] = Math.floor((p % width) * columns / width) + Math.floor(Math.floor(p / width) * rows / height) * columns;
  const events = [], byFrame = new Map(), heat = captureHeat ? new Uint16Array(size) : null;

  function sample(rgb, frame) {
    const tiles = new Float64Array(columns * rows), peaks = new Uint32Array(span + 1);
    let pixels = 0, lumaPixels = 0, redPixels = 0, amplitude = 0, energy = 0, from = frame;
    let left = width, top = height, right = 0, bottom = 0;
    for (let p = 0; p < size; p++) {
      const r = linear[rgb[p * 3]], g = linear[rgb[p * 3 + 1]], b = linear[rgb[p * 3 + 2]];
      const l = luminance.sample(p, .2126 * r + .7152 * g + .0722 * b, frame);
      const s = red.sample(p, Math.max(0, r - Math.max(g, b)), frame);
      if (!l && !s) continue;
      const peak = l >= s ? luminance : red;
      const weight = Math.max(l, s);
      pixels++;
      lumaPixels += Number(l > 0);
      redPixels += Number(s > 0);
      if (heat) heat[p]++;
      const x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      from = Math.min(from, peak.started[p]);
      peaks[frame - peak.peaked[p]]++;
      energy += weight / size;
      tiles[tileAt[p]] += weight / size;
      amplitude = Math.max(amplitude, weight);
    }
    if (!pixels) return;

    let peak = frame;
    for (let i = 1; i < peaks.length; i++)
      if (peaks[i] >= peaks[frame - peak]) peak = frame - i;
    const event = { from, peak, frame, area: pixels / size, amplitude, energy,
      lumaArea: lumaPixels / size, redArea: redPixels / size,
      bounds: [left, top, right - left + 1, bottom - top + 1], tiles };
    events.push(event);
    byFrame.set(frame, event);
  }

  function finish() {
    const qualified = events.filter(event => event.area >= settings.minArea);
    const windows = [];
    let left = 0, peakCount = 0, peakEnergy = 0, peakRedArea = 0, sum = 0;
    const within = (a, b) => b - a < fps * settings.windowSeconds - 1e-7;
    for (const [index, event] of qualified.entries()) {
      while (!within(qualified[left].frame, event.frame)) left++;
      const count = index - left + 1;
      peakCount = Math.max(peakCount, count);
      if (count >= settings.minFlashes) {
        const start = qualified[left].from, previous = windows.at(-1);
        if (previous && start <= previous.to) {
          previous.to = event.frame;
          previous.peakCount = Math.max(previous.peakCount, count);
        } else windows.push({ from: start, to: event.frame, peakCount: count });
      }
    }
    left = 0;
    for (const event of events) {
      while (!within(events[left].frame, event.frame)) sum -= events[left++].energy;
      sum += event.energy;
      peakEnergy = Math.max(peakEnergy, sum);
      peakRedArea = Math.max(peakRedArea, event.redArea);
    }
    return { events, byFrame, qualified, heat, summary: {
      pulses: qualified.length, peakCount, peakEnergy, peakRedArea, windows
    } };
  }
  return { sample, finish };
}

function matchingEnergy(event, track) {
  const frames = [-1, 0, 1].map(delta => track.byFrame.get(event.frame + delta)?.tiles).filter(Boolean);
  let sum = 0;
  for (const [i, energy] of event.tiles.entries()) {
    let other = 0;
    for (const row of frames) other = Math.max(other, row[i]);
    sum += Math.min(energy, other);
  }
  return sum;
}

function improves(before, candidate) {
  if (candidate.peakCount > before.peakCount || candidate.peakRedArea > before.peakRedArea + .005 ||
      candidate.windows.some(next => !before.windows.some(old => next.from <= old.to && next.to >= old.from)))
    return false;
  return candidate.peakEnergy < before.peakEnergy * .995 ||
    (candidate.peakCount < before.peakCount && candidate.peakEnergy <= before.peakEnergy + 1e-7);
}

module.exports = { scanner, matchingEnergy, improves };
