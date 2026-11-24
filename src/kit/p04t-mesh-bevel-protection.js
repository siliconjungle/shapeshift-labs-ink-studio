/* Paint stays registered when a kept affine UV chart contains its guarded region. */
const meshBevelProtection = (function (K) {
  const { V, meshTopology: topology } = K, { record, point, unit } = meshCutGeometry;
  const { index, name, cyclic } = meshEdgeFlowData;
  const eps = 1e-8;

  function settings(doc, raw = {}) {
    if (!record(raw, ['faces', 'materials', 'paint', 'gaps']) ||
        ['faces', 'materials', 'paint', 'gaps'].some(key => raw[key] !== undefined && !Array.isArray(raw[key])))
      throw new TypeError('Protect authored faces, materials, UV paint rectangles, or gap rays');
    const { faces = [], materials = [], paint = [], gaps = [] } = raw, known = index(doc.faces);
    const slots = new Set(doc.faces.map(face => face.material));
    if (faces.some(id => !known.has(id)) || materials.some(id => !slots.has(id)) ||
        paint.length > 256 || gaps.length > 256)
      throw new RangeError('Use known face and material IDs and at most 256 paint rectangles and gap rays');
    for (const row of paint) {
      if (!record(row, ['face', 'min', 'max']) || !known.has(row.face) ||
          !point(row.min, 2) || !point(row.max, 2) ||
          row.min.some((n, i) => n < 0 || row.max[i] > 1 || row.max[i] - n <= 4 * eps))
        throw new RangeError('Protect a normalized UV rectangle on a known face');
    }
    const gapIds = new Set();
    const rays = gaps.map(row => {
      if (!record(row, ['id', 'origin', 'direction', 'distance']) || !name(row.id) || gapIds.has(row.id) ||
          !point(row.origin, 3) || !Number.isFinite(row.distance) || row.distance <= 0)
        throw new TypeError('A protected gap needs an ID and a finite ray segment');
      gapIds.add(row.id);
      return { id: row.id, origin: row.origin, direction: unit(row.direction, 'Gap direction'), maxDistance: row.distance };
    });
    return { faces: new Set(faces), materials: new Set(materials), paint, rays };
  }

  function affine(face, vertices, tolerance) {
    const points = face.corners.map(({ uv, vertex }) => ({ uv, at: vertices.get(vertex).position }));
    const origin = points[0], uv = points.map(row => row.uv);
    let test;
    for (let i = 1; !test && i < points.length - 1; i++) for (let j = i + 1; !test && j < points.length; j++) {
      const a = [uv[i][0] - origin.uv[0], uv[i][1] - origin.uv[1]],
        b = [uv[j][0] - origin.uv[0], uv[j][1] - origin.uv[1]];
      const det = a[0] * b[1] - a[1] * b[0];
      if (Math.abs(det) <= eps ** 2) continue;
      const da = V.sub(points[i].at, origin.at), db = V.sub(points[j].at, origin.at);
      if (V.len(V.cross(da, db)) <= tolerance ** 2) continue;
      test = ([u, v]) => {
        const x = u - origin.uv[0], y = v - origin.uv[1];
        return V.mad(V.mad(origin.at, da, (x * b[1] - y * b[0]) / det), db, (a[0] * y - a[1] * x) / det);
      };
    }
    return test && points.every(row => V.dist(test(row.uv), row.at) <= tolerance * 4) ? { uv, test } : null;
  }

  function contains(ring, [x, y]) {
    let inside = false;
    for (const [i, a] of ring.entries()) {
      const [u, v] = a, [s, t] = cyclic(ring, i + 1);
      if (Math.abs((s - u) * (y - v) - (t - v) * (x - u)) <= eps &&
          x >= Math.min(u, s) - eps && x <= Math.max(u, s) + eps &&
          y >= Math.min(v, t) - eps && y <= Math.max(v, t) + eps) return true;
      if ((v > y) !== (t > y) && x < (s - u) * (y - v) / (t - v) + u) inside = !inside;
    }
    return inside;
  }

  function crosses(a, b, min, max) {
    let low = 0, high = 1;
    for (let i = 0; i < 2; i++) {
      const d = b[i] - a[i], l = min[i] + eps, h = max[i] - eps;
      if (Math.abs(d) < eps) {
        if (a[i] < l || a[i] > h) return false;
        continue;
      }
      const p = (l - a[i]) / d, q = (h - a[i]) / d;
      low = Math.max(low, Math.min(p, q));
      high = Math.min(high, Math.max(p, q));
    }
    return low <= high;
  }

  function paintCheck(row, before, after, vertices, oldVertices, tolerance) {
    const original = affine(before, oldVertices, tolerance), next = affine(after, vertices, tolerance);
    const { min, max } = row, probes = [min, [max[0], min[1]], max, [min[0], max[1]]];
    const fits = chart => probes.every(at => contains(chart.uv, at)) &&
      !chart.uv.some((p, i) => crosses(p, cyclic(chart.uv, i + 1), min, max));
    let reason = null;
    if (!original || !next) reason = 'non-affine-uv';
    else if (!fits(original)) reason = 'outside-authored-chart';
    else if (!fits(next)) reason = 'trimmed-paint';
    else if (before.material !== after.material ||
        probes.some(uv => V.dist(original.test(uv), next.test(uv)) > tolerance * 4)) reason = 'displaced-paint';
    return { ...row, retained: !reason, ...(reason && { reason }) };
  }

  function evaluate(doc, document, patch, rules, tolerance) {
    const before = index(doc.faces), oldVertices = index(doc.vertices), next = index(document.faces), vertices = index(document.vertices);
    const faces = (patch.faces ?? []).flatMap(({ id, material }) =>
      before.has(id) && (rules.faces.has(id) || rules.materials.has(material)) ? [id] : []);
    const paint = rules.paint.map(row => paintCheck(row, before.get(row.face), next.get(row.face), vertices, oldVertices, tolerance));
    const gaps = [];
    if (rules.rays.length) {
      const a = K.sceneMeshes.rayQuery(topology.toSceneMesh(doc), K), b = K.sceneMeshes.rayQuery(topology.toSceneMesh(document), K);
      for (const { id, ...ray } of rules.rays) {
        const before = a(ray)?.distance ?? null, after = b(ray)?.distance ?? null;
        gaps.push({ id, retained: before === null && after === null, before, after });
      }
    }
    return { faces, paint, gaps };
  }

  return { settings, evaluate };
})(KIT);
