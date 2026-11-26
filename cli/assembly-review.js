'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { render, cameraCapture } = require('./render.js');
const { pose } = require('./diarama-pose.js');
const files = require('./asset-files.js');
const PNG = require('./png.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = file => typeof file === 'string' && file.endsWith('.json');
const noSelection = () => false;
const outline = [103, 219, 238];
const clamp01 = n => Math.max(0, Math.min(1, n));

function projector(camera) {
  const { view: m, width, height, focal, ortho, clipNear, clipFar } = camera;
  return ([x, y, z]) => {
    const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
    if (depth < clipNear || depth > clipFar) return;
    const scale = ortho ? focal : focal / depth;
    return [Math.round(width * .5 + scale * (m[0] * x + m[4] * y + m[8] * z + m[12])),
      Math.round(height * .5 - scale * (m[1] * x + m[5] * y + m[9] * z + m[13]))];
  };
}

function markers(frame, projection, world, rows) {
  if (!projection) return [];
  const notes = [];
  for (const row of rows) {
    const part = row.part, rig = world.lab?.rig;
    const at = part && rig?.has(part) ? rig.at(part, row.point) : row.point;
    const center = projection(at);
    if (!center) continue;
    const [cx, cy] = center;
    if (cx < 0 || cx >= frame.w || cy < 0 || cy >= frame.h) continue;
    for (let step = -5; step <= 5; step++) for (const [x, y] of [[cx + step, cy], [cx, cy + step]]) {
      if (x < 0 || x >= frame.w || y < 0 || y >= frame.h) continue;
      frame.rgb.set(Math.abs(step) < 2 ? [246, 249, 232] : outline, (y * frame.w + x) * 3);
    }
    notes.push({ key: row.key, at, pixel: center });
  }
  return notes;
}

function renderAssemblyReview(editor, preset, view = {}) {
  const { world, review, time } = editor.buildAssemblyReview(preset, { time: view.t });
  const { report, scoped, visible, reveal, hasReveal, studio } = review;
  const w = view.w ?? 320, h = view.h ?? 240;
  if (![w, h].every(n => Number.isSafeInteger(n) && n >= 16 && n <= 1024))
    throw new RangeError('An assembly review needs image dimensions from 16 to 1024');
  pose(world, time, { kit: require('..').load(), maxSteps: 7200 });

  const selectedLights = report.items.filter(row => row.kind === 'light' && row.revealThrough && Array.isArray(row.point));
  let projection;
  const options = { ...view, w, h, t: time, px: 1, transparent: false,
    renderGrid: false, renderGraph: false, composite: false, inspection: false, shutter: false,
    cameraGuides: false, depthOfField: false,
    ...(scoped || studio ? { reflections: false, reflectionProbes: false, water: false } : {}),
    ...(studio ? { atmosphere: false, liveSun: false, raw: true, bounceProbes: false,
      relighting: false, colorGrade: false, clouds: false } : {})
  };
  const base = render(world, { ...options, ...(selectedLights.length && cameraCapture(null, (camera, sample) => {
    if (camera.width === w && camera.height === h)
      projection = projector({ ...camera, focal: sample.focal });
  })), ...(scoped || hasReveal ? { pixelSelection: { review: {
    matches: hasReveal ? reveal : noSelection, ...(scoped && { allow: visible })
  } } } : {}) });

  let revealedPixels = 0;
  if (hasReveal && report.preset.revealOpacity > 0) {
    const ghost = render(world, { ...options, transparent: true, raw: true,
      atmosphere: false, reflections: false, water: false, reviewEmitters: false,
      pixelSelection: { review: { matches: reveal, allow: reveal } } });
    const a = base.pixelSelection?.coverage, b = ghost.pixelSelection?.coverage;
    if (base.w !== ghost.w || base.h !== ghost.h || !a || !b || a.length !== b.length || a.length !== base.w * base.h)
      throw new Error('Assembly reveal needs matching native coverage grids');
    for (let i = 0; i < b.length; i++) {
      const opacity = clamp01(b[i] - a[i]) * report.preset.revealOpacity;
      if (opacity <= .003) continue;
      revealedPixels++;
      for (let c = 0; c < 3; c++) {
        const target = ghost.rgb[i * 3 + c] * .45 + outline[c] * .55;
        base.rgb[i * 3 + c] = Math.round(base.rgb[i * 3 + c] * (1 - opacity) + target * opacity);
      }
    }
  }
  const locators = markers(base, projection, world, selectedLights);
  return { frame: base, report: { ...report, frame: { w: base.w, h: base.h, time, revealedPixels, locators } } };
}

function command([verb, scene, presetFile, candidate, ...rest], flags, openEditor, view) {
  const renderView = verb === 'render', check = verb === 'check', { out } = flags;
  const options = renderView ? ['out', 'w', 'h', 't', 'yaw', 'pitch', 'target', 'zoom', 'ortho', 'raw'] : [];
  if (!['inspect', 'check', 'render'].includes(verb) || !json(scene) || !json(presetFile) || rest.length ||
      (check ? !json(candidate) : candidate !== undefined) ||
      (renderView && (typeof out !== 'string' || !out.endsWith('.png'))) ||
      Object.keys(flags).some(key => !options.includes(key)))
    throw new TypeError('Use assembly-review inspect|render <scene.json> <review.json> [--out image.png] or check <scene.json> <review.json> <candidate.json>');
  const editor = openEditor(scene), preset = read(presetFile);
  if (verb === 'inspect') return console.log(JSON.stringify(editor.inspectAssemblyReview(preset), null, 2));
  if (check) {
    const report = editor.checkAssemblyReview(read(candidate), preset);
    console.log(JSON.stringify(report, null, 2));
    if (!report.canEdit) process.exitCode = 1;
    return;
  }
  if ([scene, presetFile].some(file => path.resolve(file) === path.resolve(out)))
    throw new RangeError('Write the review image to its own output');
  const { frame, report } = renderAssemblyReview(editor, preset, view());
  files.write(out, PNG.encode(frame.w, frame.h, frame.rgb));
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { command, renderAssemblyReview };
