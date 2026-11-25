'use strict';

const path = require('node:path');
const files = require('./asset-files.js');
const axes = ['origin','right','up'];
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function coordinates(value, count, flag) {
  const parts = typeof value === 'string' ? value.split(',').map(part=>part.trim()) : [];
  const values = parts.map(Number);
  if (parts.length !== count || !parts.every(part=>number.test(part)) || !values.every(Number.isFinite))
    throw new TypeError(flag+' needs '+count+' comma-separated finite numbers');
  return values;
}

function command(file, extra, options, toolkit, openEditor) {
  const allowed = [...axes,'grid','out'];
  const name = value=>typeof value === 'string' && value.trim();
  const {grid,out} = options;
  if (!name(file) || extra.length || Object.entries(options).some(([key,value])=>!allowed.includes(key) || !name(value)) ||
      grid !== undefined && !number.test(grid))
    throw new TypeError('Use mesh-topology plane <scene.json> [--origin X,Y,Z] [--right X,Y,Z] [--up X,Y,Z] [--grid N] [--out file.json]');
  const input = path.resolve(file), output = out && path.resolve(out);
  if (output && (!/\.json$/i.test(output) || output === input || path.dirname(output) !== path.dirname(input)))
    throw new RangeError('Write a separate scene JSON file beside its source');
  const changes = Object.fromEntries(axes.filter(axis=>options[axis] !== undefined)
    .map(axis=>[axis,coordinates(options[axis],3,'--'+axis)]));
  if (grid !== undefined) changes.grid = Number(grid);
  const editor = openEditor(input), before = editor.constructionPlane();
  const {plane:after,axes:basis} = toolkit.KIT.authoring.constructionPlane.resolve({...before,...changes});
  if (output) {
    editor.setConstructionPlane(changes);
    files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  }
  process.stdout.write(JSON.stringify({format:'ink-studio/construction-plane-edit',version:1,before,after,axes:basis},null,2)+'\n');
}

module.exports = {command,coordinates};
