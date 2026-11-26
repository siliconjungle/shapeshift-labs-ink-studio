/* Editable tensor-product rational splines and parameter-space trim loops. */
(function (K) {
  const P = K.procedural, { V } = K;
  const { clone, freeze, hash } = P.data;
  const format = 'ink-studio/rational-surface';
  const prepared = new WeakMap();
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const vector = (p, size, valid) => Array.isArray(p) && p.length === size && Array.from(p).every(valid);
  const id = s => typeof s === 'string' && /^[\w][\w./-]{0,127}$/.test(s);
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, names) => record(value) && Object.keys(value).every(name => names.includes(name));
  function need(ok, message) {
    if (!ok) throw new RangeError('Rational surface: ' + message);
  }

  function axis(source, count) {
    need(fields(source, ['degree', 'knots']), 'expected a degree and knot vector');
    const { degree, knots } = source;
    need(integer(degree, 1, Math.min(5, count - 1)) && vector(knots, count + degree + 1, unit),
      'invalid degree or normalized knot count');
    let copies = 0;
    for (let i = 0; i < knots.length; i++) {
      need(i === 0 || knots[i] === knots[i - 1] || knots[i] - knots[i - 1] >= 1e-9,
        'knots must be nondecreasing with distinct knots at least 1e-9 apart');
      copies = knots[i] === knots[i - 1] ? copies + 1 : 1;
      need(copies <= (knots[i] === 0 || knots[i] === 1 ? degree + 1 : degree), 'excess knot multiplicity');
    }
    need(knots[degree] === 0 && knots[count] === 1, 'knots must be clamped at 0 and 1');
    return { degree, knots: knots.slice() };
  }

  function control(row, size, valid) {
    need(fields(row, ['position', 'weight']), 'invalid control');
    const { position, weight = 1 } = row;
    need(vector(position, size, valid) && Number.isFinite(weight) && weight >= 1e-4 && weight <= 1e4,
      'expected a finite control position and positive weight in range');
    return { position: position.slice(), weight };
  }

  // Return the nonzero basis functions in a knot span. The same recurrence
  // one degree lower gives the first derivative, including clamped endpoints.
  function localBasis(knots, span, t, degree) {
    const values = [1];
    for (let d = 1; d <= degree; d++) {
      let saved = 0;
      for (let r = 0; r < d; r++) {
        const left = knots[span + 1 + r - d], right = knots[span + 1 + r];
        const contribution = right === left ? 0 : values[r] / (right - left);
        values[r] = saved + (right - t) * contribution;
        saved = (t - left) * contribution;
      }
      values.push(saved);
    }
    return values;
  }

  function basis({ degree, knots }, t, derivative) {
    const count = knots.length - degree - 1;
    let span = degree;
    while (span < count - 1 && t >= knots[span + 1]) span++;
    const start = span - degree, weights = localBasis(knots, span, t, degree);
    if (!derivative) return { start, weights };
    const lower = localBasis(knots, span, t, degree - 1);
    const slopes = weights.map((_, j) => {
      const i = start + j, left = knots[i + degree] - knots[i], right = knots[i + degree + 1] - knots[i + 1];
      return (j > 0 && left ? degree * lower[j - 1] / left : 0) -
        (j < degree && right ? degree * lower[j] / right : 0);
    });
    return { start, weights, slopes };
  }

  function stops({ knots }, steps) {
    const breaks = [...new Set(knots)];
    return [...breaks.slice(1).flatMap((b, i) => Array.from({ length: steps },
      (_, j) => breaks[i] + (b - breaks[i]) * j / steps)), 1];
  }

  function trimLoop(source) {
    need(fields(source, ['id', 'kind', 'degree', 'knots', 'controls', 'steps']) && id(source.id) &&
      ['outer', 'hole'].includes(source.kind) && Array.isArray(source.controls) &&
      integer(source.controls.length, 3, 129), 'invalid trim loop');
    const { steps = 8 } = source;
    need(integer(steps, 1, 64), 'trim sampling needs 1 to 64 steps per knot span');
    const { degree, knots } = axis({ degree: source.degree, knots: source.knots }, source.controls.length);
    const controls = Array.from(source.controls, row => control(row, 2, unit));
    need(controls[0].position.every((x, k) => x === controls.at(-1).position[k]), 'trim endpoints must match');
    return { id: source.id, kind: source.kind, degree, knots, controls, steps };
  }

  function trimPoints(loop) {
    return stops(loop, loop.steps).slice(0, -1).map(t => {
      const { start, weights } = basis(loop, t);
      const sum = [0, 0];
      let total = 0;
      for (const [i, b] of weights.entries()) {
        const { position, weight } = loop.controls[start + i];
        const w = weight * b;
        total += w;
        sum[0] += w * position[0];
        sum[1] += w * position[1];
      }
      return sum.map(v => Math.max(0, Math.min(1, v / total)));
    });
  }

  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const epsilon = 1e-10;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = ring => ring.reduce((sum, a, i) => sum + cross([0, 0], a, ring[(i + 1) % ring.length]), 0) / 2;
  const between = (a, b, c) => c >= Math.min(a, b) - epsilon && c <= Math.max(a, b) + epsilon;
  const touches = (a, b, p) => Math.abs(cross(a, b, p)) <= epsilon * Math.hypot(b[0] - a[0], b[1] - a[1]) &&
    p.every((c, k) => between(a[k], b[k], c));
  function crosses(a, b, c, d) {
    return touches(a, b, c) || touches(a, b, d) || touches(c, d, a) || touches(c, d, b) ||
      Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 &&
      Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0;
  }
  function contains(ring, [x, y]) {
    let odd = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) odd = !odd;
    }
    return odd;
  }
  function trimRegion(loops) {
    const outer = loops.find(loop => loop.kind === 'outer');
    const rings = [outer ? trimPoints(outer) : square, ...loops.filter(loop => loop.kind === 'hole').map(trimPoints)];
    const total = rings.reduce((sum, ring) => sum + ring.length, 0);
    need(total <= 1024, 'trim sampling exceeds 1024 vertices');
    const edges = [];
    for (const [r, ring] of rings.entries()) {
      need(ring.length >= 3 && Math.abs(area(ring)) > epsilon, 'trim loop must enclose an area');
      for (const [i, a] of ring.entries()) {
        const b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
        need(Math.hypot(b[0] - a[0], b[1] - a[1]) > epsilon && !touches(a, b, c) &&
          !touches(b, c, a), 'trim loop has a collapsed or doubled-back edge');
        for (const edge of edges) {
          if (edge.r === r && (edge.i === i - 1 || i === ring.length - 1 && edge.i === 0)) continue;
          need(!crosses(a, b, edge.a, edge.b), 'trim boundaries intersect or touch');
        }
        edges.push({ a, b, r, i });
      }
      if (r > 0) {
        need(contains(rings[0], ring[0]), 'trim holes must lie inside the outer boundary');
        for (let j = 1; j < r; j++)
          need(!contains(rings[j], ring[0]) && !contains(ring, rings[j][0]), 'trim holes cannot nest');
      }
    }
    return { rings, edges };
  }

  function create(source) {
    if (prepared.has(source)) return source;
    need(fields(source, ['format', 'version', 'id', 'u', 'v', 'controls', 'trims']) &&
      source.format === format && source.version === 1 && id(source.id), 'expected a version 1 surface');
    const { controls, trims = [] } = source;
    need(Array.isArray(controls) && integer(controls.length, 2, 64) && Array.isArray(controls[0]) &&
      integer(controls[0].length, 2, 64), 'expected 2 to 64 controls along each axis');
    const columns = controls[0].length;
    const net = Array.from(controls, row => {
      need(Array.isArray(row) && row.length === columns, 'control net must be rectangular');
      return Array.from(row, item => control(item, 3, x => Number.isFinite(x) && Math.abs(x) <= 1e5));
    });
    need(Array.isArray(trims) && trims.length <= 16, 'expected up to 16 trims');
    const loops = Array.from(trims, trimLoop);
    need(new Set(loops.map(loop => loop.id)).size === loops.length && loops.filter(loop => loop.kind === 'outer').length <= 1,
      'expected distinct trim IDs and at most one outer boundary');
    const u = axis(source.u, columns), v = axis(source.v, net.length);
    const region = trimRegion(loops);
    const document = freeze({ format, version: 1, id: source.id, u, v, controls: net, trims: loops });
    const bytes = JSON.stringify(document);
    prepared.set(document, { ...region, revision: [bytes.length, hash(bytes), hash(bytes, 0x9e3779b9)].map(n => n.toString(36)).join('-') });
    return document;
  }

  function inspect(source) {
    const doc = create(source), { rings, revision } = prepared.get(doc);
    return { id: doc.id, revision, u: doc.u, v: doc.v, rows: doc.controls.length, columns: doc.controls[0].length,
      trims: doc.trims.map(loop => ({ id: loop.id, kind: loop.kind, degree: loop.degree, controls: loop.controls.length, steps: loop.steps })),
      parameterArea: Math.abs(area(rings[0])) - rings.slice(1).reduce((sum, ring) => sum + Math.abs(area(ring)), 0) };
  }

  function evaluate(doc, [u, v]) {
    const a = basis(doc.u, u, true), b = basis(doc.v, v, true);
    const value = [0, 0, 0, 0], du = value.slice(), dv = value.slice();
    for (const [y, vy] of b.weights.entries()) for (const [x, ux] of a.weights.entries()) {
      const { position, weight } = doc.controls[b.start + y][a.start + x];
      const w = ux * vy * weight, wu = a.slopes[x] * vy * weight, wv = ux * b.slopes[y] * weight;
      for (const [k, n] of [...position, 1].entries()) {
        value[k] += w * n;
        du[k] += wu * n;
        dv[k] += wv * n;
      }
    }
    const point = value.slice(0, 3).map(n => n / value[3]);
    const tangent = partial => point.map((n, k) => (partial[k] - n * partial[3]) / value[3]);
    const tangentU = tangent(du), tangentV = tangent(dv);
    const direction = V.cross(tangentU, tangentV), length = Math.hypot(...direction);
    need([point, tangentU, tangentV].flat().every(Number.isFinite) && Number.isFinite(length),
      'surface derivatives exceed the numeric range');
    return { point, tangentU, tangentV, normal: length > 0 ? direction.map(n => n / length) : null };
  }

  function visible(rings, uv) {
    return contains(rings[0], uv) && !rings.slice(1).some(ring => contains(ring, uv));
  }

  function sample(source, uv) {
    const doc = create(source), { rings, edges } = prepared.get(doc);
    need(vector(uv, 2, unit), 'sample UV must be in the unit square');
    const boundary = edges.some(({ a, b }) => touches(a, b, uv));
    return { uv: uv.slice(), ...evaluate(doc, uv), retained: boundary || visible(rings, uv), boundary };
  }

  function mesh(source, { resolution = 24 } = {}) {
    const doc = create(source), { rings, edges } = prepared.get(doc);
    need(integer(resolution, 2, 48), 'mesh resolution must be an integer from 2 to 48');
    const grid = ({ knots }) => {
      const samples = [...new Set(knots)];
      for (let i = 1; i < resolution; i++) {
        const t = i / resolution;
        if (!knots.some(k => Math.abs(k - t) < 1e-9)) samples.push(t);
      }
      return samples.sort((a, b) => a - b);
    };
    const us = grid(doc.u), vs = grid(doc.v);
    let uv, faces;
    if (!doc.trims.length) {
      uv = vs.flatMap(v => us.map(u => [u, v]));
      faces = vs.slice(1).flatMap((_, y) => us.slice(1).flatMap((__, x) => {
        const a = y * us.length + x, b = a + us.length;
        return [[a, a + 1, b + 1], [a, b + 1, b]];
      }));
    } else {
      // Seed the constrained triangulation with interior grid sites. Its
      // recovered boundary links prevent any triangle from bridging a hole.
      uv = rings.flat().slice();
      const constraints = [];
      let offset = 0;
      for (const ring of rings) {
        ring.forEach((_, i) => constraints.push([offset + i, offset + (i + 1) % ring.length]));
        offset += ring.length;
      }
      for (const v of vs) for (const u of us) {
        const p = [u, v];
        if (edges.some(({ a, b }) => touches(a, b, p))) {
          // The implicit rectangular boundary can safely take extra sites on its straight sides.
          if (rings[0] === square && (u === 0 || u === 1 || v === 0 || v === 1) &&
              !square.some(q => q[0] === u && q[1] === v)) uv.push(p);
        } else if (visible(rings, p)) uv.push(p);
      }
      need(uv.length <= 2500, 'trim tessellation exceeds 2500 sites; lower resolution or trim steps');
      const triangulated = P.geometry.delaunay(uv, { constraints, maxChecks: 60000000 });
      faces = triangulated.triangles.filter(tri => visible(rings, [0, 1].map(k =>
        tri.reduce((sum, i) => sum + uv[i][k], 0) / 3)));
      need(faces.length, 'trim leaves no faces');
    }
    const samples = uv.map(p => evaluate(doc, p));
    const singularNormals = samples.filter(row => !row.normal).length;
    const geometry = { points: samples.map(row => row.point), faces, uvs: uv.flat(),
      ...(singularNormals === 0 && { normals: samples.flatMap(row => row.normal) }) };
    return { geometry, report: { ...inspect(doc), resolution, vertices: uv.length, triangles: faces.length, singularNormals } };
  }

  function edit(source, request) {
    const doc = create(source), input = inspect(doc);
    need(fields(request, ['revision', 'operations']) && Array.isArray(request.operations) &&
      integer(request.operations.length, 1, 64), 'expected 1 to 64 operations');
    need(request.revision === undefined || request.revision === input.revision, 'edit was authored against a different revision');
    const draft = clone(doc);
    for (const change of request.operations) {
      need(record(change), 'invalid operation');
      const { op, row, column, position, weight, trim, id: trimId, direction, degree, knots } = change;
      if (op === 'set-control') {
        need(fields(change, ['op', 'row', 'column', 'position', 'weight']) && integer(row, 0, input.rows - 1) &&
          integer(column, 0, input.columns - 1) && (position !== undefined || weight !== undefined), 'invalid control edit');
        const target = draft.controls[row][column];
        if (position !== undefined) target.position = position;
        if (weight !== undefined) target.weight = weight;
      } else if (op === 'set-axis') {
        need(fields(change, ['op', 'direction', 'degree', 'knots']) && ['u', 'v'].includes(direction), 'invalid axis edit');
        draft[direction] = axis({ degree, knots }, direction === 'u' ? input.columns : input.rows);
      } else if (op === 'set-trim') {
        need(fields(change, ['op', 'trim']), 'invalid trim edit');
        const loop = trimLoop(trim), index = draft.trims.findIndex(row => row.id === loop.id);
        if (index < 0) draft.trims.push(loop);
        else draft.trims[index] = loop;
      } else if (op === 'remove-trim') {
        const index = draft.trims.findIndex(row => row.id === trimId);
        need(fields(change, ['op', 'id']) && index >= 0, 'unknown trim to remove');
        draft.trims.splice(index, 1);
      } else {
        need(false, 'unknown operation ' + op);
      }
    }
    const document = create(draft);
    return { document, report: { revision: input.revision, after: inspect(document), operations: clone(request.operations) } };
  }

  P.rationalSurface = Object.freeze({ format, create, inspect, sample, mesh, edit });
})(KIT);
