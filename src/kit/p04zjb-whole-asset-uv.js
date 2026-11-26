/* Whole retained mesh UV preparation and native material-sheet pagination. */
(function (K) {
  const T = K.meshTopology, UV = T.uv, V = K.V, { freeze } = K.procedural.data;
  const format = 'ink-studio/uv-tile-layout';
  const { tuple, integer, fields, bounds } = meshUVRegions;
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const clamp = x => Math.min(1, Math.max(0, x));
  const finite = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  function need(ok, message) {
    if (!ok) throw new RangeError('Whole-asset UV: ' + message);
  }

  function settings(raw, prepare) {
    const common = ['uvSet', 'atlas', 'texelsPerUnit', 'densityTolerance', 'maxStretch', 'maxChecks', 'acceptHeldDensity'];
    const more = ['revision', 'seamAngle', 'gutter', 'maxTiles', 'columns', 'protect'];
    need(fields(raw, prepare ? common.concat(more) : common), 'unknown setting');
    const spec = { uvSet: 'pigment', atlas: [64, 64], texelsPerUnit: 16, densityTolerance: .16,
      maxStretch: 1.8, maxChecks: 3000000, acceptHeldDensity: false, ...raw };
    need((MaterialUV.layout(spec.uvSet) || MaterialUV.channel(spec.uvSet)) &&
      tuple(spec.atlas, 2, n => integer(n, 8, 4096)) && finite(spec.texelsPerUnit, .01, 4096) &&
      finite(spec.densityTolerance, 0, 1) && finite(spec.maxStretch, 1, 50) &&
      integer(spec.maxChecks, 1, 16000000) && typeof spec.acceptHeldDensity === 'boolean', 'invalid layout, density, distortion or budget');
    if (!prepare) return spec;
    const { seamAngle = 58, gutter = 2, maxTiles = 16, columns = 4 } = raw;
    need(finite(seamAngle, 1, 180) && integer(gutter, 1, 32) && integer(maxTiles, 1, 32) &&
      integer(columns, 1, 32) && spec.atlas.every(n => n - 1 > gutter * 2), 'invalid tile, gutter or seam setting');
    return { ...spec, seamAngle, gutter, maxTiles, columns };
  }

  function model(source, selector) {
    const doc = T.create(source);
    need(doc.faces.length >= 1 && doc.faces.length <= 12000, 'mesh needs 1 to 12000 faces');
    const set = MaterialUV.resolve(doc.uvBindings, selector), layout = UV.inspect(doc, set);
    const corners = index(layout.corners), faces = index(doc.faces), meta = index(layout.faces), edges = index(layout.edges);
    const vertices = index(doc.vertices), positions = new Map();
    for (const c of corners.values()) positions.set(c.id, vertices.get(c.vertex).position);
    const triangles = T.triangulate(doc).triangleSources.map(({ face, corners: ids }) =>
      ({ face, corners: ids, positions: ids.map(id => positions.get(id)),
        material: faces.get(face).material, island: meta.get(face).island }));
    need(triangles.length <= 24000, 'triangle budget exceeded');
    const byFace = new Map(doc.faces.map(face => [face.id, []]));
    for (const row of triangles) byFace.get(row.face).push(row);
    return { doc, set, layout, corners, positions, faces, meta, edges, triangles, byFace };
  }

  function protection(g, raw = {}, options) {
    need(fields(raw, ['seams', 'painted']), 'protection accepts seams and painted spans');
    const held = new Map(), refused = new Set(), pins = [], ids = new Set(), protectedEdges = new Set();
    function hold(face, reason) {
      const id = g.meta.get(face)?.island;
      need(id, 'unknown protected face ' + face);
      if (!held.has(id)) held.set(id, new Set());
      held.get(id).add(reason);
    }
    function edge(id, reason) {
      const row = g.edges.get(id);
      need(row, 'unknown protected edge ' + id);
      protectedEdges.add(id);
      row.sides.forEach(({ face }) => hold(face, reason));
    }
    const { seams = [], painted = [] } = raw;
    need(Array.isArray(seams) && Array.isArray(painted) && painted.length <= 256, 'invalid protection lists');
    for (const id of seams) edge(id, 'approved-seam');
    for (const row of painted) {
      need(fields(row, ['id', 'faces', 'edges']) && typeof row.id === 'string' && row.id.trim() && !ids.has(row.id) &&
        Array.isArray(row.faces ?? []) && Array.isArray(row.edges ?? []) &&
        ((row.faces ?? []).length || (row.edges ?? []).length), 'painted spans need distinct IDs and a face or edge');
      ids.add(row.id);
      for (const id of row.faces ?? []) hold(id, 'pigment:' + row.id);
      for (const id of row.edges ?? []) edge(id, 'pigment:' + row.id);
    }
    for (const corner of g.corners.values()) if (corner.pinned) {
      pins.push(corner);
      hold(corner.face, 'pinned-corner');
    }
    for (const face of g.faces.values()) {
      if (options.atlasFor?.(face.material)) hold(face.id, 'registered-map');
      if (options.lockedMaterials?.has(face.material)) hold(face.id, 'retained-bake');
    }
    for (const id of options.lockedFaces ?? []) hold(id, 'authored-binding');
    for (const id of held.keys()) {
      const island = g.layout.islands.find(row => row.id === id);
      for (const face of island.faces) refused.add(face);
    }
    return { held, refused, pins, protectedEdges };
  }

  function sizeFor(options, spec, id) {
    const size = options.atlasFor?.(id)?.size ?? spec.atlas;
    need(tuple(size, 2, n => integer(n, 1, 16384)), 'invalid tile size for ' + id);
    return size;
  }

  function measure(g, spec, uv, sizeFor, held, work) {
    const configured = new Map(), faces = new Map(), valid = [];
    const overlaps = [], overlapFaces = new Set();
    let overlapCount = 0;
    for (const tri of g.triangles) {
      if (!configured.has(tri.material)) configured.set(tri.material, sizeFor(tri.material).map(n => n - 1));
      const spans = configured.get(tri.material), coords = tri.corners.map(id => uv(id).map((n, k) => n * spans[k]));
      const metric = MeshUV.metrics(tri.positions, coords);
      if (!faces.has(tri.face)) faces.set(tri.face, { face: tri.face, material: tri.material, triangles: 0,
        held: held.has(tri.face), densityMin: Infinity, densityMax: 0, maxStretch: 0, reasons: new Set() });
      const row = faces.get(tri.face);
      row.triangles++;
      if (metric.state !== 'ok') { row.reasons.add(metric.state); continue; }
      valid.push(tri);
      row.densityMin = Math.min(row.densityMin, metric.density);
      row.densityMax = Math.max(row.densityMax, metric.density);
      row.maxStretch = Math.max(row.maxStretch, metric.stretch);
      if (Math.abs(metric.density / spec.texelsPerUnit - 1) > spec.densityTolerance + 1e-10) row.reasons.add('density-outside-tolerance');
      if (metric.stretch > spec.maxStretch + 1e-10) row.reasons.add('distortion');
    }
    const scan = MeshUV.scanOverlaps(valid, tri => tri.corners.map(uv),
      work.overlap, (a, b) => {
        overlapCount++;
        overlapFaces.add(a.face);
        overlapFaces.add(b.face);
        faces.get(a.face).reasons.add('overlap');
        faces.get(b.face).reasons.add('overlap');
        if (overlaps.length < 128) overlaps.push({ faces: [a.face, b.face].sort(cmp), material: a.material,
          sameIsland: a.island === b.island });
      });
    work.overlap -= scan.checks;
    const rows = [...faces.values()].map(({ reasons, ...row }) => ({ ...row, densityMin: Number.isFinite(row.densityMin) ? row.densityMin : null,
      densityMax: row.densityMax || null, maxStretch: row.maxStretch || null, reasons: [...reasons].sort(cmp) }));
    const failures = rows.filter(row => row.reasons.some(reason => !(reason === 'density-outside-tolerance' && row.held && spec.acceptHeldDensity)));
    return { clean: scan.complete && !failures.length, complete: scan.complete, overlapCount, overlaps,
      overlappingFaces: [...overlapFaces].sort(cmp), failedFaces: failures.map(r => r.face), faces: rows,
      triangles: g.triangles.length, comparisons: scan.checks };
  }

  function contour(g) {
    const crosses = new Map();
    for (const [face, rows] of g.byFace) {
      let normal = [0, 0, 0];
      for (const { positions: [a, b, c] } of rows) normal = V.add(normal, V.cross(V.sub(b, a), V.sub(c, a)));
      crosses.set(face, normal);
    }
    return crosses;
  }

  function graph(g, held, spec, normals) {
    const proposed = [], split = new Set();
    const neighbors = new Map(g.doc.faces.map(row => [row.id, []]));
    for (const edge of g.layout.edges) {
      if (edge.kind !== 'continuous') continue;
      const [a, b] = edge.sides.map(row => row.face), n = normals.get(a), m = normals.get(b);
      const angle = Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(n), V.norm(m))))) * 180 / Math.PI;
      if (angle >= spec.seamAngle && !held.refused.has(a) && !held.refused.has(b) && !held.protectedEdges.has(edge.id)) {
        proposed.push({ edge: edge.id, faces: [a, b], reason: 'crease', angle });
        split.add(edge.id);
      } else {
        neighbors.get(a).push(b);
        neighbors.get(b).push(a);
      }
    }
    const free = new Set(g.doc.faces.map(row => row.id).filter(id => !held.refused.has(id)));
    const groups = [];
    for (const seed of [...free].sort(cmp)) {
      if (!free.delete(seed)) continue;
      const faces = [seed];
      for (let i = 0; i < faces.length; i++) for (const next of neighbors.get(faces[i])) {
        if (free.delete(next)) faces.push(next);
      }
      groups.push(faces.sort(cmp));
    }
    return { proposed, split, groups };
  }

  function planar(g, faces, normals) {
    const normal = V.norm(faces.reduce((sum, id) => V.add(sum, normals.get(id)), [0, 0, 0]));
    if (!(V.len(normal) > 1e-10)) return;
    let axis, best = 0;
    for (const id of faces) {
      const { corners } = g.faces.get(id);
      for (const [i, row] of corners.entries()) {
        const step = V.sub(g.positions.get(corners[(i + 1) % corners.length].id), g.positions.get(row.id));
        const vector = V.mad(step, normal, -V.dot(step, normal)), length = V.dot(vector, vector);
        if (length > best) { best = length; axis = vector; }
      }
    }
    if (!axis) return;
    const u = V.norm(axis), v = V.cross(normal, u), origin = g.positions.get(g.faces.get(faces[0]).corners[0].id);
    return new Map(faces.flatMap(id => g.faces.get(id).corners.map(corner => {
      const p = V.sub(g.positions.get(corner.id), origin);
      return [corner.id, [V.dot(p, u), V.dot(p, v)]];
    })));
  }

  function chart(g, faces, spec, size, normals, work) {
    const rows = faces.flatMap(face => g.byFace.get(face)), material = rows[0].material;
    const all = faces.flatMap(id => g.faces.get(id).corners.map(c => c.id));
    const source = new Map(all.map(id => [id, g.corners.get(g.corners.get(id).weld).uv.map((n, k) => n * (size[k] - 1))]));
    function candidate(points, method) {
      if (!points) return;
      let world = 0, area = 0;
      for (const row of rows) {
        const metric = MeshUV.metrics(row.positions, row.corners.map(id => points.get(id)));
        if (metric.state !== 'ok' || metric.stretch > spec.maxStretch + 1e-10) return;
        world += metric.worldArea;
        area += metric.uvArea;
      }
      const scale = spec.texelsPerUnit / Math.sqrt(area / world);
      const box = bounds(points.values()), dims = box.slice(2).map((n, k) => Math.max(1, Math.ceil((n - box[k]) * scale - 1e-10)) + spec.gutter * 2);
      if (dims.some((n, k) => n > spec.atlas[k] - 1)) return;
      let winding = 0;
      for (const row of rows) {
        const coords = row.corners.map(id => points.get(id)), sign = Math.sign(MeshUV.area2(...coords));
        if (winding && winding !== sign) return;
        winding = sign;
        const metric = MeshUV.metrics(row.positions, coords);
        if (Math.abs(metric.density * scale / spec.texelsPerUnit - 1) > spec.densityTolerance + 1e-10) return;
      }
      let crossing = false;
      const scan = MeshUV.scanOverlaps(rows, row => row.corners.map(id => points.get(id)), work.overlap, () => { crossing = true; });
      work.overlap -= scan.checks;
      if (!scan.complete) { work.exhausted = true; return; }
      if (crossing) return;
      return { id: faces[0], material, faces, method, dims, points: new Map([...points].map(([id, pair]) =>
        [id, pair.map((n, k) => (n - box[k]) * scale)])) };
    }
    const authored = candidate(source, 'scaled-authored');
    if (authored || work.exhausted) return authored;
    const projected = candidate(planar(g, faces, normals), 'planar');
    if (projected || work.exhausted || faces.length !== 1) return projected;
    return candidate(meshUVFlatten.unfold(g.positions, rows, all.slice(0, 2)), 'intrinsic-face');
  }

  function tileSizes(g, layout, spec, options) {
    if (layout === undefined) return id => sizeFor(options, spec, id);
    need(layout?.format === format && layout.version === 1 && layout.mesh === g.doc.id &&
      layout.revision === T.revision(g.doc) && layout.uvSet === g.set && Array.isArray(layout.tiles) &&
      layout.tiles.length >= 1 && layout.tiles.length <= 32, 'layout belongs to a different document or set');
    const tiles = new Map(), positions = new Set();
    for (const row of layout.tiles) {
      need(row && typeof row.material === 'string' && !tiles.has(row.material) &&
        tuple(row.at, 2, n => integer(n, 0, 31)) && !positions.has(row.at.join('/')) &&
        tuple(row.size, 2, n => integer(n, 1, 16384)), 'invalid or duplicate native tile');
      tiles.set(row.material, row.size);
      positions.add(row.at.join('/'));
    }
    need(new Set(g.triangles.map(row => row.material)).size === tiles.size &&
      g.triangles.every(row => tiles.has(row.material)), 'tile materials must match the mesh exactly');
    return id => tiles.get(id);
  }

  function validate(source, raw = {}, options = {}) {
    const selector = raw.uvSet ?? options.layout?.uvSet ?? 'pigment';
    const spec = settings({ ...raw, uvSet: selector }, false), g = model(source, spec.uvSet);
    const kept = protection(g, {}, options).refused;
    if (options.layout?.heldFaces) {
      // A layout can report authored protection without weakening overlap or distortion checks.
      need(Array.isArray(options.layout.heldFaces) && options.layout.heldFaces.every(id => g.faces.has(id)),
        'layout contains unknown held faces');
      for (const id of options.layout.heldFaces) kept.add(id);
    }
    const size = tileSizes(g, options.layout, spec, options);
    const report = measure(g, spec, id => g.corners.get(id).uv, size, kept, { overlap: spec.maxChecks });
    return freeze({ mesh: g.doc.id, revision: T.revision(g.doc), uvSet: g.set, target: spec.texelsPerUnit,
      densityTolerance: spec.densityTolerance, maxStretch: spec.maxStretch, ...report });
  }

  function prepare(source, raw = {}, options = {}) {
    const spec = settings(raw, true), g = model(source, spec.uvSet), revision = T.revision(g.doc);
    need(raw.revision === undefined || raw.revision === revision, 'request was authored against a different topology revision');
    const held = protection(g, raw.protect, options), normals = contour(g), work = { overlap: spec.maxChecks, remaining: 16000000 };
    const sizes = id => sizeFor(options, spec, id);
    const before = measure(g, spec, id => g.corners.get(id).uv, sizes, held.refused, work);
    const { proposed, split, groups } = graph(g, held, spec, normals);
    const charts = [], failures = [];
    const byMaterial = new Map(), byFace = new Map();
    function problem(code, evidence = {}) {
      if (failures.length < 128) failures.push({ code, ...evidence });
    }
    if (!before.complete) problem('comparison-budget');
    if (held.held.size > 1024) problem('chart-budget');
    function add(row) {
      charts.push(row);
      if (!byMaterial.has(row.material)) byMaterial.set(row.material, []);
      byMaterial.get(row.material).push(row);
      row.faces.forEach(id => byFace.set(id, row.id));
    }
    for (const island of g.layout.islands) if (held.held.has(island.id)) add({
      id: island.id, material: island.material, faces: island.faces, method: 'held', reasons: [...held.held.get(island.id)],
      box: island.bounds.map((n, i) => n * (sizes(island.material)[i % 2] - 1))
    });
    for (const faces of groups) {
      if (!before.complete || work.exhausted || charts.length > 1024) break;
      const size = sizes(g.faces.get(faces[0]).material), planned = chart(g, faces, spec, size, normals, work);
      if (planned) add(planned);
      else if (faces.length === 1) problem('unpackable-chart', { faces, atlas: spec.atlas });
      else for (const id of faces) {
        if (work.exhausted) break;
        const patch = chart(g, [id], spec, size, normals, work);
        if (patch) add(patch);
        else problem('unpackable-chart', { faces: [id], atlas: spec.atlas });
      }
      if (charts.length > 1024) {
        problem('chart-budget');
        break;
      }
    }
    if (work.exhausted) problem('comparison-budget');
    for (const row of g.layout.edges) if (row.kind === 'continuous' && !split.has(row.id)) {
      const [a, b] = row.sides.map(side => side.face);
      if (byFace.has(a) && byFace.has(b) && byFace.get(a) !== byFace.get(b)) {
        proposed.push({ edge: row.id, faces: [a, b], reason: 'split-to-fit' });
        split.add(row.id);
      }
    }
    proposed.sort((a, b) => cmp(a.edge, b.edge));
    const tiles = [], points = new Map(), pageByFace = new Map(), placed = new Map();
    const reserved = new Set([...g.faces.values()].map(row => row.material));
    for (const id of options.materialIds ?? []) reserved.add(id);
    const sceneIds = new Map();
    function addTile(base, size) {
      if (tiles.length >= spec.maxTiles) return;
      const count = sceneIds.get(base) ?? 0;
      sceneIds.set(base, count + 1);
      let material = base;
      if (count > 0) {
        let suffix = 0;
        do {
          material = 'uv-page-' + (tiles.length + 1) + (suffix ? '-' + suffix : '');
          suffix++;
        } while (reserved.has(material));
        reserved.add(material);
      }
      const row = { material, sourceMaterial: base, at: [tiles.length % spec.columns, Math.floor(tiles.length / spec.columns)],
        size: size.slice(), faces: [] };
      tiles.push(row);
      return row;
    }
    function record(page, row, at) {
      for (const id of row.faces) {
        page.faces.push(id);
        pageByFace.set(id, page.material);
      }
      if (at) {
        for (const [corner, uv] of row.points) points.set(corner, uv.map((n, k) => (n + at[k]) / (page.size[k] - 1)));
        placed.set(row.id, { at, material: page.material, tile: page.at, method: row.method });
      } else {
        placed.set(row.id, { at: row.box.slice(0, 2), material: page.material, tile: page.at, method: row.method });
      }
    }
    if (!failures.length) for (const [id, items] of [...byMaterial].sort(([a], [b]) => cmp(a, b))) {
      const anchors = items.filter(row => row.method === 'held'), movable = items.filter(row => row.method !== 'held');
      let newTile = anchors.length ? addTile(id, sizes(id)) : null;
      if (anchors.length && !newTile) {
        problem('tile-budget', { material: id, unplaced: items.map(row => row.id) });
        break;
      }
      if (newTile) for (const row of anchors) record(newTile, row);
      let pending = movable;
      while (pending.length) {
        const sameSize = newTile && newTile.size.every((n, i) => n === spec.atlas[i]);
        if (!sameSize) newTile = addTile(id, spec.atlas);
        if (!newTile) {
          problem('tile-budget', { material: id, unplaced: pending.map(row => row.id) });
          break;
        }
        const gutter = spec.gutter;
        const block = newTile.faces.length ? anchors.map(row => row.box.map((n, i) =>
          i < 2 ? Math.floor(n) - gutter : Math.ceil(n) + gutter)) : [];
        const free = meshUVTexelBudget.freeSpace([0, 0, ...newTile.size.map(n => n - 1)], block, work);
        const placement = meshUVTexelBudget.place(free, pending, work, true);
        if (!block.length && !placement.placed.size) {
          problem('packing-stalled', { material: id, unplaced: pending.map(row => row.id) });
          break;
        }
        for (const row of pending) {
          const at = placement.placed.get(row.id);
          if (at) record(newTile, row, at.map(n => n + gutter));
        }
        pending = pending.filter(row => !placement.placed.has(row.id));
        newTile = null;
      }
      if (failures.length) break;
    }

    let after = null, asset = null, layout = null;
    if (!failures.length) {
      const changes = g.doc.faces.flatMap(face => {
        if (held.refused.has(face.id)) return [];
        const material = pageByFace.get(face.id);
        return [{ ...face, material, corners: face.corners.map(corner => {
          const uv = points.get(corner.id).map(clamp);
          return g.set ? { ...corner, attributes: { ...corner.attributes, [MaterialUV.key(g.set)]: uv } } : { ...corner, uv };
        }) }];
      });
      const edges = [];
      const originalEdges = index(g.doc.edges);
      for (const row of g.layout.edges) {
        if (row.kind !== 'seam' && !split.has(row.id)) continue;
        // Record existing implicit cuts as authored when their moved sides would meet.
        if (row.kind === 'seam' && !row.sides.some(side => side.corners.some(id => points.has(id)))) continue;
        if (row.authored) continue;
        edges.push(g.set ? { id: row.id, uvSeams: { ...originalEdges.get(row.id).uvSeams, [g.set]: true } } :
          { id: row.id, uvSeam: true });
      }
      const document = T.edit(g.doc, { faces: changes, edges });
      const verified = model(document, g.set), dimensions = new Map(tiles.map(row => [row.material, row.size]));
      after = measure(verified, spec, id => verified.corners.get(id).uv, id => dimensions.get(id), held.refused, work);
      if (!after.complete) problem('comparison-budget');
      if (after.overlapCount) problem('unresolved-overlap', { faces: after.overlappingFaces });
      const failedMovable = after.failedFaces.filter(id => !held.refused.has(id));
      if (failedMovable.length) problem('layout-validation', { faces: failedMovable });
      if (!failures.length) {
        asset = document;
        layout = { format, version: 1, mesh: document.id, revision: T.revision(document), uvSet: g.set,
          columns: spec.columns, tiles: tiles.map(row => ({ ...row, faces: row.faces.slice().sort(cmp) })),
          heldFaces: [...held.refused].sort(cmp) };
      }
    }
    const report = { mesh: g.doc.id, revision, uvSet: g.set, outputRevision: asset ? T.revision(asset) : revision,
      canCommit: !failures.length, target: spec.texelsPerUnit, before, after,
      proposedSeams: proposed, failures, tiles: layout?.tiles ?? [],
      charts: charts.map(row => ({ id: row.id, faces: row.faces, sourceMaterial: row.material,
        method: row.method, ...(row.reasons && { reasons: row.reasons }), ...(placed.has(row.id) && { placement: placed.get(row.id) }) })),
      preserved: { faces: [...held.refused].sort(cmp), pins: held.pins.map(row => ({
        id: row.id, face: row.face, uv: row.uv, texel: MaterialUV.texel(row.uv, ...sizes(g.faces.get(row.face).material))
      })) }, work: { comparisons: spec.maxChecks - work.overlap, packing: 16000000 - work.remaining } };
    return freeze({ document: asset ?? g.doc, layout, report });
  }

  K.meshTopology = Object.freeze({ ...T, uvPreparation: Object.freeze({ format, prepare, validate }) });
})(KIT);
