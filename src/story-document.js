/* Portable story definition validation shared by the CLI and world runtime. */
const StoryDocument = (() => {
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

  function condition(rule, at, depth = 0) {
    record(rule, at);
    if (depth >= 16) invalid(at, 'condition nesting exceeds 16 levels');
    const logical = ['all', 'any', 'not'].find(key => Object.hasOwn(rule, key));
    if (logical) {
      fields(rule, at, [logical]);
      const next = `${at}.${logical}`, value = rule[logical];
      if (logical === 'not') return condition(value, next, depth + 1);
      if (!Array.isArray(value) || !value.length || value.length > 128) invalid(next, 'expected 1–128 conditions');
      for (let i = 0; i < value.length; i++) condition(value[i], `${next}[${i}]`, depth + 1);
      return;
    }
    fields(rule, at, [], ['path', 'op', 'value']);
    const { path, op = 'eq', value } = rule;
    const safeKey = key => typeof key === 'string' && key.length > 0 && !['constructor', 'prototype', '__proto__'].includes(key);
    if (Object.hasOwn(rule, 'path')) {
      const parts = typeof path === 'string' && path.startsWith('/') && !/~(?![01])/u.test(path) ?
        path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')) : path;
      if (!Array.isArray(parts) || !parts.length || parts.length > 64 || Array.from(parts).some(key =>
        !(safeKey(key) || Number.isSafeInteger(key) && key >= 0))) invalid(`${at}.path`, 'expected a valid path array or JSON Pointer');
    }
    if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'exists'].includes(op)) invalid(`${at}.op`, 'unknown condition operator');
    if (op === 'exists') {
      if (Object.hasOwn(rule, 'value')) invalid(`${at}.value`, 'exists takes no value');
    } else if (value === undefined || ['lt', 'lte', 'gt', 'gte'].includes(op) && !Number.isFinite(value) ||
      op === 'in' && !Array.isArray(value)) invalid(`${at}.value`, 'expected a value for ' + op);
  }

  function triggers(story, at) {
    const table = `${at}.triggers`;
    const worldName = value => safeId(value) && value.length <= 96;
    for (const [name, rule] of entries(story.triggers, table, true)) {
      const location = `${table}.${name}`;
      record(rule, location);
      if (Object.hasOwn(rule, 'event')) {
        fields(rule, location, ['event'], ['count', 'within']);
        const event = `${location}.event`;
        fields(rule.event, event, ['kind'], ['system', 'where']);
        const { kind, system, where } = rule.event;
        if (!worldName(kind) || ['story-started', 'event-action-scheduled'].includes(kind))
          invalid(`${event}.kind`, 'expected a source event kind');
        if (Object.hasOwn(rule.event, 'system') && !worldName(system)) invalid(`${event}.system`, 'invalid system ID');
        if (Object.hasOwn(rule.event, 'where')) condition(where, `${event}.where`);
        const { count = 1, within } = rule;
        if (!Number.isInteger(count) || count < 1 || count > 128) invalid(`${location}.count`, 'expected an integer from 1 to 128');
        if (count > 1 && !(Number.isFinite(within) && within > 0) || count === 1 && Object.hasOwn(rule, 'within'))
          invalid(`${location}.within`, 'supply a positive window in seconds for counts greater than one');
      } else {
        fields(rule, location, ['state'], ['hold']);
        const state = `${location}.state`;
        fields(rule.state, state, ['field', 'when'], ['at', 'args']);
        const { field, when, args, at } = rule.state;
        if (typeof field !== 'string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(field) || field === 'world/story-triggers')
          invalid(`${state}.field`, 'expected a qualified world query field');
        if (Object.hasOwn(rule.state, 'args')) record(args, `${state}.args`);
        if (Object.hasOwn(rule.state, 'at')) {
          const point = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
          if (!point(at)) {
            if (at && Object.hasOwn(at, 'point')) {
              fields(at, `${state}.at`, ['point']);
              if (!point(at.point)) invalid(`${state}.at.point`, 'expected a finite XYZ point');
            } else {
              fields(at, `${state}.at`, ['entity'], ['socket']);
              if (!worldName(at.entity) || Object.hasOwn(at, 'socket') && !worldName(at.socket))
                invalid(`${state}.at`, 'invalid entity or socket ID');
            }
          }
        }
        condition(when, `${state}.when`);
        if (Object.hasOwn(rule, 'hold') && !(Number.isFinite(rule.hold) && rule.hold > 0))
          invalid(`${location}.hold`, 'expected a positive duration in seconds');
      }
    }
  }

  function lifecycle(value, at) {
    fields(value, at, [], ['activation', 'offerFor', 'progression']);
    if (Object.hasOwn(value, 'activation') && !['automatic', 'manual'].includes(value.activation))
      invalid(`${at}.activation`, 'expected automatic or manual');
    if (Object.hasOwn(value, 'offerFor') &&
      (value.activation !== 'manual' || !Number.isFinite(value.offerFor) || value.offerFor <= 0))
      invalid(`${at}.offerFor`, 'expected a positive offer duration in seconds for manual activation');
    if (Object.hasOwn(value, 'progression') && typeof value.progression !== 'boolean')
      invalid(`${at}.progression`, 'expected a boolean');
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
      fields(story, at, ['kind', 'title', 'entry', 'stages', 'outcomes'], ['summary', 'refs', 'roles', 'triggers', 'lifecycle']);
      if (!kinds.has(story.kind)) invalid(`${at}.kind`, 'expected incident, questlet or arc');
      labelsAndRefs(story, at, references);
      if (Object.hasOwn(story, 'triggers')) triggers(story, at);
      if (Object.hasOwn(story, 'lifecycle')) lifecycle(story.lifecycle, `${at}.lifecycle`);
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
      const progression = story.lifecycle?.progression === true;
      link(story.entry, stages, `${at}.entry`, 'stage');
      for (const [name, outcome] of entries(outcomes, `${at}.outcomes`, true)) {
        const location = `${at}.outcomes.${name}`;
        fields(outcome, location, ['title'], ['summary', 'refs', ...(progression ? ['status'] : [])]);
        if (Object.hasOwn(outcome, 'status') && !['completed', 'failed'].includes(outcome.status))
          invalid(`${location}.status`, 'expected completed or failed');
        labelsAndRefs(outcome, location, references);
      }
      for (const [name, stage] of stageRows) {
        const location = `${at}.stages.${name}`;
        fields(stage, location, ['title', 'next'], ['summary', 'roles', 'refs', 'story', ...(progression ? ['objectives'] : [])]);
        labelsAndRefs(stage, location, references);
        if (Object.hasOwn(stage, 'roles')) links(stage.roles, roles, `${location}.roles`, 'role');
        if (Object.hasOwn(stage, 'story')) link(stage.story, stories, `${location}.story`, 'story');
        const objectives = Object.hasOwn(stage, 'objectives') ? stage.objectives : {};
        const objectiveRows = entries(objectives, `${location}.objectives`);
        if (objectiveRows.length > 64) invalid(`${location}.objectives`, 'a stage supports up to 64 objectives');
        for (const [name, objective] of objectiveRows) {
          const place = `${location}.objectives.${name}`;
          fields(objective, place, ['title'], ['summary', 'refs', 'optional']);
          labelsAndRefs(objective, place, references);
          if (Object.hasOwn(objective, 'optional') && typeof objective.optional !== 'boolean')
            invalid(`${place}.optional`, 'expected a boolean');
        }
        for (const [choice, target] of entries(stage.next, `${location}.next`, true)) {
          const edge = `${location}.next.${choice}`;
          fields(target, edge, [], ['stage', 'outcome', ...(progression ? ['requires'] : [])]);
          if (Object.hasOwn(target, 'stage') === Object.hasOwn(target, 'outcome')) invalid(edge, 'expected exactly one stage or outcome target');
          if (Object.hasOwn(target, 'stage')) link(target.stage, stages, `${edge}.stage`, 'stage');
          else link(target.outcome, outcomes, `${edge}.outcome`, 'outcome');
          if (Object.hasOwn(target, 'requires')) links(target.requires, objectives, `${edge}.requires`, 'objective');
        }
      }
    }
    return document;
  }

  return Object.freeze({ validateStoryDocument });
})();
if (typeof module !== 'undefined') module.exports = StoryDocument;
