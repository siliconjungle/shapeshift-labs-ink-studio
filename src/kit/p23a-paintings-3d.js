/* Retained 3D paintings and their scene placements. */
(function (K) {
  const format = 'ink-studio/painting-3d', { clone, freeze } = K.procedural.data;
  const DIO = K.diorama;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const name = value => K.world.data.id(value) && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const channels = ['brush', 'step', 'blendRadius', 'pressureResponse', 'looseness', 'direction', 'grid', 'relief', 'finish', 'mat', 'boil'];
  const editable = [...channels, 'preset', 'poses', 'path', 'res', 'transform', 'attachment', 'enabled', 'erasers'];
  const resources = ['profiles', 'flowMaps', 'presets'];

  function resolveBrush(brush, profiles) {
    if (brush?.kind !== 'mark-profile') return brush;
    const definition = profile => {
      if (typeof profile !== 'string') return profile;
      if (!Object.hasOwn(profiles, profile)) throw new RangeError('Unknown mark profile ' + profile);
      return profiles[profile];
    };
    return { ...brush, profile: definition(brush.profile),
      ...(record(brush.mix) && { mix: { ...brush.mix, profile: definition(brush.mix.profile) } }) };
  }

  function readPreset(presets, key) {
    if (!name(key) || !Object.hasOwn(presets ?? {}, key)) throw new RangeError('Unknown brush preset ' + key);
    return presets[key];
  }

  function checkPresets(presets, profiles, flowMaps) {
    if (!record(presets) || Object.keys(presets).length > 64 || !Object.keys(presets).every(name))
      throw new TypeError('A painting needs a map of up to 64 named brush presets');
    const P = K.procedural;
    for (const [id, style] of Object.entries(presets)) {
      try {
        if (!fields(style, channels) || !Object.keys(style).length || Object.values(style).some(value => value == null))
          throw new TypeError('A brush preset needs one or more style channels');
        const { brush = { kind: 'sphere', radius: .1 }, step, blendRadius, pressureResponse, looseness, direction, grid, relief } = style;
        P.shapeSweeps.prepare({ brush: resolveBrush(brush, profiles), step, blendRadius, pressureResponse, looseness,
          poses: [{ point: [0, 0, 0], pressure: pressureResponse?.width?.[0] > pressureResponse?.width?.[1] ? 0 : 1 }] });
        P.markDirection.prepare(direction, flowMaps);
        P.markGrid.prepare(grid, flowMaps);
        P.paintRelief.prepare(relief);
        PaintFinish.prepare(style.finish);
        P.paintBoil.prepare(style.boil);
      } catch (error) {
        throw new RangeError('Brush preset ' + id + ' — ' + error.message, { cause: error });
      }
    }
  }

  function expand(source, time = 0, waveMarks, throbMarks) {
    const anchors = new Map(), layers = new Set(), looseness = new Map(), boils = new Map(), reports = [];
    if (source?.paintings3d === undefined) return { spec: source, anchors, layers, looseness, boils, reports };
    const { paintings3d, ...scene } = source;
    if (!Array.isArray(paintings3d) || paintings3d.length > 64 ||
        scene.solids !== undefined && !Array.isArray(scene.solids) || scene.brushRegion != null)
      throw new TypeError('A native sculpt scene can contain up to 64 3D painting placements');
    const solids = scene.solids ?? [], graph = K.sceneGraph, placements = new Set();
    const hosts = new Map(solids.filter(s => s?.id).map(s => [s.id, s]));
    const parts = new Set(solids.filter(s => s?.part && !s.hold && !s.carve && !s.ghost).map(s => s.part));
    const occupied = new Set([...DIO.solids(scene)].map(s => s.id));
    const marks = [];
    let spills = 0;
    for (const placement of paintings3d) {
      if (!fields(placement, ['id', 'painting', 'bindings', 'transform']) || !name(placement.id) || placements.has(placement.id))
        throw new TypeError('3D painting placements need unique IDs and a portable painting');
      const { id, painting, bindings = {}, transform } = placement;
      placements.add(id);
      if (!fields(painting, ['format', 'version', 'id', 'marks', ...resources]) || painting.format !== format ||
          painting.version !== 1 || !name(painting.id) || !Array.isArray(painting.marks) || painting.marks.length > 256)
        throw new TypeError(id + ' needs a version 1 ' + format + ' document with up to 256 ordered marks');
      if (!record(bindings) || Object.entries(bindings).some(([slot, target]) => !name(slot) || !TargetSelectors.name(target)))
        throw new TypeError(id + ' bindings must map slot names to solid or part IDs');
      const profiles = painting.profiles ?? {};
      if (!record(profiles) || painting.profiles === null || Object.keys(profiles).length > 64 || !Object.keys(profiles).every(name))
        throw new TypeError(id + ' needs a map of up to 64 named mark profiles');
      for (const [key, profile] of Object.entries(profiles)) {
        try { K.procedural.markProfiles.prepare(profile); }
        catch (error) { throw new RangeError(id + ' profile ' + key + ' — ' + error.message, { cause: error }); }
      }
      const flowMaps = painting.flowMaps ?? {};
      if (!record(flowMaps) || painting.flowMaps === null || Object.keys(flowMaps).length > 64 || !Object.keys(flowMaps).every(name))
        throw new TypeError(id + ' needs a map of up to 64 named flow maps');
      const openedFlows = Object.fromEntries(Object.entries(flowMaps).map(([key, flow]) => {
        try { return [key, K.flowMap.open(flow)]; }
        catch (error) { throw new TypeError(id + ' flow map ' + key + ' — ' + error.message, { cause: error }); }
      }));
      const { presets = {} } = painting;
      checkPresets(presets, profiles, openedFlows);
      const frame = graph.transform(transform), ids = new Set(), slots = new Set();
      const report = { id, painting: painting.id, transform: frame, marks: [],
        ...(painting.profiles !== undefined && { profiles: Object.keys(profiles) }),
        ...(painting.flowMaps !== undefined && { flowMaps: Object.keys(flowMaps) }),
        ...(painting.presets !== undefined && { presets: Object.keys(presets) }) };
      reports.push(report);
      for (const [order, mark] of painting.marks.entries()) {
        if (!fields(mark, ['id', ...editable]) || !name(mark.id) || ids.has(mark.id) ||
            mark.enabled !== undefined && typeof mark.enabled !== 'boolean' ||
            mark.res !== undefined && (!Number.isFinite(mark.res) || mark.res <= 0))
          throw new TypeError(id + ' mark ' + order + ' needs a unique ID, brush, poses and material');
        const presetStyle = mark.preset === undefined ? {} : readPreset(presets, mark.preset);
        const { id: key, attachment = { kind: 'free' }, transform, enabled = true, looseness: authoredStyle, preset,
          direction: authoredDirection, grid: authoredGrid, relief: authoredRelief, finish: authoredFinish,
          erasers: authoredErasers, boil: authoredBoil, ...stroke } = { ...presetStyle, ...mark };
        if (stroke.mat === undefined && authoredFinish === undefined) throw new TypeError(id + ' mark ' + key + ' needs a material');
        ids.add(key);
        const solid = 'paint.' + id + '.' + key;
        const markFrame = graph.transform(transform), guideFrame = graph.compose(frame, markFrame);
        const wave = waveMarks?.get(solid), pulse = throbMarks?.get(solid);
        let restAffine = guideFrame, part, target;
        if (!fields(attachment, ['kind', 'slot', 'snap']) || !['free', 'surface', 'part'].includes(attachment.kind) ||
            (attachment.kind === 'free' ? attachment.slot !== undefined : !name(attachment.slot)) ||
            (attachment.kind === 'surface') !== (attachment.snap !== undefined))
          throw new TypeError(solid + ' needs a free, surface or part attachment');
        let shape, style, direction, grid, relief, finish, erasers, boil, drawing;
        try {
          boil = K.procedural.paintBoil.prepare(authoredBoil);
          if (boil?.active) ({ drawing } = K.procedural.paintBoil.state(boil, time));
          relief = K.procedural.paintRelief.prepare(authoredRelief);
          finish = PaintFinish.prepare(authoredFinish);
          if (pulse?.height !== undefined) {
            if (!relief || relief.mode==='flat') throw new TypeError('Height pulses need shading or volume relief');
            relief={...relief,height:relief.height*pulse.height};
          }
          if (pulse?.emission !== undefined) {
            if (!finish?.emission) throw new TypeError('Emission pulses need a finish with authored emission');
            finish={...finish,emission:finish.emission.map(n=>n*pulse.emission),
              ...(finish.spill && {spill:{...finish.spill,intensity:finish.spill.intensity*pulse.emission}})};
          }
          if (pulse?.coverage !== undefined && relief?.mode==='volume' && relief.height<0)
            throw new TypeError('Coverage pulses need additive or surface paint');
          erasers = K.procedural.channelEraser.surface(authoredErasers);
          if (erasers && (attachment.kind !== 'surface' || attachment.snap.mode !== 'surface'))
            throw new TypeError('Channel erasers need a surface attachment in surface snap mode');
          if (finish && (attachment.kind !== 'surface' || attachment.snap.mode !== 'surface' || relief?.mode === 'volume'))
            throw new TypeError('Finish paint needs surface snap mode and can share flat or shading relief');
          if (relief && (attachment.kind !== 'surface' || attachment.snap.mode !== 'surface'))
            throw new TypeError('Paint relief needs a surface attachment in surface snap mode');
          direction = K.procedural.markDirection.prepare(authoredDirection, openedFlows);
          if (direction && attachment.kind !== 'surface') throw new TypeError('Mark direction needs a surface attachment');
          grid = K.procedural.markGrid.prepare(authoredGrid, openedFlows);
          if (grid && (attachment.kind !== 'surface' || grid.settings.kind !== 'direction' && attachment.snap.mode !== 'surface'))
            throw new TypeError('A mark grid needs a surface attachment and positional grids need surface snap mode');
          style = K.procedural.paintLooseness.prepare(authoredStyle);
          if (wave?.target.mode === 'pigment' && (attachment.kind !== 'surface' || attachment.snap.mode !== 'surface' ||
              relief?.mode === 'volume' || !relief && !finish && style?.silhouetteAllowance !== 0))
            throw new TypeError('Pigment waves need a flat, shading-relief or finish surface stroke');
          if (wave?.target.mode === 'raised' && !(relief?.mode === 'volume' && relief.height > 0))
            throw new TypeError('Raised waves need positive volume relief');
          if (authoredErasers?.some(row => row.channels.includes('paint')) &&
              (finish || relief?.mode === 'volume' || !relief && style?.silhouetteAllowance !== 0))
            throw new TypeError('Paint erasers need a flat pigment or shading-relief stroke');
          if (relief?.mode === 'volume' && authoredErasers?.some(row => row.channels.includes('relief')))
            throw new TypeError('The relief eraser controls shading relief');
          if (style && !relief && !finish && (attachment.kind === 'surface') !== (style.silhouetteAllowance !== undefined))
            throw new TypeError(attachment.kind === 'surface' ? 'State a silhouette allowance for surface looseness'
              : 'A silhouette allowance needs a surface receiver');
          if (relief?.mode === 'volume' && relief.height > 0 && style?.silhouetteAllowance === 0)
            throw new RangeError('Raised volume needs positive silhouette clearance. Use shading relief for a zero silhouette allowance');
          shape = { kind: 'sweep', id: solid, ...stroke, brush: resolveBrush(stroke.brush, profiles) };
          if (wave) shape = K.procedural.paintWave.stroke(shape, markFrame, wave);
          K.procedural.shapeSweeps.prepare({ ...shape, looseness: authoredStyle });
          if (attachment.kind === 'surface') K.procedural.sweepSnap.check(attachment.snap, shape);
        } catch (error) {
          throw new RangeError(solid + ' ' + error.message, { cause: error });
        }
        if (attachment.slot !== undefined) {
          slots.add(attachment.slot);
          if (Object.hasOwn(bindings, attachment.slot)) target = bindings[attachment.slot];
          if (enabled && target === undefined) throw new RangeError(solid + ' needs a binding for slot ' + attachment.slot);
        }
        if (enabled) {
          if (finish?.spill && ++spills > 16) throw new RangeError('A scene can have up to 16 finish strokes with light spill');
          if (occupied.has(solid)) throw new RangeError('3D painting solid ID is already in use: ' + solid);
          occupied.add(solid);
          if (attachment.kind === 'surface') {
            const host = hosts.get(target);
            if (!host || host.kind === 'ground' || host.carve || host.ghost || host.hold)
              throw new RangeError(solid + ' needs a named exterior sculpt for slot ' + attachment.slot);
            part = host.part;
            restAffine = graph.compose(DIO.solidFrames.rest(host), guideFrame);
            const map = authoredDirection?.field?.map, gridMap = authoredGrid?.field?.map;
            anchors.set(solid, { host, guideFrame, snap: attachment.snap,
              ...(relief && { relief }),
              ...(finish && { finish }),
              ...(erasers && { erasers }),
              ...(direction && { direction, flowAsset: typeof map === 'string' ? flowMaps[map] : map }),
              ...(grid && { grid, gridFlow: typeof gridMap === 'string' ? flowMaps[gridMap] : gridMap }) });
          } else if (attachment.kind === 'part') {
            if (!parts.has(target)) throw new RangeError(solid + ' needs an existing sculpt rig part for slot ' + attachment.slot);
            part = target;
          }
          layers.add(solid);
          if (style) looseness.set(solid, style);
          if (boil?.active) boils.set(solid, { plan: boil, drawing });
          marks.push({ ...shape, restAffine, ...(part && { part }) });
          if (marks.length > 4096) throw new RangeError('A scene can render up to 4096 painting marks');
        }
        const { brush } = stroke;
        report.marks.push({ id: key, order, enabled, attachment: attachment.kind, ...(attachment.slot && { slot: attachment.slot }),
          ...(target && { target }), ...(part && { part }), ...(enabled && { solid, transform: restAffine }),
          brush: brush.kind, ...(stroke.mat !== undefined && { material: stroke.mat }), poses: stroke.poses.length,
          ...(preset !== undefined && { preset, channelSources: Object.fromEntries(channels.filter(channel =>
            Object.hasOwn(mark, channel) || Object.hasOwn(presetStyle, channel)).map(channel =>
            [channel, Object.hasOwn(mark, channel) ? 'mark' : 'preset'])) }),
          ...(typeof brush.profile === 'string' && { profile: brush.profile }),
          ...(brush.mix && { mix: { range: brush.mix.range, ...(typeof brush.mix.profile === 'string' && { profile: brush.mix.profile }) } }),
          ...(style && { looseness: style }),
          ...(direction && { direction: { field: direction.field, strength: direction.strength,
            ruffleDegrees: direction.ruffleDegrees, seed: direction.seed } }),
          ...(grid && { grid: grid.settings }),
          ...(relief && { relief }),
          ...(finish && { finish: authoredFinish }),
          ...(boil && { boil: authoredBoil, ...(drawing !== undefined && { drawing }) }),
          ...(wave && { wave: wave.id }),
          ...(pulse && { pulse }),
          ...(authoredErasers !== undefined && { erasers: authoredErasers }),
          ...(stroke.step !== undefined && { step: stroke.step }), ...(stroke.blendRadius !== undefined && { blendRadius: stroke.blendRadius }),
          ...(stroke.path !== undefined && { path: stroke.path }), ...(stroke.pressureResponse && { pressureResponse: stroke.pressureResponse }) });
      }
      for (const slot of Object.keys(bindings)) if (!slots.has(slot))
        throw new RangeError(id + ' has no attachment slot ' + slot);
    }
    // Field ownership breaks a tie in insertion order, so later marks are built first.
    return { spec: { ...scene, solids: [...solids, ...marks.reverse()] }, anchors, layers, looseness, boils, reports };
  }

  function editMarks(painting, edits, previousPresets) {
    if (!Array.isArray(edits) || !edits.length) throw new TypeError('Mark edits must be a nonempty ordered array');
    const marks = painting.marks.slice();
    for (const change of edits) {
      if (!record(change) || !name(change.id)) throw new TypeError('A mark edit needs an operation and mark ID');
      const index = marks.findIndex(mark => mark.id === change.id);
      if (change.op === 'add') {
        if (!fields(change, ['op', 'id', 'mark']) || index !== -1 || !fields(change.mark, editable))
          throw new TypeError('An add edit needs a new ID and mark settings');
        marks.push({ ...change.mark, id: change.id });
        continue;
      }
      if (index === -1) throw new RangeError('Unknown mark ' + change.id);
      if (change.op === 'remove' && fields(change, ['op', 'id'])) marks.splice(index, 1);
      else if (change.op === 'set' && fields(change, ['op', 'id', 'patch']) && fields(change.patch, editable)) {
        const updated = { ...marks[index], ...change.patch };
        for (const [key, value] of Object.entries(change.patch)) if (value === null) delete updated[key];
        marks[index] = updated;
      } else if (change.op === 'set-finish' && fields(change, ['op', 'id', 'patch']) && fields(change.patch, PaintFinish.keys)) {
        const current = marks[index];
        const prior = current.finish ?? (current.preset !== undefined ? readPreset(painting.presets, current.preset).finish : undefined);
        const finish = { ...prior, ...change.patch };
        for (const [key, value] of Object.entries(change.patch)) if (value === null) delete finish[key];
        marks[index] = { ...current, finish };
      } else if (change.op === 'set-eraser' && fields(change, ['op', 'id', 'eraser', 'patch'])) {
        const current = marks[index], erasers = K.procedural.channelEraser.revise(current.erasers, change.eraser, change.patch);
        const updated = { ...current };
        if (erasers.length) updated.erasers = erasers;
        else delete updated.erasers;
        marks[index] = updated;
      } else if (change.op === 'apply-preset' && fields(change, ['op', 'id', 'preset'])) {
        const current = marks[index], preset = readPreset(painting.presets, change.preset);
        const available = Object.hasOwn(painting.presets ?? {}, current.preset) ? painting.presets : previousPresets;
        const inherited = current.preset === undefined ? {} : readPreset(available, current.preset);
        const updated = { ...inherited, ...current, preset: change.preset };
        for (const channel of channels) if (Object.hasOwn(preset, channel)) delete updated[channel];
        marks[index] = updated;
      } else if (change.op === 'move' && fields(change, ['op', 'id', 'before'])) {
        const [mark] = marks.splice(index, 1);
        const before = change.before === undefined ? marks.length : marks.findIndex(row => row.id === change.before);
        if (before < 0) throw new RangeError('Unknown destination mark ' + change.before);
        marks.splice(before, 0, mark);
      } else throw new TypeError('Use add, remove, set, set-finish, set-eraser, move or apply-preset to edit a mark');
    }
    return { ...painting, marks };
  }

  function revise(scene, input, update = false) {
    const value = clone(input), list = scene.paintings3d ?? [];
    if (!record(value) || !name(value.id)) throw new TypeError('A 3D painting request needs a placement ID');
    const index = list.findIndex(row => row.id === value.id);
    if (!update) {
      if (index !== -1) throw new RangeError('3D painting placement is already in use: ' + value.id);
      return [...list, value];
    }
    if (index === -1) throw new RangeError('Unknown 3D painting placement ' + value.id);
    if (!fields(value, ['id', 'transform', 'bindings', 'painting', 'edits', ...resources]) ||
        value.painting !== undefined && ['edits', ...resources].some(key => value[key] !== undefined) ||
        resources.some(key => value[key] !== undefined && !record(value[key])))
      throw new TypeError('A painting update can replace the document or edit resources, marks, bindings and transform');
    const { edits, profiles, flowMaps, presets, ...patch } = value, current = list[index];
    const revised = { ...current, ...patch };
    for (const [key, changes] of Object.entries({ profiles, flowMaps, presets })) {
      if (changes === undefined) continue;
      const definitions = Object.fromEntries(Object.entries({ ...revised.painting[key], ...changes }).filter(([, asset]) => asset !== null));
      revised.painting = { ...revised.painting, [key]: definitions };
    }
    if (edits !== undefined) revised.painting = editMarks(revised.painting, edits, current.painting.presets);
    for (const key of ['transform', 'bindings']) if (revised[key] === null) delete revised[key];
    return list.map((row, i) => i === index ? revised : row);
  }

  function extract(scene, id) {
    const placement = scene.paintings3d?.find(row => row.id === id);
    if (!placement) throw new RangeError('Unknown 3D painting placement ' + id);
    return freeze(clone(placement.painting));
  }

  K.authoring.paintings3d = Object.freeze({ format, expand, revise, extract });
})(KIT);
