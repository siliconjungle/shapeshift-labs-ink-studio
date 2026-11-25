const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const source = require('./source.cjs');

function build(directory = __dirname) {
  const entries = source.ids.map(id => {
    const { project, label, summary, category, controls } = source.graph(id);
    const document = {
      ...Ink.openMaterialGraph(project, { id }), label, controls,
      metadata: {
        author: 'Ink Studio', description: summary, tags: [category, 'Recipe', id],
        materialModel: 'pbr.metallic-roughness', visibility: { library: true, publication: 'public' },
        thumbnail: { file: '../previews/' + id + '.png', alt: label + ' material swatch' }
      }
    };
    const { artifacts } = Ink.createGraphProject(document).run();
    const preview = artifacts.find(artifact => artifact.file === 'artifacts/preview.png');
    files.write(path.join(directory, 'previews', id + '.png'), preview.bytes);
    const file = 'graphs/' + id + '.material.json', target = path.join(directory, file);
    Ink.writeMaterialGraph(target, document);
    const sha256 = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    return { asset: 'recipes/' + id, revision: 1, kind: 'graph', file, sha256 };
  });
  const registry = path.join(directory, 'registry.json');
  files.json(registry, { format: 'ink-studio/asset-registry', version: 1, entries });
  return registry;
}

if (require.main === module) console.log(build(process.argv[2] && path.resolve(process.argv[2])));
module.exports = build;
