const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');

module.exports = function paletteFitCLI(files, { format = 'png', out, tile }, { KIT: K }, outputFile) {
  if (files.length !== 1 || !['png', 'data'].includes(format) ||
      out !== undefined && typeof out !== 'string' || tile !== undefined && (tile !== true || format !== 'png'))
    throw new TypeError('Use palette fit <fit.json> [--format png|data] [--tile] [--out file]');
  const source = JSON.parse(fs.readFileSync(path.resolve(files[0]), 'utf8'));
  if (!source || Object.getPrototypeOf(source) !== Object.prototype)
    throw new TypeError('A dither fit file needs a JSON object');
  const { context, ...definition } = source;
  const result = K.palette.fitDither(definition, context);
  if (format === 'data') {
    const json = JSON.stringify({ ...result.report, raster: result.indexed() }) + '\n';
    if (!out) return process.stdout.write(json);
    const file = outputFile('dither-fit.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
    return;
  }
  const raster = tile ? result.indexed() : result.preview();
  const file = outputFile(tile ? 'dither-tile.png' : 'dither-fit.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  PNG.writeIndexed(file, raster.width, raster.height, raster.slots,
    raster.palette.map(swatch => [1, 3, 5].map(i => parseInt(swatch.slice(i, i + 2), 16))));
  console.log('wrote', file, raster.width + 'x' + raster.height);
};
