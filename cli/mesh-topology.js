const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const usage = 'Use mesh-topology inspect|triangulate <mesh.json>, edit <mesh.json> <patch.json>, or correspond <before.json> <after.json>';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function command([action, file, input, ...rest], { out, report, projection, lineage, 'match-ids': matchIds }, { KIT: { meshTopology } }) {
  const paired = action === 'edit' || action === 'correspond';
  if (!file || !['inspect', 'triangulate', 'edit', 'correspond'].includes(action) ||
      (paired ? !input : input !== undefined) || rest.length ||
      [out, report, projection, lineage].some(value => value !== undefined && typeof value !== 'string'))
    throw new Error(usage);
  if (report !== undefined && action !== 'edit' ||
      [projection, lineage].some(value => value !== undefined && action !== 'correspond' && !(action === 'edit' && report)))
    throw new Error('Use --report on edit or use correspond for topology mapping');
  if (matchIds !== undefined && (action !== 'correspond' || !['on', 'off'].includes(matchIds)))
    throw new Error('Use --match-ids on|off with correspond');
  const filenames = [file, input, projection, lineage].filter(Boolean).map(value => path.resolve(value));
  if (report && [...filenames, ...(out ? [path.resolve(out)] : [])].includes(path.resolve(report)) ||
      out && action === 'correspond' && filenames.includes(path.resolve(out)))
    throw new Error('Choose a different file for the correspondence report');

  const document = meshTopology.create(read(file));
  let result;
  if (paired) {
    const next = read(input);
    const options = { ...(projection && { projection: read(projection) }), ...(lineage && { lineage: read(lineage) }), ...(matchIds && { matchIds: matchIds === 'on' }) };
    if (action === 'correspond') result = meshTopology.correspond(document, next, options);
    else if (report) {
      const edited = meshTopology.editWithCorrespondence(document, next, options);
      files.json(path.resolve(report), edited.correspondence);
      result = edited.document;
    } else result = meshTopology.edit(document, next);
  } else result = meshTopology[action](document);

  if (out) files.json(path.resolve(out), result);
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { command };
