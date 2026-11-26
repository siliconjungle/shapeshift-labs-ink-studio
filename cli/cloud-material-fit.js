'use strict';

const Color = require('../src/color-space.js');
const Normals = require('./cloud-material-normals.js');
const { dot, cross, clamp, normalize } = Normals;

const toLinear = Color.prepare('srgb', 'srgb-linear'), toDisplay = Color.prepare('srgb-linear', 'srgb');
const sh0 = .28209479177387814;
const ambientPrior = { direction: [0, 1, 0], ambient: 1, key: 0 };
const widths = [.20, .28, .36, .44, .52, .60, .68, .76, .84, .92, 1];
const average = rgb => (rgb[0] + rgb[1] + rgb[2]) / 3;
const exponent = roughness => 2 / Math.max(.18, roughness) ** 2 - 1;
const reflected = (n, l, incidence) => n.map((v, k) => 2 * incidence * v - l[k]);
const vectors = (count, hemisphere) => Array.from({ length: count }, (_, i) => {
  const z = hemisphere ? (i + .5) / count : 2 * (i + .5) / count - 1;
  const theta = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(theta), r * Math.sin(theta), z];
});
const hemisphere = vectors(28, true), directions = vectors(64, false);
function axes(n) {
  const tangent = normalize(cross(Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0], n));
  return [tangent, cross(n, tangent), n];
}

function sample(world, row, normal, basis) {
  const { degree, dc, sh } = world.gaussianHarmonics, offset = row * 3;
  const base = [0, 1, 2].map(i => .5 + sh0 * dc[offset + i]);
  if (!degree) return { base: toLinear(base.map(n => clamp(n))), samples: [] };
  const frame = axes(normal);
  const samples = hemisphere.map(local => {
    const view = normal.map((_, k) => local[0] * frame[0][k] + local[1] * frame[1][k] + local[2] * frame[2][k]);
    const weights = basis(view.map(n => -n), degree), first = offset * weights.length;
    const rgb = toLinear(base.map((n, k) => clamp(weights.reduce((sum, w, i) => sum + w * sh[first + i * 3 + k], n))));
    return { view, rgb, brightness: average(rgb) };
  });
  const dim = samples.slice().sort((a, b) => a.brightness - b.brightness).slice(4, 14);
  return { base: [0, 1, 2].map(c => dim.reduce((sum, row) => sum + row.rgb[c], 0) / dim.length), samples };
}

function squaredGainError(array, s) {
  return array.reduce((sum, row) => sum + row.weight * (row.gain - s) ** 2, 0);
}

function anchored(anchors, direction) {
  let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
  const rows = anchors.map(row => {
    const x = Math.max(0, dot(row.normal, direction)), { gain, weight } = row;
    xx += weight; xy += weight * x; yy += weight * x * x; bx += weight * gain; by += weight * x * gain;
    return { x, gain, weight };
  });
  const determinant = xx * yy - xy * xy;
  const candidates = [[clamp(bx / xx, .025, 4), 0]];
  if (determinant > 1e-8)
    candidates.push([clamp((bx * yy - by * xy) / determinant, .025, 4), clamp((by * xx - bx * xy) / determinant, 0, 4)]);
  for (const ambient of [.025, 4]) candidates.push([ambient, clamp(yy ? (by - ambient * xy) / yy : 0, 0, 4)]);
  candidates.push([clamp((bx - 4 * xy) / xx, .025, 4), 4]);
  return candidates.map(([ambient, key]) => ({ direction, ambient, key, loss: rows.reduce((sum, row) =>
    sum + row.weight * (row.gain - ambient - row.x * key) ** 2, 0) / xx })).reduce((a,b) => a.loss <= b.loss ? a : b);
}

function grouped(groups, direction) {
  const samples = groups.map(rows => rows.map(row => ({ ...row, facing: Math.max(0, dot(row.normal, direction)) })));
  let best;
  for (const ambient of [.18, .26, .34, .43, .52, .62, .72, .82, .92, 1]) {
    const key = 1 - ambient;
    let error = 0, count = 0;
    for (const group of samples) {
      let sum = 0, sum2 = 0, weight = 0;
      for (const { log, weight: w, facing } of group) {
        const t = log - Math.log(ambient + key * facing);
        sum += w * t;
        sum2 += w * t * t;
        weight += w;
      }
      error += Math.max(0, sum2 - sum ** 2 / weight);
      count += weight;
    }
    const loss = error / count + .002 * key ** 2;
    if (!best || loss < best.loss) best = { direction, ambient, key, loss };
  }
  return best;
}

function lightFor(world, normals, settings, basis) {
  if (settings.captureLight) return { ...settings.captureLight, source: 'artist', uncertainty: .04, exposureUncertainty: .04 };
  const anchors = settings.anchors?.map(({ row, pigment }) => {
    const { normal, uncertainty } = normals[row], observed = sample(world, row, normal, basis).base;
    return { normal, gain: dot(observed, pigment) / dot(pigment, pigment), weight: Math.max(.12, 1 - uncertainty) };
  });
  let method, observations, baseline, assess;
  if (anchors) {
    method = 'pigment-anchors';
    observations = anchors.length;
    const weight = anchors.reduce((sum, row) => sum + row.weight, 0);
    const mean = anchors.reduce((sum, row) => sum + row.weight * row.gain, 0) / weight;
    baseline = squaredGainError(anchors, mean) / weight;
    assess = direction => anchored(anchors, direction);
  } else {
    method = 'chromaticity-groups';
    const groups = new Map(), count = Math.min(950, world.count);
    for (let i = 0; i < count; i++) {
      const row = Math.floor((i + .5) * world.count / count), { normal, uncertainty } = normals[row];
      if (uncertainty > .8 || world.data[row * 16 + 3] < .08) continue;
      const rgb = sample(world, row, normal, basis).base, brightness = average(rgb);
      if (brightness < .018 || rgb.some(n => n > .96)) continue;
      const key = rgb.map(n => Math.round(n / (3 * brightness) * 9)).join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ normal, weight: 1 - uncertainty, log: Math.log(brightness) });
    }
    const usable = [...groups.values()].filter(rows => rows.length >= 6);
    observations = usable.reduce((sum, rows) => sum + rows.length, 0);
    if (observations < 12) return { ...ambientPrior, source: 'prior', observations, uncertainty: 1, exposureUncertainty: 1 };
    assess = direction => grouped(usable, direction);
    baseline = usable.reduce((sum, group) => {
      const weight = group.reduce((acc, row) => acc + row.weight, 0);
      const mean = group.reduce((acc, row) => acc + row.log * row.weight, 0) / weight;
      return sum + group.reduce((acc, row) => acc + row.weight * (row.log - mean) ** 2, 0);
    }, 0) / usable.flat().reduce((sum, row) => sum + row.weight, 0);
  }
  const candidates = directions.map(assess).sort((a, b) => a.loss - b.loss);
  let best = candidates[0];
  for (const step of [.22, .10, .044, .020]) {
    const [u, v, n] = axes(best.direction);
    const probes = Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4;
      return assess(normalize(n.map((x, k) => x + step * (u[k] * Math.cos(a) + v[k] * Math.sin(a)))));
    });
    best = [best, ...probes].reduce((a, b) => a.loss <= b.loss ? a : b);
  }
  const alternative = candidates.find(candidate => dot(candidate.direction, best.direction) < .8);
  const improvement = clamp(1 - best.loss / Math.max(baseline, 1e-9));
  const separation = clamp(((alternative?.loss ?? best.loss) - best.loss) / Math.max(baseline * .18, 1e-8));
  const certainty = improvement * (.38 + .62 * separation) * Math.min(1, observations / 16);
  return { ...best, source: method, observations, ambientOnlyLoss: baseline,
    uncertainty: 1 - certainty * (anchors ? .96 : .67), exposureUncertainty: anchors ? clamp(.12 + (1 - certainty) * .65) : 1 };
}

function material(observed, normal, light, fallback) {
  const incidence = Math.max(0, dot(normal.normal, light.direction)), directed = light.key * incidence;
  const gain = light.ambient + directed, { samples } = observed;
  const pigment = diffuse => diffuse.map(n => clamp(n / gain));
  if (!samples.length || directed < .045)
    return { pigment: pigment(observed.base), roughness: fallback, specular: 0, roughnessUncertainty: 1, residual: null,
      roughnessRange: [0, 1], evidence: !samples.length ? 'dc-only' : 'insufficient-key' };
  const axis = reflected(normal.normal, light.direction, incidence);
  const ys = samples.map(row => row.brightness), meanY = averageChannels(ys);
  const mean = [0, 1, 2].map(c => averageChannels(samples.map(s => s.rgb[c])));
  const nullLoss = samples.reduce((sum, row) => sum + row.rgb.reduce((err,n,c) => err + (n - mean[c]) ** 2, 0), 0);
  const candidates = widths.map(roughness => {
    const curve = samples.map(row => Math.max(0, dot(axis, row.view)) ** exponent(roughness));
    const meanX = averageChannels(curve);
    const spread = curve.reduce((sum, n) => sum + (n - meanX) ** 2, 0);
    const covariance = curve.reduce((sum, n, i) => sum + (n - meanX) * (ys[i] - meanY), 0);
    const amp = spread > 1e-8 ? clamp(covariance / spread, 0, directed) : 0;
    const base = mean.map(n => clamp(n - amp * meanX));
    const loss = samples.reduce((sum, row, i) => sum +
      row.rgb.reduce((err, n, c) => err + (n - base[c] - curve[i] * amp) ** 2, 0), 0);
    return { roughness, loss, amp, base, spread };
  }).sort((a,b) => a.loss - b.loss);
  const best = candidates[0], rms = Math.sqrt(best.loss / (3 * samples.length));
  const strength = clamp(best.amp / .09), explained = clamp(1 - best.loss / Math.max(nullLoss, 1e-9));
  const evidence = explained * strength * clamp(4 * Math.sqrt(best.spread / samples.length)) *
    (1 - normal.uncertainty * .8) * (1 - light.uncertainty * .65);
  if (best.amp < .012 || explained < .15)
    return { pigment: pigment(observed.base), roughness: fallback, specular: 0, roughnessUncertainty: 1, residual: rms,
      roughnessRange: [0, 1], evidence: 'unresolved-lobe' };
  const near = candidates.filter(row => row.loss <= best.loss + .12 * nullLoss + 1e-6).map(row => row.roughness);
  const roughnessRange = [Math.min(...near), Math.max(...near)];
  const widthSupport = 1 - .7 * (roughnessRange[1] - roughnessRange[0]);
  return { pigment: pigment(best.base), roughness: best.roughness, specular: best.amp / directed,
    roughnessUncertainty: 1 - evidence * widthSupport, roughnessRange, residual: rms, evidence: 'directional-lobe' };
}

const averageChannels = rows => rows.reduce((sum, n) => sum + n, 0) / rows.length;
const round = n => Math.round(n * 1e6) / 1e6;
function recover(world, settings, basis) {
  const normals = Normals.estimate(world, settings), light = lightFor(world, normals, settings, basis);
  const rows = normals.map((normal, index) => {
    const observed = sample(world, index, normal.normal, basis);
    const fit = material(observed, normal, light, settings.fallbackRoughness);
    const irradiance = light.ambient + light.key * Math.max(0, dot(normal.normal, light.direction));
    const darkness = 1 - clamp(average(observed.base) / .14);
    const uncertainty = { normal: round(normal.uncertainty), roughness: round(fit.roughnessUncertainty),
      pigment: round(clamp(.34 * light.exposureUncertainty + .26 * light.uncertainty + .2 * normal.uncertainty +
        .17 * darkness + 2.5 * (fit.residual ?? 0) + .12 * (fit.pigment.some(n => n >= .999) ? 1 : 0))) };
    return { normal: normal.normal.map(round), pigment: fit.pigment.map(round), roughness: fit.roughness, specular: round(fit.specular),
      uncertainty, roughnessRange: fit.roughnessRange, normalSource: normal.source, neighbors: normal.neighbors,
      ...(normal.limited && { searchLimited: true }), illumination: round(irradiance), evidence: fit.evidence,
      residual: fit.residual === null ? null : round(fit.residual) };
  });
  return { light, rows };
}

function shade(row, view, light) {
  const incidence = Math.max(0, dot(row.normal, light.direction)), key = light.key * incidence;
  const bounce = reflected(row.normal, light.direction, incidence);
  const specular = key * row.specular * Math.max(0, dot(bounce, view)) ** exponent(row.roughness);
  return row.pigment.map(n => clamp(n * (light.ambient + key) + specular));
}
module.exports = { recover, shade, toDisplay, toLinear };
