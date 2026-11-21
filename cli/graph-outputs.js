const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

function graphOutputs(inputs) {
  const sources = inputs.map(file => fs.statSync(file));
  function protect(stat) {
    if (stat && sources.some(source => source.dev === stat.dev && source.ino === stat.ino))
      throw new Error('Graph outputs must be separate from source files');
  }
  function write(directory, output) {
    const locations = output.map(entry => {
      const file = path.resolve(directory, entry.file);
      protect(fs.statSync(file, { throwIfNoEntry: false }));
      return { file, entry };
    });
    for (const { file, entry } of locations) {
      if (entry.bytes) files.write(file, entry.bytes);
      else files.json(file, entry.document);
    }
  }
  return { protect, write };
}

function save(directory, result, inputs) {
  const artifacts = result.results ? result.results.flatMap(row => [
    ...row.artifacts.map(artifact => ({ ...artifact, file: path.join('cases', row.id, artifact.file) })),
    { file: path.join('cases', row.id, 'report.json'), document: row.report }
  ]) : result.artifacts;
  graphOutputs(inputs).write(directory, [...artifacts, { file: 'report.json', document: result.report }]);
}

module.exports = { graphOutputs, save };
