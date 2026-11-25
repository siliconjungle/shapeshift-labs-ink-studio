'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {publishJson} = require('./asset-files.js');
const {captureMeshTopologyVisibility,needsParticipation} = require('./mesh-topology-visibility.js');
const read = input=>JSON.parse(fs.readFileSync(input,'utf8'));
const name = value=>typeof value === 'string' && value.trim();

function command([file,...rest], options, openEditor) {
  const {scene,view,visibility,from,out,'topology-out':topologyOut} = options;
  const inputs = [file,scene,view,visibility,from].filter(value=>value !== undefined);
  const output = out ?? topologyOut;
  if (rest.length || ![file,scene,...inputs].every(name) ||
      Object.keys(options).some(key=>!['scene','view','visibility','from','out','topology-out'].includes(key)) ||
      (view !== undefined && visibility !== undefined) || (out !== undefined && topologyOut !== undefined) ||
      output !== undefined && (!name(output) || !/\.json$/i.test(output)))
    throw new TypeError('Use tileset select <query.json> --scene <scene.json> with one view input and one output');
  if (output && inputs.some(input=>path.resolve(input)===path.resolve(output)))
    throw new RangeError('Write the selection separately from its inputs');
  const request = read(file), editor = openEditor(path.resolve(scene));
  if (from) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || !['tiles','edges','vertices'].includes(request.domain) ||
        request.query !== undefined && (!request.query || Object.getPrototypeOf(request.query) !== Object.prototype ||
          Object.hasOwn(request.query,'from')))
      throw new TypeError('Use --from with a tile, edge, or vertex query and one saved selection');
    request.query = {...request.query,from:read(from)};
  }
  if (view && (!name(request?.object) || !['tiles','edges','vertices'].includes(request.domain)))
    throw new TypeError('A selection view needs an editable mesh and a component domain');
  const participation = needsParticipation(request?.query?.filter);
  const evidence = view ? captureMeshTopologyVisibility(editor.build(),request.object,read(view),
    {participation,region:request.query?.region}).visibility :
    visibility && read(visibility);
  const report = editor.selectTilesetComponents(request,{visibility:evidence});
  if (topologyOut && !report.selection) throw new TypeError('--topology-out needs a tile, edge, or vertex selection');
  if (output) publishJson(output,topologyOut ? report.selection : report,'A different selection already exists at '+output);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function atlasCommand([file,...rest], options, openEditor) {
  const {scene,object,part,mode,out} = options;
  if (rest.length || ![file,scene,object].every(name) ||
      Object.entries(options).some(([key,value])=>!['scene','object','part','mode','out'].includes(key) || !name(value)) ||
      out !== undefined && !/\.json$/i.test(out))
    throw new TypeError('Use tileset select-atlas <pick.json> --scene <scene.json> --object <mesh-id>');
  if (out && [scene,file].some(input=>path.resolve(input)===path.resolve(out)))
    throw new RangeError('Write the selection separately from its inputs');
  const report = openEditor(path.resolve(scene)).selectTilesetAtlas({object,part,mode,selection:read(file)});
  if (out) publishJson(out,report.selection,'A different selection already exists at '+out);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command,atlasCommand};
