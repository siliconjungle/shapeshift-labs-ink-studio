const fs = require('node:fs');
const path = require('node:path');
const schema = require('../src/story-document.js');
const { validateStoryDocument, inspectStoryDocument } = schema;
const { analyze } = require('../src/story-analysis.js');
const {collect} = require('../src/story-inventory.js');
const { write } = require('./asset-files.js');
const {formatStoryRoutes} = require('./story-routes.js');
const SimulationFixture = require('./simulation-fixture.js');

function readDefinition(file, check = value => value) {
  try {
    return check(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    error.message = `${file}: ${error.message}`;
    throw error;
  }
}

const readStoryDocument = file => readDefinition(file, validateStoryDocument);

function preflightStoryDocument(document, {story} = {}) {
  const inspected = inspectStoryDocument(document);
  if (inspected.shapeValid && story !== undefined && !Object.hasOwn(document.stories, story))
    throw new TypeError('story preview: unknown story ' + JSON.stringify(story));
  const analyzed = inspected.shapeValid ? analyze(document, {story, preview:true}) : {diagnostics:[], stories:[]};
  return {format:'ink-studio/story-preview', version:1, documentId:typeof document?.id === 'string' ? document.id : null,
    valid:inspected.diagnostics.length === 0, diagnostics:[...inspected.diagnostics,...analyzed.diagnostics], stories:analyzed.stories,
    ...(inspected.shapeValid&&{inventory:collect([document],{schema,story})})};
}

function embedStoryDocuments(world, file, dependency) {
  if (!Array.isArray(world.storyDocuments) && !Array.isArray(world.storyTemplates)) return world;
  const directory = path.dirname(path.resolve(file));
  const documents = Array.isArray(world.storyDocuments) ? world.storyDocuments.map(item => {
    if (!item || !Object.hasOwn(item, 'file')) return item;
    if (Object.keys(item).length !== 1 || typeof item.file !== 'string' || !item.file || path.isAbsolute(item.file))
      throw new TypeError('Story document file reference needs a relative file path');
    const source = path.resolve(directory, item.file);
    dependency?.(source);
    return readStoryDocument(source);
  }) : undefined;
  const cache = new Map();
  const templates = Array.isArray(world.storyTemplates) ? world.storyTemplates.map(item => {
    if (!item || !Object.hasOwn(item, 'file')) return item;
    const {file, ...spec} = item;
    if (Object.hasOwn(spec, 'template') || typeof file !== 'string' || !file.trim() ||
        path.isAbsolute(file) || path.win32.isAbsolute(file))
      throw new TypeError('Story template file reference needs a relative file path');
    const source = path.resolve(directory, file);
    if (!cache.has(source)) {
      dependency?.(source);
      cache.set(source, readDefinition(source));
    }
    return {...spec, template:cache.get(source)};
  }) : undefined;
  return { ...world, ...(documents && {storyDocuments:documents}), ...(templates && {storyTemplates:templates}) };
}

function eventCommand(file, rest, options, library) {
  const {format = 'json', story, out} = options;
  if (!file || rest.length || !['json','markdown','timeline','events','envelopes'].includes(format) ||
    Object.keys(options).some(key=>!['format','story','out'].includes(key)) ||
    story!==undefined&&(typeof story!=='string'||format==='events') || out!==undefined&&typeof out!=='string')
    throw new TypeError('Use story events <recording|fixture> [--story document/story] [--format json|markdown|timeline|events|envelopes] [--out file]');
  const input = readDefinition(file), W = library().KIT.world, api = W.storyEvents;
  const source = input?.format===SimulationFixture.format?SimulationFixture.eventRecording(W,input):input;
  let value;
  if (format==='envelopes') {
    if (story!==undefined&&!(story.split('/').length===2&&story.split('/').every(schema.isStoryId)))
      throw new TypeError('Story event filter needs a document/story ID');
    value=api.envelopes(source,{story,stream:input?.checkpoint?.eventStream});
  } else value = format==='events'?api.read(source):format==='timeline'?api.timeline(source,{story}):api.analyze(source,{story});
  let output;
  if (format==='markdown') {
    const escape = value => value.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]))
      .replace(/[\[\]\\`*_#|]/g,ch=>'\\'+ch);
    const rows = value.timeline.map(({time,label,event})=>
      '| '+time.toFixed(6)+' | '+event.tick+' | '+escape(event.id)+' | '+escape(label)+' |');
    output = ['# Story events for '+escape(value.story??value.source.id),'',
      'Coverage '+value.source.coverage+' · ticks '+value.source.from+'–'+value.source.to+
      ' · '+rows.length+' events · '+value.source.dropped+' dropped upstream','',
      '| Seconds | Tick | Event | Recorded activity |','| --- | --- | --- | --- |',...rows,''].join('\n');
  } else output = JSON.stringify(value,null,2)+'\n';
  if (out!==undefined) {
    if (path.resolve(file)===path.resolve(out)) throw new TypeError('Choose an output different from the event recording');
    write(path.resolve(out),output);
  } else process.stdout.write(output);
}

function cueCommand(file,plan,rest,options,library) {
  const {format='sheet',out}=options;
  if (!file||!plan||rest.length||!['sheet','timeline'].includes(format)||
    Object.keys(options).some(key=>!['format','out'].includes(key))||
    out!==undefined&&(typeof out!=='string'||!out.trim()))
    throw new TypeError('Use story cues <recording|fixture|envelopes> <plan.json> [--format sheet|timeline] [--out file]');
  const input=readDefinition(file), W=library().KIT.world, E=W.storyEvents;
  const source=input?.format===SimulationFixture.format?SimulationFixture.eventRecording(W,input):input;
  const events=source?.format===E.envelopeFormat?source:E.envelopes(source,{stream:input?.checkpoint?.eventStream});
  const sheet=W.presentationCues.project(events,readDefinition(plan));
  const output=JSON.stringify(format==='timeline'?{presentationCues:sheet}:sheet,null,2)+'\n';
  if (out!==undefined) {
    const existing=fs.existsSync(out)?fs.statSync(out):null;
    for (const source of [file,plan]) {
      const stat=existing&&fs.statSync(source);
      if (path.resolve(out)===path.resolve(source)||stat&&stat.dev===existing.dev&&stat.ino===existing.ino)
        throw new TypeError('Choose a cue output different from its input files');
    }
    write(path.resolve(out),output);
  } else process.stdout.write(output);
}

function catalogCommand(files, options, library) {
  const {incident,category,tags,text,out} = options;
  const minimum = options['min-intensity'], maximum = options['max-intensity'];
  const intensity = value=>value===undefined||typeof value==='string'&&/^[0-5]$/.test(value);
  if (!files.length||files.length>32||
      Object.keys(options).some(key=>!['incident','category','tags','text','out','min-intensity','max-intensity'].includes(key))||
      [incident,category,tags,text,out].some(value=>value!==undefined&&typeof value!=='string')||
      !intensity(minimum)||!intensity(maximum))
    throw new TypeError('Use story catalog <story.json> [story.json ...] [--incident document/story] [--category ID] [--tags a,b] [--min-intensity N] [--max-intensity N] [--text text] [--out file]');
  const api = library().KIT.world.incidentCatalog;
  const report = api.find(api.compile(files.map(readStoryDocument)),{incident,category,text,
    ...(tags!==undefined&&{tags:tags.split(',').map(tag=>tag.trim())}),
    ...(minimum!==undefined&&{minIntensity:Number(minimum)}),...(maximum!==undefined&&{maxIntensity:Number(maximum)})});
  const output = JSON.stringify(report,null,2)+'\n';
  if (out!==undefined) {
    if (files.some(file=>path.resolve(file)===path.resolve(out))) throw new TypeError('Choose an output different from the story documents');
    write(path.resolve(out),output);
  } else process.stdout.write(output);
}

const previewUsage = 'story preview <file.json> [story-id] [--format json|text|dot] [--out file] [--strict]';

function previewCommand(file, id, rest, options) {
  const {format='json',out,strict} = options;
  if (!file||rest.length||!['json','text','dot'].includes(format)||
    Object.keys(options).some(key=>!['format','out','strict'].includes(key))||
    (strict!==undefined&&strict!==true)||(out!==undefined&&(typeof out!=='string'||!out.trim())))
    throw new TypeError('Use '+previewUsage);
  if (out!==undefined&&(path.resolve(file)===path.resolve(out)||
    fs.existsSync(file)&&fs.existsSync(out)&&fs.realpathSync(file)===fs.realpathSync(out)))
    throw new TypeError('Choose an output different from the story document');
  const document = readDefinition(file), report = preflightStoryDocument(document,{story:id});
  const output = format==='json'?JSON.stringify(report,null,2)+'\n':formatStoryRoutes(report,document,format);
  if (out!==undefined) write(path.resolve(out),output);
  else process.stdout.write(output);
  if (!report.valid||strict&&report.diagnostics.length) process.exitCode = 1;
}

function storyCommand([mode, file, id, ...rest], options, library) {
  if (mode==='catalog') return catalogCommand([file,id,...rest].filter(value=>value!==undefined),options,library);
  if (mode==='events') return eventCommand(file,[id,...rest].filter(value=>value!==undefined),options,library);
  if (mode==='cues') return cueCommand(file,id,rest,options,library);
  if (mode==='preview') return previewCommand(file,id,rest,options);
  const usage = 'Usage: ink-studio story catalog <story.json> [story.json ...] | story events <recording.json> | story cues <recording> <plan.json> | story validate <file.json> [--strict] | story describe <file.json> [story-id] [--inventory] | '+previewUsage+' | story instantiate <template.json> <instance.json>';
  if (mode === 'instantiate') {
    if (!file || !id || rest.length || Object.keys(options).length) throw new TypeError(usage);
    const materialized = library().KIT.world.storyTemplates.instantiate(readDefinition(file), readDefinition(id));
    console.log(JSON.stringify(materialized, null, 2));
    return;
  }
  if (rest.length || Object.keys(options).some(key => !['strict','inventory'].includes(key)) ||
    (options.strict !== undefined && (options.strict !== true || mode === 'describe')) ||
    (options.inventory !== undefined && (options.inventory !== true || mode !== 'describe'))) throw new TypeError(usage);
  if ((!mode || mode === 'help') && file === undefined) return console.log(usage);
  if (!file || !['validate', 'describe'].includes(mode) || mode === 'validate' && id !== undefined)
    throw new TypeError(usage);
  const document = readStoryDocument(file);
  if (mode==='describe'&&id!==undefined&&!Object.hasOwn(document.stories,id))
    throw new TypeError('story describe: unknown story ' + JSON.stringify(id));
  if (options.inventory) {
    console.log(JSON.stringify({format:'ink-studio/story-inventory',version:1,documentId:document.id,
      ...collect([document],{schema,story:id})},null,2));
    return;
  }
  let output = document;
  if (mode === 'validate') {
    const { format, version, id } = document;
    const stories = Object.entries(document.stories).map(([id, { kind }]) => ({ id, kind }));
    const {diagnostics} = analyze(document);
    output = { format, version, id, valid: true, stories, ...(diagnostics.length && {diagnostics}) };
    if (options.strict && diagnostics.length) process.exitCode = 1;
  } else if (id !== undefined) {
    output = { documentId: document.id, version: document.version, id, definition: document.stories[id],
      references: document.references ?? {},
      ...(document.objectiveTypes !== undefined && { objectiveTypes: document.objectiveTypes }) };
  }
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { validateStoryDocument, preflightStoryDocument, readStoryDocument, embedStoryDocuments, storyCommand };
