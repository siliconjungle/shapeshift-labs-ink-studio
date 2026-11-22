/* Materialize versioned story recipes into ordinary documents, role bindings, and event actions. */
(function(K) {
  const W = K.world, {check, copy, id, own, read, record, selector, vector} = W.data;
  const {freeze} = K.procedural.data;
  const format = 'ink-studio/story-template';
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const revisionOK = value => Number.isSafeInteger(value) && value > 0;
  const documentId = value => id(value) && /^[a-z]/i.test(value);
  const validators = {
    string: value => typeof value === 'string',
    id,
    boolean: value => typeof value === 'boolean',
    number: Number.isFinite,
    integer: Number.isSafeInteger,
    point: vector,
    object: record,
    array: Array.isArray,
    json: () => true // Inputs already passed the world's finite JSON check.
  };

  function checkValue(value, spec, at) {
    check(validators[spec.type](value), at + ' expects ' + spec.type);
    check((spec.min === undefined || value >= spec.min) && (spec.max === undefined || value <= spec.max),
      at + ' is outside its parameter bounds');
  }

  function values(schema, supplied, at) {
    check(record(schema) && Object.keys(schema).length <= 64 && record(supplied),
      at + ' needs a parameter table of up to 64 entries and an object of values');
    for (const name of Object.keys(supplied))
      check(own(schema, name), at + ' has unknown parameter ' + name);
    const defaults = [];
    const parameters = Object.fromEntries(Object.entries(schema).map(([name, spec]) => {
      const place = at + '.' + name;
      check(id(name) && keys(spec, ['type', 'default', 'min', 'max']) && typeof spec.type === 'string' && own(validators, spec.type),
        'Invalid parameter declaration at ' + place);
      const {type, min, max} = spec;
      const numeric = type === 'integer' || type === 'number';
      check((min === undefined || numeric && validators[type](min)) &&
        (max === undefined || numeric && validators[type](max)) &&
        (min === undefined || max === undefined || min <= max), 'Invalid parameter bounds at ' + place);
      if (own(spec, 'default')) checkValue(spec.default, spec, place + ' default');
      if (own(supplied, name)) {
        checkValue(supplied[name], spec, place);
        return [name, supplied[name]];
      }
      check(own(spec, 'default'), 'Missing required parameter ' + place);
      defaults.push(name);
      return [name, spec.default];
    }));
    return {parameters, defaults};
  }

  function materialize(value, at, parameters, instance, stories) {
    if (!value || typeof value !== 'object') return value;
    if (own(value, '$param')) {
      check(keys(value, ['$param', 'path']) && id(value.$param) && own(parameters, value.$param),
        'Unknown or invalid template parameter at ' + at);
      const base = parameters[value.$param];
      const selected = own(value, 'path') ? read(base, selector(value.path)) : base;
      check(selected !== undefined, 'Missing template parameter path for ' + value.$param + ' at ' + at);
      return selected;
    }
    if (own(value, '$instance')) {
      check(keys(value, ['$instance']) &&
        (value.$instance === true || typeof value.$instance === 'string' && own(stories, value.$instance)),
        'Expected true or a local story ID in $instance at ' + at);
      return value.$instance === true ? instance : instance + '/' + value.$instance;
    }
    if (Array.isArray(value))
      return value.map((item, i) => materialize(item, at + '[' + i + ']', parameters, instance, stories));
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, materialize(item, at + '.' + key, parameters, instance, stories)]));
  }

  function expand(template, spec) {
    check(keys(spec, ['id', 'parameters', 'revision']) && documentId(spec.id) &&
      (spec.revision === undefined || revisionOK(spec.revision)), 'Invalid story template instance');
    const at = 'storyTemplates.' + spec.id;
    check(keys(template, ['format', 'version', 'id', 'revision', 'parameters', 'document', 'bindings', 'eventActions']) &&
      template.format === format && template.version === 1 && documentId(template.id) && revisionOK(template.revision),
      at + ' needs an ink-studio/story-template version 1 with an ID and positive revision');
    check(spec.revision === undefined || spec.revision === template.revision,
      at + ' expected template revision ' + spec.revision + ', got ' + template.revision);
    check(keys(template.document, ['title', 'stories', 'references', 'objectiveTypes']) && record(template.document.stories),
      at + ' needs a story document body with a stories map');
    const {id:instance} = spec;
    const {parameters, defaults} = values(own(template, 'parameters') ? template.parameters : {},
      own(spec, 'parameters') ? spec.parameters : {}, at + '.parameters');
    const expandValues = (value, key) => materialize(value, at + '.' + key, parameters, instance, template.document.stories);
    const document = StoryDocument.validateStoryDocument({
      format:'ink-studio/story', version:1, id:instance, ...expandValues(template.document, 'document')
    });
    const bindings = expandValues(own(template, 'bindings') ? template.bindings : {}, 'bindings');
    check(record(bindings), at + ' needs a local story binding table');
    const storyBindings = Object.fromEntries(Object.entries(bindings).map(([story, roles]) => {
      check(own(document.stories, story) && record(roles), 'Invalid local story bindings at ' + at + '.bindings.' + story);
      return [instance + '/' + story, roles];
    }));
    const routes = expandValues(own(template, 'eventActions') ? template.eventActions : {}, 'eventActions');
    check(record(routes), at + ' needs an event action table');
    const eventActions = Object.fromEntries(Object.entries(routes).map(([rule, route]) => {
      const name = instance + '.' + rule;
      check(id(rule) && id(name), 'Invalid or overlong event action ID ' + name);
      return [name, route];
    }));
    return {
      document, storyBindings, eventActions,
      instance:{template:{id:template.id, revision:template.revision}, parameters, defaults, stories:Object.keys(document.stories)}
    };
  }

  function instantiate(template, spec) {
    return freeze(expand(copy(template), copy(spec)));
  }

  function compile(world) {
    check(Array.isArray(world.storyTemplates) && world.storyTemplates.length <= 32, 'Expected up to 32 story template instances');
    const source = world.storyDocuments === undefined ? [] : world.storyDocuments;
    const worldBindings = world.storyBindings === undefined ? {} : world.storyBindings;
    check(Array.isArray(source) && source.length + world.storyTemplates.length <= 32,
      'Expected up to 32 story documents including template instances');
    check(record(worldBindings), 'Expected a world storyBindings table');
    check(world.eventActions === undefined || record(world.eventActions), 'Expected a world eventActions table');
    const documents = source.slice(), bindings = {...worldBindings}, actions = {...world.eventActions}, instances = {};
    for (const row of world.storyTemplates) {
      check(keys(row, ['template', 'id', 'revision', 'parameters']) && own(row, 'template'), 'Expected an embedded story template instance');
      const {template, ...spec} = row;
      check(!own(instances, spec.id), 'Duplicate story template instance ' + spec.id);
      const result = expand(template, spec);
      documents.push(result.document);
      instances[spec.id] = result.instance;
      for (const [story, slots] of Object.entries(result.storyBindings)) {
        const current = own(bindings, story) ? bindings[story] : {};
        check(record(current), 'Expected role bindings for ' + story);
        for (const role of Object.keys(slots))
          check(!own(current, role), 'Duplicate story role binding ' + story + '/' + role);
        bindings[story] = {...current, ...slots};
      }
      for (const [name, action] of Object.entries(result.eventActions)) {
        check(!own(actions, name), 'Duplicate story template event action ' + name);
        actions[name] = action;
      }
    }
    return {documents:freeze(documents), bindings:freeze(bindings), instances:freeze(instances),
      eventActions:Object.keys(actions).length || world.eventActions !== undefined ? freeze(actions) : undefined};
  }

  W.storyTemplates = Object.freeze({instantiate, compile});
})(KIT);
