const fs = require('node:fs');
const path = require('node:path');
const { validateStoryDocument, inspectStoryDocument } = require('../src/story-document.js');
const { analyze } = require('../src/story-analysis.js');

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
    valid:inspected.diagnostics.length === 0, diagnostics:[...inspected.diagnostics,...analyzed.diagnostics], stories:analyzed.stories};
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

function storyCommand([mode, file, id, ...rest], options, library) {
  const usage = 'Usage: ink-studio story validate <file.json> [--strict] | story describe <file.json> [story-id] | story preview <file.json> [story-id] [--strict] | story instantiate <template.json> <instance.json>';
  if (mode === 'instantiate') {
    if (!file || !id || rest.length || Object.keys(options).length) throw new TypeError(usage);
    const materialized = library().KIT.world.storyTemplates.instantiate(readDefinition(file), readDefinition(id));
    console.log(JSON.stringify(materialized, null, 2));
    return;
  }
  if (rest.length || Object.keys(options).some(key => key !== 'strict') ||
    (options.strict !== undefined && (options.strict !== true || mode === 'describe'))) throw new TypeError(usage);
  if ((!mode || mode === 'help') && file === undefined) return console.log(usage);
  if (!file || !['validate', 'describe', 'preview'].includes(mode) || mode === 'validate' && id !== undefined)
    throw new TypeError(usage);
  if (mode === 'preview') {
    const report = preflightStoryDocument(readDefinition(file), {story:id});
    console.log(JSON.stringify(report,null,2));
    if (!report.valid || options.strict && report.diagnostics.length) process.exitCode = 1;
    return;
  }
  const document = readStoryDocument(file);
  let output = document;
  if (mode === 'validate') {
    const { format, version, id } = document;
    const stories = Object.entries(document.stories).map(([id, { kind }]) => ({ id, kind }));
    const {diagnostics} = analyze(document);
    output = { format, version, id, valid: true, stories, ...(diagnostics.length && {diagnostics}) };
    if (options.strict && diagnostics.length) process.exitCode = 1;
  } else if (id !== undefined) {
    if (!Object.hasOwn(document.stories, id)) throw new TypeError('story describe: unknown story ' + JSON.stringify(id));
    output = { documentId: document.id, version: document.version, id, definition: document.stories[id],
      references: document.references ?? {},
      ...(document.objectiveTypes !== undefined && { objectiveTypes: document.objectiveTypes }) };
  }
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { validateStoryDocument, preflightStoryDocument, readStoryDocument, embedStoryDocuments, storyCommand };
