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
  if (!Array.isArray(world.storyDocuments)) return world;
  const directory = path.dirname(path.resolve(file));
  const documents = world.storyDocuments.map(item => {
    if (!item || !Object.hasOwn(item, 'file')) return item;
    if (Object.keys(item).length !== 1 || typeof item.file !== 'string' || !item.file || path.isAbsolute(item.file))
      throw new TypeError('Story document file reference needs a relative file path');
    const source = path.resolve(directory, item.file);
    dependency?.(source);
    return readStoryDocument(source);
  });
  return { ...world, storyDocuments: documents };
}

function storyCommand([mode, file, id, ...rest], options) {
  const usage = 'Usage: ink-studio story validate <file.json> [--strict] | story describe <file.json> [story-id] | story preview <file.json> [story-id] [--strict]';
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
