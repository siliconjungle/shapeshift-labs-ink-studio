const fs = require('node:fs');
const path = require('node:path');
const { validateStoryDocument } = require('../src/story-document.js');

function readStoryDocument(file) {
  try {
    return validateStoryDocument(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    error.message = `${file}: ${error.message}`;
    throw error;
  }
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
  const usage = 'Usage: ink-studio story validate <file.json> | story describe <file.json> [story-id]';
  if (rest.length || Object.keys(options).length) throw new TypeError(usage);
  if ((!mode || mode === 'help') && file === undefined) return console.log(usage);
  if (!file || !['validate', 'describe'].includes(mode) || mode === 'validate' && id !== undefined)
    throw new TypeError(usage);
  const document = readStoryDocument(file);
  let output = document;
  if (mode === 'validate') {
    const { format, version, id } = document;
    const stories = Object.entries(document.stories).map(([id, { kind }]) => ({ id, kind }));
    output = { format, version, id, valid: true, stories };
  } else if (id !== undefined) {
    if (!Object.hasOwn(document.stories, id)) throw new TypeError('story describe: unknown story ' + JSON.stringify(id));
    output = { documentId: document.id, version: document.version, id, definition: document.stories[id],
      references: document.references ?? {},
      ...(document.objectiveTypes !== undefined && { objectiveTypes: document.objectiveTypes }) };
  }
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { validateStoryDocument, readStoryDocument, embedStoryDocuments, storyCommand };
