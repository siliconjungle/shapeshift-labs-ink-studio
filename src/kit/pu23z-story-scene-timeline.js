/* Editable scene markers projected from committed world events. */
(function (K) {
  const W = K.world, T = K.procedural.takeTime, { freeze, hash } = K.procedural.data;
  const { check, id, record } = W.data, links = W.inspectionLinks;
  const planFormat = 'ink-studio/story-marker-plan', maxMarkers = 4096;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const tick = value => Number.isSafeInteger(value) && value >= 0 && value <= W.runtime.maxTick;
  const storyId = value => typeof value === 'string' && value.split('/').length === 2 && value.split('/').every(id);
  const terminal = new Set(['completed', 'failed', 'withdrawn', 'expired']);
  const names = new Map(Object.entries({
    arrival: ['arrival', 'arrived', 'group-arrived', 'population-arrival', 'visitor-arrived', 'caravan-arrived'],
    discovery: ['discovery', 'discovered', 'object-discovered', 'site-discovered'],
    argument: ['argument', 'argument-started', 'dispute', 'dispute-raised'],
    choice: ['choice', 'choice-made', 'story-branch-chosen'],
    outcome: ['outcome', 'outcome-recorded', 'story-outcome-recorded']
  }).flatMap(([category, events]) => events.map(kind => [kind, category])));

  function rules(plan) {
    const byKind = new Map();
    if (plan === undefined) return byKind;
    check(fields(plan, ['format', 'version', 'rules']) && plan.format === planFormat && plan.version === 1 &&
      Array.isArray(plan.rules) && plan.rules.length <= 128, 'Expected a version 1 story marker plan with up to 128 rules');
    for (const row of plan.rules) {
      check(fields(row, ['on', 'category', 'label']) && id(row.category) &&
        (row.label === undefined || typeof row.label === 'string' && row.label.trim() && row.label.length <= 256) &&
        fields(row.on, ['kind', 'system', 'story', 'stage', 'branch', 'where']) && id(row.on.kind) &&
        ['system', 'stage', 'branch'].every(key => row.on[key] === undefined || id(row.on[key])) &&
        (row.on.story === undefined || storyId(row.on.story)), 'Invalid story marker rule');
      W.query.condition(row.on.where, undefined);
      const kind = row.on.kind;
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(row);
    }
    return byKind;
  }

  function classify({ kind, payload }) {
    if (kind === 'story-transition' && terminal.has(payload.to)) return 'outcome';
    if (kind === 'custody-changed' && payload.custody?.operation === 'discover') return 'discovery';
    if (kind === 'world-fact') return names.get(payload.fact?.type);
    return names.get(kind);
  }

  function label(category, { payload, subjects }) {
    const detail = ({
      arrival: payload.entity ?? payload.actor ?? payload.group ?? payload.household ?? payload.place,
      discovery: payload.custody?.object ?? payload.object ?? payload.place ?? payload.fact?.at?.place,
      argument: payload.topic ?? payload.fact?.data?.topic,
      choice: payload.branch,
      outcome: payload.outcome ?? payload.to
    })[category];
    const text = [payload.label, payload.title, detail, subjects?.[0]?.id]
      .find(value => typeof value === 'string' && value.trim());
    return category[0].toUpperCase() + category.slice(1) +
      (text ? ' · ' + text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '');
  }

  function portableTime(point) {
    const seconds = T.seconds(point);
    return T.compare(T.read(seconds), point) === 0 ? seconds : T.pack(point);
  }

  function validSource(row, beatId) {
    if (!fields(row, ['world', 'branch', 'id', 'system', 'kind', 'tick', 'story', 'stage', 'visit', 'timecode']) ||
      ![row.world, row.branch, row.id, row.system, row.kind].every(id) || !tick(row.tick) ||
      (row.story !== undefined && !storyId(row.story)) || (row.stage !== undefined && !id(row.stage)) ||
      (row.visit !== undefined && (!Number.isSafeInteger(row.visit) || row.visit < 1))) return false;
    const ref = links.parse(beatId);
    if (!ref || links.make(row, ref.projected) !== beatId || !fields(row.timecode, ['numerator', 'denominator'])) return false;
    const seconds = T.seconds(T.read(row.timecode));
    return Number.isFinite(seconds) && seconds >= 0;
  }

  function collector({ dt, simulationRate, to }, { story, fromTick = 0, toTick = to, plan } = {}) {
    check((story === undefined || storyId(story)) && tick(fromTick) && tick(toTick) &&
      fromTick <= toTick && toTick <= to, 'Story markers need an ordered tick range within the source and a document/story ID');
    const byKind = rules(plan), step = T.period(dt, simulationRate), converted = [], used = new Set();
    const boundary = value => T.mul(step, T.read(value));
    function add(event) {
      const { world, branch, id, tick: at, kind, system, story: owner, stage, visit, payload } = event;
      if (at < fromTick || at > toTick || story !== undefined && story !== owner) return;
      const rule = byKind.get(kind)?.find(({ on }) =>
        ['system', 'story', 'stage', 'branch'].every(key => on[key] === undefined || event[key] === on[key]) &&
        W.query.condition(on.where, event));
      const category = rule?.category ?? classify(event);
      if (!category) return;
      check(converted.length < maxMarkers, 'Story marker budget exceeded. Narrow the story or tick range.');
      const beatId = links.identify(event);
      check(beatId, 'Story marker needs a committed event identity');
      const markerId = 'beat-' + hash(beatId).toString(36) + '-' + hash([...beatId].reverse().join('')).toString(36);
      check(!used.has(markerId), 'Duplicate story marker identity');
      used.add(markerId);
      const native = W.timedEvents.timeOf(payload), point = native === undefined ? boundary(at) : T.read(native);
      const source = { world, branch, id, tick: at, kind, system, ...(owner && { story: owner }),
        ...(stage && { stage }), ...(Number.isSafeInteger(visit) && visit > 0 && { visit }), timecode: T.pack(point) };
      check(validSource(source, beatId), 'Invalid committed story marker source');
      converted.push({ point, marker: { id: markerId, time: portableTime(point),
        label: rule?.label ?? label(category, event), category, beatId, source } });
    }
    return { add, finish() {
      converted.sort((a, b) => T.compare(a.point, b.point));
      const end = boundary(toTick), last = converted.at(-1)?.point;
      return freeze({ duration: portableTime(last && T.compare(last, end) > 0 ? last : end),
        markers: converted.map(row => row.marker) });
    } };
  }

  function project(source, options) {
    const log = W.storyEvents.envelopes(source);
    const output = collector(log, options);
    for (const row of log.events) output.add(row);
    return output.finish();
  }

  async function replay(source, options) {
    const output = collector({ dt: source.origin.world.dt, simulationRate: source.origin.world.takeClock?.simulationRate,
      to: source.end.tick }, options);
    const { world, eventStream } = source.end;
    for (const row of W.storyEvents.envelopes(source.origin).events) output.add(row);
    await W.runtime.replayAsync(source, { onTick(frame) {
      for (const row of frame.events) output.add(W.committedEvents.read(row, world.id, eventStream));
    } });
    return output.finish();
  }

  W.storySceneTimeline = Object.freeze({ planFormat, project, replay, validSource });
})(KIT);
