/* Discover typed project references while preserving their original relative paths. */
const path = require('node:path');
const { createHash } = require('node:crypto');
const Shot = require('./shot-recipes.js');
const { validateTake } = require('./take-document.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { isModel, mapModels, requireRevision } = require('./simulation-model-files.js');
const { groupEntries, groupReference, groupDocument, requireGroupReference } = require('./graph-groups.js');
const Experiment = require('./experiment-schema.js');
const Assets = require('./asset-references.js');
const Story = require('../src/story-document.js');

const formats = {
  'ink-studio/take': 'take',
  'ink-studio/world': 'world',
  'ink-studio/simulation-model': 'world',
  'ink-studio/graph-project': 'graph',
  'ink-studio/graph-group': 'group',
  'ink-studio/scene-audio': 'audio',
  'ink-studio/shot-recipe': 'shot',
  'ink-studio/checkpoint-ref': 'checkpoints',
  'ink-studio/checkpoint': 'checkpoints',
  'ink-studio/take-checkpoint': 'checkpoints',
  'ink-studio/raster-checkpoint': 'checkpoints',
  'ink-studio/run': 'checkpoints',
  'ink-studio/asset-pack': 'look',
  'ink-studio/asset-bundle': 'look',
  'ink-studio/input-recording': 'inputs',
  'ink-studio/story-pack': 'story-pack',
  'ink-studio/story-run': 'story-run',
  'ink-studio/story': 'story-definition',
  'ink-studio/story-template': 'story-template',
  'ink-studio/story-events': 'story-events',
  'ink-studio/committed-events': 'story-events',
  'ink-studio/simulation-fixture': 'fixture',
  'ink-studio/project-bundle': 'archive',
  [Experiment.format]: 'experiment'
};
const bytes = record => Buffer.from(record.data, record.encoding);
const digest = record => createHash('sha256').update(bytes(record)).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const values = value => Object.values(value ?? {});

function collectDependencies(bundles, entry, get, attachments = {}) {
  const { resolvePath } = bundles, visited = new Map(), atlasPaths = new Set(), activeGroups = new Set();
  const virtualRoot = path.resolve(path.sep, 'ink-project');
  const activeModels = new Set();
  const requireFile = name => {
    const value = get(name);
    if (!value) throw new Error('Missing project file: ' + name);
    return value;
  };
  const entryDocument = JSON.parse(bytes(requireFile(entry)).toString('utf8'));
  const experiment = entryDocument?.format === Experiment.format;
  let kit;
  const toolkit=()=>kit??=require('../index.js').load().KIT;
  const assetApi=()=>toolkit().authoring.assetReferences;
  const assetIO = { resolvePath, load: file => bytes(requireFile(file)) };
  function select(file, document) {
    return Assets.scope(assetApi(), file, document.assetRegistry, assetIO);
  }
  function visualAssets(file, document, type) {
    const resolve = select(file, document);
    assetApi().visual(document, type, (ref, kind) => Assets.parse(resolve(ref, kind).bytes));
  }

  function directoryAnchor(owner, ref) {
    if (typeof ref !== 'string') throw new TypeError('Expected a project directory path');
    return resolvePath(owner, (ref || '.') + '/.ink-root');
  }

  function datasetFiles(file, data) {
    for (const dataset of values(data)) if (dataset?.file !== undefined)
      requireFile(resolvePath(file, dataset.file));
  }

  function world(file, document) {
    datasetFiles(file, document.dataInputs);
    visualAssets(file, document, 'world');
    for(const item of document.storyDocuments??[]){
      if(item?.file!==undefined)visit(resolvePath(file,item.file),'story-definition');
      if(item?.pack!==undefined){
        const packed=visit(resolvePath(file,item.pack),'archive').archive;
        if(packed?.metadata.kind!=='story-pack'||packed.metadata.revision!==item.revision)
          throw new TypeError('World needs the pinned story pack revision at '+item.pack);
      }
    }
    for(const item of document.storyTemplates??[])if(item?.file!==undefined)
      visit(resolvePath(file,item.file),'story-template');
    activeModels.add(file);
    mapModels(document, ref => {
      const target = resolvePath(file, ref.file);
      if (activeModels.has(target)) throw new Error('Simulation model file cycle at ' + target);
      requireRevision(ref, visit(target, 'world').model, target);
      return ref;
    });
    activeModels.delete(file);
  }

  function storyEntry(file,document,kind) {
    const K=toolkit(), W=K.world;
    K.authoring.storyExchange.validate(document);
    const follow=(ref,type)=>visit(resolvePath(file,ref),type);
    for(const ref of [...values(document.inputs),...values(document.media)])follow(ref);
    if(kind==='story-pack'){
      for(const ref of document.documents??[])follow(ref,'story-definition');
      for(const ref of values(document.templates))follow(ref,'story-template');
      for(const ref of document.assetPacks??[])follow(ref,'look');
      const bind=select(file,document);
      for(const ref of values(document.assets)){
        const selected=bind(ref);
        if(['graph','scene'].includes(selected.entry.kind))visit(selected.filename,selected.entry.kind);
      }
    }else{
      if(document.pack!==undefined)follow(document.pack,'story-pack');
      follow(document.events,'story-events');
      if(document.recording!==undefined){
        const source=follow(document.recording);
        if(source.kind!=='fixture'&&source.recordingFormat!==W.runtime.runFormat)
          throw new TypeError('Story run recording needs a native run or simulation fixture');
      }
    }
  }

  function simulation(file, document) {
    if (document.format === 'ink-studio/world' || isModel(document) ||
        document.format === undefined && record(document.systems)) world(file, document);
    for (const source of Experiment.dependencies(document)) {
      if (typeof source === 'string') visit(resolvePath(file, source));
      else if (Object.hasOwn(source, Experiment.savedFile)) requireFile(resolvePath(file, source[Experiment.savedFile]));
      else simulation(file, source);
    }
  }

  function experimentEntry(file, document) {
    Experiment.validate(document);
    for (const group of values(document.assets))
      for (const ref of values(group)) visit(resolvePath(file, ref));
    for (const [name, run] of Object.entries(document.runs)) {
      const source = visit(resolvePath(file, run.source), undefined, true), expected = Experiment.entries[run.kind];
      if (expected === 'native' ? !Experiment.nativeFormats.has(source.format) : source.format !== expected)
        throw new TypeError('Unexpected experiment source format on ' + name);
      JSON.parse(bytes(requireFile(resolvePath(file, run.expected))).toString('utf8'));
      if (run.checkpoint !== undefined) visit(resolvePath(file, run.checkpoint), 'checkpoints');
      if (run.commands !== undefined)
        JSON.parse(bytes(requireFile(resolvePath(file, run.commands))).toString('utf8'));
    }
  }

  function graphGroups(file, declarations = {}) {
    for (const [name, value] of groupEntries(declarations)) {
      const reference = groupReference(value);
      if (reference) {
        const target = resolvePath(file, reference.file);
        if (activeGroups.has(target)) throw new Error('Graph group file cycle at ' + target);
        const { group } = visit(target, 'group');
        requireGroupReference(reference, group, name + ' (' + target + ')');
      } else if (value?.groups !== undefined) graphGroups(file, value.groups);
    }
  }

  function shot(file, document) {
    const recipe = Shot.validate(document);
    const anchor = directoryAnchor(file, recipe.project);
    const inputs = new Set();
    for (const { file: ref, sha256 } of recipe.inputs) {
      const name = resolvePath(anchor, ref);
      if (/(?:^|\/)ink-studio\.config\.js$/i.test(name))
        throw new TypeError('A portable shot needs declarative project settings: ' + file);
      if (digest(requireFile(name)) !== sha256) throw new Error('Shot input is missing or changed: ' + name);
      inputs.add(name);
      visit(name);
    }
    if (recipe.scene.startsWith('@') && recipe.options['asset-registry']) {
      const registry = resolvePath(anchor, recipe.options['asset-registry']);
      if (!inputs.has(registry)) throw new TypeError('Portable shots need a fingerprint for ' + registry);
      const api = assetApi(), resolved = Assets.open(api, registry, assetIO)
        .resolve(Assets.referenceArgument(api, recipe.scene), 'scene');
      if (!inputs.has(resolved.filename)) throw new TypeError('Portable shots need a fingerprint for ' + resolved.filename);
      visit(resolved.filename, 'scene');
    } else if (!/^[\w.-]+$/.test(recipe.scene) || /\.json$/i.test(recipe.scene)) {
      const target = resolvePath(anchor, recipe.scene);
      if (!/\.json$/i.test(target) && !/\.(?:obj|gltf|glb)$/i.test(target))
        throw new TypeError('A portable shot needs a declarative scene or mesh: ' + target);
      visit(target);
    } else if (/\.(?:js|cjs|mjs)$/i.test(recipe.scene)) {
      throw new TypeError('A portable shot needs a declarative scene: ' + recipe.scene);
    }
    for (const [key, value] of Object.entries(recipe.options)) if (typeof value === 'string') {
      if (key === 'dir' || key === 'asset-cache') {
        directoryAnchor(anchor, value);
      } else if (Shot.fileOption(key) && (/[\\/]/.test(value) || /\.(?:json|png|cube)$/i.test(value))) {
        const file = resolvePath(anchor, value);
        if (key === 'look' && !/\.(?:json|png|cube)$/i.test(value) && !inputs.has(file)) continue;
        if (!inputs.has(file)) throw new TypeError('Portable shots need a fingerprint for ' + file);
        if (key === 'horizon-bands') {
          const horizon = JSON.parse(bytes(requireFile(file)).toString('utf8'));
          for (const band of horizon?.bands ?? []) if (typeof band?.image === 'string')
            requireFile(resolvePath(file, band.image));
        }
      }
    }
  }

  function visit(file, expected, json = false) {
    if (visited.has(file)) {
      const prior = visited.get(file);
      if (expected && expected !== prior.kind) throw new TypeError('Unexpected project dependency type: ' + file);
      return prior;
    }
    const raw = requireFile(file);
    const document = file === entry ? entryDocument :
      /\.json$/i.test(file) || expected || json ? JSON.parse(bytes(raw).toString('utf8')) : undefined;
    const kind = document && Object.hasOwn(formats, document.format) ? formats[document.format] :
      document && document.format === undefined && ['world','scene'].includes(expected) ? expected :
      document && (file === entry || Array.isArray(document.solids) || document.brushRegion || document.prefabLibrary || document.instances)
        ? 'scene' : undefined;
    if (expected && expected !== kind) throw new TypeError('Unexpected project dependency type: ' + file);
    const dependency = {kind,format:document?.format, ...(kind === 'group' && {group:groupDocument(document, bytes(raw), file)}),
      ...(isModel(document) && {model:document})};
    visited.set(file, dependency);
    const follow = (ref, type) => { if (ref !== undefined) visit(resolvePath(file, ref), type); };

    if (kind === 'experiment') {
      if (!experiment || file !== entry) throw new TypeError('A simulation experiment must be the project entry');
      experimentEntry(file, document);
    } else if (kind==='story-pack'||kind==='story-run') {
      storyEntry(file,document,kind);
    } else if (kind==='story-definition') {
      Story.validateStoryDocument(document);
    } else if (kind==='story-events') {
      toolkit().world.storyEvents.envelopes(document);
    } else if (kind==='inputs') {
      toolkit().procedural.mediaGraph.recording(document);
    } else if (kind==='archive'&&document.version===bundles.storyVersion) {
      dependency.archive=bundles.open(document,{digest:data=>createHash('sha256').update(data).digest('hex')});
    } else if (kind==='fixture') {
      const W=toolkit().world;
      require('./simulation-fixture.js').eventRecording(W,document);
      datasetFiles(file,document.checkpoint.world.dataInputs);
    } else if (kind === 'take') {
      validateTake(document);
      const bind = select(file, document);
      follow(document.world, 'world');
      if (assetApi().isRef(document.graph)) visit(bind(document.graph, 'graph').filename, 'graph');
      else follow(document.graph, 'graph');
      follow(document.audio, 'audio');
      follow(document.assetPack, 'look');
      follow(document.checkpoint, 'checkpoints');
      for (const ref of values(document.shots)) follow(ref, 'shot');
    } else if (kind === 'graph') {
      const bind = select(file, document);
      graphGroups(file, document.groups);
      for (const asset of values(document.assets)) {
        const ref = asset?.file, target = assetApi().isRef(ref) ?
          bind(ref, Assets.graphKinds(asset.format)).filename : resolvePath(file, ref);
        if (asset?.format === 'json') visit(target, undefined, true);
        else requireFile(target);
      }
    } else if (kind === 'group') {
      activeGroups.add(file);
      graphGroups(file, dependency.group.definition.groups);
      activeGroups.delete(file);
    } else if (kind === 'audio') {
      const bind = select(file, document);
      follow(document.world, 'world');
      for (const asset of values(document.assets)) {
        if (typeof asset === 'string') requireFile(resolvePath(file, asset));
        else if (assetApi().isRef(asset)) bind(asset, Assets.waveKinds);
        else if (assetApi().isRef(asset?.graph)) visit(bind(asset.graph, 'graph').filename, 'graph');
        else if (record(asset)) follow(asset.graph, 'graph');
      }
    } else if (kind === 'world') {
      world(file, document);
    } else if (kind === 'shot') {
      shot(file, document);
    } else if (kind === 'checkpoints') {
      if (document.format === 'ink-studio/checkpoint-ref') directoryAnchor(file, document.store);
      const data = resolveCheckpoint(path.join(virtualRoot, file), document, {
        readBlock(block) {
          const name = path.relative(virtualRoot, block).split(path.sep).join('/');
          return bytes(requireFile(resolvePath('', name)));
        }
      });
      dependency.recordingFormat=data.format;
      for (const world of [data.world, data.world?.world, data.origin?.world, data.end?.world])
        if (world?.dataInputs) datasetFiles(file, world.dataInputs);
    } else if (kind === 'scene') {
      visualAssets(file, document, 'scene');
      for (const name of bundles.collect(file, get, {}, { validate: file === entry }).atlasPaths) atlasPaths.add(name);
    } else if (kind === undefined) {
      if (experiment && document) simulation(file, document);
      bundles.collectAttachment(file, get);
    }
    return dependency;
  }
  visit(entry);
  for (const file of values(attachments)) visit(file);
  return { atlasPaths };
}

module.exports = { collectDependencies };
