/* Evaluates authored story starts at the world publication boundary. */
(function (K) {
  const W = K.world, { check, record, own, equal } = W.data, { freeze } = K.procedural.data;
  const maxTick = W.runtime.maxTick;
  const tickAt = (value, tick) => Number.isSafeInteger(value) && value >= 0 && value <= tick;
  const keys = (value, expected) => record(value) && equal(Object.keys(value).sort(), expected);

  function ticks(seconds, dt, round) {
    const steps = seconds / dt, nearest = Math.round(steps);
    const count = Math.abs(steps - nearest) <= 4 * Number.EPSILON * Math.max(1, steps) ? nearest : round(steps);
    check(tickAt(count, maxTick), 'Story trigger duration exceeds the world tick budget');
    return count;
  }

  function matchState(query, { field, at, args, when }) {
    const sample = query.probe(field, at, args);
    return sample.status === 'ok' ? W.query.condition(when, sample.value) : null;
  }

  function compile(documents, world, systems) {
    check(Array.isArray(documents) && documents.length <= 32, 'Expected up to 32 embedded story documents');
    const ids = new Set(), stories = [], kinds = new Set();
    let ruleCount = 0;
    const weather = world.visual?.weatherTracks || world.visual?.environmentPreset;
    const registry = W.query.create({ world, ...(weather && { weatherTrackState: {} }) }, systems);
    for (const document of documents) {
      StoryDocument.validateStoryDocument(document);
      check(!ids.has(document.id), 'Duplicate story document ID ' + document.id);
      ids.add(document.id);
      for (const [story, definition] of Object.entries(document.stories)) {
        if (!definition.triggers) continue;
        const { kind: storyKind, entry: stage } = definition, rules = new Map(), key = document.id + '/' + story;
        for (const trigger of Object.keys(definition.triggers).sort()) {
          check(++ruleCount <= 256, 'World story trigger budget exceeds 256 rules');
          const { event, count = 1, within, state, hold } = definition.triggers[trigger];
          if (event) {
            const { kind, system } = event;
            check(system === undefined || system === 'world' || own(systems, system), 'Unknown story event source ' + system + ' in ' + key);
            kinds.add(kind);
            rules.set(trigger, { event, count, window: within === undefined ? 0 : ticks(within, world.dt, Math.floor) });
          } else {
            check(registry.field(state.field), 'Unknown story query field ' + state.field + ' in ' + key);
            rules.set(trigger, { state, duration: hold === undefined ? 0 : Math.max(1, ticks(hold, world.dt, Math.ceil)) });
          }
        }
        stories.push({ key, document: document.id, story, storyKind, stage, rules });
      }
    }
    if (!stories.length) return null;
    stories.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const storyKeys = stories.map(row => row.key);

    function initial(query) {
      return freeze(Object.fromEntries(stories.map(({ key, rules }) => [key, { start: null,
        progress: Object.fromEntries(Array.from(rules, ([id, rule]) => {
          if (rule.event) return [id, []];
          const matching = matchState(query, rule.state);
          return [id, { matching, since: matching ? 0 : null }];
        }))
      }])));
    }

    function validate(saved, tick) {
      check(keys(saved, storyKeys), 'Malformed story trigger checkpoint');
      for (const { key, rules } of stories) {
        const row = saved[key], message = 'Invalid saved story trigger state for ' + key;
        if (row?.start) {
          check(keys(row, ['start']) && keys(row.start, ['tick', 'trigger']) && rules.has(row.start.trigger) &&
            tickAt(row.start.tick, tick) && row.start.tick > 0, message);
          continue;
        }
        check(keys(row, ['progress', 'start']) && row.start === null && keys(row.progress, [...rules.keys()]), message);
        for (const [id, rule] of rules) {
          const progress = row.progress[id];
          if (rule.event) {
            let lastTick = -1, order = -1;
            check(Array.isArray(progress) && progress.length < rule.count && progress.every(sample => {
              if (typeof sample !== 'string' || !/^\d{1,8}\.\d{1,4}$/.test(sample)) return false;
              const [at, index] = sample.split('.').map(Number);
              const valid = tickAt(at, tick) && at > 0 && tick - at <= rule.window && (at > lastTick || at === lastTick && index > order);
              lastTick = at;
              order = index;
              return valid;
            }), message);
          } else {
            check(keys(progress, ['matching', 'since']) && [true, false, null].includes(progress.matching) &&
              (progress.matching === true ? tickAt(progress.since, tick) &&
                (!rule.duration || tick - progress.since < rule.duration) : progress.since === null), message);
          }
        }
      }
    }

    function evaluate(rule, before, indexed, tick, query) {
      if (rule.event) {
        const { event, count, window } = rule;
        const retained = before.filter(id => tick - Number(id.split('.')[0]) <= window);
        for (const row of indexed.get(event.kind) ?? []) {
          if (event.system !== undefined && event.system !== row.system || !W.query.condition(event.where, row)) continue;
          retained.push(row.id);
          if (retained.length === count) return { evidence: { kind: 'event', events: retained } };
        }
        return { progress: equal(retained, before) ? before : retained };
      }
      const { state, duration } = rule, matching = matchState(query(), state);
      const since = matching ? before.since ?? tick : null;
      const ready = matching && (duration ? tick - since >= duration : before.matching === false);
      if (ready) return { evidence: { kind: 'state', field: state.field, since, ticks: tick - since } };
      return { progress: matching === before.matching && since === before.since ? before : { matching, since } };
    }

    function advance(previous, events, tick, query) {
      const indexed = new Map(), starts = [];
      for (const row of events) {
        if (!kinds.has(row.kind)) continue;
        if (!indexed.has(row.kind)) indexed.set(row.kind, []);
        indexed.get(row.kind).push(row);
      }
      let state = previous;
      for (const { key, rules, ...story } of stories) {
        const row = previous[key];
        if (row.start) continue;
        let progress = row.progress, next;
        for (const [trigger, rule] of rules) {
          const result = evaluate(rule, progress[trigger], indexed, tick, query);
          if (result.evidence) {
            next = { start: { tick, trigger } };
            starts.push({ ...story, trigger, evidence: result.evidence });
            break;
          }
          if (result.progress !== progress[trigger]) {
            if (progress === row.progress) progress = { ...progress };
            progress[trigger] = result.progress;
          }
        }
        if (next || progress !== row.progress) {
          if (state === previous) state = { ...previous };
          state[key] = next ?? { start: null, progress };
        }
      }
      return { state: freeze(state), starts };
    }

    return { initial, validate, advance };
  }

  W.storyTriggers = Object.freeze({ compile, ticks });
})(KIT);
