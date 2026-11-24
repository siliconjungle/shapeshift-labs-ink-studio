/* Carry authored material channels through a pinned topology correspondence. */
(function (K) {
  const topology = K.meshTopology, { V, procedural: { geometry, spatial } } = K;
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const ordered = values => [...new Set(values)].sort();
  const triKey = ids => JSON.stringify([...ids].sort());
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const mix = (vectors, weights) => vectors[0].map((_, k) =>
    weights.reduce((sum, weight, i) => sum + vectors[i][k] * weight, 0));
  const attrs = row => Object.entries(row.attributes ?? {}).sort(([a], [b]) => a < b ? -1 : 1);
  const layout = row => JSON.stringify(attrs(row).map(([name, value]) => [name, Array.isArray(value) ? value.length : 0]));
  const close = (a, b) => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((value, i) => close(value, b[i])) || typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6;
  const sameSurface = (a, b) => close(a.uv, b.uv) && close(a.normal, b.normal) && close(attrs(a), attrs(b));
  const strong = link => link.confidence === 1 && !link.evidence.method.startsWith('projected-');

  function catalog(doc) {
    const points = new Map(doc.vertices.map(row => [row.id, row.position]));
    const faces = index(doc.faces), corners = new Map(), triangles = new Map();
    for (const face of doc.faces) {
      triangles.set(face.id, []);
      for (const row of face.corners) corners.set(row.id, { ...row, face: face.id, point: points.get(row.vertex) });
    }
    const keys = new Set();
    for (const { face, corners: ids } of topology.triangulate(doc).triangleSources) {
      const rows = ids.map(id => corners.get(id)), p = rows.map(row => row.point);
      const [a, b, c] = p, u = V.sub(b, a), v = V.sub(c, a);
      triangles.get(face).push({ face, rows, a, b, c, u, v, normal: V.norm(V.cross(u, v)), bounds: spatial.boxOf(p) });
      keys.add(triKey(ids));
    }
    return { points, faces, corners, triangles, keys, edges: index(doc.edges) };
  }

  function readLinks(domain, source, target) {
    if (!Array.isArray(domain?.groups)) throw new TypeError('Material transfer needs all topology correspondence domains');
    const result = new Map();
    const unresolved = new Map((domain.unresolved ?? []).filter(row => row.side === 'to').map(row => [row.id, row]));
    for (const group of domain.groups) for (const link of group.links) {
      if (!source.has(link?.from) || !target.has(link.to) || !unit(link.confidence) ||
          typeof link.evidence?.method !== 'string')
        throw new RangeError('Revision map links must refer to elements in the pinned meshes');
      if (!result.has(link.to)) result.set(link.to, []);
      result.get(link.to).push(link);
    }
    return { result, unresolved, incomplete: Boolean(domain.projectionIncomplete) };
  }

  function surface({ rows, normal }, weights) {
    const active = rows.filter((_, i) => weights[i] > 1e-8);
    const { attributes } = rows[0];
    const blend = data => Array.isArray(data[0]) ? mix(data, weights) :
      data.reduce((n, value, i) => n + value * weights[i], 0);
    if (active.some(row => row.attributes?.paletteIndex !== active[0].attributes?.paletteIndex)) return null;
    const authored = active.some(row => row.normal);
    return {
      uv: mix(rows.map(row => row.uv), weights).map(n => Math.max(0, Math.min(1, n))),
      ...(authored && { normal: V.norm(mix(rows.map(row => row.normal ?? normal), weights), normal) }),
      ...(attributes && { attributes: Object.fromEntries(Object.keys(attributes).map(key => [key,
        key === 'paletteIndex' ? active[0].attributes[key] : blend(rows.map(row => row.attributes[key]))])) })
    };
  }

  function sharedBoundary(a, b) {
    const active = hit => hit.triangle.rows.filter((_, i) => hit.weights[i] > 1e-6).map(row => row.vertex);
    const x = active(a), y = active(b);
    return x.length < 3 && y.length === x.length && x.every(id => y.includes(id));
  }

  function projector(source, islands, { maxDistance, minNormalDot, ambiguityDistance, maxChecks }) {
    const lookup = spatial.pointIndex([...source.triangles.values()].flat());
    const work = { checks: 0, complete: true };
    const summary = hit => ({ face: hit.triangle.face, distance: hit.distance, normalDot: hit.alignment,
      corners: hit.triangle.rows.map(row => row.id), barycentric: hit.weights });
    function probe(point, normal, allowed, authoritative) {
      const hits = [];
      lookup.box(spatial.expand(spatial.boxOf([point]), maxDistance), triangle => {
        if (authoritative && !allowed.has(triangle.face)) return;
        if (work.checks === maxChecks) { work.complete = false; return false; }
        work.checks++;
        const { at, weights } = geometry.closestTrianglePoint(point, triangle);
        const delta = V.sub(point, at), distance = V.len(delta);
        // Do not acquire a projection by sliding off the source edge.
        if (distance <= maxDistance && V.len(V.cross(delta, triangle.normal)) <= maxDistance * 1e-5)
          hits.push({ triangle, distance, weights, alignment: V.dot(triangle.normal, normal) });
      });
      if (!work.complete) return { reason: 'projection-budget', point };
      hits.sort((a, b) => a.distance - b.distance || (a.triangle.face < b.triangle.face ? -1 : a.triangle.face > b.triangle.face ? 1 : 0));
      const best = hits.find(hit => allowed.has(hit.triangle.face) && hit.alignment >= minNormalDot);
      if (!best) return { reason: 'no-surface-match', point, candidates: hits.slice(0, 4).map(summary) };
      const sample = surface(best.triangle, best.weights);
      if (!sample) return { reason: 'mixed-palette-indices', point, candidates: [summary(best)] };
      for (const hit of hits) {
        if (hit === best || hit.distance > best.distance + ambiguityDistance) continue;
        if (!sharedBoundary(best, hit)) {
          // Near a nonparallel surface edge, a perpendicular wall is not a competing sheet.
          if (Math.abs(hit.alignment) < minNormalDot) continue;
          return { reason: hit.alignment <= -minNormalDot ? 'thin-surface' : 'overlapping-surfaces',
            point, candidates: [summary(best), summary(hit)] };
        }
        if (hit.triangle.face !== best.triangle.face && islands.get(hit.triangle.face) !== islands.get(best.triangle.face))
          return { reason: 'uv-seam', point, candidates: [summary(best), summary(hit)] };
        if (hit.alignment >= minNormalDot) {
          const other = surface(hit.triangle, hit.weights);
          if (!other || !sameSurface(sample, other))
            return { reason: 'material-discontinuity', point, candidates: [summary(best), summary(hit)] };
        }
      }
      return { sample, evidence: summary(best) };
    }
    return { probe, work };
  }

  function bytePlane(values, length, name) {
    const invalid = () => new RangeError(name + ' needs matching byte data');
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== length) throw invalid();
    const data = Array.from(values);
    if (!data.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 255)) throw invalid();
    return data;
  }

  function materialRows(materials) {
    const output = new Map();
    if (!Array.isArray(materials)) throw new TypeError('Supply source mesh materials as an array');
    for (const entry of materials) {
      if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim() || output.has(entry.id))
        throw new TypeError('Source mesh materials need distinct IDs');
      const row = { ...entry };
      const { texture, masks } = row;
      const { width = 1, height = 1, indices, palette, coverage, pixels } = texture ?? {};
      if (texture !== undefined && (!record(texture) || ![width, height].every(n =>
          Number.isSafeInteger(n) && n >= 1 && n <= (indices === undefined ? 2048 : 1024))))
        throw new RangeError('Source texture needs valid atlas dimensions');
      const count = width * height;
      if (indices !== undefined) {
        if (!Array.isArray(palette) || !palette.length || palette.length > 256 || !Array.from(palette).every(n =>
          Number.isSafeInteger(n) && n >= 0 && n <= 0xffffff) || pixels !== undefined)
          throw new RangeError('Indexed pigment needs its original RGB24 palette and indices');
        const data = bytePlane(indices, count, 'Pigment indices');
        if (data.some(n => n >= palette.length)) throw new RangeError('Pigment index is outside its palette');
        row.texture = { ...texture, width, height, palette: palette.slice(), indices: data,
          ...(coverage !== undefined && { coverage: bytePlane(coverage, count, 'Pigment coverage') }) };
      } else if (texture) row.texture = { ...texture, width, height, pixels: bytePlane(pixels, count * 4, 'Pigment') };
      if (masks !== undefined) {
        if (!record(masks)) throw new TypeError('Use named byte masks registered to the source atlas');
        row.masks = Object.fromEntries(Object.entries(masks).map(([name, data]) => [name, bytePlane(data, count, 'Mask ' + name)]));
      }
      for (const name of ['normal', 'emission', 'roughness', 'metalness']) {
        const data = row[name];
        if (data !== undefined && typeof data !== 'number')
          row[name] = bytePlane(data, count * (name === 'normal' || name === 'emission' ? 4 : 1), 'Material ' + name);
      }
      output.set(row.id, row);
    }
    return output;
  }

  const probes = [[1/3, 1/3, 1/3], [.5, .5, 0], [0, .5, .5], [.5, 0, .5],
    [2/3, 1/6, 1/6], [1/6, 2/3, 1/6], [1/6, 1/6, 2/3]];

  function transferMaterials(before, after, correspondence, { materials = [], maxDistance,
      minNormalDot = correspondence?.projection?.minNormalDot ?? .8, ambiguityDistance, maxUVError = .002,
      maxChecks = 1000000 } = {}) {
    const source = topology.create(before), target = topology.create(after);
    const beforeRevision = topology.revision(source), afterRevision = topology.revision(target);
    if (correspondence?.format !== 'ink-studio/topology-correspondence' || correspondence.version !== 1 ||
        correspondence.before !== source.id || correspondence.after !== target.id ||
        correspondence.beforeRevision !== beforeRevision || correspondence.afterRevision !== afterRevision)
      throw new RangeError('Material transfer needs a correspondence map pinned to these mesh revisions');
    const declarations = materialRows(materials), left = catalog(source), right = catalog(target);
    const links = Object.fromEntries(['faces', 'corners', 'edges'].map(name =>
      [name, readLinks(correspondence.domains?.[name], left[name], right[name])]));
    const extent = source.vertices.length ? spatial.boxOf(source.vertices.map(row => row.position)) : null;
    maxDistance ??= correspondence.projection?.maxDistance ?? Math.max(1e-9, extent ? V.dist(extent.min, extent.max) * 1e-6 : 0);
    ambiguityDistance ??= maxDistance * (correspondence.projection?.ambiguity ?? .05);
    if (!(Number.isFinite(maxDistance) && maxDistance > 0) || !unit(minNormalDot) ||
        !(Number.isFinite(ambiguityDistance) && ambiguityDistance >= 0 && ambiguityDistance <= maxDistance) ||
        !unit(maxUVError) || !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 4000000)
      throw new RangeError('Use valid material projection distance, alignment, UV error and work limits');
    const islands = new Map(topology.uv.inspect(source).faces.map(row => [row.id, row.island]));
    const projection = projector(left, islands, { maxDistance, minNormalDot, ambiguityDistance, maxChecks });
    const faces = [], issues = [], transferred = [], slots = new Set();
    for (const face of target.faces) {
      const faceLinks = links.faces.result.get(face.id) ?? [];
      const allowed = new Set(faceLinks.map(link => link.from));
      const review = (reason, evidence) => issues.push({ face: face.id, reason, ...evidence });
      if (!allowed.size) {
        const detail = links.faces.unresolved.get(face.id);
        review(detail ? 'revision-' + detail.reason : links.faces.incomplete ? 'revision-budget' : 'unmapped-face',
          { ...(detail && { candidates: detail.candidates }) });
        continue;
      }
      const from = [...allowed].sort(), sourceSlots = ordered(from.map(id => left.faces.get(id).material));
      if (sourceSlots.length > 1 || ordered(from.map(id => islands.get(id))).length > 1) {
        review(sourceSlots.length > 1 ? 'material-slot-boundary' : 'uv-seam', { sourceFaces: from, materials: sourceSlots });
        continue;
      }
      const material = sourceSlots[0], authoritative = faceLinks.every(strong), triangles = right.triangles.get(face.id);
      const matches = new Map();
      let problem;
      for (const corner of face.corners) {
        const exact = (links.corners.result.get(corner.id) ?? []).filter(strong).map(link => left.corners.get(link.from))
          .filter(row => allowed.has(row.face));
        const [first] = exact;
        let hit;
        if (authoritative && first) {
          if (exact.some(row => !sameSurface(first, row))) {
            problem = { reason: 'ambiguous-corner', corner: corner.id, candidates: exact.map(row => row.id) };
            break;
          }
          hit = { sample: first, exact: first.id };
        } else {
          const triangle = triangles.find(row => row.rows.some(row => row.id === corner.id));
          hit = projection.probe(right.corners.get(corner.id).point, triangle.normal, allowed, authoritative);
        }
        if (!hit.sample || corner.uvPinned && !MeshUV.sameUV(corner.uv, hit.sample.uv)) {
          problem = { ...hit, sample: undefined, corner: corner.id, reason: hit.reason ?? 'pinned-uv' };
          break;
        }
        matches.set(corner.id, hit);
      }
      if (!problem && new Set([...matches.values()].map(hit => layout(hit.sample))).size > 1)
        problem = { reason: 'incompatible-corner-channels' };
      if (!problem) for (const triangle of triangles) {
        const mapped = triangle.rows.map(row => matches.get(row.id)), exact = mapped.map(row => row.exact);
        if (exact.every(Boolean) && left.keys.has(triKey(exact))) continue;
        const samples = mapped.map(row => row.sample);
        const points = exact.every(Boolean) ? samples.map(row => row.point) : triangle.rows.map(row => row.point);
        for (const barycentric of probes) {
          const hit = projection.probe(mix(points, barycentric), triangle.normal, allowed, authoritative);
          if (!hit.sample) {
            problem = hit;
            break;
          }
          const expected = surface({ rows: samples, normal: triangle.normal }, barycentric), actual = hit.sample;
          const uvError = expected && Math.hypot(expected.uv[0] - actual.uv[0], expected.uv[1] - actual.uv[1]);
          if (!expected || uvError > maxUVError || !close(attrs(expected), attrs(actual)) ||
              !close(expected.normal, actual.normal) && !(expected.normal && actual.normal &&
                V.dot(expected.normal, actual.normal) >= .999)) {
            const reason = uvError > maxUVError ? 'uv-interpolation-error' : 'corner-channel-interpolation-error';
            problem = { reason, expected, actual, candidates: [hit.evidence] };
            break;
          }
        }
        if (problem) break;
      }
      if (problem) {
        const { reason, ...evidence } = problem;
        review(reason, evidence);
        continue;
      }
      faces.push({ ...face, material, corners: face.corners.map(corner => {
        const { uv, normal, attributes } = matches.get(corner.id).sample;
        return { ...corner, uv, ...(normal && { normal }),
          ...(attributes && { attributes: { ...corner.attributes, ...attributes } }) };
      }) });
      const exactCorners = [...matches.values()].filter(row => row.exact).length;
      transferred.push({ face: face.id, sourceFaces: from, material, exactCorners, projectedCorners: face.corners.length - exactCorners });
      slots.add(material);
    }
    const accepted = new Set(faces.map(row => row.id)), incoming = topology.inspect(target).edges;
    const edges = incoming.filter(row => row.uses.every(use => accepted.has(use.face)) &&
      links.edges.result.get(row.id)?.some(link => strong(link) && left.edges.get(link.from).uvSeam))
      .map(row => ({ id: row.id, uvSeam: true }));
    const patch = { faces, edges };
    const document = topology.edit(target, patch);
    const used = ordered(slots).filter(id => declarations.has(id)).map(id => declarations.get(id));
    const report = { format: 'ink-studio/mesh-material-transfer', version: 1, beforeRevision, afterRevision,
      outputRevision: topology.revision(document), complete: issues.length === 0, transferred, issues,
      indexedSlots: used.filter(row => row.texture?.indices).map(row => row.id),
      maskSlots: used.filter(row => Object.keys(row.masks ?? {}).length).map(row => ({ material: row.id, names: ordered(Object.keys(row.masks)) })),
      projection: { ...projection.work, maxDistance, ambiguityDistance, minNormalDot, maxUVError, maxChecks } };
    return { document, materials: used, patch, report };
  }

  K.meshTopology = Object.freeze({ ...topology, transferMaterials });
})(KIT);
