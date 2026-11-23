/* A bounded planar material-point solver with quadratic APIC transfers. */
(function (K) {
  const P = K.procedural;
  const { kinds, size, obstacles, int, range, vector, clamp, raster, buffer, move, color } = P.rasterSimSupport;
  const stride = 12;
  const particleLimit = 8000;
  const falloff = distance => distance < .5 ? .75 - distance * distance
    : distance < 1.5 ? .5 * (1.5 - distance) ** 2 : 0;

  kinds.mpm = (options, { seed, dt: clock }) => {
    const dims = size(options, 65536), { width, height } = dims, { open } = obstacles(options, dims);
    const { cell = 2, substeps = 5, gravity = [0, 96], maxSpeed = 180, damping = .18, bounce = .05,
      materials = [{ type: 'fluid', color: '#5cdad6' }, { type: 'elastic', color: '#f08b62' }],
      bodies = [{ rect: [width * .25, height * .16, width * .5, height * .28] }]
    } = options;
    if (!range(cell, 1, 12) || !int(substeps, 1, 16) || !vector(gravity, 2) ||
        !range(maxSpeed, 1, 500) || !range(damping, 0, 10) || !range(bounce, 0, 1) ||
        !Array.isArray(materials) || !int(materials.length, 1, 16) ||
        !Array.isArray(bodies) || !int(bodies.length, 1, 64))
      throw new RangeError('Invalid MPM grid, clock, materials, or bodies');

    const stepSize = clock / substeps;
    const recipes = materials.map(({ type = 'fluid', stiffness = type === 'fluid' ? 190 : 340,
      shear = stiffness * .36, density = 1, color: tint = '#75c9d5' }) => {
      if (!['fluid', 'elastic'].includes(type) || !range(stiffness, 0, 10000) ||
          !range(shear, 0, 10000) || !range(density, .05, 20))
        throw new RangeError('Invalid MPM material');
      if (stepSize * (maxSpeed + Math.sqrt((stiffness + 2 * shear) / density)) > .65 * cell)
        throw new RangeError('MPM clock needs more substeps, a larger cell, or lower speeds and stiffness');
      return { type, stiffness, shear, density, rgb: color(tint) };
    });

    const random = K.grow.dice(P.data.hash('material-points', seed));
    const points = [], body = [];
    for (const [index, entry] of bodies.entries()) {
      const { rect, points: explicit, spacing = .85, velocity = [0, 0], material = 0, release = 0 } = entry;
      if (!int(material, 0, recipes.length - 1) || !vector(velocity, 2) ||
          !velocity.every(n => Math.abs(n) <= maxSpeed) || !range(release, 0, 1200) ||
          !range(spacing, .35, 8) || Number(rect !== undefined) + Number(explicit !== undefined) !== 1)
        throw new RangeError('An MPM body needs one fill, a material, and a valid release and velocity');
      function insert(x, y) {
        if (!open(x, y)) return;
        if (points.length >= particleLimit * stride) throw new RangeError('MPM particle budget exceeded');
        points.push(x, y, ...velocity, 0, 0, 0, 0, 1, 0, 0, 1);
        body.push(index);
      }
      if (explicit !== undefined) {
        if (!Array.isArray(explicit) || explicit.length > particleLimit || !explicit.every(p => vector(p, 2)))
          throw new RangeError('Invalid MPM point fill');
        for (const point of explicit) insert(...point);
      } else {
        if (!vector(rect, 4) || rect[2] <= 0 || rect[3] <= 0) throw new RangeError('Invalid MPM rectangle');
        const [x, y, w, h] = rect;
        for (let j = Math.max(0, Math.floor(-y / spacing)); y + j * spacing < Math.min(height, y + h); j++)
          for (let i = Math.max(0, Math.floor(-x / spacing)); x + i * spacing < Math.min(width, x + w); i++) {
            const px = x + (i + .32 + random() * .36) * spacing, py = y + (j + .32 + random() * .36) * spacing;
            if (px < x + w && py < y + h) insert(px, py);
          }
      }
    }
    if (!body.length) throw new RangeError('MPM fill has no open particles');
    let p = Float64Array.from(points);
    const count = body.length;
    const bodySettings = bodies.map(({ spacing = .85, material = 0, release = 0 }) => ({
      ...recipes[material], volume: spacing * spacing, mass: spacing * spacing * recipes[material].density, release
    }));
    const nx = Math.ceil(width / cell), ny = Math.ceil(height / cell), nodes = nx * ny;
    const mass = new Float64Array(nodes), vx = new Float64Array(nodes), vy = new Float64Array(nodes);
    const sides = new Uint8Array(nodes), offsets = new Int32Array(9), ws = new Float64Array(9);
    const dx = new Float64Array(9), dy = new Float64Array(9);
    const invMoment = 4 / (cell * cell);
    const on = (x, y) => open((x + .5) * cell, (y + .5) * cell);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!on(x, y)) continue;
      sides[y * nx + x] = 16 | Number(!on(x - 1, y)) | (Number(!on(x + 1, y)) << 1) |
        (Number(!on(x, y - 1)) << 2) | (Number(!on(x, y + 1)) << 3);
    }
    function support(x, y) {
      const u = x / cell - .5, v = y / cell - .5;
      const firstX = Math.floor(u - .5), firstY = Math.floor(v - .5);
      let n = 0, total = 0;
      for (let j = Math.max(0, firstY); j <= Math.min(ny - 1, firstY + 2); j++)
        for (let i = Math.max(0, firstX); i <= Math.min(nx - 1, firstX + 2); i++) {
          const k = i + nx * j;
          if (!(sides[k] & 16)) continue;
          const weight = falloff(Math.abs(u - i)) * falloff(Math.abs(v - j));
          if (!weight) continue;
          total += weight;
          offsets[n] = k; ws[n] = weight; dx[n] = (i - u) * cell; dy[n] = (j - v) * cell;
          n++;
        }
      let mx = 0, my = 0;
      for (let j = 0; j < n; j++) {
        ws[j] /= total;
        mx += ws[j] * dx[j];
        my += ws[j] * dy[j];
      }
      for (let j = 0; j < n; j++) {
        dx[j] -= mx;
        dy[j] -= my;
      }
      return n;
    }

    // Kirchhoff stress for a compressible liquid or a fixed-corotated elastic body.
    const stress = new Float64Array(3);
    function stressAt(a, b, c, d, material) {
      const j = a * d - b * c;
      const pressure = material.stiffness * j * (j - 1);
      stress[0] = stress[2] = pressure;
      stress[1] = 0;
      if (material.type === 'fluid') return;
      const length = Math.hypot(a + d, c - b) || 1;
      const cos = (a + d) / length, sin = (c - b) / length;
      const mu = 2 * material.shear;
      stress[0] += mu * ((a - cos) * a + (b + sin) * b);
      stress[1] += mu * ((a - cos) * c + (b + sin) * d);
      stress[2] += mu * ((c - sin) * c + (d - cos) * d);
    }
    function advance(dt, time) {
      mass.fill(0); vx.fill(0); vy.fill(0);
      for (let i = 0, q = 0; i < count; i++, q += stride) {
        const material = bodySettings[body[i]];
        if (time < material.release) continue;
        const n = support(p[q], p[q + 1]), { mass: m, volume } = material;
        stressAt(p[q+8], p[q+9], p[q+10], p[q+11], material);
        const s = -dt * volume * invMoment;
        const ax = m * p[q+4] + s * stress[0], ay = m * p[q+5] + s * stress[1];
        const bx = m * p[q+6] + s * stress[1], by = m * p[q+7] + s * stress[2];
        for (let j = 0; j < n; j++) {
          const k = offsets[j], weight = ws[j];
          mass[k] += weight * m;
          vx[k] += weight * (m * p[q+2] + ax * dx[j] + ay * dy[j]);
          vy[k] += weight * (m * p[q+3] + bx * dx[j] + by * dy[j]);
        }
      }
      const retain = Math.exp(-damping * dt);
      for (let k = 0; k < nodes; k++) {
        if (mass[k] < 1e-12) continue;
        const s = sides[k];
        const x = clamp((vx[k] / mass[k] + gravity[0] * dt) * retain, -maxSpeed, maxSpeed);
        const y = clamp((vy[k] / mass[k] + gravity[1] * dt) * retain, -maxSpeed, maxSpeed);
        vx[k] = s & (x < 0 ? 1 : 2) ? -x * bounce : x;
        vy[k] = s & (y < 0 ? 4 : 8) ? -y * bounce : y;
      }
      const row = [0, 0, 0, 0];
      for (let i = 0, q = 0; i < count; i++, q += stride) {
        const material = bodySettings[body[i]];
        if (time < material.release) continue;
        const n = support(p[q], p[q+1]);
        row[0] = p[q]; row[1] = p[q+1];
        if (!n) {
          row[2] = clamp(p[q+2] + gravity[0] * dt, -maxSpeed, maxSpeed);
          row[3] = clamp(p[q+3] + gravity[1] * dt, -maxSpeed, maxSpeed);
          move(row, dt, open, bounce);
          p.set(row, q);
          continue;
        }
        let x = 0, y = 0, a = 0, b = 0, c = 0, d = 0;
        for (let j = 0; j < n; j++) {
          const k = offsets[j], mx = ws[j] * vx[k], my = ws[j] * vy[k];
          x += mx; y += my;
          a += mx * dx[j]; b += mx * dy[j]; c += my * dx[j]; d += my * dy[j];
        }
        row[2] = x; row[3] = y;
        move(row, dt, open, bounce);
        p.set(row, q);
        const limit = .24 / dt;
        p[q+4] = a = clamp(a * invMoment, -limit, limit);
        p[q+5] = b = clamp(b * invMoment, -limit, limit);
        p[q+6] = c = clamp(c * invMoment, -limit, limit);
        p[q+7] = d = clamp(d * invMoment, -limit, limit);
        a = 1 + dt * a; b *= dt; c *= dt; d = 1 + dt * d;
        const f = p[q+8], g = p[q+9], h = p[q+10], l = p[q+11];
        const e = a * f + b * h, m = a * g + b * l, r = c * f + d * h, s = c * g + d * l;
        const volume = e * s - m * r;
        const j = clamp(volume, .55, 1.85);
        if (material.type === 'fluid') {
          p[q+8] = p[q+11] = Math.sqrt(j);
        } else {
          const normalize = Math.sqrt(j / Math.max(volume, .05));
          p[q+8] = clamp(e * normalize, -4, 4); p[q+9] = clamp(m * normalize, -4, 4);
          p[q+10] = clamp(r * normalize, -4, 4); p[q+11] = clamp(s * normalize, -4, 4);
        }
      }
    }

    function frame() {
      const field = new Float32Array(width * height), light = new Float32Array(field.length);
      const rgb = new Float32Array(field.length * 3), data = new Uint8Array(field.length * 4);
      const marks = [];
      let totalMass = 0;
      for (let i = 0, q = 0; i < count; i++, q += stride) {
        const [x, y] = [p[q], p[q+1]], material = bodySettings[body[i]], speed = Math.hypot(p[q+2], p[q+3]);
        marks.push({ id: String(i), point: [x, y], velocity: [p[q+2], p[q+3]], body: body[i] });
        totalMass += material.mass;
        for (let iy = Math.max(0, Math.floor(y - 1.5)); iy < Math.min(height, Math.ceil(y + 1.5)); iy++)
          for (let ix = Math.max(0, Math.floor(x - 1.5)); ix < Math.min(width, Math.ceil(x + 1.5)); ix++) {
            if (!open(ix + .5, iy + .5)) continue;
            const w = falloff(Math.abs(ix + .5 - x)) * falloff(Math.abs(iy + .5 - y)) * material.volume;
            const k = ix + iy * width;
            field[k] += w;
            light[k] += w * speed / maxSpeed;
            for (let c = 0; c < 3; c++) rgb[k * 3 + c] += w * material.rgb[c];
          }
      }
      for (let i = 0; i < field.length; i++) {
        const density = field[i];
        if (density < .045) continue;
        const shade = density < .38 ? .75 : density < .68 ? 1.12 : .88 + .18 * light[i] / density;
        for (let c = 0; c < 3; c++) data[i*4+c] = clamp(Math.round(rgb[i*3+c] / density * shade), 0, 255);
        data[i*4+3] = density >= .42 ? 255 : Math.round(density / .42 * 255);
      }
      return { value: raster(dims, data, 4), field: raster(dims, field), points: marks, count, mass: totalMass };
    }

    return {
      work: substeps * (count * 65 + nodes * 5),
      step(tick, dt) { for (let i = 0; i < substeps; i++) advance(dt / substeps, ((tick - 1) + i / substeps) * dt); },
      capture: () => ({ particles: p }),
      restore(snapshot) {
        const state = buffer(snapshot?.particles, count * stride, -1e6, 1e6);
        for (let i = 0; i < state.length; i += stride)
          if (!open(state[i], state[i+1]) || Math.hypot(state[i+2], state[i+3]) > Math.SQRT2 * maxSpeed + 1e-7)
            throw new RangeError('Invalid MPM particle position or velocity in checkpoint');
        p = Float64Array.from(state);
      },
      frame
    };
  };
})(KIT);
