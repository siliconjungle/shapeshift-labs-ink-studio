'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js');
const {canonicalDigest,isRevision} = require('./pixel-edit-revisions.js');

const format = 'ink-studio/tileset-material', receipt = 'ink-studio/tileset-material-edit';
const name = value=>typeof value==='string' && value.trim().length>0;
const read = file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

function preset(value) {
  if (value?.format !== format) return value;
  if (value.version!==1 || !Object.hasOwn(value,'settings') ||
      Object.keys(value).some(key=>!['format','version','settings'].includes(key)))
    throw new TypeError('Expected a version 1 tileset material preset');
  return value.settings;
}

function command([action,file,...rest],options,openEditor,sceneOutput) {
  const {scene,id,out,expect} = options, setting = action==='set';
  if (!['inspect','export','set'].includes(action) || rest.length || ![scene,id].every(name) ||
      Object.keys(options).some(key=>!['scene','id',...(action!=='inspect' ? ['out'] : []),...(setting ? ['expect'] : [])].includes(key)) ||
      !Object.values(options).every(name) || (setting ? !name(file) : file!==undefined) || action==='export' && !name(out))
    throw new TypeError('Use tileset material inspect, export or set with --scene and --id');
  const input = path.resolve(scene), editor = openEditor(input);
  const [sheet] = editor.tilesetDependencies(id).sheets;
  const current = {format,version:1,settings:sheet.material ?? null};
  let report = {...current,tileset:id,source:sheet.material ? 'sheet' : 'legacy',revision:sheet.revision,
    faces:sheet.faces.filter(row=>row.active)};
  if (action==='export') {
    const output=path.resolve(out);
    if (output===input) throw new RangeError('Write the material preset separately from the scene');
    files.publishJson(output,current,'A different material preset exists at '+output);
  }
  if (setting) {
    const output = out && sceneOutput(input,out,file);
    if (output && expect && output===path.resolve(expect)) throw new RangeError('Write the scene separately from the receipt');
    const request = {type:'material',id,settings:preset(read(file))};
    const plan = editor.planTilesetRevision(request);
    report = {...plan,format:receipt,previewRevision:canonicalDigest([editor.snapshot(),editor.sourceDependencies?.(),plan])};
    if (expect) {
      const reviewed = read(expect);
      if (reviewed?.format!==receipt || reviewed.version!==1 || reviewed.canCommit!==true || !isRevision(reviewed.previewRevision))
        throw new TypeError('Expected a successful tileset material preview receipt');
      if (reviewed.previewRevision!==report.previewRevision) throw new RangeError('Tileset material preview is stale');
    }
    if (output && report.canCommit) {
      editor.editTilesetRevision(request);
      files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    }
    if (output && !report.canCommit) process.exitCode = 1;
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command};
