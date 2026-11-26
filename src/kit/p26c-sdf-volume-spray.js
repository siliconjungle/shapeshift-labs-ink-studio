// A directional, feathered paint volume authored in scene space and retained in solid rest space.
(function (K) {
  const { V, M } = K, { clone, freeze } = K.procedural.data;
  const maxStrokes = 32, maxReceivers = 16, maxDepth = 65534;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const clamp01 = n => Math.min(1, Math.max(0, n));
  const smooth = n => n * n * (3 - 2 * n);
  const styles = ['color', 'opacity', 'softness', 'falloff', 'facing', 'occlusion'];
  const authored = solid => solid.id && !solid.ghost && !solid.carve && !solid.hold && solid.kind !== 'ground';

  function volume(raw) {
    if (!fields(raw, ['shape', 'half', 'tip']) || !['ellipsoid', 'box', 'cone'].includes(raw.shape) ||
        !xyz(raw.half) || !raw.half.every(n => finite(n, .005, 64)) ||
        raw.tip !== undefined && (raw.shape !== 'cone' || !finite(raw.tip, .02, 1)))
      throw new TypeError('Use an ellipsoid, box or cone with three half sizes from .005 to 64, and an optional cone tip');
    return { shape: raw.shape, half: raw.half, ...(raw.shape === 'cone' && { tip: raw.tip ?? .12 }) };
  }

  function settings(raw) {
    const { color, opacity = .85, softness = .25, falloff = 1,
      facing = { minDot: 0, feather: .3 }, occlusion = 'visible' } = raw;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color) || !finite(opacity, 0, 1) ||
        !finite(softness, 0, 1) || !finite(falloff, .1, 8) || !['visible', 'wrap'].includes(occlusion) ||
        facing !== 'all' && (!fields(facing, ['minDot', 'feather']) ||
          !finite(facing.minDot, -1, 1) || !finite(facing.feather ?? .25, 0, 2)))
      throw new TypeError('Use a hex pigment, valid opacity, softness and falloff, facing settings and visible or wrap occlusion');
    return { color: color.toLowerCase(), opacity, softness, falloff,
      facing: facing === 'all' ? facing : { minDot: facing.minDot, feather: facing.feather ?? .25 }, occlusion };
  }

  function request(raw) {
    if (!fields(raw, ['id', 'targets', 'brush', 'resolution', 'bias', ...styles]) || !TargetSelectors.name(raw.id) ||
        !Array.isArray(raw.targets) || raw.targets.length < 1 || raw.targets.length > maxReceivers ||
        !Array.from(raw.targets).every(id => TargetSelectors.name(id)) || new Set(raw.targets).size !== raw.targets.length ||
        !fields(raw.brush, ['shape', 'half', 'tip', 'center', 'direction', 'up']) ||
        !xyz(raw.brush.center) || !xyz(raw.brush.direction) || !xyz(raw.brush.up ?? [0, 1, 0]))
      throw new TypeError('A spray needs an ID, distinct solid IDs and a brush center, direction and shape');
    const { id, targets, brush: { center, direction, up = [0, 1, 0], ...shape }, resolution = 96, bias } = raw;
    const geometry = volume(shape), style = settings(raw);
    const length = V.len(direction), upLength = V.len(up);
    if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(upLength) || upLength < 1e-8)
      throw new RangeError('Spray direction and up need finite, nonzero vectors');
    const forward = V.mul(direction, 1 / length), cross = V.cross(V.mul(up, 1 / upLength), forward);
    if (V.len(cross) < 1e-6) throw new RangeError('Spray direction and up must be independent');
    if (!Number.isSafeInteger(resolution) || !finite(resolution, 16, 160) ||
        bias !== undefined && !finite(bias, 0, geometry.half[2]))
      throw new RangeError('Spray resolution must be 16–160 and bias must fit within the brush half depth');
    const right = V.norm(cross), frame = K.sceneGraph.transform({ position: center,
      matrix: M.cols(right, V.cross(forward, right), forward) });
    return { id, targets, geometry, style, resolution, bias, frame };
  }

  function inset(geometry, [x, y, z]) {
    const [w, h, d] = geometry.half, u = x / w, v = y / h, t = z / d;
    if (geometry.shape === 'ellipsoid') return 1 - Math.hypot(u, v, t);
    if (geometry.shape === 'box') return 1 - Math.max(Math.abs(u), Math.abs(v), Math.abs(t));
    const radius = geometry.tip + (1 - geometry.tip) * clamp01((t + 1) * .5);
    return Math.min(1 - Math.abs(t), radius - Math.hypot(u, v));
  }

  function visibility(capture, x, y, z, facing, [w, h, d]) {
    const { grid: [nx, ny], depths, bias } = capture;
    const gx = (x / w + 1) * .5 * nx - .5, gy = (y / h + 1) * .5 * ny - .5;
    const ix = Math.floor(gx), iy = Math.floor(gy), u = gx - ix, v = gy - iy;
    const slope = Math.sqrt(Math.max(0, 1 - facing * facing)) / Math.max(.15, Math.abs(facing));
    const step = Math.hypot(w / nx, h / ny);
    const tolerance = bias + step * (1 + 1.5 * slope);
    let coverage = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const px = ix + i, py = iy + j;
      if (px < 0 || px >= nx || py < 0 || py >= ny) continue;
      const depth = depths[py * nx + px];
      if (depth < 0 || Math.abs(z - (2 * depth / maxDepth - 1) * d) > tolerance) continue;
      coverage += (i ? u : 1 - u) * (j ? v : 1 - v);
    }
    return coverage;
  }

  function compile(raw, ids) {
    if (!fields(raw, ['id', 'geometry', 'frame', 'capture', ...styles]) ||
        !TargetSelectors.name(raw.id) || ids.has(raw.id))
      throw new TypeError('Retained sprays need unique IDs on each solid');
    ids.add(raw.id);
    const style = settings(raw), geometry = volume(raw.geometry), graph = K.sceneGraph;
    if (!fields(raw.frame, ['position', 'matrix']) || !xyz(raw.frame.position) ||
        !Array.isArray(raw.frame.matrix) || raw.frame.matrix.length !== 9 ||
        !Array.from(raw.frame.matrix).every(Number.isFinite))
      throw new TypeError('A retained spray needs its solid-to-volume affine frame');
    const frame = graph.transform(raw.frame), normalMatrix = M.tr(graph.inverse(frame).matrix);
    const capture = raw.capture;
    if (style.occlusion === 'visible') {
      const valid = fields(capture, ['grid', 'depths', 'bias']) && Array.isArray(capture.grid) &&
        capture.grid.length === 2 && Array.from(capture.grid).every(n => Number.isSafeInteger(n) && finite(n, 1, 160)) &&
        Array.isArray(capture.depths) && capture.depths.length === capture.grid[0] * capture.grid[1] &&
        Array.from(capture.depths).every(n => Number.isSafeInteger(n) && finite(n, -1, maxDepth)) &&
        finite(capture.bias, 0, geometry.half[2]);
      if (!valid) throw new TypeError('Visible spray needs its captured receiver depths and bias');
    } else if (capture !== undefined) throw new TypeError('Wrap spray does not use visibility capture');
    const pigment = [1, 3, 5].map(i => Number.parseInt(style.color.slice(i, i + 2), 16) / 255);
    function sample(point, normal) {
      const local = graph.point(frame, point), edge = inset(geometry, local);
      if (edge <= 0 || style.opacity === 0) return 0;
      const direction = -V.norm(M.app(normalMatrix, normal), [0, 0, 1])[2];
      const { facing, softness, falloff, opacity } = style;
      const angle = facing === 'all' ? 1 : facing.feather ?
        smooth(clamp01((direction - facing.minDot) / facing.feather)) : Number(direction >= facing.minDot);
      if (!angle) return 0;
      const contour = softness ? smooth(clamp01(edge / softness)) ** falloff : 1;
      return opacity * angle * contour * (capture ? visibility(capture, ...local, direction, geometry.half) : 1);
    }
    return { id: raw.id, sample, pigment };
  }

  function prepare(strokes) {
    if (!Array.isArray(strokes) || !strokes.length || strokes.length > maxStrokes)
      throw new TypeError('A solid supports 1–' + maxStrokes + ' retained sprays');
    const ids = new Set(), compiled = Array.from(strokes, row => compile(row, ids));
    return { locate(point, normal, onHit) {
      let color = [0, 0, 0], residual = 1;
      for (const { id, sample, pigment } of compiled) {
        const weight = sample(point, normal);
        if (!(weight > 0)) continue;
        onHit?.(id, weight);
        color = V.lerp(color, pigment, weight);
        residual *= 1 - weight;
      }
      if (residual === 1) return;
      return rgb => {
        const light = .35 + .85 * (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]);
        return color.map((c, i) => clamp01(c * light + rgb[i] * residual));
      };
    } };
  }

  function captureDepths(field, frame, geometry, resolution, bias, selected) {
    const [w, h, d] = geometry.half, span = Math.max(w, h), graph = K.sceneGraph;
    const [nx, ny] = [w, h].map(n => Math.max(1, Math.round(resolution * n / span)));
    const epsilon = Math.min(.00075, d / 512, span / resolution / 12);
    const depthBias = bias ?? Math.min(d, Math.max(epsilon * 4, .001));
    const grids = new Map(selected.map(id => [id, { grid: [nx, ny], bias: depthBias, depths: Array(nx * ny).fill(-1) }]));
    const origin = graph.point(frame, [0, 0, 0]), forward = M.app(frame.matrix, [0, 0, 1]);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const start = graph.point(frame, [((x + .5) / nx * 2 - 1) * w, ((y + .5) / ny * 2 - 1) * h, -d]);
      let distance = field.sdf(...start);
      // A nozzle already inside a blocker cannot reach surfaces on the other side.
      if (distance < -epsilon) continue;
      let t = 0, point = start;
      for (let i = 0; distance > epsilon && t < 2 * d && i < 384; i++) {
        t = Math.min(2 * d, t + Math.max(distance * .65, epsilon * .5));
        point = V.mad(start, forward, t);
        distance = field.sdf(...point);
      }
      if (!(distance <= epsilon)) continue;
      const { body } = field.renderSurface(...point);
      const grid = grids.get(body?.renderTarget?.entity);
      if (!grid) continue;
      grid.depths[y * nx + x] = Math.round(clamp01((V.dot(V.sub(point, origin), forward) + d) / (2 * d)) * maxDepth);
    }
    return grids;
  }

  function entry(solid, { id, geometry, frame, facing, occlusion, color, opacity, softness, falloff, capture }) {
    return { solid: solid.id, id, geometry, frame, facing, occlusion, color, opacity, softness, falloff,
      ...(capture && { grid: capture.grid, bias: capture.bias,
        receiverRays: capture.depths.reduce((count, depth) => count + Number(depth >= 0), 0) }) };
  }

  function inspect(scene) {
    return freeze(clone((scene.solids ?? []).flatMap(solid => (solid.sdfSpray ?? []).map(stroke => entry(solid, stroke)))));
  }

  function plan(scene, input, env) {
    const { id, targets, geometry, style, resolution, bias, frame } = request(clone(input));
    if (scene.brushRegion != null) throw new TypeError('Volume spray needs a native sculpt scene');
    if ((scene.solids ?? []).some(solid => solid.sdfSpray?.some(stroke => stroke.id === id)))
      throw new RangeError('A spray with this ID already exists: ' + id);
    const receivers = targets.map(target => {
      const solid = scene.solids?.find(row => row.id === target && authored(row));
      if (!solid) throw new RangeError('Choose a named exterior sculpt solid for spray: ' + target);
      if ((solid.sdfSpray?.length ?? 0) >= maxStrokes) throw new RangeError('Too many retained sprays on ' + target);
      return solid;
    });
    const { field, frames } = K.diorama.sculptFieldReceivers(scene, env);
    const captures = style.occlusion === 'visible' ? captureDepths(field, frame, geometry, resolution, bias, targets) : null;
    const graph = K.sceneGraph, inverse = graph.inverse(frame);
    const strokes = receivers.map(solid => ({ id, geometry, ...style,
      frame: graph.compose(inverse, frames.get(solid.id)),
      ...(captures && { capture: captures.get(solid.id) }) }));
    return freeze({ id, targets, strokes, report: { id, receivers: receivers.map((solid, i) => entry(solid, strokes[i])) } });
  }

  K.procedural.sdfVolumeSpray = Object.freeze({ prepare });
  K.authoring.sculptSpray = Object.freeze({ plan, inspect });
})(KIT);
