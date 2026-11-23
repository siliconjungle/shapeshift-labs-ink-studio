/* A branching, seekable arc with separate core, edge and halo. */
(function (K) {
  const P = K.procedural;
  const { dimensions, integer, range, vector, unit, wrap, clock, draw, color } = P.generatorSupport;
  const tau = Math.PI * 2;

  function discharge({ points, width = 128, height = 96, time = 0, period = 2,
    seed = 0, detail = 6, roughness = .62, amplitude = 12, branches = 3, branchReach = 18,
    core = '#f5ffff', edge = '#6be6ff', halo = '#443dff', coreWidth = 1,
    edgeWidth = 2.5, haloRadius = 5, intensity = 1 } = {}) {
    const size = dimensions({ width, height });
    points ??= [[width*.18, height*.68], [width*.83, height*.24]];
    clock(time, seed);
    if (!Array.isArray(points) || !integer(points.length, 2, 16) || !points.every(p => vector(p, 2)) ||
        !integer(detail, 1, 8) || !integer(branches, 0, 32) || !range(roughness, 0, 1) ||
        !range(amplitude, 0, 192) || !range(branchReach, 0, 192) || !range(period, .02, 120) ||
        !range(coreWidth, .25, 8) || !range(edgeWidth, coreWidth, 16) ||
        !integer(haloRadius, 0, 16) || !range(intensity, 0, 4))
      throw new RangeError('Invalid discharge path, timing or style');
    [core, edge, halo].forEach(color);
    for (let i = 1; i < points.length; i++)
      if (Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]) < .001)
        throw new RangeError('A discharge path needs distinct consecutive points');

    const phase = wrap(time, period) / period * tau;
    const random = K.grow.dice(P.data.hash('discharge', seed));
    function segment([ax, ay], [bx, by], depth, strength) {
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      const tx = length ? -dy / length : 0, ty = length ? dx / length : 0;
      const path = [[ax, ay], [bx, by]];
      for (let level = 0; level < depth; level++) {
        const count = path.length - 1, step = strength * roughness ** level;
        for (let i = count - 1; i >= 0; i--) {
          const a = path[i], b = path[i+1], angle = random() * tau;
          const wobble = step * (.7 * Math.sin(phase * (1 + level % 3) + angle) +
            .30 * Math.sin(phase * 7 - angle * 2));
          path.splice(i+1, 0, [(a[0] + b[0]) / 2 + tx * wobble, (a[1] + b[1]) / 2 + ty * wobble]);
        }
      }
      return path;
    }
    const trunk = [points[0].slice()];
    for (let i = 1; i < points.length; i++) trunk.push(...segment(points[i-1], points[i], detail, amplitude).slice(1));
    const paths = [{ id: 'trunk', points: trunk, width: coreWidth }];
    for (let i = 0; i < branches; i++) {
      if (!branchReach) break;
      const rank = 1 + Math.floor((.12 + .76 * random()) * (trunk.length - 2));
      const at = trunk[rank], ahead = trunk[Math.min(trunk.length-1, rank + 1)], sign = i % 2 ? -1 : 1;
      const direction = Math.atan2(ahead[1] - at[1], ahead[0] - at[0]) + sign * (.49 + random() * 1.12);
      const reach = branchReach * (.38 + random() * .62);
      const to = [at[0] + reach * Math.cos(direction), at[1] + reach * Math.sin(direction)];
      paths.push({ id: 'fork-' + i, points: segment(at, to, Math.min(5, detail), Math.min(reach*.3, amplitude)), width: coreWidth * .68 });
    }
    const lines = (ink, border) => draw(size, paths.map(path => ({
      type: 'path', points: path.points, color: ink, width: path.width + border
    })));
    const filament = lines(core, 0), fringe = lines(edge, edgeWidth - coreWidth);
    const bloom = haloRadius ? P.pixelEffects.glow(fringe, { color: halo, radius: haloRadius, strength: intensity }).glow
      : P.raster.canvas(size);
    const value = P.raster.stack({ ...size, layers: [{ source: bloom }, { source: fringe }, { source: filament }] }).value;
    return { value, filament, fringe, halo: bloom, paths };
  }

  P.generator.discharge = discharge;
})(KIT);
