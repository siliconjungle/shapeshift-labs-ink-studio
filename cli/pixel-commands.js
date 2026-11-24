'use strict';

const path = require('node:path');
const Destinations = require('./pixel-edit-destinations.js');

const format = 'ink-studio/pixel-command';
const edits = Object.freeze(['apply','draw','mask','recolor','transform']);
const travel = Object.freeze(['commit','cancel','undo','redo']);
const paintTools = ['pencil','eraser','fill','shape','brush','rgba','cleanup'];
const canvasTools = ['crop','trim','pad','resize','resample'];
const recolorTools = ['swatch','remap-indices'];
const renderOptions = Object.freeze({
  'shot-corrections':'shotCorrections','splat-fit':'splatFit','scan-paint':'scanPaint'
});
const exportArtifacts = Object.freeze([
  'document','scene','layer-deck','stamp','png','preset',...Object.keys(renderOptions)
]);
const optionFields = {
  inspect:['frame','cel','binding','destinations','references'],
  select:['frame','layer','cel','targetRevision'],
  edit:['shotHitFrame'],
  preview:['limit','exact','shotHitFrame'],
  'revalidate-batch':['limit','exact'],'preview-recipe':['limit','exact'],
  export:{ preset:['preset','out','directory'],png:['frame','cel','layer','colorMode'],
    stamp:['frame','cel','layer','references'],render:['scene'] }
};
const members = {
  validate:[],inspect:['at','options'],select:['query','options'],
  ...Object.fromEntries(edits.map(action=>[action,['patch','options']])),
  preview:['edit','options'],begin:['label'],...Object.fromEntries(travel.map(action=>[action,[]])),
  replay:['receipt'],batch:['revision','label','commands'],'record-batch':[],
  'replay-batch':['batch'],'revalidate-batch':['batch','options'],
  'preview-recipe':['recipe','inputs','options'],'apply-recipe':['plan','approval'],export:['artifact','options']
};
const requiredFields = { inspect:['at'],select:['query'],replay:['receipt'],batch:['revision','commands'],
  'replay-batch':['batch'],'revalidate-batch':['batch'],
  'preview-recipe':['recipe'],'apply-recipe':['plan','approval'],
  ...Object.fromEntries(edits.map(action=>[action,['patch']])) };

function contract() {
  return structuredClone({ format,version:1,members,requiredFields,optionFields,
    edits,travel,paintTools,canvasTools,recolorTools,exportArtifacts,renderArtifacts:Object.keys(renderOptions) });
}

const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;
const text = value=>typeof value === 'string' && !!value.trim();
const fields = (value,allowed)=>record(value) && Object.keys(value).every(key=>allowed.includes(key));
const envelope = (action,details)=>({ ...details,format,version:1,action });

function prepare(command) {
  if (!record(command) || command.format !== format || command.version !== 1 ||
      typeof command.action !== 'string' || !Object.hasOwn(members,command.action) ||
      !fields(command,['format','version','action',...members[command.action]]) ||
      requiredFields[command.action]?.some(key=>!Object.hasOwn(command,key)))
    throw new TypeError('Use a version 1 Ink pixel command with fields for its action');
  return command;
}

function optionsFor(options,keys) {
  if (options !== undefined && !fields(options,keys))
    throw new TypeError('Unknown options for this pixel command');
  return options;
}

function request(design,command) {
  const { action,patch } = command;
  if (!record(patch)) throw new TypeError('A pixel edit command needs a guarded patch object');
  if (action === 'apply') return patch;

  const { operation } = patch;
  let destination = patch.destination;
  if (destination === undefined) {
    if (action === 'mask') destination = 'selections';
    else if (action === 'recolor' && recolorTools.includes(operation?.type)) destination = 'palette';
    else if (action === 'transform' && canvasTools.includes(operation?.type)) destination = 'canvas';
    else destination = 'raster';
  }
  const { kind,channel } = Destinations.resolve(design,destination).destination;
  if (action === 'draw' && (kind === 'surface-channel' || kind === 'raster' &&
      (paintTools.includes(operation?.tool) || operation === undefined && Array.isArray(patch.edits))))
    return { ...patch,destination };
  if (action === 'mask' && (kind === 'selections' || kind === 'surface-channel' && channel.startsWith('mask:')))
    return { ...patch,destination };
  if (action === 'recolor') {
    if (kind === 'palette' && recolorTools.includes(operation?.type) ||
        kind === 'surface-channel' && ['paint','pigment'].includes(channel)) return { ...patch,destination };
    if (kind === 'raster' && record(operation) && [undefined,'replace-swatch'].includes(operation.tool))
      return { ...patch,destination,operation:{ ...operation,tool:'replace-swatch' } };
  }
  if (action === 'transform') {
    if (kind === 'canvas') return { ...patch,destination };
    if (kind === 'raster' && record(operation) && [undefined,'transform','paste'].includes(operation.tool))
      return { ...patch,destination,operation:{ ...operation,tool:operation.tool ?? 'transform' } };
  }
  throw new TypeError('Pixel '+action+' command does not accept this destination or operation');
}

function exportArtifact(editor,artifact,options,context) {
  if (!exportArtifacts.includes(artifact)) throw new TypeError('Unknown pixel export artifact '+artifact);
  if (artifact === 'preset') {
    const {preset,out,directory} = optionsFor(options,optionFields.export.preset) ?? {};
    if (!record(preset) || !text(out) || directory !== undefined && !text(directory))
      throw new TypeError('A preset export needs a preset object, an output directory, and an optional auxiliary base directory');
    const root = context.directory ?? process.cwd();
    return { artifact,data:editor.exportPreset(preset,{ out:path.resolve(root,out),
      directory:path.resolve(root,directory ?? '.'),inputs:context.inputs }) };
  }
  if (artifact === 'png') {
    const settings = optionsFor(options,optionFields.export.png);
    return { artifact,encoding:'base64',data:editor.png(settings).toString('base64') };
  }
  if (artifact === 'stamp') return { artifact,data:editor.stamp(optionsFor(options,optionFields.export.stamp)) };
  let data;
  if (Object.hasOwn(renderOptions,artifact)) {
    const { scene } = optionsFor(options,optionFields.export.render) ?? {};
    data = editor.renderOptions(scene)[renderOptions[artifact]];
  } else {
    optionsFor(options,[]);
    if (artifact === 'document') data = editor.snapshot();
    else if (artifact === 'layer-deck') data = editor.layerDeck();
    else data = editor.sceneEditor?.snapshot();
  }
  if (data === undefined) throw new Error('No session artifact named '+artifact);
  return { artifact,data };
}

function execute(editor,design,raw,context = {}) {
  const command = prepare(raw), {action,options} = command;
  if (edits.includes(action) || action === 'replay') {
    if (action === 'replay') editor.replay(command.receipt,context);
    else editor.apply(request(design,command),{ ...context,...optionsFor(options,optionFields.edit) });
    return editor.receipts().at(-1);
  }
  if (travel.includes(action)) {
    const changed = editor[action]();
    return { changed,history:editor.history() };
  }
  switch (action) {
    case 'batch':
      return editor.applyBatch({revision:command.revision,label:command.label,commands:command.commands},context);
    case 'record-batch':
      return editor.recordBatch(context);
    case 'replay-batch':
      return editor.replayBatch(command.batch,context);
    case 'revalidate-batch':
      return editor.revalidateBatch(command.batch,{...context,...optionsFor(options,optionFields['revalidate-batch'])});
    case 'preview-recipe':
      return editor.previewRecipe(command.recipe,{...context,...optionsFor(options,optionFields['preview-recipe']),inputs:command.inputs});
    case 'apply-recipe':
      return editor.applyRecipe(command.plan,command.approval,context);
    case 'validate':
      return editor.describe();
    case 'inspect':
      return editor.inspect(command.at,{ ...context,...optionsFor(options,optionFields.inspect) });
    case 'select':
      return editor.select(command.query,{ ...context,...optionsFor(options,optionFields.select) });
    case 'preview': {
      const settings = { ...context,...optionsFor(options,optionFields.preview) };
      if (command.edit === undefined) return editor.previewChanges(settings);
      const proposed = prepare(command.edit);
      if (!edits.includes(proposed.action)) throw new TypeError('Preview needs a pixel edit command');
      optionsFor(proposed.options,optionFields.edit);
      return editor.previewEdit(request(design,proposed),settings);
    }
    case 'begin':
      if (command.label !== undefined && !text(command.label)) throw new TypeError('A pixel transaction label needs text');
      editor.begin(command.label);
      return { history:editor.history() };
    case 'export':
      return exportArtifact(editor,command.artifact ?? 'document',options,context);
  }
}

function batchCommand(command) {
  prepare(command);
  if (!edits.includes(command.action)) throw new TypeError('A batch step must be a pixel edit command');
  optionsFor(command.options,optionFields.edit);
  if (!record(command.patch)) throw new TypeError('A batch step needs a pixel edit patch');
  return command;
}

module.exports = { execute,envelope,edits,travel,contract,request,batchCommand };
