/* World bindings for portable, domain-defined story roles. */
(function (K) {
  const W = K.world, { check, own, read, record } = W.data, { freeze } = K.procedural.data;
  const sorted = table => Object.keys(table ?? {}).sort();

  function compile(documents, bindings = {}) {
    check(Array.isArray(documents) && documents.length <= 32, 'Expected up to 32 embedded story documents');
    check(record(bindings), 'Expected a world storyBindings table');
    const storyKeys = new Set(), documentIds = new Set(), inventory = [];
    for (const document of documents) {
      StoryDocument.validateStoryDocument(document);
      check(!documentIds.has(document.id), 'Duplicate story document ID ' + document.id);
      documentIds.add(document.id);
      for (const [id, story] of Object.entries(document.stories)) {
        const key = document.id + '/' + id;
        storyKeys.add(key);
        const selected = own(bindings, key) ? bindings[key] : {};
        check(record(selected), 'Expected role bindings for ' + key);
        for (const role of sorted(selected)) check(own(story.roles, role), 'Unknown story role ' + key + '/' + role);
        const slots = sorted(story.roles).map(id => {
          const { kind, ref, required } = story.roles[id], place = key + '/' + id;
          if (own(selected, id)) {
            const bound = selected[id];
            check(record(bound) && Object.keys(bound).length === 2 && own(bound, 'value') && own(bound, 'kind') && bound.kind === kind,
              'Story role ' + place + ' expects a binding of kind ' + kind + ' with a value');
            StoryDocument.mapRoleValues(bound.value, 'world.storyBindings.' + place, (_, at) => {
              throw Error('Role bindings need concrete values at ' + at);
            });
            return [id, { kind, source:'world', value:bound.value }];
          }
          if (ref !== undefined) return [id, { kind, source:'reference', value:document.references[ref].id }];
          check(!required, 'Missing required story role binding ' + place);
          return [id, { kind, source:'unbound' }];
        });
        if (slots.length) inventory.push([key, Object.fromEntries(slots)]);
      }
    }
    for (const key of sorted(bindings)) check(storyKeys.has(key), 'Unknown story for role bindings ' + key);
    const roles = freeze(Object.fromEntries(inventory));

    function resolve(value, at, scope) {
      return StoryDocument.mapRoleValues(value, at, (token, location) => {
        const path = StoryDocument.roleToken(token, location, scope === undefined);
        const key = scope ?? token.story, slots = own(roles, key) && roles[key];
        check(own(slots, token.$role), 'Unknown story role ' + key + '/' + token.$role + ' at ' + location);
        const slot = slots[token.$role];
        check(slot.source !== 'unbound', 'Missing story role binding ' + key + '/' + token.$role + ' at ' + location);
        const result = read(slot.value, path);
        check(result !== undefined, 'Missing story role value path for ' + key + '/' + token.$role + ' at ' + location);
        return result;
      });
    }

    const resolved = documents.map(document => {
      const stories = Object.entries(document.stories).map(([id, story]) =>
        [id, resolve(story, 'story.stories.' + id, document.id + '/' + id)]);
      return stories.some(([id, story]) => story !== document.stories[id]) ?
        { ...document, stories:Object.fromEntries(stories) } : document;
    });

    function command(raw) {
      if (!record(raw)) return raw;
      const action = resolve(raw.action, 'command.action'), args = resolve(raw.args, 'command.args');
      return action === raw.action && args === raw.args ? raw : { ...raw, action, args };
    }

    return { documents:resolved, authored:documents, roles, resolve, command };
  }

  W.storyRoles = Object.freeze({ compile });
})(KIT);
