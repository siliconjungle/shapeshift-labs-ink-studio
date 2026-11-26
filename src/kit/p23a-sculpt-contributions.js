/* Stable stack selections and rest-pose comparisons for retained sculpt edits. */
(function (K) {
  const { diorama: DIO, V } = K;
  const { clone, freeze } = K.procedural.data;
  const { name } = TargetSelectors;
  const common = ['solid', 'contribution', 'op'];
  const optionFields = {
    move: ['delta'], stretch: ['factors', 'pivot'], clone: ['id', 'index'],
    replace: ['replacement'], mute: ['muted'], reorder: ['index']
  };
  const fields = (value, keys) => K.world.data.record(value) && Object.keys(value).every(key => keys.includes(key));
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

  function host(scene, id) {
    const solid = name(id) && scene.solids?.find(row => row.id === id);
    if (!solid || solid.kind === 'ground' || solid.carve || solid.ghost || solid.hold)
      throw new RangeError('Choose a named top-level exterior sculpt solid: ' + id);
    return solid;
  }

  function summary(row, index) {
    const { id, kind, label, shape, how, mode, enabled } = row;
    return { id, index, kind, enabled: enabled !== false, ...(label && { label }),
      ...(shape && { shape: shape.kind }), ...(how && { how }), ...(mode && { mode }) };
  }

  function list(scene, id) {
    return (host(scene, id).modifiers ?? []).map(summary);
  }

  function select(scene, solid, id) {
    const owner = host(scene, solid), stack = owner.modifiers ?? [];
    const index = name(id) ? stack.findIndex(row => row.id === id) : -1;
    if (index === -1) throw new RangeError('Unknown sculpt contribution ' + id + ' on ' + solid);
    return { owner, stack, index, row: stack[index] };
  }

  function mapGridBrush(brush, point, direction) {
    // Attachments describe the original capture. Only the resolved geometry is placed.
    if (brush.version === 3) return { ...brush, stamps: brush.stamps.map(stamp =>
      ({ ...stamp, origin: point(stamp.origin), axes: stamp.axes.map(direction) })) };
    if (brush.version === 2) return { ...brush, columns: brush.columns.map(column =>
      ({ ...column, corners: column.corners.map(point) })) };
    const { projection } = brush;
    return { ...brush, projection: { ...projection, origin: point(projection.origin),
      right: direction(projection.right), down: direction(projection.down), forward: direction(projection.forward) } };
  }

  function move(row, delta) {
    if (!xyz(delta)) throw new TypeError('A move needs a finite XYZ delta');
    if (row.shape) {
      const translation = V.add(row.shape.transform?.translation ?? [0, 0, 0], delta);
      return { ...row, shape: { ...row.shape, transform: { ...row.shape.transform, translation } } };
    }
    if (row.kind === 'grid-brush') return { ...row, brush: mapGridBrush(row.brush, p => V.add(p, delta), p => p) };
    throw new RangeError('Move requires a shape operand or a retained grid brush');
  }

  function stretch(row, factors, pivot = [0, 0, 0]) {
    if (!xyz(factors) || factors.some(n => n < .02 || n > 20) || !xyz(pivot))
      throw new TypeError('A stretch needs three factors from 0.02 to 20 and an optional XYZ pivot');
    if (row.shape) {
      const stack = row.shape.modifiers ?? [];
      let id = 'stretch', suffix = 2;
      while (stack.some(modifier => modifier.id === id)) id = 'stretch-' + suffix++;
      return { ...row, shape: { ...row.shape, modifiers: [...stack,
        { id, kind: 'warp', stretch: factors, centre: pivot }] } };
    }
    if (row.kind === 'grid-brush') {
      const direction = v => v.map((value, axis) => value * factors[axis]);
      const point = p => V.add(pivot, direction(V.sub(p, pivot)));
      return { ...row, brush: mapGridBrush(row.brush, point, direction) };
    }
    throw new RangeError('Stretch requires a shape operand or a retained grid brush');
  }

  function cloneShape(shape, prefix) {
    const result = { ...shape, ...(shape.id !== undefined && { id: prefix + '/' + shape.id }) };
    for (const key of DIO.operandFields(shape)) result[key] = cloneShape(shape[key], prefix);
    if (shape.modifiers) result.modifiers = shape.modifiers.map(modifier => modifier.shape ?
      { ...modifier, shape: cloneShape(modifier.shape, prefix) } : modifier);
    return result;
  }

  function insert(stack, index, row) {
    if (!Number.isSafeInteger(index) || index < 0 || index > stack.length)
      throw new RangeError('Set index to a zero-based position from 0 to ' + stack.length);
    stack.splice(index, 0, row);
  }

  function revised(selection, request) {
    const { index, row, stack } = selection;
    const next = stack.slice(), op = request.op;
    if (op === 'move') next[index] = move(row, request.delta);
    if (op === 'stretch') next[index] = stretch(row, request.factors, request.pivot);
    if (op === 'mute') {
      const { muted = true } = request;
      if (typeof muted !== 'boolean') throw new TypeError('Mute needs a boolean muted value');
      next[index] = { ...row, enabled: !muted };
    }
    if (op === 'replace') {
      const { replacement } = request;
      if (!K.world.data.record(replacement) || !Object.hasOwn(replacement, 'kind') || Object.hasOwn(replacement, 'id'))
        throw new TypeError('Supply a replacement modifier with a kind. The contribution retains its ID');
      next[index] = { ...(row.enabled !== undefined && { enabled: row.enabled }), ...replacement, id: row.id };
    }
    if (op === 'clone') {
      const { id } = request;
      if (!name(id) || stack.some(entry => entry.id === id)) throw new RangeError('Clone needs a unique contribution ID');
      const copy = { ...row, id, ...(row.shape && { shape: cloneShape(row.shape, id) }) };
      insert(next, request.index ?? index + 1, copy);
    }
    if (op === 'reorder') {
      next.splice(index, 1);
      insert(next, request.index, row);
    }
    return next;
  }

  function cuts(row) {
    return row.kind === 'mask' ||
      row.kind === 'join' && /^(cut|engrave|groove)/.test(row.how) ||
      row.kind === 'grid-brush' && ['cut', 'carve', 'through-cut', 'scrape', 'crease', 'smooth'].includes(row.mode);
  }

  function box(shape) {
    if (!shape || !Number.isFinite(shape.br) || shape.br >= 1e8) return;
    return shape.geometryBounds ?? { min: shape.bc.map(c => c - shape.br), max: shape.bc.map(c => c + shape.br) };
  }

  function samples(bounds, count, pad = 0) {
    const points = [];
    for (const { min, max } of bounds) {
      const axes = min.map((lo, i) =>
        Array.from({ length: count }, (_, j) => lo - pad + j * (max[i] - lo + 2 * pad) / (count - 1)));
      for (const x of axes[0]) for (const y of axes[1]) for (const z of axes[2]) points.push([x, y, z]);
    }
    return points;
  }

  function cutReport(before, after, original, edited, focus) {
    const beforeFocus = original.findIndex(row => row.id === focus), afterFocus = edited.findIndex(row => row.id === focus);
    const rows = new Map();
    for (const [side, stack, at] of [['before', original, beforeFocus], ['after', edited, afterFocus]]) {
      for (const [index, row] of stack.entries()) if (at >= 0 && index > at && cuts(row)) {
        if (!rows.has(row.id)) rows.set(row.id, { id: row.id });
        rows.get(row.id)[side] = summary(row, index);
      }
    }
    return [...rows.values()].map(row => {
      // Compare removal wherever the cutter ran in both builds, including when reorder changed its prefix.
      const a = before.stages.get(row.id), b = after.stages.get(row.id);
      const bounds = [a?.tool, b?.tool, before.stages.get(focus)?.tool, after.stages.get(focus)?.tool];
      if (!a?.tool || !b?.tool || row.before?.mode === 'keep' || row.after?.mode === 'keep')
        bounds.push(box(a?.before), box(b?.before));
      const probes = samples(bounds.filter(Boolean), 7);
      let lost = 0, gained = 0, witness;
      const removed = (trace, stage, point) => stage &&
        trace.distance(stage.before, point) < -1e-5 && trace.distance(stage.after, point) > 1e-5;
      for (const point of probes) {
        const one = Boolean(removed(before, a, point)), two = Boolean(removed(after, b, point));
        if (one === two) continue;
        witness ??= point;
        if (one) lost++;
        else gained++;
      }
      return { ...row, status: lost || gained ? 'observed-change' : a || b ? 'stack-dependency' : 'muted',
        samples: probes.length, removedBeforeOnly: lost, removedAfterOnly: gained, ...(witness && { witness }) };
    });
  }

  function distance(trace, point) {
    return trace.distance(trace.output, point);
  }

  function surface(trace, lo, hi, a, b) {
    if ((a < 0) === (b < 0)) return;
    for (let i = 0; i < 13; i++) {
      const mid = V.lerp(lo, hi, .5);
      if ((distance(trace, mid) < 0) === (a < 0)) lo = mid;
      else hi = mid;
    }
    return V.lerp(lo, hi, .5);
  }

  function appearance(trace, point) {
    const e = .001;
    const normal = V.norm(point.map((_, axis) => {
      const right = point.slice(), left = point.slice();
      right[axis] += e;
      left[axis] -= e;
      return distance(trace, right) - distance(trace, left);
    }), [0, 1, 0]);
    const { role, chart, generatedSurface, paintIds } = trace.materialAt(point, normal);
    return [
      ...(role ? [{ kind: 'role', id: role }] : []),
      ...(chart ? [{ kind: 'chart', id: chart }] : []),
      ...(generatedSurface ? [{ kind: 'cut-surface', id: generatedSurface.stroke, face: generatedSurface.face }] : []),
      ...paintIds.map(id => ({ kind: 'paint', id }))
    ];
  }

  function materialReport(before, after, original, focus) {
    const stages = [before.stages.get(focus), after.stages.get(focus)];
    const bounds = [box(before.output), box(after.output), ...stages.map(stage => stage?.tool)].filter(Boolean);
    const points = samples(bounds, 8, .015);
    const offsets = [64, 8, 1], regions = new Map();
    let surfaceSamples = 0;
    function compare(point, side) {
      const a = side === 'before' ? before : after, b = side === 'before' ? after : before;
      const other = Math.abs(distance(b, point)) <= .004 ? new Set(appearance(b, point).map(row => JSON.stringify(row))) : new Set();
      surfaceSamples++;
      for (const item of appearance(a, point)) {
        const key = JSON.stringify(item);
        if (other.has(key)) continue;
        if (!regions.has(key)) regions.set(key, { ...item, beforeOnly: 0, afterOnly: 0, witness: point });
        regions.get(key)[side + 'Only']++;
      }
    }
    for (const [side, trace] of [['before', before], ['after', after]]) {
      const distances = points.map(point => distance(trace, point));
      for (let i = 0; i < points.length; i++) for (const offset of offsets) {
        if (Math.floor(i / offset) % 8 === 7) continue;
        const hit = surface(trace, points[i], points[i + offset], distances[i], distances[i + offset]);
        if (hit) compare(hit, side);
      }
      // Check a bounded set of actual paint contacts as well as the regular grids.
      for (const stroke of original.sdfPaint?.strokes ?? []) {
        const step = Math.ceil(stroke.cells.length / 8);
        for (let i = 0; i < stroke.cells.length; i += step) {
          const [, , anchor, normal, band] = stroke.cells[i];
          const lo = V.mad(anchor, normal, -band), hi = V.mad(anchor, normal, band);
          const hit = surface(trace, lo, hi, distance(trace, lo), distance(trace, hi));
          if (hit) compare(hit, side);
        }
      }
    }
    return { surfaceSamples, regions: [...regions.values()] };
  }

  function report(scene, selection, modifiers, focus, env) {
    const { owner, stack } = selection;
    const next = { ...scene, solids: scene.solids.map(solid => solid === owner ? { ...owner, modifiers } : solid) };
    const before = DIO.sculptRestTrace(scene, owner.id, env), after = DIO.sculptRestTrace(next, owner.id, env);
    return { solid: owner.id, contribution: focus, space: 'solid-rest',
      cuts: cutReport(before, after, stack, modifiers, focus),
      materials: materialReport(before, after, owner, focus) };
  }

  function inspect(scene, solid, id, env) {
    const selection = select(scene, solid, id);
    const muted = revised(selection, { op: 'mute' });
    return freeze({ entry: clone(selection.row), comparison: 'muted',
      ...report(scene, selection, muted, id, env) });
  }

  function plan(scene, input, env) {
    if (!Object.hasOwn(optionFields, input?.op) || !fields(input, [...common, ...optionFields[input.op]]))
      throw new TypeError('Expected a sculpt contribution move, stretch, clone, replace, mute, or reorder request');
    const request = clone(input);
    const selection = select(scene, request.solid, request.contribution);
    const modifiers = revised(selection, request), focus = request.op === 'clone' ? request.id : request.contribution;
    return { modifiers, report: freeze({ op: request.op, ...report(scene, selection, modifiers, focus, env) }) };
  }

  K.authoring.sculptContributions = Object.freeze({ list, inspect, plan });
})(KIT);
