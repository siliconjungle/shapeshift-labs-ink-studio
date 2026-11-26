/* Quantize retained dab stations and headings before receiver deformation. */
(function (K) {
  const P = K.procedural, { V, M } = K, rad = Math.PI / 180;
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const vector = (value, size) => Array.isArray(value) && value.length === size &&
    Array.from(value).every(n => range(n, -10000, 10000));
  const fields = (value, keys) => K.world.data.record(value) && Object.keys(value).every(key => keys.includes(key));
  const signedTurn = (from, to, normal) => Math.atan2(V.dot(V.cross(from, to), normal), V.dot(from, to));
  const tangent = (axis, normal) => V.mad(axis, normal, -V.dot(axis, normal));
  const lattice = (value, phase, spacing) => phase + Math.floor((value - phase) / spacing + .5) * spacing;

  function prepare(raw, flowMaps) {
    if (raw === undefined) return undefined;
    const { kind, strength = 1 } = raw ?? {};
    if (!range(strength, 0, 1)) throw new RangeError('Mark grid strength must be 0–1');
    if (kind === 'direction') {
      const { field, angleStep = 360, angleOffset = 0 } = raw;
      if (!fields(raw, ['kind', 'field', 'strength', 'angleStep', 'angleOffset']) || !range(angleStep, 1, 360) ||
          Math.abs(360 / angleStep - Math.round(360 / angleStep)) > 1e-8 || !range(angleOffset, -360, 360))
        throw new RangeError('A direction grid needs a field, an angle step that divides 360 and an optional angle offset');
      const direction = P.markDirection.prepare({ field }, flowMaps);
      return { settings: { kind, field: direction.field, angleStep, angleOffset, strength }, brush: direction.brush };
    }
    const { spacing, phase = [0, 0], stagger = 0, heading = 'u', turnStrength = strength } = raw ?? {};
    const common = ['kind', 'strength', 'spacing', 'phase', 'stagger', 'heading', 'turnStrength'];
    if (!['tangent', 'uv'].includes(kind) ||
        !fields(raw, common.concat(kind === 'tangent' ? ['origin', 'u', 'v'] : ['chart'])) ||
        !vector(spacing, 2) || !spacing.every(n => range(n, .0001, kind === 'uv' ? 1 : 10000)) ||
        !vector(phase, 2) || !range(stagger, 0, 1) || !range(turnStrength, 0, 1) || !['u', 'v', 'keep'].includes(heading))
      throw new TypeError('A positional mark grid needs tangent or UV coordinates, positive spacing and valid phase, stagger and heading');
    const settings = { kind, spacing, phase, stagger, heading, strength, turnStrength };
    if (kind === 'uv') {
      if (typeof raw.chart !== 'string' || !raw.chart.length || raw.chart.length > 200)
        throw new TypeError('A UV mark grid needs a named receiver surface chart');
      return { settings: { ...settings, chart: raw.chart } };
    }
    const { origin = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0] } = raw;
    if (![origin, u, v].every(value => vector(value, 3)) || V.len(u) < 1e-8 || V.len(v) < 1e-8 ||
        Math.abs(V.dot(V.norm(u), V.norm(v))) > 1e-6)
      throw new TypeError('A tangent mark grid needs an origin and perpendicular nonzero axes');
    return { settings: { ...settings, origin, u: V.norm(u), v: V.norm(v) } };
  }

  function align(plan, { chart, distance, reach, minFacing }) {
    const { settings, brush } = plan;
    const { kind, strength, turnStrength, heading: axis, spacing, phase, stagger, angleStep, angleOffset } = settings;
    if (kind === 'direction') return (point, support, normal, heading, context) => {
      const preferred = P.markDirection.preferred(brush, support, normal, context);
      if (!preferred) return { point, support, normal, heading, status: 'no-direction' };
      const angle = signedTurn(preferred, heading, normal) / rad;
      const target = lattice(angle, angleOffset, angleStep);
      const shift = ((target - angle + 540) % 360 - 180) * strength;
      return { point, support, normal, heading: M.app(M.rot(normal, shift * rad), heading),
        status: 'aligned', angle, targetAngle: target };
    };
    if (kind === 'tangent') {
      const { origin, u, v } = settings;
      chart = { u, v, axis: V.cross(u, v), read: point => [V.dot(V.sub(point, origin), u), V.dot(V.sub(point, origin), v)] };
    }
    if (!chart) throw new RangeError('The receiver has no surface chart named ' + settings.chart);
    const surface = CurveGrowth.sdfSurface({ field: { distance }, reach, steps: 64, minFacing });
    const context = surface.context({});
    const project = (point, outward) => surface.read(surface.anchor({ point,
      normal: V.dot(chart.axis, outward) < 0 ? V.mul(chart.axis, -1) : chart.axis }), context);
    return (point, support, normal, heading) => {
      const unchanged = { point, support, normal, heading };
      const coords = chart.read(support, normal);
      if (!coords) return { ...unchanged, status: 'outside-chart' };
      const row = Math.floor((coords[1] - phase[1]) / spacing[1] + .5);
      const xPhase = phase[0] + (row % 2 ? stagger * spacing[0] : 0);
      const target = [lattice(coords[0], xPhase, spacing[0]), phase[1] + row * spacing[1]];
      const moved = coords.map((value, i) => value + (target[i] - value) * strength);
      if (kind === 'uv' && moved.some(n => !range(n, -1e-6, 1 + 1e-6)))
        return { ...unchanged, status: 'outside-grid', coords, target };
      if (Math.hypot(moved[0] - coords[0], moved[1] - coords[1]) > 1e-9) {
        const guide = V.mad(V.mad(support, chart.u, moved[0] - coords[0]), chart.v, moved[1] - coords[1]);
        const hit = project(guide, normal);
        if (!hit || V.dot(hit.n, normal) < minFacing || !chart.read(hit.p, hit.n))
          return { ...unchanged, status: 'projection-miss', coords, target };
        point = V.mad(hit.p, hit.n, V.dot(V.sub(point, support), normal));
        support = hit.p;
        normal = hit.n;
        heading = V.norm(tangent(heading, normal), V.perp(normal));
      }
      if (axis !== 'keep') {
        const wanted = tangent(chart[axis], normal);
        if (V.len(wanted) > 1e-8) heading = M.app(M.rot(normal, signedTurn(heading, wanted, normal) * turnStrength), heading);
      }
      return { point, support, normal, heading, status: 'aligned', coords, target };
    };
  }

  P.markGrid = Object.freeze({ prepare, align });
})(KIT);
