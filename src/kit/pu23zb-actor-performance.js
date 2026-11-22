/* A read-only cast, pose, dialogue and prop adapter over presentation cues. */
(function (K) {
  const W = K.world, P = K.procedural, T = P.takeTime, { check, copy, id, own, record } = W.data;
  const { freeze } = P.data, assetRefs = K.authoring.assetReferences, presentation = W.presentationCues;
  const format = 'ink-studio/actor-performance', planFormat = format + '-plan';
  const kinds = new Set(['cast', 'gesture', 'expression', 'dialogue', 'prop']);
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const table = (value, limit) => record(value) && Object.keys(value).length <= limit && Object.keys(value).every(id);
  const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  const storyId = value => typeof value === 'string' && value.split('/').length === 2 && value.split('/').every(id);
  const roleRef = row => fields(row, ['story', 'role']) && storyId(row.story) && id(row.role);
  const identity = value => text(value, 160) || record(value) && Object.keys(value).length > 0 && JSON.stringify(value).length <= 2048;
  const duration = value => Number.isFinite(value) && value > 0 && value <= 3600;
  const reference = value => value === undefined || assetRefs.validRef(value);

  function castRows(cast, props, { roles, resolved = false } = {}) {
    check(table(cast, 64) && table(props, 64), 'Actor performance needs bounded cast and prop maps');
    const nodes = new Set();
    const nodeOf = (key, value) => {
      const node = value ?? key;
      check(id(node) && !nodes.has(node), 'Actor performance needs distinct scene node IDs');
      nodes.add(node);
      return node;
    };
    const actors = Object.fromEntries(Object.entries(cast).map(([name, row]) => {
      check(fields(row, ['actor', 'label', 'node', 'role', 'visible', 'rig', 'voice', 'sockets', 'gestures', 'expressions']) &&
        (row.role === undefined || roleRef(row.role)) && (row.actor === undefined || identity(row.actor)) &&
        (row.label === undefined || text(row.label, 80) && !/[\r\n]/.test(row.label)) &&
        (row.visible === undefined || typeof row.visible === 'boolean') && reference(row.rig) && reference(row.voice) &&
        (row.sockets === undefined || table(row.sockets, 64) && Object.values(row.sockets).every(id)),
      'Invalid cast slot ' + name);
      const bound = row.role && roles?.[row.role.story]?.[row.role.role];
      const actor = resolved ? row.actor : bound?.value ?? row.actor;
      check(identity(actor), 'Cast slot ' + name + ' needs a recorded role binding or explicit actor');
      return [name, { ...row, actor, node: nodeOf(name, row.node), label: row.label ?? name,
        visible: row.visible ?? true, sockets: row.sockets ?? {} }];
    }));
    const objects = Object.fromEntries(Object.entries(props).map(([name, row]) => {
      check(fields(row, ['node', 'scene', 'visible', 'home', 'transform']) && reference(row.scene) &&
        (row.visible === undefined || typeof row.visible === 'boolean'), 'Invalid prop slot ' + name);
      const { home = null } = row;
      if (home !== null) K.sceneGraph.reference(home);
      if (row.transform !== undefined) K.sceneGraph.transform(row.transform);
      return [name, { ...row, node: nodeOf(name, row.node), visible: row.visible ?? true, home }];
    }));
    return { cast: actors, props: objects };
  }

  function clips(value = {}, label) {
    check(table(value, 64), 'Invalid ' + label + ' clip map');
    return new Map(Object.entries(value).map(([name, row]) => {
      check(fields(row, ['duration', 'tracks']) && duration(row.duration) && table(row.tracks, 96) &&
        Object.keys(row.tracks).length > 0 && Object.values(row.tracks).every(keys => Array.isArray(keys) &&
          keys.every(key => Number.isFinite(key?.time) && key.time >= 0 && key.time <= row.duration)),
      'Clip ' + name + ' needs bone keys inside its duration');
      return [name, { duration: row.duration, pose: P.sceneGraph.compileSpritePose(row.tracks) }];
    }));
  }

  function makeCue(row, cast, props, presets) {
    const { kind, target, detail = {}, assets } = row;
    check(kinds.has(kind) && id(target) && own(kind === 'prop' ? props : cast, target),
      'Unknown ' + kind + ' target ' + target);
    check(row.time <= 1e9, 'Actor performance cue exceeds the supported time range');
    const start = T.read(row.timecode ?? row.time);
    const result = { row, start };
    if (kind === 'gesture' || kind === 'expression') {
      const clip = presets.get(target)[kind].get(detail.clip);
      check(fields(detail, ['clip', 'duration']) && clip && (detail.duration === undefined || duration(detail.duration)),
        'Unknown or invalid ' + kind + ' clip for ' + target);
      return { ...result, clip, end: T.add(start, T.read(detail.duration ?? clip.duration)) };
    }
    if (kind === 'dialogue') {
      check(fields(detail, ['text', 'duration']) && text(detail.text, 2048) && duration(detail.duration),
        'Dialogue needs authored text and a positive duration');
      return { ...result, end: T.add(start, T.read(detail.duration)), voice: assets?.voice ?? cast[target].voice };
    }
    if (kind === 'cast') {
      check(fields(detail, ['actor', 'visible']) && (detail.actor === undefined || identity(detail.actor)) &&
        (detail.visible === undefined || typeof detail.visible === 'boolean') && Object.keys(detail).length > 0,
      'Cast cue needs an actor identity or visibility');
      return result;
    }
    check(fields(detail, ['actor', 'socket', 'visible', 'transform']) &&
      (detail.visible === undefined || typeof detail.visible === 'boolean') &&
      (detail.actor === null ? detail.socket === undefined :
        id(detail.actor) && own(cast, detail.actor) && id(detail.socket) && own(cast[detail.actor].sockets, detail.socket)),
    'Prop cue needs a cast socket or a null actor to return home');
    if (detail.transform !== undefined) K.sceneGraph.transform(detail.transform);
    return { ...result, parent: detail.actor === null ? props[target].home :
      { node: cast[detail.actor].node, socket: cast[detail.actor].sockets[detail.socket] } };
  }

  function open(input) {
    check(record(input) && JSON.stringify(input).length <= 32 * 1024 * 1024, 'Expected a bounded actor performance sheet');
    const sheet = freeze(copy(input));
    check(fields(sheet, ['format', 'version', 'id', 'cast', 'props', 'presentationCues']) &&
      sheet.format === format && sheet.version === 1 && id(sheet.id), 'Expected a version 1 actor performance sheet');
    const { cast, props } = castRows(sheet.cast, sheet.props, { resolved: true });
    const presets = new Map(Object.entries(cast).map(([id, row]) => [id, {
      gesture: clips(row.gestures, 'gesture'), expression: clips(row.expressions, 'expression')
    }]));
    const cueSheet = presentation.read(sheet.presentationCues);
    const cues = cueSheet.cues.map(row => makeCue(row, cast, props, presets))
      .sort((a, b) => T.compare(a.start, b.start));
    const dialogue = cues.filter(value => value.row.kind === 'dialogue').map(({ row, start, end, voice }) =>
      freeze({ id: row.id, actor: row.target, speaker: cast[row.target].label, text: row.detail.text,
        time: T.seconds(start), end: T.seconds(end), timecode: T.pack(start), endTimecode: T.pack(end),
        ...(row.beatId && { beatId: row.beatId }), ...(row.source && { source: row.source }), ...(voice && { voice }) }));
    const lines = new Map(dialogue.map(row => [row.id, row]));
    const zero = T.read(0);
    const end = cues.reduce((max, cue) => T.compare(cue.end ?? cue.start, max) > 0 ? cue.end ?? cue.start : max, zero);
    function sample(time = 0) {
      const at = T.read(time), seconds = T.seconds(at);
      check(Number.isFinite(seconds) && seconds >= 0, 'Actor performance time must be nonnegative and finite');
      const castState = Object.fromEntries(Object.entries(cast).map(([id, row]) => [id, {
        actor: row.actor, label: row.label, node: row.node, visible: row.visible, pose: {},
        ...(row.role && { role: row.role }), ...(row.rig && { rig: row.rig }), ...(row.voice && { voice: row.voice })
      }]));
      const propState = Object.fromEntries(Object.entries(props).map(([id, row]) => [id, {
        node: row.node, parent: row.home, visible: row.visible,
        ...(row.scene && { scene: row.scene }), ...(row.transform && { transform: row.transform })
      }]));
      const lettering = [], active = [];
      for (const cue of cues) {
        if (T.compare(cue.start, at) > 0) break;
        const { row, clip, parent } = cue, { kind, target, detail } = row;
        if (kind === 'cast') Object.assign(castState[target], detail, { cue: row.id, beatId: row.beatId ?? null });
        else if (kind === 'prop') {
          const rest = props[target], transform = detail.transform ?? rest.transform;
          const state = propState[target];
          Object.assign(state, { parent, cue: row.id, beatId: row.beatId ?? null, visible: detail.visible ?? state.visible });
          if (transform === undefined) delete state.transform;
          else state.transform = transform;
        } else if (T.compare(at, cue.end) < 0) {
          active.push({ id: row.id, kind, target, ...(row.beatId && { beatId: row.beatId }) });
          if (kind === 'dialogue') lettering.push(lines.get(row.id));
          else {
            const ratio = T.div(T.sub(at, cue.start), T.sub(cue.end, cue.start));
            Object.assign(castState[target].pose, clip.pose(T.seconds(ratio) * clip.duration));
          }
        }
      }
      const caption = lettering.map(line => line.speaker + ': ' + line.text).join('\n');
      return freeze({ time: seconds, cast: castState, props: propState, lettering, caption, active });
    }
    return Object.freeze({ sample, dialogue: freeze(dialogue), duration: T.seconds(end),
      timeline: () => freeze({ duration: T.pack(end), markers: [], presentationCues: cueSheet }) });
  }

  function validatePlan(plan) {
    check(fields(plan, ['format', 'version', 'id', 'cast', 'props', 'rules']) && plan.format === planFormat &&
      plan.version === 1 && id(plan.id) && table(plan.cast, 64) && table(plan.props ?? {}, 64) &&
      (plan.rules === undefined || table(plan.rules, 128) &&
        Object.values(plan.rules).every(rule => kinds.has(rule?.cue?.kind))), 'Expected a version 1 actor performance plan');
  }

  function make(plan, projected, roles) {
    const { cast, props } = castRows(plan.cast, plan.props ?? {}, { roles });
    const { cues, ...header } = presentation.read(projected);
    const sheet = freeze(copy({ format, version: 1, id: plan.id, cast, props,
      presentationCues: { ...header, cues: cues.filter(row => kinds.has(row.kind)) } }));
    open(sheet);
    return sheet;
  }

  function rules(plan) {
    return { format: presentation.planFormat, version: 1, id: plan.id, rules: plan.rules ?? {} };
  }

  function project(source, plan) {
    validatePlan(plan);
    const imported = source?.format === presentation.format ? source :
      source?.format === undefined && source?.presentationCues?.format === presentation.format ? source.presentationCues : undefined;
    const cues = imported ?? presentation.project(W.storyEvents.envelopes(source), rules(plan));
    return make(plan, cues);
  }

  async function replay(source, plan) {
    validatePlan(plan);
    plan = copy(plan);
    let roles, size = 0;
    const { world, tick: from, dropped } = source.origin;
    const kinds = new Set(Object.values(plan.rules ?? {}).map(row => row.on?.kind));
    const events = [];
    await W.storySceneTimeline.scan(source, row => {
      if (!kinds.has(row.kind)) return;
      size += JSON.stringify(row).length;
      check(events.length < 110000 && size <= 32 * 1024 * 1024, 'Performance event selection exceeds its budget');
      events.push(row);
    }, frame => { roles = frame.storyRoles; });
    const log = { format: W.storyEvents.envelopeFormat, version: 1, world: world.id, dt: world.dt, from: 0,
      to: source.end.tick, coverage: from ? 'retained' : 'complete', dropped: from ? dropped : 0, events,
      ...(world.takeClock?.simulationRate !== undefined && { simulationRate: world.takeClock.simulationRate }) };
    return make(plan, presentation.project(log, rules(plan)), roles);
  }

  function scene(definition, value) {
    const graph = K.sceneGraph.create(definition);
    for (const row of Object.values(value.cast)) graph.setVisible(row.node, row.visible);
    for (const row of Object.values(value.props)) {
      graph.reparent(row.node, row.parent, { keepWorld: false });
      if (row.transform !== undefined) graph.setLocal(row.node, row.transform);
      graph.setVisible(row.node, row.visible);
    }
    return graph;
  }

  W.actorPerformance = Object.freeze({ format, planFormat, open, project, replay, scene });
  P.graph.operations = Object.freeze({ ...P.graph.operations, 'scene.actorPerformance': {
    description: 'Sample committed actor performance cues into a sprite pose, cast, props and lettering.',
    inputs: { sheet: 'record', actor: { type: 'string', default: '' } },
    outputs: { value: 'record', pose: 'record', cast: 'record', props: 'record', lettering: 'array<record>', caption: 'string' },
    time: true,
    instantiate() {
      let source, adapter;
      const use = ({ sheet, actor }, { time, take }) => {
        if (sheet !== source) { adapter = open(sheet); source = sheet; }
        const value = adapter.sample(take === undefined ? time : T.pack(T.requireFrame(take).start));
        check(actor === '' || own(value.cast, actor), 'Unknown performance actor ' + actor);
        const { cast, props, lettering, caption } = value;
        return { value, pose: actor ? cast[actor].pose : {}, cast, props, lettering, caption };
      };
      use.clear = () => { source = adapter = undefined; };
      return use;
    }
  } });
})(KIT);
