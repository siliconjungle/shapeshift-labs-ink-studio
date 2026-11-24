/* First descending contacts with finite horizontal receivers, shared by authored and live particles. */
(function (K) {
  const V = K.V, up = [0, 1, 0];
  const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  const tuple = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(v => bounded(v, -1e6, 1e6));
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9._/-]{0,127}$/.test(value);
  function check(ok, message) {
    if (!ok) throw new RangeError('Particle impacts: ' + message);
  }
  function fields(value, keys, name) {
    check(value && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).every(key => keys.includes(key)), 'invalid ' + name);
  }

  function receivers(value) {
    check(Array.isArray(value) && value.length > 0 && value.length <= 32, 'expected 1–32 receiving planes');
    const used = new Set();
    return Array.from(value, row => {
      fields(row, ['id', 'material', 'y', 'bounds'], 'receiver');
      const { id: name, material, y, bounds } = row;
      check(id(name) && !used.has(name) && id(material) && bounded(y, -1e6, 1e6) &&
        tuple(bounds, 4) && bounds[0] < bounds[2] && bounds[1] < bounds[3],
      'receivers need a unique ID, material, Y height and increasing XZ bounds');
      used.add(name);
      return { id: name, material, y, bounds: bounds.slice() };
    });
  }

  function first(receivers, candidate, position) {
    let hit;
    for (const surface of receivers) {
      const at = candidate(surface.y);
      if (at === null || hit && at >= hit.at) continue;
      const [x,,z] = position(at);
      const [l,b,r,f] = surface.bounds;
      if (x >= l && x < r && z >= b && z < f)
        hit = { at, receiver: surface.id, material: surface.material, point: [x,surface.y,z] };
    }
    return hit ?? null;
  }

  function sweep(value) {
    const surfaces = receivers(value);
    return (from, to, radius = 0) => {
      check(tuple(from, 3) && tuple(to, 3) && bounded(radius, 0, 100), 'sweep needs bounded XYZ endpoints and radius');
      const fall = from[1] - to[1];
      if (fall <= 0) return null;
      const hit = first(surfaces, y => {
        const at = (from[1] - (y + radius)) / fall;
        return at >= 0 && at <= 1 ? at : null;
      }, at => V.lerp(from, to, at));
      if (!hit) return null;
      const { at: fraction, ...contact } = hit;
      return { ...contact, fraction };
    };
  }

  function contact(hit, { particle, velocity, time, source }) {
    return { id: 'particle-impact/' + particle, interaction: 'impact', particle,
      receiver: hit.receiver, material: hit.material, point: hit.point, time,
      normal: up.slice(), heading: [velocity[0],0,velocity[2]], speed: Math.max(0,-velocity[1]),
      ...(source !== undefined && { source }) };
  }

  function landingTime(gap, vy, gravity, life) {
    if (gap === 0 && vy === 0 && gravity > 0) return 0;
    // Use the conjugate for a falling launch to retain precision near the plane.
    const discriminant = vy * vy + 2 * gravity * gap;
    if (discriminant <= 0) return null;
    const speed = Math.sqrt(discriminant);
    const at = vy < 0 ? 2 * gap / (speed - vy) : gravity ? (vy + speed) / gravity : null;
    return at !== null && at >= 0 && at < life ? at : null;
  }

  function compile(spec) {
    fields(spec, ['receivers', 'particles'], 'flight track');
    const surfaces = receivers(spec.receivers);
    check(Array.isArray(spec.particles) && spec.particles.length <= 512, 'expected up to 512 authored particles');
    const ids = new Set(), hits = [];
    const rows = Array.from(spec.particles, row => {
      fields(row, ['id', 'time', 'point', 'velocity', 'gravity', 'radius', 'life', 'color'], 'particle');
      const { id: particle, time, point, velocity, gravity = 9.81, radius = .035, life = 2, color = '#ffe7af' } = row;
      check(id(particle) && !ids.has(particle) && bounded(time, 0, 1e6) && tuple(point, 3) && tuple(velocity, 3) &&
        bounded(gravity, 0, 1e4) && bounded(radius, .001, 1) && bounded(life, .001, 120) && time + life <= 1e6,
      'particles need a unique ID, finite launch, radius, gravity and lifetime');
      ids.add(particle);
      const p = point.slice(), v = velocity.slice();
      const position = age => [p[0]+v[0]*age, p[1]+v[1]*age-.5*gravity*age*age, p[2]+v[2]*age];
      const hit = first(surfaces, y => landingTime(p[1]-(y+radius),v[1],gravity,life), position);
      const end = time + (hit?.at ?? life);
      if (hit) hits.push(contact(hit, { particle, velocity: [v[0],v[1]-gravity*hit.at,v[2]], time: end }));
      return { time, end, position, radius, rgb: ColorCurves.color(color).map(c => Math.round(c*255)) };
    });
    hits.sort((a,b) => a.time-b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const authored = structuredClone(spec);
    return Object.freeze({
      contacts: () => structuredClone(hits),
      snapshot: () => structuredClone(authored),
      duration: rows.reduce((end,row) => Math.max(end,row.end),0),
      frame(time) {
        check(bounded(time, -1e6, 1e6), 'invalid frame time');
        return rows.filter(row => time >= row.time && time < row.end).map(row => ({
          point: row.position(time-row.time), radius: row.radius, rgb: row.rgb.slice(), alpha: 255
        }));
      }
    });
  }

  K.particleImpacts = Object.freeze({ sweep, contact, compile });
})(KIT);
