const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const { toGraphProject } = require('../../cli/material-graph.js');
const { ids } = require('../../materials/recipes/source.cjs');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'studio/out/material-recipe-library');
const at = file => path.join(directory, file);
const recipeFolder = path.resolve(__dirname, '../../materials/recipes');
const registry = path.join(recipeFolder, 'registry.json');
const { items } = Ink.searchMaterialLibrary(registry);
const byId = new Map(items.map(item => [item.id, item]));
const entries = ids.map(id => {
  const item = byId.get(id), document = Ink.readMaterialGraph(item.file);
  const file = path.relative(recipeFolder, item.file), thumbnail = path.relative(recipeFolder, item.thumbnail.file);
  for (const asset of [file, thumbnail]) files.write(at(asset), fs.readFileSync(path.join(recipeFolder, asset)));
  const { inputs, nodes, outputs } = toGraphProject(document);
  return { id, label: item.label, summary: item.description, category: item.tags[0], document,
    project: { inputs, nodes, outputs }, file, thumbnail };
});
for (const file of ['index.html', 'gallery.js']) files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
files.write(at('registry.json'), fs.readFileSync(registry));
files.write(at('catalog.js'), 'const recipeCatalog = ' + JSON.stringify(entries) + '\n');
files.write(at('ink-studio.browser.js'), Ink.bundle());
console.log(at('index.html'));
