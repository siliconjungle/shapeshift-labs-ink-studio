'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const json = value => typeof value === 'string' && value.endsWith('.json');
const verbs = { plan: [], apply: ['out'], update: ['out'], inspect: [], extract: ['id', 'out'] };
const report = value => console.log(JSON.stringify(value, null, 2));

module.exports = function painting3d([verb, scene, request, ...rest], flags, openEditor) {
  const { id, out } = flags;
  const whole = verb === 'inspect' || verb === 'extract', saveScene = verb === 'apply' || verb === 'update';
  if (!Object.hasOwn(verbs, verb) || !json(scene) || rest.length ||
      (whole ? request !== undefined : !json(request)) || Object.keys(flags).some(key => !verbs[verb].includes(key)) ||
      (saveScene || verb === 'extract') && !json(out) || verb === 'extract' && typeof id !== 'string')
    throw new TypeError('Use painting-3d inspect|extract <scene.json> [--id painting --out painting.json] or plan|apply|update <scene.json> <request.json> [--out scene.json]');

  const destination = out && path.resolve(out), source = path.resolve(scene);
  if (destination === source || saveScene && destination === path.resolve(request))
    throw new RangeError('Write to a different file from the inputs');
  if (saveScene && path.dirname(destination) !== path.dirname(source))
    throw new RangeError('Write the painted scene beside its source to preserve relative assets');

  const editor = openEditor(scene);
  if (verb === 'inspect') return report(editor.inspectPaintings3d());
  if (verb === 'extract') {
    const painting = editor.extractPainting3d(id);
    files.json(destination, painting);
    return report({ id, painting: painting.id, marks: painting.marks.length, out });
  }
  const input = JSON.parse(fs.readFileSync(request, 'utf8'));
  if (verb === 'plan') return report(editor.planPainting3d(input).report);
  const result = editor.applyPainting3d(input, { update: verb === 'update' });
  files.json(destination, editor.snapshot());
  report(result);
};
