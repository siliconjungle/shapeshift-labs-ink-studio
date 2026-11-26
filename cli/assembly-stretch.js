'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const jsonFile = value => typeof value === 'string' && value.endsWith('.json');

module.exports = function assemblyStretch([verb, scene, request, ...rest], flags, openEditor) {
  const plan = verb === 'plan', flag = plan ? 'preview' : 'out', output = flags[flag];
  if (!['plan', 'apply'].includes(verb) || !jsonFile(scene) || !jsonFile(request) || rest.length ||
      (!plan || output !== undefined) && !jsonFile(output) || Object.keys(flags).some(key => key !== flag))
    throw new TypeError('Use assembly-stretch plan <scene.json> <stretch.json> [--preview scene.json] or apply <scene.json> <stretch.json> --out scene.json');
  const destination = output === undefined ? undefined : path.resolve(output);
  if (destination && ([scene, request].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene))))
    throw new RangeError('Write the assembly scene beside its source to preserve relative assets');

  const editor = openEditor(scene), input = JSON.parse(fs.readFileSync(request, 'utf8'));
  if (plan) {
    const proposal = editor.planAssemblyStretch(input);
    if (destination) {
      editor.fork(proposal.scene).build();
      files.json(destination, proposal.scene);
    }
    console.log(JSON.stringify(proposal.report, null, 2));
    return;
  }
  let report;
  try {
    report = editor.stretchAssembly(input);
  } catch (error) {
    if (error.report) console.log(JSON.stringify(error.report, null, 2));
    throw error;
  }
  editor.build();
  files.json(destination, editor.snapshot());
  console.log(JSON.stringify(report, null, 2));
};
