// Scene support extracted from the Inkwell Rebirth examples.
function rebirthInfernoSupport({ KIT }) {
  function makeCharacter(B, spec, LANE0) { return KIT.character(B, spec, LANE0); }

  const PTS = (hip, chest, hem, neck, sock, lz) => Object.assign({ hip: [0, hip, 0], chest: [0, chest, 0], hem: [0, hem, 0], neck: [0, neck, 0] }, sock ? { sock: [0, sock, lz], ank: [0, 0.05, lz] } : {});

  const SCALLOP = (y, mat, r) => [[-1, 1], [-1, -1], [1, 1], [1, -1]].map(([sx, sz]) => ({ at: [sx * 0.2, y, sz * 0.14], n: 2, seg: 0.09, r0: r || 0.1, r1: 0.04, mat, dir: sx > 0 ? [0.15, -1, 0] : [-0.3, -0.95, 0] }));

  const INF = {
    ss: v => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v * v * (3 - 2 * v); },
    path(pts, closed, n) {
      const P = [], m = pts.length, get = i => closed ? pts[(i + m) % m] : pts[Math.max(0, Math.min(m - 1, i))], segs = closed ? m : m - 1;
      for (let i = 0; i < segs; i++) for (let k = 0; k < n; k++) { const t = k / n, a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2), t2 = t * t, t3 = t2 * t;
        P.push([0, 1].map(j => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3))); }
      if (!closed) P.push(pts[m - 1].slice());
      const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const tot = L[L.length - 1] + (closed ? Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) : 0);
      const at = s => { s = closed ? ((s % tot) + tot) % tot : Math.max(0, Math.min(tot, s)); let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (L[md] <= s) lo = md; else hi = md; }
        const a = P[lo], b = closed && lo === P.length - 1 ? P[0] : P[Math.min(P.length - 1, lo + 1)], seg = (closed && lo === P.length - 1 ? tot : L[lo + 1]) - L[lo] || 1, u = Math.max(0, Math.min(1, (s - L[lo]) / seg)), dx = b[0] - a[0], dz = b[1] - a[1], dl = Math.hypot(dx, dz) || 1;
        return { x: a[0] + dx * u, z: a[1] + dz * u, tx: dx / dl, tz: dz / dl }; };
      // the distance from a point to the line, and how far along it the nearest place is
      const near = (x, z) => { let best = 1e9, bs = 0; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], bx = b[0] - a[0], bz = b[1] - a[1], l2 = bx * bx + bz * bz || 1;
        let u = ((x - a[0]) * bx + (z - a[1]) * bz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u; const dx = x - a[0] - bx * u, dz = z - a[1] - bz * u, d = dx * dx + dz * dz; if (d < best) { best = d; bs = L[i] + u * Math.sqrt(l2); } }
        return [Math.sqrt(best), bs]; };
      return { P, L, tot, at, near };
    },
    drape(S, o, mat, opts) {
      const V = KIT.V, n3 = o.n3;   // (the builder's noise, passed in)
      const U = V.norm(o.U || [0, 1, 0]), X0 = o.X || [0, 0, 1], X = V.norm(V.mad(X0, U, -V.dot(X0, U))), Y = V.cross(U, X);
      const L = o.len, rf = o.r, am = o.amp || (() => 0.3), n = o.n || 10, sd0 = o.seed || 0, arc = o.arc, thick = o.thick || 0;
      const ph = (a, t) => 1.4 * (n3(Math.cos(a) * 1.3 + sd0, Math.sin(a) * 1.3, t * 2.2) - 0.5) * 2;
      const R = (t, a) => rf(t) + am(t) * (1 - 2 * Math.pow(Math.abs(Math.sin(0.5 * n * a + ph(a, t))), 0.75));
      const inArc = a => { if (!arc) return 0; let q = a; while (q < arc[0]) q += 2 * Math.PI; while (q > arc[0] + 2 * Math.PI) q -= 2 * Math.PI; return q <= arc[1] ? 0 : Math.min(q - arc[1], arc[0] + 2 * Math.PI - q); };
      const c = o.c, rmax = Math.max(...[0, 0.25, 0.5, 0.75, 1].map(t => rf(t) + am(t))) + 1;
      return S.add({ bc: V.mad(c, U, L / 2), br: L / 2 + rmax,
        sd(x, y, z) { const q = [x - c[0], y - c[1], z - c[2]], h = V.dot(q, U), t = Math.max(0, Math.min(1, h / L)), rv = V.mad(q, U, -h), rho = V.len(rv), a = Math.atan2(V.dot(rv, Y), V.dot(rv, X)), Rr = R(t, a);
          let d = thick ? Math.abs(rho - Rr) - thick : (rho - Rr) * 0.6; d = Math.max(d, -h, h - L); const off = inArc(a); if (off > 0) d = Math.max(d, off * Math.max(0.5, rho)); return d; },
        sample(f) { const res = this.res; for (let h = 0; h <= L; h += res) { const t = h / L, rr = rf(t) + am(t), a0 = arc ? arc[0] : 0, a1 = arc ? arc[1] : 2 * Math.PI;
          for (let a = a0; a < a1; a += res / Math.max(0.3, rr)) { const Rr = R(t, a), dir = V.add(V.mad([0, 0, 0], X, Math.cos(a)), V.mad([0, 0, 0], Y, Math.sin(a))), base = V.mad(c, U, h);
            f(...V.mad(base, dir, Rr + thick)); if (thick) f(...V.mad(base, dir, Rr - thick)); } } } }, mat, opts); },
    loose(B, n) { return KIT.pool(B, n); },
    pilgrim: C => ({ id: 'pilgrim', name: 'The Pilgrim', anim: { breath: 0.02, bf: 2.0, sway: 0.03, sf: 1.2 }, height: 1.6, faceTurn: 0.5, fx: C.fx, light: { lo: 0.25, hi: 1.05 },
      pts: PTS(0.6, 0.86, 0.4, 1.0, 0.4, 0.08), legs: { r0: 0.04, r1: 0.032, mat: C.dark, foot: [0.06, 0.03, 0.04] }, tails: SCALLOP(0.36, C.cloak, 0.09),
      speed: { walk: 2.4, run: 5.0 },
      sculpt(S, T, U) { const G = S.grp(0.1), M = { r: C.cloak };
        S.lathe([0, 0.34, 0], 0.64, t => U.mixn(0.33, 0.16, Math.pow(t, 1.15)), M, Object.assign(T('hem', 'chest', p => U.ss((p[1] - 0.4) / 0.5)), G));
        S.ball([0, 1.17, 0], [0.26, 0.28, 0.25], M, Object.assign(T('head'), G));
        S.tube([[-0.06, 1.34, 0], [-0.26, 1.42, 0], [-0.4, 1.33, 0]], t => 0.12 * (1 - t) + 0.02, 0, M, Object.assign(T('head'), G));   // the hood falls to a point behind
        S.ball([0.2, 1.15, 0], [0.16, 0.19, 0.18], {}, T('head', null, null, { neg: true }));   // the hood is deep
        S.ball([0.11, 1.14, 0], [0.11, 0.15, 0.14], { r: C.face }, U.gh('head', 0.035));
        S.tube([[0.1, 0.9, 0.2], [0.24, 0.72, 0.26], [0.28, 0.56, 0.2]], 0.07, 0.05, M, Object.assign(T('chest'), G));   // an arm held close
      } }),
    stage(W, pool) { const st = { W, D: W.data, rows: new Uint8Array(Math.ceil(W.count / 512)) }; for (let i = 0; i < pool.n; i++) W.data[(pool.first + i) * 16 + 11] = 16 + 32; return st; },
    crowd(o, random) {
      const rr = (a, b) => a + random() * (b - a), P = [];
      for (let k = 0; k < o.n; k++) { const [x, z] = o.spawn(); P.push({ k, x, z, y: o.ground(x, z), vx: 0, vz: 0, fx: 1, fz: 0, v: 0, ph: rr(0, 2), sp: rr(o.speed[0], o.speed[1]), mode: 'go', mt: rr(1, 5), goal: null, fall: 0, beat: 0, seed: rr(0, 99), fear: 0 }); }
      const pickGoal = p => { for (let i = 0; i < 12; i++) { const a = rr(0, 6.283), d = rr(o.wander[0], o.wander[1]), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (o.ok(x, z)) return [x, z]; } return o.spawn(); };
      const update = (dt, t, threats) => {
        for (const p of P) {
          p.mt -= dt; if (!p.goal || Math.hypot(p.goal[0] - p.x, p.goal[1] - p.z) < 1.2) p.goal = pickGoal(p);
          let ax = 0, az = 0, fear = 0;
          for (const th of threats) { const dx = p.x - th.x, dz = p.z - th.z, d = Math.hypot(dx, dz) || 1e-3; if (d < th.r) { const w = th.k * (1 - d / th.r); ax += dx / d * w; az += dz / d * w; fear = Math.max(fear, w); } }
          p.fear += (fear - p.fear) * Math.min(1, dt * 3);
          if (p.mode === 'go' && p.mt <= 0 && p.fear < 0.3) { const q = random(); if (o.beat && q < 0.5) { p.mode = 'beat'; p.mt = rr(0.9, 2.2); } else if (q < 0.8) { p.mode = 'stop'; p.mt = rr(0.5, 1.6); } else p.mt = rr(1, 4); }
          else if ((p.mode === 'stop' || p.mode === 'beat') && (p.mt <= 0 || p.fear > 0.4)) { p.mode = 'go'; p.mt = rr(2.5, 7); if (random() < 0.4) p.goal = pickGoal(p); }
          else if (p.mode === 'go' && p.fear > 0.5 && p.v > 2 && random() < dt * 0.35) { p.mode = 'down'; p.mt = rr(0.9, 1.6); }
          else if (p.mode === 'down' && p.mt <= 0) { p.mode = 'up'; p.mt = 0.7; }
          else if (p.mode === 'up' && p.mt <= 0) { p.mode = 'go'; p.mt = rr(2, 5); }
          const moving = p.mode === 'go', sp = p.sp * (1 + 0.8 * p.fear);
          let dx = p.goal[0] - p.x, dz = p.goal[1] - p.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
          let wx = moving ? dx * sp + ax * sp * 2 : ax * sp * (p.mode === 'down' ? 0 : 1.5), wz = moving ? dz * sp + az * sp * 2 : az * sp * (p.mode === 'down' ? 0 : 1.5);
          for (const q of P) if (q !== p) { const ex = p.x - q.x, ez = p.z - q.z, e = ex * ex + ez * ez; if (e < 0.6 && e > 1e-6) { const ee = Math.sqrt(e); wx += ex / ee * (0.78 - ee) * 4; wz += ez / ee * (0.78 - ee) * 4; } }
          const wl = Math.hypot(wx, wz), cap = sp * 1.9; if (wl > cap) { wx *= cap / wl; wz *= cap / wl; }
          let gx = wx - p.vx, gz = wz - p.vz; const gl = Math.hypot(gx, gz), amax = (p.mode === 'down' ? 14 : 7) * dt; if (gl > amax) { gx *= amax / gl; gz *= amax / gl; }
          p.vx += gx; p.vz += gz; const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
          if (o.ok(nx, nz)) { p.x = nx; p.z = nz; } else { p.vx *= -0.3; p.vz *= -0.3; p.goal = pickGoal(p); }
          p.v = Math.hypot(p.vx, p.vz); if (p.v > 0.25) { const k2 = Math.min(1, dt * 8); p.fx += (p.vx / p.v - p.fx) * k2; p.fz += (p.vz / p.v - p.fz) * k2; const fl = Math.hypot(p.fx, p.fz) || 1; p.fx /= fl; p.fz /= fl; }
          p.ph += p.v * dt / 0.48;
          p.y = o.ground(p.x, p.z);
          p.fall += ((p.mode === 'down' ? 1 : 0) - p.fall) * Math.min(1, dt * (p.mode === 'down' ? 9 : 3));
          p.beat += ((p.mode === 'beat' ? 1 : 0) - p.beat) * Math.min(1, dt * 7);
        } };
      return { P, update };
    },
    drawFigure(st, pool, ids, P, cols, t, scale) {
      const k = scale || 1, f = [P.fx, 0, P.fz], side = [-P.fz, 0, P.fx], lean = 0.1 + 0.16 * Math.min(1, P.v / 3), fl = P.fall || 0;
      let U = KIT.V.norm([P.fx * lean, 1, P.fz * lean]); if (fl > 0) U = KIT.V.norm([U[0] + (P.fx * 1.4 - U[0]) * fl, U[1] + (0.12 - U[1]) * fl, U[2] + (P.fz * 1.4 - U[2]) * fl]);
      const al = 3 * (P.a === undefined ? 1 : P.a), y0 = P.y, hipH = 0.42 * k * (1 - 0.72 * fl), hip = [P.x, y0 + hipH, P.z], put = (i, c, s, col, ax, l) => pool.put(st, ids[i], c[0], c[1], c[2], s, col, al, ax, l);
      const at = (b, u, s2, w) => [b[0] + U[0] * u + side[0] * s2 + f[0] * w, b[1] + U[1] * u + side[1] * s2, b[2] + U[2] * u + side[2] * s2 + f[2] * w];
      const seg = (i, a, b, w, col) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1e-3; put(i, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], w, col, [d[0] / L, d[1] / L, d[2] / L], L / 2 + w * 0.5); };
      const bob = 0.03 * k * Math.abs(Math.sin(Math.PI * P.ph)) * Math.min(1, P.v / 1.5);
      seg(0, at(hip, 0, 0, 0), at(hip, 0.5 * k + bob, 0, 0), 0.085 * k, cols[0]);
      put(1, at(hip, 0.66 * k + bob, 0, 0.03 * k + 0.05 * (P.beat || 0) * Math.sin(t * 11 + P.seed)), 0.075 * k, cols[1]);
      for (const sg of [-1, 1]) { const s = Math.sin(Math.PI * (P.ph + (sg > 0 ? 0 : 1))), st2 = Math.min(1, P.v / 1.2) * (1 - fl), lift = Math.max(0, Math.cos(Math.PI * (P.ph + (sg > 0 ? 0 : 1)))) * 0.08 * k * st2;
        const foot = fl > 0.5 ? at(hip, -0.05, sg * 0.07 * k, -0.4 * k) : [P.x + f[0] * 0.22 * k * s * st2 + side[0] * sg * 0.06 * k, y0 + 0.03 + lift, P.z + f[2] * 0.22 * k * s * st2 + side[2] * sg * 0.06 * k];
        seg(sg < 0 ? 2 : 3, at(hip, 0.02, sg * 0.06 * k, 0), foot, 0.042 * k, cols[2]);
        const sh = at(hip, 0.44 * k + bob, sg * 0.1 * k, 0), bt = P.beat || 0, sw = -s * 0.2 * k * st2;
        const run = at(sh, -0.26 * k, sg * 0.03 * k, sw + 0.04 * k), beatH = at(sh, 0.24 * k + 0.1 * k * Math.sin(t * (14 + 3 * sg) + P.seed * (sg + 2)), sg * (0.1 + 0.08 * Math.sin(t * 9 + P.seed + sg)) * k, 0.1 * k * Math.cos(t * 12 + P.seed));
        seg(sg < 0 ? 4 : 5, sh, [run[0] + (beatH[0] - run[0]) * bt, run[1] + (beatH[1] - run[1]) * bt, run[2] + (beatH[2] - run[2]) * bt], 0.035 * k, cols[2]); } }
  };

  return { makeCharacter, INF };
}

if (typeof module !== 'undefined') module.exports = rebirthInfernoSupport;
