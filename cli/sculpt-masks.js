'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const R = require('./render.js');

const format = 'ink-studio/sculpt-mask-plan';
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
const record = row => row && Object.getPrototypeOf(row) === Object.prototype;

function run(world, plan, directory, { kit, time = 0, objectId, inputs = [] }) {
  const { sculptMasks, brickMeshes } = kit.KIT.procedural;
  if (!record(plan) || plan.format !== format || plan.version !== 1)
    throw new TypeError('Use a version 1 sculpt mask plan');
  const { w = 128, h = 96, actions = [{ id: 'current', kind: 'capture' }], probes = [] } = plan;
  if (![w, h].every(n => Number.isSafeInteger(n) && n >= 32 && n <= 384) ||
      !Array.isArray(actions) || !actions.length || actions.length > 12 || !Array.isArray(probes) || probes.length > 48)
    throw new TypeError('Use a version 1 sculpt mask plan with a 32–384 pixel grid, up to 12 actions and up to 48 probes');
  const ids = new Set(['comparison']);
  const steps = actions.map(action => {
    if (!record(action) || typeof action.id !== 'string' || !idPattern.test(action.id) || ids.has(action.id.toLowerCase()))
      throw new TypeError('Use unique sculpt action IDs and reserve comparison for the review image');
    ids.add(action.id.toLowerCase());
    if (action.kind === 'capture' || action.kind === 'controls' && record(action.controls)) return action;
    if (action.kind === 'masks' && Object.hasOwn(action, 'document')) return { ...action, document: action.document === null ? null : sculptMasks.prepare(action.document) };
    if (action.kind === 'stroke' && record(action.brush)) {
      const { volume, bounds, material, medium, operation, smooth, masks } = action.brush;
      return { ...action, brush: { bounds, material, medium, operation, smooth, masks,
        sdf: volume === undefined ? undefined : sculptMasks.field(volume) } };
    }
    throw new TypeError('Sculpt actions need a capture, masks document, controls, or stroke brush');
  });
  if (objectId !== undefined && typeof objectId !== 'string') throw new TypeError('Choose a brick mesh by object ID');
  const rows = brickMeshes.frame(world);
  const matches = rows.filter(row => objectId === undefined || row.objectId === objectId);
  const selected = matches.length === 1 && matches[0];
  const controller = selected && world.brickMeshes.find(row => row.current?.() === selected);
  if (!controller) throw new RangeError('Choose one live brick mesh object with --object');
  const files = ['report.json', 'masks.json', 'comparison.png', ...steps.map(({ id }) => id + '.png')];
  for (const input of inputs)
    if (files.some(file => path.resolve(directory, file) === path.resolve(input)))
      throw new RangeError('Write the sculpt mask review separately from its inputs');

  const images = [], frames = [];
  for (const step of steps) {
    if (step.kind === 'masks') controller.setSculptMasks(step.document);
    if (step.kind === 'controls') {
      const document = controller.current().sculpt?.document;
      if (!document) throw new RangeError('Set a sculpt mask document before changing controls');
      controller.setSculptMasks({ ...document, controls: step.controls });
    }
    if (step.kind === 'stroke') controller.edit(step.brush);
    const { revision, sculpt, work, chunks } = controller.current();
    const evidence = probes.map(row => {
      if (!record(row) || typeof row.id !== 'string' || !Array.isArray(row.point) || row.point.length !== 3 ||
          !Array.from(row.point).every(Number.isFinite)) throw new TypeError('A sculpt probe needs an ID and a finite 3D point');
      return { id: row.id, point: row.point, ...(sculpt ? sculpt.sample(row.point, { masks: row.masks }) : { weight: 1, faceSets: [] }) };
    });
    const file = step.id + '.png';
    images.push(R.render(world, { w, h, t: time, px: 1, raw: true }));
    frames.push({ id: step.id, kind: step.kind, file, revision, brickCount: chunks.length, faceSets: sculpt?.faceSets ?? [],
      controls: sculpt?.document.controls ?? null, work, probes: evidence });
  }
  const report = { format: 'ink-studio/sculpt-mask-review', version: 1, object: selected.objectId, time,
    grid: { w, h, pixelSize: 1 }, comparison: 'comparison.png', frames };
  fs.mkdirSync(directory, { recursive: true });
  for (const [i, image] of images.entries())
    PNG.write(path.join(directory, frames[i].file), image.w, image.h, image.rgb, image.alpha);
  const comparison = R.grid(images, Math.min(2, images.length), frames.map((_, i) => String(i + 1).padStart(2, '0')));
  PNG.write(path.join(directory, report.comparison), comparison.w, comparison.h, comparison.rgb, comparison.alpha);
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'masks.json'), JSON.stringify(controller.current().sculpt?.document ?? null, null, 2) + '\n');
  return report;
}

module.exports = { run };
