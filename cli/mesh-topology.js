const fs = require('node:fs');
const path = require('node:path');

const usage = 'mesh-topology inspect|triangulate <mesh.json> [--out file.json] or mesh-topology edit <mesh.json> <patch.json> [--out file.json]';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function command([action, file, patch, ...rest], { out }, { KIT: { meshTopology } }) {
  if (!file || !['inspect', 'triangulate', 'edit'].includes(action) ||
      (action === 'edit' ? !patch : patch !== undefined) || rest.length || out !== undefined && typeof out !== 'string')
    throw new Error(usage);
  const document = meshTopology.create(read(file));
  const result = action === 'edit' ? meshTopology.edit(document, read(patch)) : meshTopology[action](document);
  const json = JSON.stringify(result, null, 2) + '\n';
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
  } else process.stdout.write(json);
}

module.exports = { command };
