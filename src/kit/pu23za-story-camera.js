/* Camera drafts tied to a verified event and its recorded world pose. */
(function (K) {
  const W = K.world, { V } = K, { id, record, vector, check, own } = W.data;
  const { freeze } = K.procedural.data, T = K.procedural.takeTime, timeline = W.storySceneTimeline;
  const format = 'ink-studio/story-shot-plan', maximum = 24;
  const priority = new Map([['choice', 6], ['outcome', 5], ['consequence', 4], ['commitment', 4],
    ['argument', 3], ['discovery', 2], ['arrival', 1]]);
  const turningPoints = new Set(['choice', 'outcome', 'commitment', 'consequence']);
  const escalationMarkers = { format: timeline.planFormat, version: 1,
    rules: ['commitment', 'consequence'].map(category => ({
      on: { kind: 'story-beat-entered', where: { path: '/payload/beat/kind', value: category } }, category
    })) };
  const attachments = new WeakMap();
  const score = row => priority.get(row.category) ?? 0;
  const timeOK = time => Number.isFinite(time) && time >= 0;
  function eventMatch(marker, event, world) {
    if (marker.beatId !== W.inspectionLinks.identify(event) ||
      !['tick', 'kind', 'system'].every(key => marker.source[key] === event[key])) return false;
    const measured = W.timedEvents.timeOf(event.payload);
    const original = measured === undefined ? T.mul(T.read(event.tick), T.period(world.dt, world.takeClock?.simulationRate)) :
      T.read(measured);
    return T.compare(original, T.read(marker.source.timecode)) === 0;
  }

  function anchors(event) {
    const { payload, subjects } = event, rows = [];
    if (payload.custody?.object) rows.push({ ref: payload.custody.object, role: 'object', kind: 'item', evidence: 'custody' });
    for (const { id, role, kind } of subjects.slice(0, 16))
      rows.push({ ref: id, role, kind, evidence: 'event-subject' });
    const anchor = payload.fact?.at ?? payload.custody?.at ?? payload.at ?? payload.point;
    if (vector(anchor) || record(anchor)) rows.push({ ref: typeof anchor.place === 'string' ? anchor.place : 'location', role: 'location',
      kind: 'place', evidence: 'event-location', value: anchor });
    return rows;
  }

  function actor(query, system, agent, generation) {
    if (!id(system) || !id(agent) || (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) ||
      query.field(system + '/agent') === undefined) return;
    const row = query.probe(system + '/agent', undefined, { agent, generation }).value;
    if (vector(row?.position)) return { point: row.position, entity: row.entity };
  }

  function locate(row, world, query, system) {
    let { value, ref, kind } = row;
    if (kind === 'account') value = query.probe('world/account', {}, { account: ref }).value?.at;
    const entity = value?.entity ?? world.custody?.objects?.[ref]?.entity ??
      world.systems[system]?.config?.bodies?.[ref]?.entity ?? (typeof value === 'string' ? value : ref);
    const point = vector(value) ? value : value?.point;
    if (vector(point)) return { point, ...(id(entity) && own(world.entities, entity) && { entity }) };
    if (id(entity) && own(world.entities, entity)) {
      const pose = query.frame({ entity, socket: value?.socket });
      if (pose?.point) return { point: pose.point, entity };
    }
    if (record(value?.agent)) return actor(query, value.agent.system, value.agent.id, value.agent.generation);
    if (id(value?.agent)) return actor(query, value.system, value.agent, value.generation);
    if (kind === 'agent') {
      const parts = ref.split('/');
      return parts.length === 2 ? actor(query, ...parts) : actor(query, system, ref);
    }
  }

  function framingExtent(entities, query, position) {
    if (!position.entity) return { radius: .25 };
    if (!attachments.has(entities)) {
      const children = new Map();
      for (const [id, row] of Object.entries(entities)) {
        const parent = row.anchor?.entity ?? row.parent;
        if (!parent) continue;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
      }
      attachments.set(entities, children);
    }
    const children = attachments.get(entities), members = new Set([position.entity]);
    let radius = 0;
    for (const id of members) {
      const half = entities[id]?.visual?.half;
      const center = vector(half) && query.frame({ entity: id })?.point;
      if (center) radius = Math.max(radius, V.dist(position.point, center) + V.len(half));
      for (const child of children.get(id) ?? []) {
        if (members.size >= 64) break;
        members.add(child);
      }
    }
    return { radius: radius ? Math.max(.1, radius) : .25, ...(members.size > 1 && { attachments: [...members].slice(1) }) };
  }

  function subjects(event, frame, query, recent) {
    const world = frame.world, candidates = anchors(event);
    const [document, story] = event.story?.split('/') ?? [];
    const roles = frame.storyRoles?.[event.story] ?? {};
    const stage = world.storyDocuments?.find(row => row.id === document)?.stories?.[story]?.stages?.[event.stage];
    for (const role of (stage?.roles ?? Object.keys(roles)).slice(0, 12)) {
      const bound = roles[role];
      if (bound?.value === undefined) continue;
      const value = bound.value, name = typeof value === 'string' ? value : value?.entity ?? value?.agent?.id ?? value?.agent;
      candidates.push({ ref: typeof name === 'string' ? name : role, kind: bound.kind, role, evidence: 'story-role', value });
    }
    for (const cause of event.causes.filter(row => row.type === 'event').slice(0, 4)) {
      const linked = recent.get(W.inspectionLinks.make(cause));
      for (const row of linked ?? []) candidates.push({ ...row, evidence: 'causal-event' });
    }
    const resolved = [], missing = [], seen = new Set();
    for (const row of candidates) {
      const position = locate(row, world, query, event.system), { ref, kind, role, evidence } = row;
      const key = position?.entity ?? (position?.point ? position.point.join(',') : kind + '/' + ref);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!position) {
        if (missing.length < 12) missing.push({ ref, kind, role, evidence });
        continue;
      }
      if (resolved.length >= 8) continue;
      const extent = framingExtent(world.entities, query, position);
      resolved.push({ ref, kind, role, evidence, ...position, ...extent });
    }
    return { subjects: resolved, missing };
  }

  function fit(rows, yaw, pitch, fov, margin) {
    const min = [0, 1, 2].map(i => Math.min(...rows.map(row => row.point[i] - row.radius)));
    const max = [0, 1, 2].map(i => Math.max(...rows.map(row => row.point[i] + row.radius)));
    const target = V.lerp(min, max, .5);
    const radius = Math.max(...rows.map(row => V.dist(row.point, target) + row.radius));
    return { target, yaw, pitch, fov, projection: 'perspective',
      dist: Math.max(.5, radius * margin / Math.sin(fov / 2)) };
  }

  function alternatives(rows, world, scene, time) {
    if (!rows.length) return { shots: [] };
    const [focus] = rows, yaw = Number.isFinite(world.visual?.camera?.yaw) ? world.visual.camera.yaw : .6;
    const shots = [{ id: 'wide', kind: 'establishing', subjects: rows.map(row => row.ref),
      camera: fit(rows, yaw, .52, .76, 1.48), reason: 'Place the recorded subjects and locations in context.' }];
    const next = rows.find(row => V.dist(row.point, focus.point) > .12);
    let relationship;
    if (next) {
      const delta = V.sub(next.point, focus.point), distance = V.len(delta);
      const perpendicular = Math.hypot(delta[0], delta[2]) > .01 ? Math.atan2(-delta[2], delta[0]) : yaw;
      const turns = [perpendicular, perpendicular + Math.PI].map(angle => ({
        angle, turn: Math.abs(Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw)))
      }));
      const side = turns.sort((a, b) => a.turn - b.turn)[0].angle;
      relationship = { from: focus.ref, to: next.ref, delta, distance };
      shots.push({ id: 'pair', kind: 'relationship', subjects: [focus.ref, next.ref],
        camera: fit([focus, next], side, .32, .7, 1.15), reason: 'Frame the two recorded positions to show their separation.' });
    }
    const camera = fit([focus], yaw, .28, .65, 1.12);
    if (camera.dist < 1.1) {
      camera.fov = 2 * Math.asin(Math.sin(camera.fov / 2) * camera.dist / 1.1);
      camera.dist = 1.1;
    }
    shots.push({ id: 'insert', kind: 'cutaway', subjects: [focus.ref], camera,
      reason: 'Cut to the primary participant, object, or recorded location.' });
    if (scene && focus.entity) {
      const back = [Math.sin(yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(yaw) * Math.cos(camera.pitch)];
      const { clipNear } = CameraLens.frame({ cam: camera }, { lockCamera: true }, 1, 1);
      const start = camera.dist - clipNear, maxDistance = start - focus.radius - .03;
      if (maxDistance > 0) {
        const picker = K.procedural.contributions.create(scene, { time });
        const subjectEntities = new Set([focus.entity, ...(focus.attachments ?? [])]);
        const hit = picker.ray({ origin: V.mad(camera.target, back, start), direction: back.map(n => -n),
          maxDistance, water: false, cutaway: false, accept: row => row.solid && !subjectEntities.has(row.target.entity) && !subjectEntities.has(row.target.object) }).solid;
        if (hit && hit.distance < maxDistance) {
          const offset = (start - hit.distance + focus.radius) / 2;
          const blocker = hit.target?.entity ?? hit.target?.object ?? hit.target?.surface ?? 'geometry';
          shots.push({ id: 'section', kind: 'section', subjects: [focus.ref], camera,
            reason: 'A sightline probe hit foreground geometry. Test a section in front of the subject.',
            occlusion: { blocker, distance: clipNear + hit.distance },
            cutaway: { planes: [{ normal: back, point: V.mad(camera.target, back, offset), keep: 'negative' }],
              edge: { color: '#c79b62', width: .035, strength: .7 } } });
        }
      }
    }
    return { shots, ...(relationship && { relationship }) };
  }

  async function suggest(source, { definition, story, fromTick, toTick, limit = 12, scene } = {}) {
    check(Number.isInteger(limit) && limit >= 1 && limit <= maximum, 'Story shot limit must be 1–24');
    const begin = fromTick ?? source.origin.tick, end = toTick ?? source.end.tick;
    const output = timeline.forRun(source, { story, fromTick: begin, toTick: end, plan: escalationMarkers });
    const placements = new Map(), seen = new Set(), recent = new Map(), selected = [];
    let omitted = 0, duration;
    if (definition !== undefined) {
      const compiled = K.timeline.compile(definition, { exact: true });
      duration = compiled.duration;
      for (const row of compiled.markers) if (row.source && row.source.tick >= begin && row.source.tick <= end &&
        (story === undefined || row.source.story === story)) {
        if (!placements.has(row.beatId)) placements.set(row.beatId, []);
        placements.get(row.beatId).push(row);
      }
    }
    const rank = (a, b) => Number(b.subjects.length > 0) - Number(a.subjects.length > 0) ||
      score(b.marker) - score(a.marker) || a.marker.time - b.marker.time;
    await timeline.scan(source, (event, frame, query) => {
      const beatId = W.inspectionLinks.identify(event);
      const generated = definition === undefined ? output.add(event) : undefined;
      const markers = generated ? [generated] : placements.get(beatId) ?? [];
      if (markers.length && frame) {
        const evidence = subjects(event, frame, query, recent);
        for (const row of markers) {
          check(eventMatch(row, event, frame.world), 'Marker does not match its committed event ' + beatId);
          const marker = { ...row, time: T.seconds(T.read(row.time)) };
          selected.push({ marker, ...evidence, frame, query });
          selected.sort(rank);
          if (selected.length > limit) { selected.pop(); omitted++; }
        }
        seen.add(beatId);
      } else if (generated) omitted++;
      recent.set(beatId, anchors(event));
      if (recent.size > 512) recent.delete(recent.keys().next().value);
    });
    check([...placements.keys()].every(beatId => seen.has(beatId)),
      'A story marker has no matching committed pose in this recording');
    selected.sort((a, b) => a.marker.time - b.marker.time || score(b.marker) - score(a.marker));
    const times = new Set();
    const beats = selected.map((row, index) => {
      const { marker, subjects, missing, frame, query } = row;
      const { category, label, beatId, source, time, path } = marker;
      const { shots, relationship } = alternatives(subjects, frame.world, subjects[0]?.entity && scene?.(frame, query), frame.time);
      const preferred = category === 'discovery' && shots.some(shot => shot.id === 'section') ? 'section' :
        ['discovery', 'outcome', 'consequence'].includes(category) ? 'insert' :
        category === 'argument' && relationship ? 'pair' : 'wide';
      const suggested = shots.length ? preferred : null;
      const chosen = suggested && !times.has(time) ? suggested : null;
      if (chosen) times.add(time);
      return { id: 'beat-' + (index + 1), category, label, beatId, source, time, ...(path?.length && { path }),
        turningPoint: turningPoints.has(category), subjects, missing, ...(relationship && { relationship }),
        shots, suggested, selected: chosen };
    });
    duration ??= T.seconds(T.read(output.finish().duration));
    return freeze({ format, version: 1, world: source.origin.world.id, fromTick: begin, toTick: end, duration, omitted, beats });
  }

  function read(plan) {
    check(record(plan) && plan.format === format && plan.version === 1 && id(plan.world) && timeOK(plan.duration) &&
      Array.isArray(plan.beats) && plan.beats.length <= maximum, 'Expected a version 1 story shot plan');
    const ids = new Set(), cameraShots = { opening: {} }, chosen = [];
    for (const row of plan.beats) {
      check(record(row) && id(row.id) && !ids.has(row.id) && timeOK(row.time) && row.time <= plan.duration &&
        timeline.validSource(row.source, row.beatId) && row.source.world === plan.world &&
        Array.isArray(row.subjects) && row.subjects.length <= 8 && Array.isArray(row.shots) && row.shots.length <= 4,
      'Invalid story shot or timing');
      ids.add(row.id);
      const keys = new Set();
      for (const shot of row.shots) {
        check(record(shot) && id(shot.id) && !keys.has(shot.id) && record(shot.camera) && Array.isArray(shot.subjects),
          'Invalid candidate for ' + row.id);
        const name = row.id + '-' + shot.id;
        check(id(name) && !own(cameraShots, name), 'Conflicting camera shot name ' + name);
        keys.add(shot.id);
        cameraShots[name] = shot.camera;
        if (shot.cutaway !== undefined) K.cutaway.prepare(shot.cutaway);
      }
      check(row.selected === null || keys.has(row.selected), 'Unknown selected shot for ' + row.id);
      if (row.selected !== null) chosen.push({ time: row.time, shot: row.id + '-' + row.selected });
    }
    chosen.sort((a, b) => a.time - b.time);
    check(chosen.every((row, index) => !index || row.time > chosen[index - 1].time),
      'Selected shots share a cut time. Move or deselect one of them.');
    const rig = { duration: plan.duration, shots: cameraShots,
      sequence: chosen[0]?.time === 0 ? chosen : [{ time: 0, shot: 'opening' }, ...chosen] };
    return { rig, program: K.cameraRig.compile(rig) };
  }

  W.storyCamera = Object.freeze({ format, suggest, read, eventMatch });
})(KIT);
