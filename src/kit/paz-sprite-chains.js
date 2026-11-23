/* Spring-linked sprite cels with two registered sockets and joint contact. */
(function (K) {
  const V = K.V;
  const styles = new WeakMap();
  const states = ['straight', 'bent', 'compressed', 'contact'];
  const number = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const vector = (p, size) => Array.isArray(p) && p.length === size &&
    Array.from(p).every(n => number(n, -1e6, 1e6));
  const axis = ([ax, ay], [bx, by]) => {
    const length = Math.hypot(bx - ax, by - ay);
    return length > 1e-8 ? [(bx - ax) / length, (by - ay) / length, length] : [1, 0, 0];
  };

  function check(ok, message) {
    if (!ok) throw new RangeError('Sprite chains: ' + message);
  }

  function style({ palette, bendAt = Math.PI / 6, compressAt = .80, mirrorBent = true, ...sets } = {}, colors = {}) {
    check(number(bendAt, .001, Math.PI) && number(compressAt, .05, 1) && typeof mirrorBent === 'boolean' &&
      Object.keys(sets).every(key => states.includes(key)) && Array.isArray(sets.straight), 'invalid cel families or thresholds');
    const art = {};
    for (const [name, list] of Object.entries(sets)) {
      check(Array.isArray(list) && integer(list.length, 1, 24), 'each pose family needs one to 24 cels');
      art[name] = Array.from(list, ({ stamp, sockets } = {}, index) => {
        const { width, height } = stamp ?? {};
        check(integer(width, 1, 128) && integer(height, 1, 128) && stamp.frames === undefined &&
          Array.isArray(sockets) && sockets.length === 2 && Array.from(sockets).every(p =>
            vector(p, 2) && integer(p[0], 0, width - 1) && integer(p[1], 0, height - 1)),
          'a static cel needs two pixel sockets inside its grid');
        const [start, end] = sockets, [ux, uy, length] = axis(start, end);
        const { rgba } = K.pixelStamps.image({ ...stamp, palette: stamp.palette ?? palette }, colors);
        check(length && sockets.every(([x, y]) => rgba[(y * width + x) * 4 + 3]),
          'sockets need to be distinct painted pixels');
        return { rgba, width, height, start: start.slice(), ux, uy, length, index };
      });
    }
    function choose(ratio, turn, onContact, dx, dy, length) {
      const state = onContact && art.contact ? 'contact' : ratio <= compressAt && art.compressed ? 'compressed' :
        Math.abs(turn) >= bendAt && art.bent ? 'bent' : 'straight';
      let pose, best = Infinity;
      for (const cel of art[state]) {
        const dot = dx * cel.ux + dy * cel.uy, cross = dx * cel.uy - dy * cel.ux;
        // Quarter turns preserve exact texels. Prefer the least residual rotation and stretch.
        const cost = Math.abs(Math.log(length / cel.length)) + 2 * (1 - Math.max(Math.abs(dot), Math.abs(cross)));
        if (cost < best - 1e-10) { best = cost; pose = cel; }
      }
      return { state, pose, flip: state === 'bent' && mirrorBent && turn < 0 ? -1 : 1 };
    }
    const result = Object.freeze({ families: Object.freeze(Object.keys(art)) });
    styles.set(result, choose);
    return result;
  }

  function pin(row, points) {
    const { index, at } = typeof row === 'number' ? { index: row } : row ?? {};
    check(integer(index, 0, points.length - 1) && (at === undefined || vector(at, 3) || typeof at === 'function'),
      'pins need a joint index and an optional XYZ point or time callback');
    const target = at === undefined ? points[index] : typeof at === 'function' ? at : at.slice();
    return [index, typeof target === 'function' ? time => {
      const p = target(time);
      check(vector(p, 3), 'pin callback must return a finite XYZ point');
      return p;
    } : () => target];
  }

  function blit(rgba, w, h, cel, origin, dx, dy, length, flip) {
    const { width, height, start, ux, uy } = cel;
    const scale = length / cel.length;
    const corners = [[-.5, -.5], [width - .5, -.5], [-.5, height - .5], [width - .5, height - .5]]
      .map(([x, y]) => {
        x -= start[0]; y -= start[1];
        const along = (x * ux + y * uy) * scale, across = (y * ux - x * uy) * flip;
        return [origin[0] + along * dx - across * dy, origin[1] + along * dy + across * dx];
      });
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const left = Math.max(0, Math.ceil(Math.min(...xs))), right = Math.min(w - 1, Math.floor(Math.max(...xs)));
    const top = Math.max(0, Math.ceil(Math.min(...ys))), bottom = Math.min(h - 1, Math.floor(Math.max(...ys)));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const relX = x - origin[0], relY = y - origin[1];
      const along = (relX * dx + relY * dy) / scale, across = (relY * dx - relX * dy) * flip;
      const sx = Math.round(start[0] + along * ux - across * uy);
      const sy = Math.round(start[1] + along * uy + across * ux);
      if (!integer(sx, 0, width - 1) || !integer(sy, 0, height - 1)) continue;
      const p = (sy * width + sx) * 4;
      if (cel.rgba[p + 3]) rgba.set(cel.rgba.subarray(p, p + 4), (y * w + x) * 4);
    }
  }

  function turn(before, at, after) {
    if (!before || !at || !after) return 0;
    const [ax, ay, a] = axis(before, at), [bx, by, b] = axis(at, after);
    return a && b ? Math.atan2(ax * by - ay * bx, ax * bx + ay * by) : 0;
  }
  const xy = p => [p[0], p[1]];

  function create({ points, pins = [0], style: common, linkStyles, gravity = [0, 24, 0], damp = 4,
    stretch = .002, bend = .015, radius = 1, sdf, friction = .16, contactTolerance = .12,
    hz = 120, substeps = 4 } = {}) {
    check(Array.isArray(points) && integer(points.length, 2, 96) && Array.from(points).every(p => vector(p, 3)) &&
      Array.isArray(pins) && pins.length <= points.length && styles.has(common) &&
      (linkStyles === undefined || Array.isArray(linkStyles) && linkStyles.length === points.length - 1 &&
        Array.from(linkStyles).every(s => s === null || styles.has(s))), 'invalid rest points, pins or link styles');
    check(vector(gravity, 3) && number(damp, 0, 120) && number(stretch, 0, 10) && number(bend, 0, 10) &&
      number(radius, .001, 10000) && (sdf === undefined || typeof sdf === 'function') &&
      number(friction, 0, 1) && number(contactTolerance, 0, 100) && integer(hz, 24, 240) && integer(substeps, 1, 12),
      'invalid spring, clock or contact settings');
    const rest = points.map(p => p.slice()), fixed = new Map(Array.from(pins, row => pin(row, rest)));
    check(fixed.size === pins.length, 'each joint can only have one pin');
    const lengths = rest.slice(1).map((p, i) => V.dist(p, rest[i]));
    check(lengths.every(n => n > .0001), 'adjacent rest joints must be separated');
    const choose = lengths.map((_, i) => styles.get(linkStyles?.[i] ?? common));
    const contacts = sdf && K.xpbd.contactField(sdf, {friction,tolerance:contactTolerance,fallback:[0,-1,0]});
    const solver = K.xpbd.sim({ gravity: gravity.slice(), damp, substeps, fixedStep: true,
      substepPins: true, project: contacts?.project });
    for (const p of rest) solver.point(p, 1, radius);
    for (const { a, b, compliance } of K.xpbd.ropeLinks(rest.length, stretch, 0, bend)) solver.link(a, b, compliance);
    for (const [index, at] of fixed) solver.pin(index, at);
    solver.resetPose(rest.flatMap((p, i) => fixed.has(i) ? fixed.get(i)(0) : p));
    const initial = solver.motion(), checkpoints = new Map([[0, initial]]);
    let tick = 0;

    function sample(time = 0) {
      check(number(time, 0, 600), 'scene time must be between zero and 600 seconds');
      const next = Math.floor(time * hz + 1e-8);
      try {
        if (next < tick) {
          tick = 0;
          for (const key of checkpoints.keys()) if (key <= next && key > tick) tick = key;
          solver.restoreMotion(checkpoints.get(tick));
        }
        while (tick < next) {
          solver.step(1 / hz, ++tick / hz);
          if (tick % hz === 0 && checkpoints.size < 121 && !checkpoints.has(tick)) checkpoints.set(tick, solver.motion());
        }
        const pose = rest.map((_, i) => Array.from(solver.X.subarray(i * 3, i * 3 + 3)));
        check(pose.every(p => vector(p, 3)), 'chain exceeded its finite coordinate range');
        return { time: tick / hz, points: pose,
          contacts: pose.map((p, i) => !fixed.has(i) && contacts ? contacts.hit(p, tick / hz, radius) : null) };
      } catch (error) {
        // Replaying a failing driver must start from an intact simulation state.
        checkpoints.clear();
        checkpoints.set(0, initial);
        solver.restoreMotion(initial);
        tick = 0;
        throw error;
      }
    }

    function render({ width: w, height: h, time = 0, project = xy } = {}) {
      check(integer(w, 1, 4096) && integer(h, 1, 4096) && w * h <= 1048576 && typeof project === 'function',
        'render needs a bounded native canvas and a point projector');
      const pose = sample(time), rgba = new Uint8Array(w * h * 4);
      const screen = pose.points.map(p => {
        const xy = project(p.slice(), pose.time);
        check(xy === null || vector(xy, 2), 'projector must return a finite pixel pair or null');
        return xy?.slice() ?? null;
      });
      const snapped = screen.map(p => p?.map(Math.round) ?? null);
      const turns = screen.map((p, i) => turn(screen[i - 1], p, screen[i + 1]));
      const segments = lengths.map((restLength, i) => {
        const from = snapped[i], to = snapped[i + 1];
        if (!from || !to) return null;
        const [dx, dy, span] = axis(from, to);
        const [ux, uy] = span ? [dx, dy] : axis(screen[i], screen[i + 1]);
        const ratio = V.dist(pose.points[i], pose.points[i + 1]) / restLength;
        const bend = Math.abs(turns[i]) >= Math.abs(turns[i + 1]) ? turns[i] : turns[i + 1];
        const onContact = Boolean(pose.contacts[i] || pose.contacts[i + 1]);
        const { state, pose: cel, flip } = choose[i](ratio, bend, onContact, ux, uy, span || 1);
        blit(rgba, w, h, cel, from, ux, uy, span || 1, flip);
        return { index: i, state, cel: cel.index, from, to, ratio, bend, onContact };
      });
      return { w, h, rgba, ...pose, segments };
    }

    function layer({ resolution, space = 'pixels' } = {}) {
      check(['pixels', 'world'].includes(space), 'layer space must be pixels or world');
      return { ...(resolution !== undefined && { resolution }), filter: 'nearest', needsCamera: space === 'world',
        source({ w, h, time: interfaceTime, sceneTime, camera }) {
          const time = Math.max(0, sceneTime ?? interfaceTime ?? 0);
          if (space === 'pixels') return render({ width: w, height: h, time });
          const view = DrawingPrimitives.projector(camera, w, h);
          return render({ width: w, height: h, time, project: point => {
            const p = view.toView(point);
            return view.visible(p) ? view.point(p).map(n => n - .5) : null;
          } });
        } };
    }
    return Object.freeze({ sample, render, layer });
  }

  K.spriteChains = Object.freeze({ style, create });
})(KIT);
