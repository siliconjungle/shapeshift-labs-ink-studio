// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthGrove(kit) {
  const { KIT, makeBuilder, makeSculpt } = kit;

  function sceneGrove(seed) {
    // 0 void · 1-3 the night and the bark in it, one blue-green · 4-5 moss and fern · 6-8 firefly light, from olive to nearly white
    // 9 mist
    const K = KIT, B = makeBuilder(seed, [0x05080c, 0x0a1620, 0x122a3a, 0x1e465a, 0x1e5a4a, 0x3f8c60, 0x98a62a, 0xe8e45c, 0xfdffc4, 0x6a8aa0]);
    const { rr, n3, fbm, P, TAU, UP, norm, iso, stick, clamp } = B, S = K.sculpt(makeSculpt(B)), R = K.creature(B, S);
    const { rot, mul, kf, frac, J, use, AX, AY, AZ } = R;
    S.sun = norm([-0.2, 1, 0.3]); S.sunK = 0.08; S.amb = 0.08; S.sky = 0.12; S.res = 0.1;
    // the light is the fireflies: three thick swarms of them, each in front of a face
    const SWARM = [[-2.4, 2.0, 3.4, 15, 1.2], [-6.6, 1.8, 2.6, 9, 0.8], [4.2, 2.2, 3.6, 11, 0.95], [-0.6, 2.2, -4.6, 8, 0.6]]; SWARM.forEach(([x, y, z, r, s], i) => S.lights.push({ p: [x, y, z], r, s, sh: i === 0 }));
    const hf = (x, z) => 0.25 * fbm(x * 0.15 + 4, z * 0.15, 1.5, 2) - 0.12, path = (x, z) => Math.abs(x - 1.5 * Math.sin(z * 0.32) - 1.2) < 0.85;
    S.ground({ r: [1, 1, 2], g: [2, 2, 3, 4, 5], blade: { h: 0.13, j: 1.5 }, mod: (x, y, z) => 0.34 * (n3(x * 0.5, z * 0.5, 2) - 0.5), tex: (x, y, z, ny, t) => path(x, z) ? (n3(x * 2.2, z * 2.2, 5) > 0.45 ? S.pick([1, 2, 3, 3], t) : undefined) : n3(x * 2.6, z * 2.6, 3) > 0.74 ? S.pick([2, 3, 6], t) : undefined }, { rad: 11, zs: 1.1, res: 0.11, h: hf });
    const BARK = { r: [1, 1, 2], g: [2, 2, 3, 3, 4, 5], mod: (x, y, z) => 0.34 * (n3(x * 2.6, y * 0.45, z * 2.6) - 0.5) + 0.14 * (n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) - (Math.abs(n3(x * 1.1, y * 0.25 + 3, z * 1.1) - 0.5) < 0.02 ? 0.35 : 0), tex: (x, y, z, ny, t) => ny > 0.55 && n3(x * 1.2, y * 1.2, z * 1.2) > 0.42 ? S.pick([4, 4, 5], t) : undefined }, DARK = { r: [0], g: [0, 0, 1] };
    // ---- a tree: a trunk that leans and swells, roots that grip, limbs held up like arms with twigs for fingers, and on the side that
    // faces you a face: two brows grown out over two holes, a knot for a nose, a mouth with splinters for teeth
    const TREES = [], MOSS = [], MOUTH = [];
    const tree = (x, z, h, r, lean, yaw, ex) => { const i = TREES.length, n = 'tree' + i, y0 = hf(x, z) - 0.35, G = Object.assign(S.grp(0.3 * r), { tag: n, res: ex.plain ? 0.13 : 0.098 }), o = q => Object.assign({ tag: n, res: 0.06 }, q);
      const SP = B.spline([[x, y0, z], [x + lean * h * 0.22, y0 + h * 0.33, z + 0.03 * h], [x + lean * h * 0.12, y0 + h * 0.6, z - 0.02 * h], [x + lean * h * 0.4, y0 + h * 0.82, z]], 5), at = f => SP[Math.round(f * (SP.length - 1))];
      S.tube(SP, t => r * (1 - 0.6 * t) + r * 0.5 * Math.pow(1 - t, 6) + 0.14 * r * Math.exp(-Math.pow((t - 0.42) / 0.1, 2)), 0, BARK, Object.assign({ bump: [0.07 * r, 1.4 / r] }, G));
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + rr(-0.3, 0.3) + yaw + 0.5, c = Math.cos(a), s = Math.sin(a), q = rr(2.2, 3.2) * r; S.tube([[x, y0 + 0.9 * r, z], [x + c * q * 0.5, y0 + 0.55 + 0.2 * r, z + s * q * 0.5], [x + c * q, hf(x + c * q, z + s * q) - 0.1, z + s * q]], 0.42 * r, 0.1 * r, BARK, G); }
      const limb = (f, a, len, up, w) => { const st = at(f), c = Math.cos(a), s = Math.sin(a), mid = [st[0] + c * len * 0.5, st[1] + len * up * 0.3 + 0.3 * r, st[2] + s * len * 0.5], en = [st[0] + c * len, st[1] + len * up, st[2] + s * len * 0.9];
        S.tube(B.spline([st, mid, en], 4), w * r, 0.12 * r, BARK, G); for (let j = 0; j < 3; j++) { const b = a + (j - 1) * 0.7 + rr(-0.2, 0.2), tw = [en[0] + Math.cos(b) * len * 0.36, en[1] + len * rr(0.2, 0.5), en[2] + Math.sin(b) * len * 0.36]; S.tube([en, [(en[0] + tw[0]) / 2 + rr(-0.2, 0.2), (en[1] + tw[1]) / 2 + 0.2, (en[2] + tw[2]) / 2], tw], 0.12 * r, 0.02, BARK, G); if (j !== 1) MOSS.push(tw); } MOSS.push(mid); };
      limb(0.62, yaw + 1.75, h * 0.42, 0.75, 0.4); limb(0.68, yaw - 1.75, h * 0.4, 0.85, 0.4); limb(0.8, yaw + 2.9, h * 0.3, 0.9, 0.3); limb(0.92, yaw + 0.4, h * 0.26, 1.0, 0.26); limb(0.9, yaw - 1.0, h * 0.24, 0.9, 0.24);
      if (ex.plain) { TREES.push({ n, x, z, y0, r, ph: rr(0, 6), plain: true }); return; }
      if (ex.hole) { const F = [Math.sin(yaw), 0, Math.cos(yaw)], Rt = [Math.cos(yaw), 0, -Math.sin(yaw)], C = at(0.4), rf = r * 1.3, rs = r * (1 - 0.6 * 0.4) + 0.14 * r, hp = (u, v, d) => [C[0] + Rt[0] * u + F[0] * (rs + d), C[1] + v, C[2] + Rt[2] * u + F[2] * (rs + d)], pupils = [];
        S.ball(hp(0, 0.1 * rf, -0.12 * rf), [0.44 * rf, 0.6 * rf, 0.24 * rf], DARK, o({ ghost: true, res: 0.045, ax: [Rt, UP, F] })); S.torus(hp(0, 0.1 * rf, -0.1 * rf), 0.52 * rf, 0.13 * rf, BARK, Object.assign({ ax: [Rt, F, UP] }, G));
        for (const sg of [-1, 1]) { const pp = hp(sg * 0.15 * rf, 0.16 * rf, 0.02 * rf); S.ball(pp, [0.075 * rf, 0.1 * rf, 0.05 * rf], { r: [8], em: true }, { ghost: true, whole: true, tag: n + 'e', res: 0.03 }); pupils.push(pp); }
        TREES.push({ n, x, z, y0, r: rf, F, Rt, C, pupils, ph: rr(0, 6), hole: true }); return; }
      // the face
      const F = [Math.sin(yaw), 0, Math.cos(yaw)], Rt = [Math.cos(yaw), 0, -Math.sin(yaw)], C = at(0.42), rf = r * 1.32, rs = r * (1 - 0.6 * 0.42) + 0.14 * r, fp = (u, v, d) => { const q = rs * Math.sqrt(Math.max(0.1, 1 - (u / rs) * (u / rs))) + d; return [C[0] + Rt[0] * u + F[0] * q, C[1] + v, C[2] + Rt[2] * u + F[2] * q]; };
      const tilt = sgn => { const a = sgn * ex.slant, c = Math.cos(a), s = Math.sin(a); return [[Rt[0] * c, s, Rt[2] * c], [-Rt[0] * s, c, -Rt[2] * s], F]; }, pupils = [];
      for (const sg of [-1, 1]) { const e = fp(sg * 0.36 * rf, 0.26 * rf, -0.02 * rf); S.ball(e, [0.2 * rf, ex.eye * rf, 0.17 * rf], DARK, o({ ghost: true, res: 0.045, ax: tilt(sg) })); const pp = fp(sg * 0.36 * rf, 0.24 * rf, 0.1 * rf); S.ball(pp, 0.085 * rf, { r: [8], em: true }, { ghost: true, whole: true, tag: n + 'e', res: 0.03 }); pupils.push(pp);
        S.tube([fp(sg * 0.08 * rf, (0.56 - ex.slant * 0.25) * rf, 0.1 * rf), fp(sg * 0.36 * rf, (0.64 + 0.02) * rf, 0.16 * rf), fp(sg * 0.66 * rf, (0.56 + ex.slant * 0.3) * rf, 0.06 * rf)], 0.11 * rf, 0.07 * rf, BARK, { tag: n + 'b' + (sg < 0 ? 'L' : 'R'), whole: true, res: 0.05 });
        S.ball(fp(sg * 0.52 * rf, -0.12 * rf, -0.08 * rf), [0.3 * rf, 0.3 * rf, 0.26 * rf], BARK, G); }
      S.ball(fp(0, 0.02 * rf, 0.06 * rf), [0.13 * rf, 0.24 * rf, 0.2 * rf], BARK, G); S.ball(fp(0, -0.12 * rf, 0.12 * rf), [0.17 * rf, 0.12 * rf, 0.16 * rf], BARK, G);
      // the mouth: cut the way a lantern's is cut. A wide grin, turned up at the ends, with square teeth left standing in it from above
      // and from below by turns; and it is lit from inside
      const mw = ex.mw * rf * 1.35, mh = Math.max(0.26 * rf, ex.mh * rf), mv = -0.56 * rf, mc = fp(0, mv, -0.02 * rf);
      S.ball(mc, [mw, mh * 1.3, 0.17 * rf], { r: [6], em: true, tex: (x, y, z) => { const U = ((x - mc[0]) * Rt[0] + (z - mc[2]) * Rt[2]) / mw, v = y - mc[1]; if (Math.abs(U) >= 1) return -1; const c = mh * (0.6 * U * U - 0.28), th = mh * 0.66 * Math.pow(1 - U * U, 0.6), d = v - c; if (Math.abs(d) > th) return -1;
        const q = (U + 1) * 3.5, k = Math.floor(q), fr = q - k; if (fr > 0.18 && fr < 0.82 && (k % 2 ? d > th * 0.1 : d < -th * 0.1)) return -1; return Math.abs(d) < th * 0.45 && Math.abs(U) < 0.6 ? 7 : 6; } }, o({ ghost: true, res: 0.04 }));
      MOUTH.push({ n, p: fp(0, mv, 0.02 * rf), r: mw });
      TREES.push({ n, x, z, y0, r: rf, F, Rt, C, pupils, ph: rr(0, 6), shy: !!ex.shy }); };
    tree(0.2, -1.6, 12, 1.55, 0.12, 0.15, { slant: 0.35, eye: 0.26, mw: 0.44, mh: 0.2 });       // the old one, and not pleased
    tree(-6.0, -2.2, 8.5, 1.1, -0.14, 0.6, { slant: -0.3, eye: 0.3, mw: 0.26, mh: 0.36, shy: true });      // one that is afraid
    tree(6.3, -1.6, 9, 1.15, 0.16, -0.55, { slant: 0.1, eye: 0.12, mw: 0.4, mh: 0.1 });         // one that is nearly asleep
    tree(-3.2, -7.0, 10, 1.2, 0.1, 0.3, { plain: true });
    tree(4.2, -6.6, 10.5, 1.25, -0.1, -0.2, { plain: true }); tree(-10.0, -3.6, 7.5, 0.9, 0.14, 0.4, { plain: true }); tree(10.2, -2.2, 8.5, 0.95, -0.12, -0.6, { plain: true }); tree(2.2, -9.4, 11.5, 1.05, 0.08, 0, { plain: true });
    tree(-8.6, 2.8, 5.5, 0.8, -0.1, 0.9, { plain: true });
    tree(8.6, 2.6, 7.5, 1.05, 0.12, -0.9, { hole: true });                                      // no face on this one: a hole, and sometimes something in it
    // more of them further back, with no faces that can be seen from here
    const FAR = { r: [0, 1, 1], g: [1, 1, 2, 2], mod: BARK.mod }; for (const [x, z, h, r, ln] of [[-9.6, -5.6, 9, 0.7, 0.2], [-6.6, -8.8, 11, 0.8, -0.1], [-0.6, -10.2, 12, 0.9, 0.1], [7.2, -8.6, 10, 0.8, 0.15], [9.8, -4.6, 9, 0.7, -0.2], [1.8, -9.6, 8, 0.6, -0.25]]) { const y = hf(x, z) - 0.3, G = Object.assign(S.grp(0.2), { res: 0.14 }), tp = [x + ln * h, y + h * 0.75, z]; S.tube(B.spline([[x, y, z], [x + ln * h * 0.3, y + h * 0.4, z], tp], 4), t => r * (1 - 0.6 * t) + r * 0.5 * Math.pow(1 - t, 6), 0, FAR, G); for (let k = 0; k < 4; k++) { const a = k * 1.7 + x, l = h * rr(0.25, 0.4); S.tube([[x + ln * h * (0.5 + 0.12 * k), y + h * (0.45 + 0.08 * k), z], [tp[0] + Math.cos(a) * l * 0.6, tp[1] + l * 0.3, tp[2] + Math.sin(a) * l * 0.6], [tp[0] + Math.cos(a) * l, tp[1] + l * 0.9, tp[2] + Math.sin(a) * l]], 0.3 * r, 0.03, FAR, G); } }
    // stones set up for whoever is under them, most of them leaning; a crow on one, and two more in the branches
    const CROWS = []; [[-3.6, 3.6, 0.2, 0.12], [-1.6, 5.2, -0.3, -0.1], [3.9, 2.4, 0.5, 0.16], [6.2, 5.6, -0.2, -0.14], [-6.4, 5.4, 0.9, 0.08]].forEach(([x, z, yaw, lean], k) => { const y = hf(x, z), ax = B.frame(yaw, 0, lean), GS = Object.assign(S.grp(0.1), { res: 0.06 }), ST = { r: [1, 2, 2], g: [2, 3, 3, 9], tex: (px, py, pz, ny, t) => ny > 0.5 || n3(px * 2, py * 2, pz * 2) > 0.7 ? S.pick([4, 4, 5], t) : undefined }; S.box([x, y + 0.5, z], [0.42, 0.62, 0.11], ST, Object.assign({ rd: 0.05, ax }, GS)); S.ball([x, y + 1.08, z], [0.42, 0.2, 0.11], ST, Object.assign({ ax }, GS)); if (k === 2) CROWS.push([x, y + 1.5, z]); });
    CROWS.push([MOSS[1][0], MOSS[1][1] + 0.5, MOSS[1][2]], [MOSS[9][0], MOSS[9][1] + 0.5, MOSS[9][2]]);
    CROWS.forEach((c, k) => { const o = { tag: 'crow' + k, whole: true, res: 0.035 }, BK = { r: [0, 0, 1], g: [0, 1, 2] }; S.ball(c, [0.3, 0.2, 0.17], BK, o); S.ball([c[0] + 0.24, c[1] + 0.2, c[2]], 0.14, BK, o); S.lathe([c[0] + 0.34, c[1] + 0.2, c[2]], 0.2, t => 0.05 * (1 - t) + 0.005, { r: [2, 3], g: [3, 9] }, Object.assign({ ax: [[0, 1, 0], [1, 0, 0], [0, 0, 1]] }, o)); S.tube([[c[0] - 0.2, c[1], c[2]], [c[0] - 0.52, c[1] - 0.1, c[2]]], 0.09, 0.03, BK, o); S.ball([c[0] + 0.29, c[1] + 0.24, c[2] + 0.11], 0.03, { r: [8], em: true }, Object.assign({ ghost: true }, o)); });
    // a fallen length of trunk, stones on the path
    { const a = [3.4, hf(3.4, 5.2) + 0.45, 5.2], b = [7.4, hf(7.4, 3.6) + 0.5, 3.6]; S.tube([a, b], 0.55, 0.48, BARK, { res: 0.08, bump: [0.05, 2] }); S.tube([[5.2, a[1] + 0.3, 4.5], [5.5, a[1] + 1.3, 4.9], [5.3, a[1] + 1.9, 5.3]], 0.16, 0.03, BARK, { res: 0.05 }); }
    for (let k = 0; k < 9; k++) { const z = 7.5 - k * 1.7, x = 1.5 * Math.sin(z * 0.32) + 1.2 + rr(-0.3, 0.3); S.ball([x, hf(x, z) + 0.03, z], [rr(0.4, 0.6), 0.12, rr(0.34, 0.5)], { r: [1, 2, 3], g: [3, 3, 9, 6] }, { res: 0.07, ax: B.frame(rr(0, 3), 0, 0) }); }
    S.bake();
    // ---- moss hanging from the limbs; fern; the fireflies; a low mist
    const sway = (ph, rg) => ({ k: 11, ph, sp: 0.9, rg, nd: true });
    MOSS.forEach((m, i) => { const l = rr(4, 9); for (let j = 0; j < l; j++) stick(m[0] + rr(-0.05, 0.05), m[1] - 0.15 - 0.2 * j, m[2] + rr(-0.05, 0.05), UP, 0.12, 0.035 * (1 - j / l) + 0.012, P[j % 3 ? 4 : 5], 3, sway(i * 0.9, 0.028 * j)); });
    // something lit, deep in each mouth; leaves coming down; bats; and, out past the last trees, eyes that open in the dark, look, and close
    for (const m of MOUTH) R.part(m.n, () => { iso(m.p[0], m.p[1], m.p[2], m.r * 0.5, P[6], 0.22, { em: true, nd: true, k: 7, ph: m.p[0], sp: 4 }); iso(m.p[0], m.p[1], m.p[2], m.r * 0.2, P[7], 0.5, { em: true, nd: true, k: 7, ph: m.p[0] + 1, sp: 6 }); });
    for (let i = 0; i < 60; i++) stick(rr(-9, 9), 11, rr(-8, 7), norm([rr(-1, 1), 0, rr(-1, 1)]), 0.09, 0.04, P[i % 3 ? 4 : i % 2 ? 5 : 6], 3, { k: 2, ph: rr(0, 1), sp: rr(0.25, 0.5), rg: 11, ex: 0, nd: true });
    for (let i = 0; i < 6; i++) { const a = rr(0, TAU), q = rr(3, 8), y = rr(8, 12), sp = rr(0.25, 0.45) * (i % 2 ? 1 : -1), c = Math.cos(a), sn = Math.sin(a); for (const sg of [-1, 1]) stick(c * q + sg * 0.15 * c, y + 0.05, sn * q + sg * 0.15 * sn, norm([c * sg, 0.5, sn * sg]), 0.18, 0.05, P[2], 3, { k: 5, ph: 0, sp, nd: true }); }
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + rr(-1.5, 1.5), q = rr(11.5, 14), x = Math.cos(a) * q, z = Math.sin(a) * q, y = rr(1, 6), an = { em: true, nd: true, k: 1, ph: rr(0, 6), sp: rr(0.12, 0.3) }, w = rr(0.12, 0.2); for (const sg of [-1, 1]) iso(x + sg * w, y, z, rr(0.05, 0.08), P[i % 3 ? 7 : 8], 3, an); }
    for (let i = 0; i < 30; i++) { const a = rr(0, TAU), q = rr(2.5, 10), cx = Math.cos(a) * q, cz = Math.sin(a) * q / 1.1; if (path(cx, cz)) continue; const y = hf(cx, cz), nf = 7; for (let k = 0; k < nf; k++) { const b = k / nf * TAU + rr(-0.2, 0.2), L = rr(0.6, 1.0); for (let j = 0; j < 5; j++) { const t = (j + 0.5) / 5, d = norm([Math.cos(b), 1.2 - 1.9 * t, Math.sin(b)]); stick(cx + Math.cos(b) * L * t, y + L * 0.9 * t * (1.25 - 0.8 * t), cz + Math.sin(b) * L * t, d, L * 0.11, 0.05 * (1 - 0.7 * t), P[j > 2 ? 5 : 4], 3, sway(cx, 0.03 * t)); } } }
    SWARM.forEach(([x, y, z, r, s], k) => { iso(x, y, z, r * 0.16, P[6], 0.1, { em: true, nd: true, k: 7, ph: k, sp: 1.3 }); for (let i = 0; i < 10 * s; i++) { const p = [x + rr(-1, 1) * r * 0.16, y + rr(-0.8, 1.2) * r * 0.12, z + rr(-1, 1) * r * 0.16]; iso(p[0], p[1], p[2], rr(0.035, 0.06), P[i % 3 ? 7 : 8], 2.6, i % 2 ? { em: true, nd: true, k: 6, ph: rr(0, 6), sp: rr(0.6, 1.6), rg: rr(0.15, 0.4) } : { em: true, nd: true, k: 1, ph: rr(0, 6), sp: rr(0.8, 2.5) }); } });
    for (let i = 0; i < 24; i++) { const a = rr(0, TAU), q = rr(1, 10), y = rr(0.5, 7); iso(Math.cos(a) * q, y, Math.sin(a) * q, rr(0.03, 0.05), P[i % 4 ? 7 : 8], 2.4, i % 3 ? { em: true, nd: true, k: 5, ph: 0, sp: rr(0.03, 0.1) * (i % 2 ? 1 : -1) } : { em: true, nd: true, k: 6, ph: rr(0, 6), sp: rr(0.4, 1.2), rg: rr(0.2, 0.6) }); }
    K.mist(B, { rad: 10.5, zs: 1.1, y: 0.35, depth: 0.7, n: 70, cols: [3, 9], a: 0.07, size: [1.5, 3.2], drift: 0.2 });
    const W = B.finish({ cam: { target: [0, 4.6, -1.2], dist: 29, pitch: 0.12, yaw: 0.22, sway: 0.25 }, detail: 12.5, palName: 'Hush', dither: 0.28, radius: 15.5, ao: { k: 0.5, range: 0.7 }, fog: { c: 0, start: 0.68, max: 0.7 } });
    // ---- They are awake, and there is wind. Each one leans with it, more when it gusts, and comes back. What is in its eyes goes from
    // side to side, stops, and goes back; its brows come down and lift; its jaw drops and shuts as if it were saying something very slowly.
    // The shy ones shut their eyes for a while when they have looked too long. In the tree with the hole, two lights come up to the edge,
    // flicker, watch, and go back down. The crows turn their heads.
    const SHOW = [0, 0, 0.5, 0, 0.53, 1, 0.8, 1, 0.83, 0, 1, 0], SHUT = [0, 0, 0.6, 0, 0.64, 1, 0.82, 1, 0.86, 0, 1, 0];
    return R.bind(W, t => { const gust = 0.5 + 0.5 * Math.sin(0.23 * t) * Math.sin(0.11 * t + 1);
      TREES.forEach((T, i) => {
        const tj = J(null, mul(rot(AZ, 0.012 + 0.02 * gust + (0.014 + 0.03 * gust) * Math.sin(0.9 * t + T.ph)), rot(AX, (0.01 + 0.02 * gust) * Math.sin(0.7 * t + 2 * T.ph))), [T.x, T.y0, T.z]); use(T.n, tj); if (T.plain) return; const p = T.pupils[0];
        if (T.hole) { const s = kf(frac(t / 13 + 0.2), SHOW), fl = s > 0 && s < 1 ? (Math.sin(47 * t) > -0.3 ? 1 : 0) : s, back = (1 - fl) * 0.6 * T.r; use(T.n + 'e', J(tj, R.I3, p, [p[0] - T.F[0] * back + T.Rt[0] * 0.05 * T.r * Math.sin(0.8 * t), p[1] - 0.3 * T.r * (1 - s), p[2] - T.F[2] * back + T.Rt[2] * 0.05 * T.r * Math.sin(0.8 * t)])); return; }
        const shut = T.shy ? kf(frac(t / 11 + T.ph), SHUT) : 0, lx = clamp(1.7 * Math.sin(0.33 * t + T.ph * 2.1), -1, 1) * 0.085 * T.r, ly = clamp(1.5 * Math.sin(0.21 * t + T.ph), -1, 1) * 0.05 * T.r; use(T.n + 'e', J(tj, R.I3, p, [p[0] + T.Rt[0] * lx - T.F[0] * shut * 0.5 * T.r, p[1] + ly, p[2] + T.Rt[2] * lx - T.F[2] * shut * 0.5 * T.r]));
        const b = 0.1 * Math.sin(0.26 * t + T.ph * 1.3) - 0.12 * shut; for (const sg of [-1, 1]) use(T.n + 'b' + (sg < 0 ? 'L' : 'R'), J(tj, rot(T.F, sg * b), [T.C[0] + T.F[0] * T.r + T.Rt[0] * sg * 0.36 * T.r, T.C[1] + 0.6 * T.r, T.C[2] + T.F[2] * T.r + T.Rt[2] * sg * 0.36 * T.r]));
      });
      CROWS.forEach((c, k) => use('crow' + k, J(null, mul(rot(AY, 0.9 * clamp(1.6 * Math.sin(0.4 * t + k * 2), -1, 1)), rot(AZ, 0.08 * Math.sin(1.7 * t + k))), c))); });
  }

  return { id: 'grove', name: 'Hush Wood', seed: 19, build: sceneGrove };
}

if (typeof module !== 'undefined') module.exports = rebirthGrove;
