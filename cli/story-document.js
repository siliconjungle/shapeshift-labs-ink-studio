const fs = require('node:fs');

const format = 'ink-studio/story';
const version = 1;
const kinds = new Set(['incident', 'questlet', 'arc']);
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,99}$/i.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);

function invalid(at, message) {
  throw new TypeError(`${at}: ${message}`);
}

function record(value, at) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(at, 'expected an object');
}

function fields(value, at, required, optional = []) {
  record(value, at);
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key)) invalid(`${at}.${key}`, 'unknown field');
  for (const key of required)
    if (!Object.hasOwn(value, key)) invalid(`${at}.${key}`, 'required field');
}

function entries(value, at, required = false) {
  record(value, at);
  const rows = Object.entries(value);
  if (required && !rows.length) invalid(at, 'expected at least one entry');
  for (const [key] of rows) if (!safeId(key)) invalid(at, `invalid ID ${JSON.stringify(key)}`);
  return rows;
}

function text(value, at) {
  if (typeof value !== 'string' || !value.trim()) invalid(at, 'expected nonempty text');
}

function link(value, table, at, label) {
  if (!safeId(value) || !Object.hasOwn(table, value)) invalid(at, `unknown ${label} ${JSON.stringify(value)}`);
}

function links(values, table, at, label) {
  if (!Array.isArray(values)) invalid(at, 'expected an array of IDs');
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const item = `${at}[${index}]`;
    link(value, table, item, label);
    if (seen.has(value)) invalid(item, `duplicate ${label} ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function labelsAndRefs(value, at, references) {
  text(value.title, `${at}.title`);
  if (Object.hasOwn(value, 'summary')) text(value.summary, `${at}.summary`);
  if (Object.hasOwn(value, 'refs')) links(value.refs, references, `${at}.refs`, 'reference');
}

function validateStoryDocument(document) {
  fields(document, 'story', ['format', 'version', 'id', 'stories'], ['title', 'references']);
  if (document.format !== format) invalid('story.format', `expected ${format}`);
  if (document.version !== version) invalid('story.version', `unsupported version ${JSON.stringify(document.version)}; expected ${version}`);
  if (!safeId(document.id)) invalid('story.id', 'invalid document ID');
  if (Object.hasOwn(document, 'title')) text(document.title, 'story.title');
  const references = Object.hasOwn(document, 'references') ? document.references : {};
  const { stories } = document;
  for (const [id, reference] of entries(references, 'story.references')) {
    const at = `story.references.${id}`;
    fields(reference, at, ['kind', 'id']);
    if (!safeId(reference.kind)) invalid(`${at}.kind`, 'invalid reference kind');
    if (typeof reference.id !== 'string' || reference.id.length > 512 || !reference.id.split('/').every(safeId))
      invalid(`${at}.id`, 'expected an ID or slash-separated qualified ID');
  }
  for (const [id, story] of entries(stories, 'story.stories', true)) {
    const at = `story.stories.${id}`;
    fields(story, at, ['kind', 'title', 'entry', 'stages', 'outcomes'], ['summary', 'refs', 'roles']);
    if (!kinds.has(story.kind)) invalid(`${at}.kind`, 'expected incident, questlet or arc');
    labelsAndRefs(story, at, references);
    const roles = Object.hasOwn(story, 'roles') ? story.roles : {};
    const { stages, outcomes } = story;
    for (const [name, role] of entries(roles, `${at}.roles`)) {
      const location = `${at}.roles.${name}`;
      fields(role, location, ['kind'], ['ref']);
      if (!safeId(role.kind)) invalid(`${location}.kind`, 'invalid role kind');
      if (Object.hasOwn(role, 'ref')) {
        link(role.ref, references, `${location}.ref`, 'reference');
        if (references[role.ref].kind !== role.kind) invalid(`${location}.ref`, `reference kind must match ${JSON.stringify(role.kind)}`);
      }
    }
    const stageRows = entries(stages, `${at}.stages`, true);
    link(story.entry, stages, `${at}.entry`, 'stage');
    for (const [name, outcome] of entries(outcomes, `${at}.outcomes`, true)) {
      const location = `${at}.outcomes.${name}`;
      fields(outcome, location, ['title'], ['summary', 'refs']);
      labelsAndRefs(outcome, location, references);
    }
    for (const [name, stage] of stageRows) {
      const location = `${at}.stages.${name}`;
      fields(stage, location, ['title', 'next'], ['summary', 'roles', 'refs', 'story']);
      labelsAndRefs(stage, location, references);
      if (Object.hasOwn(stage, 'roles')) links(stage.roles, roles, `${location}.roles`, 'role');
      if (Object.hasOwn(stage, 'story')) link(stage.story, stories, `${location}.story`, 'story');
      for (const [choice, target] of entries(stage.next, `${location}.next`, true)) {
        const edge = `${location}.next.${choice}`;
        fields(target, edge, [], ['stage', 'outcome']);
        if (Object.keys(target).length !== 1) invalid(edge, 'expected exactly one stage or outcome target');
        if (Object.hasOwn(target, 'stage')) link(target.stage, stages, `${edge}.stage`, 'stage');
        else link(target.outcome, outcomes, `${edge}.outcome`, 'outcome');
      }
    }
  }
  return document;
}

function readStoryDocument(file) {
  try {
    return validateStoryDocument(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    error.message = `${file}: ${error.message}`;
    throw error;
  }
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
    link(id, document.stories, 'story describe', 'story');
    output = { documentId: document.id, version: document.version, id, definition: document.stories[id],
      references: document.references ?? {} };
  }
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { validateStoryDocument, readStoryDocument, storyCommand };
