'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {publishJson} = require('./asset-files.js');
const {captureMeshTopologyVisibility,needsParticipation} = require('./mesh-topology-visibility.js');

function command([file,...rest], options, openEditor) {
  const {scene,view,visibility,out,'topology-out':topologyOut} = options;
  const inputs = [file,scene,view,visibility].filter(value=>value !== undefined);
  const output = out ?? topologyOut;
  const name = value=>typeof value === 'string' && value.trim();
  if (rest.length || ![file,scene,...inputs].every(name) ||
      Object.keys(options).some(key=>!['scene','view','visibility','out','topology-out'].includes(key)) ||
      (view !== undefined && visibility !== undefined) || (out !== undefined && topologyOut !== undefined) ||
      output !== undefined && (!name(output) || !/\.json$/i.test(output)))
    throw new TypeError('Use tileset select <query.json> --scene <scene.json> with one view input and one output');
  if (output && inputs.some(input=>path.resolve(input)===path.resolve(output)))
    throw new RangeError('Write the selection separately from its inputs');
  const read = input=>JSON.parse(fs.readFileSync(input,'utf8'));
  const request = read(file), editor = openEditor(path.resolve(scene));
  if (view && (!name(request?.object) || !['tiles','edges','vertices'].includes(request.domain)))
    throw new TypeError('A selection view needs an editable mesh and a component domain');
  const participation = needsParticipation(request?.query?.filter);
  const evidence = view ? captureMeshTopologyVisibility(editor.build(),request.object,read(view),{participation}).visibility :
    visibility && read(visibility);
  const report = editor.selectTilesetComponents(request,{visibility:evidence});
  if (topologyOut && !report.selection) throw new TypeError('--topology-out needs a tile, edge, or vertex selection');
  if (output) publishJson(output,topologyOut ? report.selection : report,'A different selection already exists at '+output);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command};
