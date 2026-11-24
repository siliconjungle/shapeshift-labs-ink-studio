'use strict';

const Commands = require('./pixel-commands.js');
const Destinations = require('./pixel-edit-destinations.js');
const Preset = require('../src/pixel-export-preset.js');
const { createDefinitions,ref,constant,choice,either,object,nullable,types,array,num,int,tuple,prop } =
  require('./pixel-command-shapes.js');

const { text,bool,obj,number,natural,positive,unit,id,cel,revision,pixel,size,paintColor,inkSwatch,tangentNormal,emission } = types;
const filename = 'pixel-command-schema.json';
const open = properties=>object(properties,Object.keys(properties),true);
const history = open({ undo:array(text),redo:array(text) });
const code = name=>name.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
const pointer = name=>'#/$defs/'+name;

const evidence = {
  inspect:['inspectResult',{
    '/revision':'Document revision for follow-up edits.',
    '/composite':'Visible layer, cel, blended RGB and alpha at the sampled pixel.',
    '/layers':'Layer contributors, opacity, clipping, and paint decisions.',
    '/materials':'Requested typed source-channel values, UV coordinates and source revisions.',
    '/scene':'Camera, surface hits and binding diagnostics when native scene evidence is available.'
  }],
  select:['selectResult',{
    '/revision':'Revision of the document on which the query ran.',
    '/pixels':'Resolved native coordinates. The pixel count covers the whole mask.',
    '/sources':'Fingerprints of scene or channel inputs when a query uses them.',
    '/targetRevision':'Pass this revision back to recheck the intent or to save its mask.',
    '/intents':'Matched target identities, native runs, representative samples, and omitted evidence counts.'
  }],
  preview:['previewResult',{
    '/valid':'Whether the proposed edit or pending transaction validates.',
    '/pixels':'Before and after values, owners and protection for a bounded sample.',
    '/pixelCount':'Total changed pixels before truncating the sample.',
    '/targets':'Requested destinations, resolved source identities, affected runs or modifier IDs as applicable.',
    '/sources':'Actual scene entities and fields changed in the preview.',
    '/conflicts':'Blocking validation issues, including current and expected revisions when applicable.',
    '/warnings':'Additional review evidence, including an unpinned source revision when applicable.'
  }],
  validate:['validateResult',{
    '/revision':'Revision of the currently validated document.',
    '/grid':'Native canvas width and height in pixels.',
    '/frames':'Stable frame IDs, names and millisecond durations.',
    '/identities':'Layer, swatch and cel IDs.',
    '/destinations':'Declared destination IDs and binding kinds when present.'
  }],
  export:['exportResult',{
    '/artifact':'The selected output kind.',
    '/encoding':'Base64 for PNG bytes.',
    '/data':'Serialized document, scene, paint stamp, or native artifact. For a preset, contains the published manifest, frames and registration.'
  }],
  begin:['beginResult',{ '/history':'Undo and redo labels at the start of the transaction.' }]
};
const editEvidence = ['editReceipt',{
  '/command':'Exact guarded patch and options recorded for replay.',
  '/inputs':'Document revision, and observed source or selection inputs for bound edits.',
  '/affectedTargets':'Stable target IDs and operation-specific evidence such as native runs, texels, brush hits or changed fields.',
  '/skippedHits':'Requested pixels or source hits the edit could not use.',
  '/conflicts':'Blocking validation evidence when rejected.',
  '/outputs':'Resulting artifact and document revisions for an applied edit.'
}];
const travelEvidence = ['historyResult',{
  '/changed':'Whether the operation changed the transaction or history.',
  '/history':'Undo and redo stack labels after the operation.'
}];

const destinationDetails = {
  raster:['rasterOperation','document','Pixel runs, layer, cel, or projection-independent clipboard changes.',
    {tool:'pencil',layer:'ink',swatch:'amber',points:[[1,1],[2,1]]}],
  canvas:['canvasOperation','document','Before and after grids, source registration and affected protected detail.',
    {type:'pad',margins:[1,2,1,2],bindingPolicy:'preserve'}],
  palette:['paletteOperation','document','Swatch and ramp values and optional index or swatch remaps.',
    {type:'swatch',swatch:{id:'amber',color:'#df9645'}}],
  adjustments:['adjustmentsOperation','document','Scoped frames and cels, pixel counts and added swatches.',
    {scope:{layer:'ink',frame:'art'},adjustment:{type:'replace',map:{amber:'rust'}}}],
  'art-rules':['artRulesOperation','document','Previous and proposed authored rule definitions.',
    {artRules:null}],
  protection:['protectionOperation','document','Protected detail ID, kind, frame scope and changed pixels.',
    {type:'set',id:'glint',kind:'accent',frame:'art',pixels:[[2,1]]}],
  timeline:['timelineOperation','document','Affected frames, cels, holds, tags, slices or tile placements.',
    {type:'duration',frame:'art',durationMs:125}],
  layers:['layersOperation','document','Layer stack changes and stable IDs for created or removed cels.',
    {type:'update',layer:'ink',changes:{opacity:.8}}],
  guides:['guidesOperation','document','Added, changed or removed guide IDs.',
    {upsert:[{id:'pivot',kind:'pivot',at:[2,1]}]}],
  selections:['selectionsOperation','document','Saved mask ID, runs, and optional source evidence.',
    {id:'badge',query:{type:'rectangle',rect:[1,1,2,1]}}],
  'shot-correction':['shotCorrectionOperation','shot-corrections','Splat anchor and shot frame scope. Native render hits can be sampled with shotHitFrame.',
    {at:[2,1],fps:12,frames:[0,11],anchor:{splat:'latch-1',offset:[0,0]}}],
  'surface-channel':['surfaceOperation','scene','Object, part, chart, and material channel receiving retained UV paint.',
    {stamp:{brush:{kind:'rect',min:[.25,.25],max:[.5,.5]},value:.4}}],
  'decal-layer':['decalOperation','scene','Decal ID, anchor object or part, and changed scene fields.',
    {type:'move',delta:[.05,0]}],
  'splat-attributes':['splatOperation','splat-fit','Stable splat IDs, fitted row revisions, attribute or footprint changes and topology hits as applicable.',
    {splats:[{splat:'latch-1',pigment:'amber',weight:.8}]}],
  'scan-material':['scanMaterialOperation','scan-paint','Mesh and material IDs, registered texels, changed channels and captured appearance evidence.',
    {texels:[{at:[4,6],roughness:.35}]}],
  'sdf-shape':['sdfShapeOperation','scene','Authored solid or modifier ID, and projected, skipped or protected brush hits when applicable.',
    {brush:{mode:'carve',depth:.1,pixels:[[2,1]]}}],
  'sdf-material':['sdfMaterialOperation','scene','Authored solid, material role and projected surface paint hits when applicable.',
    {material:'stone'}]
};

const document = {
  format:'ink-studio/pixel-art',version:2,width:6,height:4,pixelAspect:[1,1],
  palette:{amber:'#da8c44',rust:'#953c2c'},layers:[{id:'ink'}],
  frames:[{id:'art',durationMs:100,cels:{ink:{marks:[{swatch:'amber',at:[1,1]}]}}}],
  selections:[{id:'badge',frame:'art',pixels:[[1,1]]}]
};

function examples(createEditor) {
  const editor = createEditor(document), { revision } = editor.describe();
  const make = Commands.envelope;
  const edit = (action,operation,scope = {frame:'art'})=>make(action,{patch:{id:'example-'+action,revision,...scope,operation}});
  const shadow = {type:'shadow-cluster',swatches:['amber']};
  const { targetRevision } = editor.select(shadow);
  const draw = edit('draw',{tool:'pencil',layer:'ink',points:[[2,1],[3,1]],swatch:'amber'});
  const begin = make('begin',{label:'Paint the badge'}), undo = make('undo');
  const inputs = {
    validate:[[make('validate')]], inspect:[[make('inspect',{at:[1,1],options:{frame:'art'}})]],
    select:[[make('select',{query:{type:'rectangle',rect:[1,1,2,1]}})],
      [make('select',{query:shadow})],[make('select',{query:shadow,options:{targetRevision}})]],
    apply:[[edit('apply',{type:'duration',frame:'art',durationMs:125},{destination:'timeline'})]],
    draw:[[draw]], mask:[[edit('mask',{id:'trim',query:{type:'grow',source:{type:'recall',id:'badge'}}})],
      [edit('mask',{id:'shadow',query:shadow,targetRevision})]],
    recolor:[[edit('recolor',{layer:'ink',selection:'badge',from:'amber',to:'rust'})],
      [edit('recolor',{type:'swatch',swatch:{id:'amber',color:'#e69143'}},{})]],
    transform:[[edit('transform',{layer:'ink',selection:'badge',transform:{offset:[2,1]},resultSelection:'moved'})],
      [edit('transform',{type:'pad',margins:[1,0,1,0]},{})]],
    preview:[[make('preview',{edit:draw})],[make('preview'),[begin,draw]]],
    begin:[[begin]], commit:[[make('commit'),[begin,draw]]], cancel:[[make('cancel'),[begin,draw]]],
    undo:[[undo,[draw]]],redo:[[make('redo'),[draw,undo]]],
    replay:[[make('replay',{receipt:editor.execute(draw)})]],
    export:[[make('export',{artifact:'document'})],[make('export',{artifact:'png',options:{frame:'art',layer:'ink'}})]]
  };
  return Object.fromEntries(Object.entries(inputs).map(([action,rows])=>[action,rows.map(([command,setup=[]])=>{
    const example = createEditor(document);
    for (const step of setup) example.execute(step);
    return {command,setup,result:JSON.parse(JSON.stringify(example.execute(command)))};
  })]));
}

function patchDefinitions(defs,edits) {
  const changes = array(ref('pixelEdit'),1,4096);
  const base = { id,revision,frame:id,cel,destination:text,sourceRevision:revision,operation:obj,edits:changes };
  // A destination ID can resolve to a document-defined kind. The runtime owns that lookup.
  defs.editPatch = object(base,['id','revision'],true);
  const typed = {
    draw:either(ref('rasterPaintOperation'),ref('surfaceOperation')),
    mask:either(ref('selectionsOperation'),ref('surfaceOperation')),
    recolor:either(ref('swatchReplacement'),ref('paletteRecolor'),ref('surfaceOperation')),
    transform:either(ref('rasterTransform'),ref('canvasOperation'))
  };
  for (const action of edits) if (action !== 'apply') {
    const patch = object({ ...base,operation:typed[action] },['id','revision',...(action==='draw' ? [] : ['operation'])],true);
    if (action === 'draw') patch.oneOf = [prop('operation'),prop('edits')];
    else patch.not = prop('edits');
    defs[action+'Patch'] = patch;
  }
}

function resultDefinitions(artifacts) {
  const conflict = open({code:text,message:text});
  const generic = array(obj);
  const owner = open({layer:nullable(id),cel:nullable(cel),color:nullable(text),alpha:int(0,255)});
  const commonReceipt = {
    format:constant('ink-studio/pixel-edit-receipt'),version:constant(1),
    command:open({runner:choice('sdk','cli'),action:constant('edit'),patch:nullable(obj),options:obj}),
    inputs:object({documentRevision:revision,sourceRevision:revision,sourceContentRevision:revision,
      selectionSources:generic},['documentRevision'],true),affectedTargets:generic,skippedHits:generic
  };
  const applied = open({...commonReceipt,status:constant('applied'),
    outputs:open({kind:text,documentRevision:revision,artifactRevision:revision})});
  return {
    conflict,history,appliedReceipt:applied,
    replayReceipt:{allOf:[ref('appliedReceipt'),{properties:{command:{properties:{runner:constant('sdk')}}}}]},
    editReceipt:either(ref('appliedReceipt'),open({...commonReceipt,status:constant('rejected'),outputs:{type:'null'},conflicts:array(conflict)})),
    inspectResult:object({revision,frame:id,at:pixel,layer:nullable(id),swatch:nullable(id),protected:bool,
      composite:owner,layers:generic,materials:generic,scene:obj,underneath:obj,protection:generic},
    ['revision','frame','at','layer','swatch','protected','composite','layers','materials','underneath','protection'],true),
    selectIntentTarget:object({pixelCount:positive,runCount:positive,runs:array(tuple(natural,natural,positive),1,128),
      sample:object({at:pixel},['at'],true)},['pixelCount','runCount','runs','sample'],true),
    selectIntent:object({type:choice('shadow-cluster','one-pixel-gap','protected-detail','visible-part','occluding-contributor'),
      matchedPixels:natural,targetCount:natural,targets:array(ref('selectIntentTarget'),0,128),
      omittedTargets:natural,unresolvedPixels:natural,truncatedPixels:natural},
    ['type','matchedPixels','targetCount','targets','omittedTargets']),
    selectResult:object({revision,frame:id,grid:size,pixelCount:natural,pixels:array(pixel),sources:generic,
      targetRevision:revision,intents:array(ref('selectIntent'),1,32),verified:constant(true)},
      ['revision','frame','grid','pixelCount','pixels'],true),
    previewResult:object({format:constant('ink-studio/pixel-edit-preview'),version:constant(1),valid:bool,pixelCount:natural,
      pixels:generic,sources:generic,targets:generic,conflicts:array(conflict),sourceRevision:revision,warnings:generic},
    ['format','version','valid','pixelCount','pixels','sources','targets','conflicts'],true),
    validateResult:object({format:constant('ink-studio/pixel-art'),version:constant(2),revision,grid:size,pixelAspect:tuple(positive,positive),
      frames:array(open({id,durationMs:positive}),1),identities:open({layers:generic,swatches:generic,cels:generic}),
      destinations:array(ref('editDestination'))},['format','version','revision','grid','pixelAspect','frames','identities'],true),
    beginResult:open({history}),historyResult:open({changed:bool,history}),
    exportResult:{oneOf:[
      object({artifact:constant('png'),encoding:constant('base64'),data:{type:'string',contentEncoding:'base64',contentMediaType:'image/png'}},
        ['artifact','encoding','data']),
      object({artifact:choice(...artifacts.filter(name=>name!=='png')),data:obj},['artifact','data'])
    ]}
  };
}

function exportRequest(contract) {
  const { optionFields:{export:fields},exportArtifacts,renderArtifacts } = contract;
  const opts = (keys,required = [])=>object(Object.fromEntries(keys.map(key=>[key,properties[key]])),required);
  const properties = { frame:id,layer:id,cel,references:bool,colorMode:choice('auto','indexed','rgba'),preset:ref('exportPreset'),
    out:text,directory:text,scene:text };
  return exportArtifacts.map(artifact=>{
    const keys = fields[artifact] ?? (renderArtifacts.includes(artifact) ? fields.render : []);
    const settings = artifact === 'preset' ? ['preset','out'] : [];
    return { properties:{artifact:constant(artifact),options:opts(keys,settings)},
      required:[...(artifact==='document' ? [] : ['artifact']),...(settings.length ? ['options'] : [])] };
  });
}

function addDestinations(defs) {
  const { declared,builtin } = Destinations.contract(), variants = [];
  const kinds = [...new Set([...Object.keys(builtin),...Object.keys(declared)])];
  const namedEntry = kind=>code(kind)+'Destination';
  for (const [kind,required] of Object.entries(declared)) {
    const schema = object({id,kind:constant(kind),...Object.fromEntries(required.map(key=>[key,key==='binding' ? id : text]))},
      ['id','kind',...required]);
    defs[namedEntry(kind)] = kind === 'raster' ? schema : { ...schema,not:{properties:{id:constant('raster')}} };
    variants.push(ref(namedEntry(kind)));
  }
  defs.editDestination = { oneOf:variants };
  return Object.fromEntries(kinds.map(kind=>{
    const [operation,artifact,description,example] = destinationDetails[kind];
    const bound = Object.hasOwn(declared,kind) && kind !== 'raster';
    defs[operation].examples = [example];
    const required = [...(bound ? ['frame'] : []),...(kind === 'raster' ? [] : ['operation']),
      ...(kind==='shot-correction' ? ['edits'] : [])];
    const patch = code(kind)+'DestinationPatch';
    defs[patch] = { allOf:[ref('editPatch'),{ properties:{operation:ref(operation)},required,
      ...(kind==='raster' && {oneOf:[prop('operation'),prop('edits')]}),
      ...(kind!=='raster' && kind!=='shot-correction' && {not:prop('edits')}) }] };
    const declaredFields = declared[kind];
    return [kind,{
      output:artifact,operation:pointer(operation),...(builtin[kind] && {builtin:builtin[kind]}),
      ...(declaredFields && { declaration:pointer(namedEntry(kind)),requiredDeclaration:['id','kind',...declaredFields],
        exampleDeclaration:{id:kind==='raster' ? 'paint' : kind,kind,...(bound && {binding:'gate'}),
          ...(kind==='surface-channel' && {chart:'front',channel:'roughness'}),
          ...(kind==='decal-layer' && {decal:'sign'}),
          ...(kind==='scan-material' && {mesh:'door',material:'metal'})} }),
      patch:pointer(patch),requiredPatch:['id','revision',...required],
      ...(kind==='raster' && { choosePatchField:['operation','edits'],pixelEdits:pointer('pixelEdit') }),
      ...(bound && { identityInputs:['sceneBindings','scene','object'],
        sourceGuard:{ field:'sourceRevision',required:false,recommended:true,source:'pixel-art targets' } }),
      scope:bound ? 'Bound frame and scene. Use targets to pin sourceRevision before editing.' :
        kind==='raster' ? 'Frame or cel scope, or an unscoped legacy drawing.' :
        kind==='selections' ? 'Frame. Optionally select from a layer, cel or bound source.' : 'Document or operation-defined frame scope.',
      evidence:{'/affectedTargets':description,...(bound && {'/inputs/sourceRevision':'Observed source fingerprint for the same destination and binding.'})}
    }];
  }));
}

function channelReference(surfaceDefinitions) {
  const channel = (units,value,description,extra)=>({ units,value,description,...extra });
  const choices = { indexed:[ref('indexedPigment'),'swatch-id or exact RGB8','Retains the swatch identity and its exact color.'],
    color:[ref('paintColor'),'RGB8 or normalized RGB','Use #rrggbb, packed RGB8, or a normalized RGB triple.'],
    emission:[ref('emission'),'linear relative intensity','Three nonnegative linear RGB intensity components.'],
    normal:[ref('tangentNormal'),'unitless tangent-space XYZ','Nonzero vector with nonnegative Z. Ink normalizes the vector.'] };
  const surface = Object.fromEntries(Object.entries(surfaceDefinitions).map(([name,definition])=>{
    const typed = choices[definition.type];
    const units = typed?.[1] ?? definition.units ?? 'dimensionless';
    const value = typed?.[0] ?? num(definition.min,definition.max);
    const description = typed?.[2] ?? 'Scalar in the authored channel range.';
    const modes = definition.type==='number' && !definition.material ? ['set','add','clear'] : ['set','clear'];
    const key = name==='mask:example' ? 'mask:<id>' : name;
    return [key,channel(units,value,description,{ definition,modes,
      ...(modes.includes('add') && { addValue:num(-1e9,1e9) }),
      ...(key==='mask:<id>' && { namePattern:'^mask:[a-z][a-z0-9_-]{0,47}$',requires:'Declare the mask on the solid.' }) })];
  }));
  return {
    surface, sourceCoordinates:{
      pixel:channel('native pixel',pixel,'Top-left document grid before source mapping.'),
      uv:channel('normalized lower-left chart UV',tuple(unit,unit),'Rest chart coordinates.'),
      texel:channel('material texel',tuple(natural,natural),'Atlas coordinate in the registered scan material grid.'),
      scene:channel('scene unit',tuple(number,number,number),'Position in the addressed world or part space.'),
      frame:channel('frame index',natural,'Zero-based where an index is requested instead of an ID.'),
      frameDuration:channel('ms',positive,'Cel exposure duration.'),
      time:channel('s',number,'Scene pose or shot clock time.'),
      fps:channel('frames/s',num(0,240),'Native shot correction sample rate.'),
      rotation:channel('deg',number,'Clockwise art-grid rotation.')
    },
    splat:{
      pigment:channel('swatch-id or exact RGB8',nullable(inkSwatch),'Null clears the fitted pigment override.'),
      roughness:channel('dimensionless',nullable(unit),'Null clears the fitted roughness override.'),
      emission:channel('linear relative intensity',nullable(emission),'Null clears the fitted emission override.'),
      coverage:channel('dimensionless',unit,'Fractional visibility.'),
      opacity:channel('dimensionless',unit,'Fractional source opacity.'),
      weight:channel('dimensionless',unit,'Pigment and material brush influence.'),
      material:channel('material profile ID',nullable(text),'Null clears the fitted material override.'),
      footprintScale:channel('ratio',num(.4,2),'Multiplier on the source footprint.'),
      position:channel('scene unit',tuple(num(-1e6,1e6),num(-1e6,1e6),num(-1e6,1e6)),'Absolute rest-space center.'),
      scale:channel('ratio',either(num(.01,100),tuple(num(.01,100),num(.01,100),num(.01,100))),'Scalar or per-axis ellipse scale.'),
      orientation:channel('unitless quaternion',tuple(number,number,number,number),'Quaternion components [x,y,z,w]. Ink normalizes them.')
    },
    scan:{ pigment:surface.pigment,roughness:surface.roughness,normal:surface.normal,
      clear:channel('null',{type:'null'},'Remove a texel override for a supplied channel.') },
    sdf:{ depth:channel('scene unit',num(.005,20),'Retained grid brush depth.'),
      thickness:channel('scene unit',num(.001,2),'Optional contact thickness for material paint.'),
      masks:channel('dimensionless',unit,'Scalar per named SDF mask.') }
  };
}

function buildSchema({ createEditor,surfaceDefinitions }) {
  const contract = Commands.contract(), { format,version,members,requiredFields,optionFields,edits,travel,exportArtifacts } = contract;
  const defs = { ...createDefinitions(),...resultDefinitions(exportArtifacts) };
  defs.indexedPigment = inkSwatch;
  defs.paintColor = paintColor;
  defs.emission = emission;
  defs.tangentNormal = tangentNormal;
  defs.exportPreset = object({format:constant(Preset.format),version:constant(1),id,
    outputs:{...array(choice(...Preset.outputs),1,Preset.outputs.length),uniqueItems:true},colorMode:choice('auto','indexed','rgba'),
    frames:{...array(id,1,1024),uniqueItems:true},tag:id,slice:id,pivot:either(id,tuple(number,number)),unitsPerPixel:{exclusiveMinimum:0,type:'number'},
    atlas:object({maxWidth:int(1,8192),maxHeight:int(1,8192),padding:int(0,128),extrude:int(0,128),trim:bool}),auxiliary:obj},
  ['format','version','id','outputs']);
  defs.exportPreset.not = { required:['frames','tag'] };
  patchDefinitions(defs,edits);
  const editDestinations = addDestinations(defs);
  const samples = examples(createEditor), byAction = {};
  const fields = { at:pixel,query:ref('selectionQuery'),label:text,receipt:ref('replayReceipt'),
    edit:{oneOf:edits.map(action=>ref(action+'Command'))},artifact:choice(...exportArtifacts) };
  const optionTypes = {frame:id,cel,layer:id,binding:id,destinations:{...array(text),uniqueItems:true},references:bool,
    limit:natural,shotHitFrame:int(0,1e9),targetRevision:revision};
  for (const action of Object.keys(members)) {
    const schemaName = action+'Command';
    const keys = optionFields[action] ?? (edits.includes(action) ? optionFields.edit : []);
    const properties = Object.fromEntries(members[action].map(key=>[key,
      key==='options' ? object(Object.fromEntries((Array.isArray(keys) ? keys : []).map(name=>[name,optionTypes[name]]))) :
        key==='patch' ? ref(action==='apply' ? 'editPatch' : action+'Patch') : fields[key]]));
    if (action==='export') properties.options = obj;
    defs[schemaName] = {
      ...object({format:constant(format),version:constant(version),action:constant(action),...properties},
        ['format','version','action',...(requiredFields[action] ?? [])]),
      ...(action==='export' && { oneOf:exportRequest(contract) }),
      examples:samples[action].map(row=>row.command)
    };
    const [result,resultEvidence] = evidence[action] ?? (travel.includes(action) ? travelEvidence : editEvidence);
    byAction[action] = {request:pointer(schemaName),result:pointer(result),required:requiredFields[action] ?? [],
      evidence:resultEvidence,examples:samples[action]};
  }
  const schema = {
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:'https://raw.githubusercontent.com/siliconjungle/shapeshift-labs-ink-studio/main/docs/reference/'+filename,
    title:'Ink Studio pixel command',
    description:'Version 1 requests for pixel-art session run and editor.execute(). Generated by npm run docs:build.',
    oneOf:Object.keys(members).map(action=>ref(action+'Command')),
    $defs:defs,
    'x-ink':{
      format:'ink-studio/pixel-command-reference',version,
      cli:'ink-studio pixel-art session run <directory> <command.json>',sdk:'editor.execute(command, context)',
      commands:byAction,editDestinations,sceneBinding:pointer('sceneBinding'),
      channels:channelReference(surfaceDefinitions),exampleDocument:document,
      exportArtifacts:Object.fromEntries(exportArtifacts.map(artifact=>[artifact,{
        ...(artifact==='scene' && {requires:'An attached scene editor.'}),
        ...(contract.renderArtifacts.includes(artifact) && {requires:'A retained artifact from a prior source edit.'}),
        ...(artifact==='preset' && {requires:'A preset and output directory. Auxiliary maps need resolved files.'}),
        ...(artifact==='png' && {encoding:'base64'})
      }])),
      validation:{
        static:'Validate the command against this schema. For a custom destination, resolve its kind from the live document and validate its operation using that destination’s reference.',
        runtime:'The Ink editor checks live IDs, bounds, palette, source capabilities, locks, revisions and evidence. Source adapters are CLI flags or SDK context, outside the command JSON.',
        cliConflictStatus:2,
        examples:'Open a fresh editor for exampleDocument for each example, execute setup commands in order, then execute command.'
      }
    }
  };
  return JSON.parse(JSON.stringify(schema));
}

module.exports = { filename,buildSchema };
