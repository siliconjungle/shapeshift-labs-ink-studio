// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthBurningSand(kit) {
  const { KIT, makeBuilder, makeSculpt } = kit;
  const { makeCharacter, INF } = (typeof module === 'undefined' ? rebirthInfernoSupport : require('./inferno-support.js'))(kit);
  const { attachRebirthDynamics } = (typeof module === 'undefined' ? rebirthMotion : require('./motion.js'))(kit);

  function sceneCircle7(seed) {
    // 0 void · 1-9 one ember family, plum-black through rust to white-hot (the shadows lean violet, the lights lean yellow)
    // 10-12 ash: the dead, the trees, the horns · 13-14 blood · 15-19 the ash the land is made of, blue-black to pale (the sand and the stone
    // are cold; only what burns is warm)
    const PAL = [0x020203, 0x220a14, 0x3c1020, 0x5a1826, 0x7c2222, 0xa2361c, 0xcc561c, 0xf08428, 0xffb44a, 0xffeab4, 0x464a62, 0x949ebc, 0xd6def0, 0x9a1428, 0xec2e3a,
      0x101420, 0x1b2031, 0x272d42, 0x3c445c, 0x5d6680, 0x5a4a56, 0x7a5c5a, 0x9c7664];   // 20-22: the ash where the fire is on it, warm   // (the reds kept well up off the black, so that nothing red is lost in the dark)
    const K = KIT, B = makeBuilder(seed, PAL), { rr, n3, fbm, TAU, norm } = B, ss = INF.ss;
    const S = K.sculpt(makeSculpt(B));
    S.sun = norm([-0.7, 0.55, 0.05]); S.sunK = 0.62; S.amb = 0.03; S.sky = 0.04; S.res = 0.15; S.shLen = 3.5;   // the light is the fire coming down: from above and behind, weak, raking across the dunes

    // The ash runs in long, wind-shaped dunes. Behind the plain a low ridge breaks into saddles and rolls back down.
    const zB = x => -15 - 1.8 * Math.sin(x * 0.17 + 2) - Math.sin(x * 0.41);
    const eBack = (x, z) => zB(x) - z;
    const RIV = INF.path([[-25, -8], [-18, -6.5], [-11, -8], [-4, -10], [3, -9], [10, -6], [15, -1], [18, 5], [19.8, 11], [21.5, 19], [23, 28], [26, 40]], false, 10);
    const DEN = [3, 1.5], SLIDE = [-21, 7], START = [-11, 9.5];
    const top = (x, z) => {
      const basin = Math.hypot(x - DEN[0], z - DEN[1]);
      const wind = x * 0.32 + z * 0.45 + 3.6 * fbm(x * 0.055, z * 0.07 + 5, 1.5, 2);
      const crest = Math.pow(0.5 + 0.5 * Math.sin(wind + 0.32 * Math.sin(wind)), 1.75);
      const swell = 0.72 + 0.7 * fbm(x * 0.09 + 3, z * 0.08, 1.5, 3);
      const heap = Math.hypot(x - SLIDE[0], (z - SLIDE[1]) * 0.85);
      return (0.4 + 1.65 * ss(basin / 11)) * swell * crest + 1.35 * (swell - 1)
        + 3.0 * ss(1 - heap / 8) - 1.15 * ss(1 - basin / 8) + 0.28 * Math.exp(-((basin - 8.7) ** 2) / 3);
    };
    const ridge = (x, z) => {
      const d = eBack(x, z);
      const crest = 3.65 - 2.0 * Math.exp(-(((x - 0.5) / 4.2) ** 2)) - 0.9 * Math.exp(-(((x + 18) / 5.5) ** 2));
      return crest * ss((d + 1.1) / 4.7) * (1 - ss((d - 3.4) / 7.2));
    };
    const river = (x, z) => RIV.near(x, z)[0];
    const hf = (x, z) => {
      const d = river(x, z);
      const cut = -1.35 * ss(1 - d / 1.7) + 0.4 * Math.exp(-((d - 2.05) ** 2) / 0.18);
      return top(x, z) + ridge(x, z) + cut * ss(-eBack(x, z) - 0.5);
    };
    const bloodY = (x, z) => top(x, z) - 0.95;
    // Melted drifts light the surrounding sand. Two shallow lava channels run from the ridge to pools at its foot.
    const RUNNELS = [-7, 9].map(x => ({ x, z: zB(x) }));
    const DRIFT = [[1.5, 9.0, 3.2], [-14, 3.5, 2.4], [13, 4, 3.0], [-3, -3, 2.2], [17, -7, 2.2], [-9, 9, 1.9]];
    for (const { x, z } of RUNNELS) {
      DRIFT.push([x + 0.3, z + 2.3, 1.55]);
      S.lights.push({ p: [x, hf(x, z - 1.4) + 0.95, z - 1.4], r: 5.5, s: 1.0, c: [6, 7] });
    }
    const drift = (x, z) => { let v = 0; for (const [cx, cz, r] of DRIFT) { const d = Math.hypot(x - cx, z - cz) / r + 0.8 * (n3(x * 0.32, z * 0.32, 4) - 0.5); if (1 - d > v) v = 1 - d; } return v; };
    const far = (x, z) => Math.hypot(x / 1.15, z - 3);
    const rim = (x, z) => ss((far(x, z) - 26) / 24);
    const onShelf = (x, z, m) => far(x, z) < 27 - m && eBack(x, z) < -1.2 - m;
    const SAND = { r: [0, 15, 15, 16, 16, 17, 18, 19], g: [17, 20, 21, 22, 6],
      mod: (x, y, z) => 0.11 * (n3(x * 0.33, z * 0.33, 3) - 0.5) - 0.78 * rim(x, z),
      tex: (x, y, z) => { if (rim(x, z) > 0.93) return 0; const d = drift(x, z); if (d < 0.04) return undefined; if (d < 0.1) return 16; if (d < 0.18) return 4; const sm = Math.abs(n3(x * 0.9, z * 0.9, 8) - 0.5); if (sm < 0.03 + 0.05 * d) return d > 0.45 ? 9 : 8; return d > 0.55 ? 6 : d > 0.32 ? 5 : 4; } };

    // One continuous heightfield supplies both slopes and the sand beyond them, with finer splats on foot.
    const dry = (x, z) => river(x, z) > 1.05;
    S.ground(SAND, { h: hf, rad: 35, cx: 0, cz: 3, edge: 0, res: 0.185,
      keep: (x, z) => far(x, z) < 25 && dry(x, z) });
    S.ground(SAND, { h: hf, rad: 46, cx: 0, cz: 3, edge: 0, res: 0.23,
      keep: (x, z) => far(x, z) >= 25 && far(x, z) < 34 && dry(x, z) });
    S.ground(Object.assign({}, SAND, { fl: { nd: true } }), { h: hf, rad: 62, cx: 0, cz: 3, edge: 0, res: 0.34, ghost: true,
      keep: (x, z) => far(x, z) >= 34 && rim(x, z) < 0.95 && dry(x, z) });
    // stone: the banks of the stream are laid stone, the heap is fallen rock
    const ROCK = { r: [0, 15, 16, 17, 18, 19], g: [17, 20, 21, 22], mod: (x, y, z) => 0.2 * (n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) - (Math.abs(n3(x * 0.4, y * 0.4 + 3, z * 0.4) - 0.5) < 0.015 ? 0.3 : 0) - 0.5 * rim(x, z) };
    for (let k = 0, s = 0; s < RIV.tot - 2; k++, s += rr(1.1, 1.6)) { const a = RIV.at(s), nx = -a.tz, nz = a.tx;   // two courses of blocks along each bank
      for (const sg of [-1, 1]) { const w = rr(1.0, 1.5), x = a.x + nx * sg * 1.55, z = a.z + nz * sg * 1.55, y = top(x, z) - 0.62; if (!onShelf(x, z, 0.6)) continue;
        S.box([x, y, z], [w * 0.5, 0.36, 0.42], ROCK, { rd: 0.08, ax: [[a.tx, 0, a.tz], [0, 1, 0], [nx, 0, nz]], bump: [0.04, 3] }); } }
    for (let k = 0; k < 26; k++) { const a = rr(0, TAU), q = Math.sqrt(rr(0, 1)) * 7, x = SLIDE[0] + Math.cos(a) * q, z = SLIDE[1] + Math.sin(a) * q * 0.8, r = rr(0.5, 1.4) * (1.3 - q / 10); if (!onShelf(x, z, 0.3) || Math.hypot(x - START[0], z - START[1]) < 2.5 + r) continue;
      K.grow.rock(S, [x, hf(x, z) + 2, z], r, ROCK, { seed: seed * 7 + k, squash: [rr(1, 1.4), rr(0.55, 0.85), rr(0.9, 1.2)], facets: 8, chip: 0.3, beds: { n: 4, depth: 0.07 * r, tilt: [0.15, 0.05] }, worn: 0.12, res: 0.15, settle: true, lean: 0.4, bury: 0.2 }); }

    // ---- the stream: blood, lit from inside, running. (Its surface is drawn glowing; brighter streaks run with it, below)
    const BLOOD = { r: [13, 13, 14], em: true, v: 0.4, tex: (x, y, z) => { const [d, s] = RIV.near(x, z); const q = Math.sin(s * 3.1 - d * 1.7 + 4 * n3(x * 0.5, z * 0.5, 2)); return q > 0.86 ? 14 : d > 0.95 ? 4 : 13; } };
    S.terrain(BLOOD, { h: (x, z) => river(x, z) < 1.7 ? bloodY(x, z) : -99, x0: -30, x1: 30, z0: -16, z1: 44, keep: (x, z) => river(x, z) < 1.25 && rim(x, z) < 0.9 });   // (a surface is a solid under it wherever it is defined: kept to the channel)
    // Lava clings to the slope. Each little disc follows the terrain normal, and light travels downhill along it.
    for (const { x: cx, z: cz } of RUNNELS) {
      for (let i = 0; i <= 78; i++) {
        const u = i / 78;
        const z = cz - 3.2 + u * 5.7;
        const mid = cx + 0.3 * Math.sin(u * 6.5) + 0.34 * u;
        const w = (0.16 + 0.17 * u) * ss(u * 16) * ss((1 - u) * 12);
        for (let j = -2; j <= 2; j++) {
          const x = mid + w * j / 2 + rr(-0.025, 0.025);
          const n = norm([hf(x - 0.04, z) - hf(x + 0.04, z), 0.08, hf(x, z - 0.04) - hf(x, z + 0.04)]);
          const col = Math.abs(j) === 2 ? 5 : rr(0, 1) < 0.18 ? 8 : 7;
          B.disc(x, hf(x, z) + 0.075, z, n, rr(0.074, 0.102), 0.03, B.P[col], 1,
            { em: true, nd: true, k: 4, ph: -u * 15 + rr(-0.45, 0.45), sp: 3.2 });
        }
      }
    }

    // ---- the wood of the self-destroyed: low black trees, every limb crooked and thorned, with no leaves at all. They are grey where the
    // fire catches them, the same grey as the dead out on the sand.
    const BARK = { r: [15, 16, 17, 10, 18, 11], g: [16, 10, 11], mod: (x, y, z) => 0.22 * (n3(x * 2.2, y * 0.5, z * 2.2) - 0.5) - 0.3 * rim(x, z), fl: undefined };
    const TREES = [];
    const thorn = (x, z, h, lean) => { const y0 = hf(x, z) - 0.3, G = Object.assign(S.grp(0.25), { res: 0.14 }), tw = rr(0, 6);
      const trunk = []; for (let k = 0; k <= 6; k++) { const t = k / 6; trunk.push([x + lean[0] * h * t * t + 0.35 * Math.sin(t * 6 + tw) * t, y0 + h * t, z + lean[1] * h * t * t + 0.35 * Math.cos(t * 5 + tw) * t]); }
      S.tube(trunk, t => 0.42 * (1 - 0.7 * t) + 0.25 * Math.pow(1 - t, 8), 0, BARK, Object.assign({ bump: [0.05, 2.2] }, G));
      for (let k = 0; k < 5; k++) { const a = rr(0, TAU); S.tube([[x, y0 + 0.5, z], [x + Math.cos(a) * 1.1, y0 + 0.25, z + Math.sin(a) * 1.1], [x + Math.cos(a) * 1.9, hf(x + Math.cos(a) * 1.9, z + Math.sin(a) * 1.9) - 0.1, z + Math.sin(a) * 1.9]], 0.2, 0.06, BARK, G); }
      const limb = (p0, dir, len, r, depth) => { const pts = [p0]; let p = p0, d = dir.slice(); for (let k = 0; k < 4; k++) { d = norm([d[0] + rr(-0.5, 0.5), d[1] + rr(-0.35, 0.25), d[2] + rr(-0.5, 0.5)]); p = [p[0] + d[0] * len / 4, p[1] + d[1] * len / 4, p[2] + d[2] * len / 4]; pts.push(p); }
        const sway = depth > 0 ? { k: 11, ph: rr(0, 6), sp: 0.9, rg: 0.025 * depth } : undefined, M = sway ? Object.assign({}, BARK, { fl: sway }) : BARK;
        S.tube(pts, r, r * 0.3, M, { res: 0.12 });
        for (let k = 1; k < pts.length; k++) if (rr(0, 1) < 0.8) { const q = pts[k], a = rr(0, TAU), tl = rr(0.18, 0.34); S.tube([q, [q[0] + Math.cos(a) * tl, q[1] + rr(-0.1, 0.15), q[2] + Math.sin(a) * tl]], r * 0.35, 0.008, M, { res: 0.09 }); }   // thorns
        if (depth < 2) for (let j = 0; j < 2; j++) limb(pts[2 + j], norm([d[0] + rr(-0.8, 0.8), d[1] + rr(0, 0.5), d[2] + rr(-0.8, 0.8)]), len * 0.6, r * 0.6, depth + 1);
        return pts; };
      const tops = []; for (let k = 0; k < 4; k++) { const f = 0.5 + k * 0.13, q = trunk[Math.round(f * 6)], a = tw + k * 1.7; tops.push(limb(q, norm([Math.cos(a), 0.55, Math.sin(a)]), h * 0.55, 0.2, 0)); }
      TREES.push({ x, z, y0, h, tops }); };
    const WOOD = [-21, -9];
    for (let k = 0; k < 20; k++) { const a = rr(0, TAU), q = 2 + Math.sqrt(rr(0, 1)) * 9, x = WOOD[0] + Math.cos(a) * q * 1.1, z = WOOD[1] + Math.sin(a) * q * 0.9;
      if (river(x, z) < 2.6 || !onShelf(x, z, 1.5) || TREES.some(t => Math.hypot(t.x - x, t.z - z) < 2.6)) continue; thorn(x, z, rr(3.2, 5.6), [rr(-0.12, 0.12), rr(-0.12, 0.12)]); }
    // harpies: on the high limbs, hunched, with wings that open and close. They look at you with lit eyes.
    const HARP = { r: [0, 1, 2, 3] };
    for (let k = 0; k < 7; k++) { const tr = TREES[(k * 5) % TREES.length], lb = tr.tops[k % tr.tops.length], p = lb[3], ph = rr(0, 6), fy = rr(0, TAU);
      S.ball([p[0], p[1] + 0.35, p[2]], [0.24, 0.36, 0.24], HARP, { res: 0.05 }); S.ball([p[0] + Math.cos(fy) * 0.08, p[1] + 0.78, p[2] + Math.sin(fy) * 0.08], 0.16, HARP, { res: 0.04 });
      for (const sg of [-1, 1]) { const ex = p[0], ez = p[2] + sg * 0.2;
        for (let j = 0; j < 7; j++) { const u = j / 6; B.iso(p[0] - Math.sin(fy) * sg * (0.25 + u * 0.7), p[1] + 0.5 + u * 0.3 - u * u * 0.4, p[2] + Math.cos(fy) * sg * (0.25 + u * 0.7), 0.13 - u * 0.05, B.P[u > 0.7 ? 3 : 1], 1, { k: 8, ph, sp: 2.6, rg: ex, ex: ez }); } }
      for (const sg of [-1, 1]) B.iso(p[0] + Math.cos(fy) * 0.2 - Math.sin(fy) * sg * 0.06, p[1] + 0.8, p[2] + Math.sin(fy) * 0.2 + Math.cos(fy) * sg * 0.06, 0.035, B.P[8], 1, { em: true, k: 1, ph: rr(0, 6), sp: 1.3 }); }

    // ---- the dead. On the open sand some lie on their backs, face up to what falls; by the stream some sit hunched, each with a purse
    // hung from the neck that catches the light. (The ones who never stop walking are out on the plain too: they move, so they come later.)
    const DEAD = { r: [16, 10, 18, 11, 12] };
    for (let k = 0; k < 16; k++) { const a = rr(0, TAU), q = rr(10.5, 20), x = DEN[0] + Math.cos(a) * q, z = DEN[1] + Math.sin(a) * q * 0.8; if (!onShelf(x, z, 2) || river(x, z) < 3 || drift(x, z) > -0.3 || Math.hypot(x - WOOD[0], z - WOOD[1]) < 11 || Math.hypot(x - SLIDE[0], z - SLIDE[1]) < 10) continue;
      const y = hf(x, z), b = rr(0, TAU), c = Math.cos(b), s = Math.sin(b), at = (u, v, w) => [x + c * u - s * w, y + v, z + s * u + c * w];
      S.ball(at(0, 0.12, 0), [0.48, 0.13, 0.17], DEAD, { res: 0.05 }); S.ball(at(0.62, 0.13, 0), [0.12, 0.11, 0.11], DEAD, { res: 0.04 });
      for (const sg of [-1, 1]) S.tube([at(0.3, 0.14, sg * 0.15), at(0.2, 0.26 + rr(0, 0.25), sg * 0.42), at(0.45, 0.4 + rr(0, 0.4), sg * 0.38)], 0.045, 0.035, DEAD, { res: 0.04 }); }   // arms up against it
    for (let k = 0, s = 4; s < RIV.tot - 3; k++, s += rr(5, 8)) { const a = RIV.at(s), sg = k % 2 ? 1 : -1, x = a.x - a.tz * sg * 3.1, z = a.z + a.tx * sg * 3.1; if (!onShelf(x, z, 1.5) || Math.hypot(x - WOOD[0], z - WOOD[1]) < 9) continue;
      const y = hf(x, z), fx = a.tz * sg, fz = -a.tx * sg;
      S.ball([x, y + 0.3, z], [0.26, 0.32, 0.26], DEAD, { res: 0.045 }); S.ball([x + fx * 0.12, y + 0.62, z + fz * 0.12], 0.13, DEAD, { res: 0.04 });
      B.iso(x + fx * 0.25, y + 0.35, z + fz * 0.25, 0.07, B.P[8], 1, { em: true, k: 4, ph: rr(0, 6), sp: 1.7 }); }

    // the edge of things: ash and bits of the land lift off slowly where it goes dark, and drift up into it
    for (let k = 0; k < 520; k++) { const a = rr(0, TAU), q = rr(24, 44), x = Math.cos(a) * q * 1.15, z = 3 + Math.sin(a) * q; if (eBack(x, z) > -0.5) continue; const w = rim(x, z);
      B.iso(x, hf(x, z) + rr(0, 1.5), z, rr(0.06, 0.13) * (1 + w), B.P[[16, 17, 15, 2, 16][k % 5]], 2.2, { nd: true, k: 3, ph: rr(0, 1), sp: rr(0.25, 0.6), rg: rr(3, 8), ex: 0.5 }); }
    // ---- the fire. Now and then a lump of it comes down out of the dark (that is in the update below); and all the while a thin fall of
    // small flakes. Off the drifts a few sparks go up, and steam off the stream.
    for (let k = 0; k < 170; k++) { const x = rr(-30, 30), z = rr(-12, 30); if (rim(x, z) > 0.7 || eBack(x, z) > -0.5 || river(x, z) < 2.2) continue; const rg = rr(12, 20);
      B.iso(x, hf(x, z) + rg, z, rr(0.055, 0.075), B.P[k % 3 ? 7 : 8], 1, { em: true, nd: true, k: 15, ph: rr(0, 1), sp: rr(2.8, 3.6), rg, ex: rr(0.08, 0.18) }); }
    for (const [cx, cz, r] of DRIFT) for (let k = 0; k < 10 * r; k++) { const a = rr(0, TAU), q = Math.sqrt(rr(0, 1)) * r * 0.6, x = cx + Math.cos(a) * q, z = cz + Math.sin(a) * q;   // a slow rise of sparks off each drift
      B.iso(x, hf(x, z) + 0.2, z, 0.06, B.P[[8, 7, 9][k % 3]], 1, { em: true, nd: true, k: 3, ph: rr(0, 1), sp: rr(0.5, 0.9), rg: rr(2.5, 5), ex: 0 }); }
    for (let s = 0; s < RIV.tot; s += 0.45) { const a = RIV.at(s), w = rr(-0.8, 0.8); if (Math.hypot(a.x - WOOD[0], a.z - WOOD[1]) < 6 && rr(0, 1) < 0.6) continue;   // steam where the fire meets the blood
      B.iso(a.x - a.tz * w, bloodY(a.x, a.z) + 0.2, a.z + a.tx * w, rr(0.12, 0.22), B.P[[3, 4, 4, 5][(s * 10 | 0) % 4]], 1, { nd: true, k: 3, ph: rr(0, 1), sp: rr(0.5, 0.9), rg: rr(2, 4), ex: 2.2 }); }

    // light from the land itself: the stream, the hole, the hollow where the bull lies, and the hottest sand
    for (let s = 2; s < RIV.tot; s += 6) { const a = RIV.at(s); S.lights.push({ p: [a.x, bloodY(a.x, a.z) + 0.8, a.z], r: 6.5, s: 0.75, c: [13, 5] }); }
    S.lights.push({ p: [DEN[0], hf(DEN[0], DEN[1]) + 1.5, DEN[1]], r: 13, s: 0.6, c: [6, 7] });
    for (const [cx, cz, r] of DRIFT) S.lights.push({ p: [cx, hf(cx, cz) + 0.8, cz], r: r * 2.6, s: 0.9, c: [6, 7] });
    S.bake();
    const walkY = (x, z, y0) => river(x, z) < 1.35 || far(x, z) >= 31 ? 1e9 : S.heightAt(x, z, y0, 8);   // (the pilgrim can cross the ridge but stays inside the lit terrain)

    // =====================================================================
    // The bull. Sculpted standing, at the origin, facing +x, on its own (its own field and its own light, so that it never melts into the
    // sand it was not made on); then carried on bones. It walks on its knuckles and its hooves. Its hide is near black and cracked, and the
    // cracks are lit from inside; the light on it comes from under, off the burning sand, so it is the same whichever way it turns.
    // =====================================================================
    const SG = K.sculpt(makeSculpt(B)), R = K.creature(B, SG);
    SG.sun = norm([0.25, 1, 0.15]); SG.sunK = 0.5; SG.amb = 0.05; SG.sky = 0.04; SG.res = 0.18;
    SG.lights.push({ p: [1, -5, 0], r: 24, s: 1.25, c: [5, 6] }, { p: [-14, 16, 0], r: 26, s: 0.35, c: [4, 5] });
    const crack = (x, y, z, w) => { const a = Math.abs(n3(x * 0.32 + 4, y * 0.32, z * 0.32) - 0.5), b = Math.abs(n3(x * 0.8, y * 0.8 + 9, z * 0.8) - 0.5); return a < w ? 2 : b < w * 0.6 ? 1 : 0; };
    const HIDE = { r: [1, 1, 2, 2, 3, 3, 4, 4, 5], g: [2, 3, 4, 5], mod: (x, y, z) => 0.18 * (n3(x * 0.6, y * 0.6, z * 0.6) - 0.5),
      tex: (x, y, z, ny, t) => { if (y > 8 && ny > -0.3) return undefined; const w = 0.004 + 0.012 * ss(1 - y / 7) + (ny < -0.2 ? 0.006 : 0), c = crack(x, y, z, w); return c === 2 ? (t > 0.4 ? 8 : 7) : c === 1 ? 6 : undefined; } };
    const HORN = { r: [15, 16, 10, 10, 11, 11, 12], mod: (x, y, z) => 0.07 * Math.sin(Math.hypot(x - 8, z) * 5.5) };
    const MANE = K.look.fur([0, 1, 2, 3, 4], { len: 1.0, comb: [-1, -0.6, 0], lay: 0.6, droop: 0.5, clump: 0.75, n: 2, rim: [5, 6, 7] });
    const IRON = { r: [0, 15, 10, 11] };
    // tufts: long rough hair that hangs in locks, lit at the tips by the fire under it (they stir as it moves)
    const TUFT = (len, comb, droop) => K.look.fur([0, 1, 2, 3, 4], { len, comb, lay: 0.35, droop, clump: 0.9, n: 3, rim: [5, 6, 7] });
    const SHAG = TUFT(1.9, [-0.4, -1, 0], 0.85), BEARD = TUFT(1.6, [0.2, -1, 0], 0.95), LOCK = TUFT(1.4, [0.6, -0.6, 0], 0.7), CUFF = TUFT(1.3, [0, -1, 0], 0.9);
    const BODY = SG.grp(1.3);
    // the back: hips to the base of the skull, bent like a bridge
    const BK0 = [[-7.6, 9.2, 0], [-4.6, 9.8, 0], [-1.4, 11.3, 0], [1.8, 12.6, 0], [4.6, 12.2, 0], [7.0, 11.2, 0]];
    const tb = q => Object.assign({ tag: 'back' }, BODY, q);
    SG.ball([-5.0, 9.0, 0], [3.3, 2.9, 3.1], HIDE, tb());
    SG.ball([-1.2, 9.7, 0], [4.3, 3.5, 3.6], HIDE, tb());
    SG.ball([2.4, 11.0, 0], [3.7, 3.9, 4.2], HIDE, tb());
    SG.ball([1.0, 13.6, 0], [3.9, 2.6, 3.3], HIDE, tb());
    for (const sg of [-1, 1]) SG.ball([3.2, 11.8, sg * 3.7], [2.3, 2.3, 2.0], HIDE, tb());
    SG.tube([[4.0, 12.3, 0], [6.0, 11.7, 0], [7.6, 10.9, 0]], 2.5, 2.0, HIDE, tb());
    SG.ball([1.2, 14.4, 0], [3.4, 1.9, 2.6], MANE, { tag: 'back', res: 0.21 }); SG.ball([4.8, 13.0, 0], [2.4, 1.6, 2.1], MANE, { tag: 'back', res: 0.21 });
    for (const sg of [-1, 1]) { SG.ball([2.6, 13.0, sg * 3.2], [2.4, 1.5, 1.4], SHAG, { tag: 'back', res: 0.22 }); SG.ball([5.4, 11.6, sg * 1.9], [1.5, 1.4, 1.0], SHAG, { tag: 'back', res: 0.22 }); }   // a shag over the shoulders, down the sides
    for (let j = 0; j < 4; j++) SG.ball([-5.5 + j * 2.4, 11.4 + j * 0.9, 0], [0.9, 0.5, 0.7], LOCK, { tag: 'back', res: 0.2 });   // a ridge of locks down the spine
    // the head: a bull's, carried low and forward. A nose ring of black iron
    const HEAD0 = [7.0, 11.2, 0], th = q => Object.assign({ tag: 'head' }, SG.grp(0.6), q);
    SG.ball([8.7, 10.7, 0], [2.1, 1.9, 1.8], HIDE, th());
    SG.ball([10.7, 9.7, 0], [1.6, 1.25, 1.35], HIDE, th({ ax: [norm([1, -0.45, 0]), norm([0.45, 1, 0]), [0, 0, 1]] }));
    SG.tube([[8.9, 11.9, -1.5], [9.4, 12.2, 0], [8.9, 11.9, 1.5]], 0.55, 0.55, HIDE, th());
    for (const sg of [-1, 1]) {
      SG.ball([11.95, 9.55, sg * 0.5], 0.3, {}, { tag: 'head', neg: true });
      SG.ball([11.75, 9.55, sg * 0.5], 0.22, { r: [7], em: true }, { tag: 'head', ghost: true, res: 0.06 });
      SG.ball([9.95, 11.0, sg * 1.3], [0.4, 0.32, 0.3], {}, { tag: 'head', neg: true });
      SG.ball([9.85, 10.98, sg * 1.27], [0.24, 0.2, 0.2], { r: [9], em: true }, { tag: 'head', ghost: true, whole: true, res: 0.05 });
      SG.ball([8.2, 11.7, sg * 2.2], [0.7, 0.3, 0.9], HIDE, th());
      SG.tube([[8.5, 11.9, sg * 1.3], [8.2, 12.7, sg * 3.4], [9.4, 13.9, sg * 5.1], [11.3, 15.1, sg * 5.3]], t => 0.8 * (1 - t) + 0.06, 0, HORN, { tag: 'head', res: 0.08 });
    }
    SG.ball([8.7, 12.5, 0], [1.1, 0.55, 1.0], LOCK, { tag: 'head', res: 0.16 });   // a forelock between the horns
    for (const sg of [-1, 1]) SG.ball([7.9, 11.0, sg * 1.7], [0.9, 1.1, 0.5], SHAG, { tag: 'head', res: 0.18 });   // and the cheeks
    SG.torus([12.15, 9.05, 0], 0.62, 0.13, IRON, { tag: 'head', res: 0.05, ax: [[0, 0, 1], [1, 0, 0], [0, 1, 0]] });
    SG.ball([10.1, 9.15, 0], [1.4, 0.32, 0.85], { r: [6, 7, 8], em: true }, { tag: 'head', ghost: true, res: 0.07 });   // the inside of the mouth: lit, like a stove
    SG.ball([10.0, 8.65, 0], [1.6, 0.5, 1.0], HIDE, { tag: 'jaw', whole: true });
    SG.ball([9.4, 8.3, 0], [1.0, 0.5, 0.75], BEARD, { tag: 'jaw', res: 0.15 });   // a beard
    const JAW0 = [8.4, 9.3, 0];
    // the arms: long, the knuckles down. The legs: a bull's hind legs, shorter, on cloven hooves
    const ARM = [-1, 1].map(sg => ({ sg, h: [3.4, 11.6, sg * 4.4], k: [4.3, 6.3, sg * 6.0], f: [5.4, 1.7, sg * 5.4], fist: [5.75, 1.0, sg * 5.3], n: sg < 0 ? 'L' : 'R' }));
    const LEG = [-1, 1].map(sg => ({ sg, h: [-5.0, 8.4, sg * 2.9], k: [-2.6, 4.6, sg * 3.3], f: [-5.0, 1.1, sg * 3.1], hoof: [-4.75, 0.55, sg * 3.1], n: sg < 0 ? 'L' : 'R' }));
    for (const a of ARM) { const w = { whole: true };
      SG.tube([a.h, [a.h[0] + 0.6, a.h[1] - 2.6, a.h[2] + a.sg * 0.9], a.k], t => 1.75 - 0.5 * t + 0.25 * Math.sin(Math.PI * t), 0, HIDE, Object.assign({ tag: 'ua' + a.n }, w));
      SG.tube([a.k, [a.k[0] + 0.6, a.k[1] - 2.4, a.k[2] - a.sg * 0.3], a.f], t => 1.35 - 0.35 * t, 0, HIDE, Object.assign({ tag: 'fa' + a.n }, w));
      SG.ball(a.fist, [1.25, 1.0, 1.15], HIDE, Object.assign({ tag: 'fi' + a.n }, w));
      SG.ball(a.k, [1.2, 1.0, 1.1], CUFF, { tag: 'fa' + a.n, res: 0.2 }); SG.ball([a.f[0] - 0.1, a.f[1] + 1.1, a.f[2]], [1.15, 0.8, 1.1], CUFF, { tag: 'fa' + a.n, res: 0.2 });   // tufts at the elbow and over the wrist
      for (let j = 0; j < 4; j++) SG.ball([a.fist[0] + 0.85, a.fist[1] - 0.35, a.fist[2] + (j - 1.5) * 0.48], [0.38, 0.4, 0.26], HIDE, { tag: 'fi' + a.n, whole: true });
      SG.torus([a.f[0] + 0.1, a.f[1] + 0.5, a.f[2]], 1.15, 0.2, IRON, { tag: 'fa' + a.n, res: 0.07, ax: [[0, 0, 1], [1, 0, 0], [0, 1, 0]] }); }   // shackles, the chains long gone
    for (const l of LEG) { const w = { whole: true };
      SG.tube([l.h, [l.h[0] + 1.4, l.h[1] - 1.8, l.h[2]], l.k], t => 2.2 - 0.8 * t, 0, HIDE, Object.assign({ tag: 'th' + l.n }, w));
      SG.tube([l.k, [l.k[0] - 1.0, l.k[1] - 1.9, l.k[2]], l.f], t => 1.25 - 0.5 * t, 0, HIDE, Object.assign({ tag: 'sh' + l.n }, w));
      SG.ball([l.f[0] + 0.05, l.f[1] + 0.3, l.f[2]], [1.0, 0.8, 0.95], CUFF, { tag: 'sh' + l.n, res: 0.18 });   // feathered fetlocks
      SG.ball([l.k[0] + 0.2, l.k[1] - 0.3, l.k[2] + l.sg * 0.4], [1.0, 1.0, 0.8], CUFF, { tag: 'th' + l.n, res: 0.2 });
      for (const t of [-1, 1]) SG.ball([l.hoof[0] + 0.25, l.hoof[1], l.hoof[2] + t * 0.42], [0.75, 0.55, 0.4], { r: [0, 1, 2, 10] }, { tag: 'ho' + l.n, whole: true, res: 0.08 }); }
    // the tail, with a tuft
    const TL0 = [[-7.9, 9.8, 0], [-9.3, 8.6, 0], [-10.0, 6.4, 0], [-10.2, 4.2, 0], [-10.0, 2.5, 0]];
    SG.tube(TL0, t => 0.5 - 0.25 * t, 0, HIDE, { tag: 'tail' }); SG.ball([-10.0, 2.3, 0], [0.7, 1.1, 0.7], TUFT(1.6, [0, -1, 0], 0.9), { tag: 'tail', res: 0.13 });
    SG.bake();

    // ---- the loose dabs (sparks, glowing footprints, ash) and then the pilgrim, last of all
    const pool = INF.loose(B, 2400);
    const hero = makeCharacter(B, Object.assign(INF.pilgrim({ cloak: [10, 11, 11, 12], dark: [15, 15, 16], face: [11], fx: 8 }), { res: 0.045, x0: START[0], world: { height: walkY } }), START[1]);
    const W = B.finish({ cam: { target: [START[0], 1, START[1]], dist: 32, pitch: 0.5, yaw: -0.35, sway: 0 }, detail: 10, palName: 'The Burning Sand', dither: 0.25, radius: 34, fog: { c: 0, start: 0.5, max: 0.92 } });
    hero.bind(W, W.count - hero.total);
    const st = INF.stage(W, pool), RN = 18, runIds = []; for (let k = 0; k < RN * 6; k++) runIds.push(pool.take());   // the runners keep their own dabs; the particles have the rest
    const parts = K.particles(st, Object.assign({}, pool, { first: pool.first + RN * 6, n: pool.n - RN * 6 }), { ground: hf });

    // ---- the bull's walk. Four feet on the real ground, each stepping when the body has carried it too far, one at a time, the way a
    // very heavy thing walks. Where a foot comes down: a print that glows and fades, sparks, and if you are near, the ground shakes.
    const back = R.spine('back', BK0), tail = R.spine('tail', TL0), { rot, mul, app, aim, J, use, set, AX, AY, AZ } = R;
    const ROUTE = INF.path([[3, 1.5], [9.5, 2.5], [13, -1.5], [9, -6.5], [0, -7], [-8, -4], [-10, 1.5], [-3, 3]], true, 12);   // (well in from the edge: it does not go near the slope)
    const FEET = [ARM[0].fist, ARM[1].fist, LEG[0].hoof, LEG[1].hoof];
    const g0 = ROUTE.at(0), G = { s: 0, v: 0, x: g0.x, z: g0.z, yaw: Math.atan2(-g0.tz, g0.tx), mode: 'stand', timer: 7, next: ROUTE.tot * 0.27, look: 0, lookP: 0, roar: -1, seen: false, paw: -1 };
    let kick = 0, kickT = 0; const FIRE = { t: 1, list: [] };
    const gait = K.gait({ feet: FEET.map((f, i) => ({ home: [f[0], f[2]], group: i })), reach: 2.4, time: 0.85, lift: 1.4, lead: 0.7, ground: hf,
      planted(f) { const p = f.p; for (let j = 0; j < 7; j++) { const a = j / 7 * TAU, q = j ? 0.55 : 0; parts.emit({ p: [p[0] + Math.cos(a) * q, p[1] + 0.06, p[2] + Math.sin(a) * q], fixed: true, life: rr(7, 10), size: j ? 0.32 : 0.45, cols: [9, 8, 7, 7, 6, 5, 4, 3], fade: 0.3 }); }
        for (let j = 0; j < 10; j++) parts.emit({ p: [p[0] + rr(-0.5, 0.5), p[1] + 0.2, p[2] + rr(-0.5, 0.5)], v: [rr(-2.5, 2.5), rr(3, 7), rr(-2.5, 2.5)], grav: 9, life: rr(0.6, 1.3), size: 0.07, cols: [9, 8, 7, 6], streak: 0.25 });
        for (let j = 0; j < 5; j++) parts.emit({ p: [p[0] + rr(-0.8, 0.8), p[1] + 0.3, p[2] + rr(-0.8, 0.8)], v: [rr(-0.6, 0.6), rr(0.4, 1.2), rr(-0.6, 0.6)], drag: 1.5, life: rr(1.5, 2.6), size: 0.35, grow: 1.4, cols: [4, 3, 2, 1], fade: 0.5 });
        const d = Math.hypot(p[0] - hero.st.x, p[2] - hero.st.z);
        if (d < 1.7 && hero.st.dead < 0) { const q = d || 1; hero.hurt((hero.st.x - p[0]) / q, (hero.st.z - p[2]) / q); } } });
    // a limb of two lengths reaching a foot (or a fist): the knee bends the way it was made to bend, turned with the body. ex: { size (the
    // fist or hoof, a 3x3 in its own frame), arm (how much the forearm swells), along (how far it is stretched down its length: a smear) }
    const scl3 = (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z], I3 = scl3(1, 1, 1);
    const alongM = (d, k) => [1 + (k - 1) * d[0] * d[0], (k - 1) * d[0] * d[1], (k - 1) * d[0] * d[2], (k - 1) * d[1] * d[0], 1 + (k - 1) * d[1] * d[1], (k - 1) * d[1] * d[2], (k - 1) * d[2] * d[0], (k - 1) * d[2] * d[1], 1 + (k - 1) * d[2] * d[2]];
    const limbIK = (L, na, nb, nc, base, Jb, target, Rb, Ry, lift, ex) => {
      const fs = ex && ex.size || I3, hy = ex && ex.hy !== undefined ? ex.hy : base[1];
      const hip = Jb.at(L.h), l1 = Math.hypot(L.k[0] - L.h[0], L.k[1] - L.h[1], L.k[2] - L.h[2]), l2 = Math.hypot(L.f[0] - L.k[0], L.f[1] - L.k[1], L.f[2] - L.k[2]);
      const mid0 = [(L.h[0] + L.f[0]) / 2, (L.h[1] + L.f[1]) / 2, (L.h[2] + L.f[2]) / 2], pole = norm(app(Rb, [L.k[0] - mid0[0], L.k[1] - mid0[1], L.k[2] - mid0[2]]));
      const Rf = mul(mul(rot(app(Ry, [0, 0, 1]), -0.5 * lift), Ry), fs), fc = [target[0], target[1] + hy, target[2]];   // where the fist (or hoof) goes, and the wrist above it
      const tw = app(Rf, [L.f[0] - base[0], L.f[1] - base[1], L.f[2] - base[2]]), w2 = [fc[0] + tw[0], fc[1] + tw[1], fc[2] + tw[2]];
      const r = K.ik2(hip, w2, l1, l2, pole), d1 = app(Ry, norm([L.k[0] - L.h[0], L.k[1] - L.h[1], L.k[2] - L.h[2]])), a2 = norm([L.f[0] - L.k[0], L.f[1] - L.k[1], L.f[2] - L.k[2]]), d2 = app(Ry, a2);
      const u1 = norm([r.mid[0] - hip[0], r.mid[1] - hip[1], r.mid[2] - hip[2]]), u2 = norm([r.tip[0] - r.mid[0], r.tip[1] - r.mid[1], r.tip[2] - r.mid[2]]), sw = ex && ex.arm || 1;
      set(na, mul(aim(d1, u1), Ry), L.h, hip);
      set(nb, mul(mul(aim(d2, u2), Ry), mul(scl3(sw, sw, sw), alongM(a2, ex && ex.along || 1))), L.k, r.mid);
      set(nc, Rf, base, fc); };
    // ---- the smash. It rears up on its hind legs about the hips, lifts both fists over its head, and the fists swell as they go up: they
    // are twice the size by the top, and shake. Then they come down faster than anything should, smeared out along the way, and flatten on
    // the sand: a ring of fire runs out from them, sparks go up, the whole bull squashes down and springs back, and the fists go back to
    // their size. (It does this when you are in front of it and close, and sometimes when it stops, at nothing.)
    const ease = { in: u => u * u * u, out: u => 1 - Math.pow(1 - u, 3) }, cl = u => u < 0 ? 0 : u > 1 ? 1 : u;
    const ACT = { dur: 3.3, top: 1.0, hold: 1.28, hit: 1.44 };
    const rearOf = u => u < 0.2 ? 0 : u < ACT.top ? ss((u - 0.2) / (ACT.top - 0.2)) : u < ACT.hold ? 1 : u < ACT.hit ? 1 - 1.3 * ease.in((u - ACT.hold) / (ACT.hit - ACT.hold)) : -0.3 * Math.exp(-(u - ACT.hit) * 3.5) * Math.cos((u - ACT.hit) * 7) * (1 - ss((u - 2.4) / 0.9));
    const bigOf = u => 1 + 0.95 * ss((u - 0.45) / 0.6) * (1 - ss((u - 1.7) / 1.0));
    const sqOf = u => u < ACT.hit ? 1 : 1 - 0.58 * Math.exp(-(u - ACT.hit) * 5) * Math.cos((u - ACT.hit) * 15);
    const smearOf = u => u > ACT.hold && u < ACT.hit + 0.03 ? 1 + 1.1 * Math.sin(Math.PI * cl((u - ACT.hold) / (ACT.hit + 0.03 - ACT.hold))) : 1;
    const impact = (A, Ry) => { const c = [(A.land[0][0] + A.land[1][0]) / 2, 0, (A.land[0][2] + A.land[1][2]) / 2]; c[1] = hf(c[0], c[2]);
      for (let j = 0; j < 64; j++) { const a = j / 64 * TAU; parts.emit({ p: [c[0] + Math.cos(a) * 1.4, c[1] + 0.25, c[2] + Math.sin(a) * 1.4], v: [Math.cos(a) * 11, 0.4, Math.sin(a) * 11], drag: 2.4, life: rr(0.7, 1.0), size: 0.3, cols: [9, 9, 8, 7, 6, 5, 4], fade: 0.4 }); }
      for (let j = 0; j < 46; j++) parts.emit({ p: [c[0] + rr(-2, 2), c[1] + 0.3, c[2] + rr(-2, 2)], v: [rr(-5, 5), rr(7, 15), rr(-5, 5)], grav: 13, life: rr(0.8, 1.6), size: 0.09, cols: [9, 8, 7, 6], streak: 0.12 });
      for (let j = 0; j < 18; j++) parts.emit({ p: [c[0] + rr(-2.5, 2.5), c[1] + 0.4, c[2] + rr(-2.5, 2.5)], v: [rr(-2, 2), rr(0.8, 2.5), rr(-2, 2)], drag: 1.2, life: rr(1.8, 3), size: 0.6, grow: 2.2, cols: [5, 4, 3, 2, 1], fade: 0.5 });
      for (const q of A.land) for (let j = 0; j < 9; j++) { const a = j / 9 * TAU, rq = j ? 1.1 : 0; parts.emit({ p: [q[0] + Math.cos(a) * rq, hf(q[0], q[2]) + 0.06, q[2] + Math.sin(a) * rq], fixed: true, life: rr(9, 13), size: j ? 0.55 : 0.8, cols: [9, 9, 8, 7, 7, 6, 5, 4, 3], fade: 0.3 }); }
      const d = Math.hypot(c[0] - hero.st.x, c[2] - hero.st.z); if (d < 30) { kick = Math.max(kick, 0.5 * (1 - d / 30)); kickT = 0; }
      for (const q of A.land) { const dq = Math.hypot(q[0] - hero.st.x, q[2] - hero.st.z); if (dq < 3.6 && hero.st.dead < 0) { hero.hurt((hero.st.x - q[0]) / (dq || 1), (hero.st.z - q[2]) / (dq || 1)); break; } }
      A.squash = 0; void Ry; };
    const pose = (t, dt) => {
      const ch = hero.st, hx = ch.x, hz = ch.z;
      // where it is going, and whether it stops
      if (G.mode === 'walk' && !G.act) { G.v += (1.45 - G.v) * Math.min(1, dt * 0.8); G.s += G.v * dt; if (G.s >= G.next) { G.mode = 'stand'; G.timer = rr(5, 8); G.next += ROUTE.tot * rr(0.2, 0.32); if (rr(0, 1) < 0.5) G.want = true; } }
      else { G.v += (0 - G.v) * Math.min(1, dt * 1.6); G.s += G.v * dt; G.timer -= dt; if (G.timer <= 0 && G.roar < 0 && !G.act) G.mode = 'walk'; }
      const a = ROUTE.at(G.s); G.x = a.x; G.z = a.z; let dy = Math.atan2(-a.tz, a.tx) - G.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); if (!G.act) G.yaw += dy * Math.min(1, dt * 1.2);
      const dHero = Math.hypot(hx - G.x, hz - G.z), c = Math.cos(G.yaw), s = Math.sin(G.yaw), lx = (hx - G.x) * c - (hz - G.z) * s, lz = (hx - G.x) * s + (hz - G.z) * c;   // you, in its own frame
      // it notices you, once, when you come close: it stops, swells, and roars
      if (!G.seen && dHero < 15) { G.seen = true; G.roar = 0; G.mode = 'stand'; G.timer = 6; }
      if (G.roar >= 0) { G.roar += dt; if (G.roar > 1.6 && G.roar - dt <= 1.6) { const hp = hJ ? hJ.at([10.5, 9.4, 0]) : [G.x, 9, G.z]; for (let j = 0; j < 50; j++) parts.emit({ p: hp, v: [rr(-6, 6), rr(-1, 5), rr(-6, 6)], drag: 0.9, life: rr(1, 2.2), size: 0.1, cols: [9, 8, 7, 6, 5], streak: 0.1, grav: 1 }); } if (G.roar > 4.2) G.roar = -1; }
      const roar = G.roar < 0 ? 0 : ss((G.roar - 1.45) / 0.2) * (1 - ss((G.roar - 3) / 1.2)), inhale = G.roar < 0 ? 0 : ss(G.roar / 1.3) * (1 - ss((G.roar - 1.5) / 0.12));
      // the smash: when you are close in front of it, or now and then when it has stopped
      G.cool = (G.cool || 0) - dt;
      if (!G.act && G.roar < 0 && G.cool <= 0 && ((dHero < 13 && lx > 3 && Math.abs(lz) < 7) || (G.want && G.mode === 'stand'))) {
        const fx = Math.max(7.5, Math.min(10.5, dHero < 13 && lx > 3 ? lx : 9)), fzc = dHero < 13 && lx > 3 ? Math.max(-2, Math.min(2, lz)) : 0;
        G.act = { t: 0, from: [gait.feet[0].p.slice(), gait.feet[1].p.slice()], land: [-1, 1].map(sg => { const q = [fx, 0, fzc + sg * 3.4], x = G.x + q[0] * c + q[2] * s, z = G.z - q[0] * s + q[2] * c; return [x, hf(x, z), z]; }), hitDone: false };
        G.want = false; G.mode = 'stand'; G.timer = Math.max(G.timer, ACT.dur + 1); }
      const A = G.act; let rear = 0, big = 1, sq = 1, smear = 1;
      if (A) { A.t += dt; const u = A.t; rear = rearOf(u); big = bigOf(u); sq = sqOf(u); smear = smearOf(u);
        if (!A.hitDone && u >= ACT.hit) { A.hitDone = true; impact(A); }
        if (u > ACT.hold && u < ACT.hit + 0.02) for (const f of A.cur || []) parts.emit({ p: f.slice(), fixed: true, life: 0.16, size: 1.15 * big, cols: [3, 2, 1], fade: 0.9 });   // the smear: the fists leave copies of themselves on the way down
        if (u >= ACT.dur) { for (let i = 0; i < 2; i++) { const f = gait.feet[i]; f.p = A.land[i].slice(); f.u = 1; f.lift = 0; } G.act = null; G.cool = 8; } }
      const want = dHero < 22 ? Math.max(-0.9, Math.min(0.9, Math.atan2(lz, lx))) : 0.35 * Math.sin(t * 0.27);
      G.look += ((A ? Math.max(-0.4, Math.min(0.4, G.look)) : want) - G.look) * Math.min(1, dt * 1.5);
      const feet = gait.update(dt, { p: [G.x, 0, G.z], yaw: G.yaw, v: [G.v * a.tx, G.v * a.tz] });
      // the body rides its feet: up and down with each step, leaning with the slope it stands on; it rears about its hips
      const fy = (feet[0].p[1] + feet[1].p[1]) / 2, by = (feet[2].p[1] + feet[3].p[1]) / 2, lifted = feet.reduce((m, f) => Math.max(m, f.lift), 0);
      const y = (gait.height || 0) - 0.35 * lifted * (A ? 0 : 1) + 0.12 * Math.sin(t * 1.1) + 0.4 * roar + 0.3 * inhale, pit = Math.atan2(fy - by, 10.5) * (1 - Math.abs(rear)) + 0.12 * roar + 0.06 * inhale + 0.62 * rear, rol = A ? 0 : 0.05 * (feet[0].lift + feet[2].lift - feet[1].lift - feet[3].lift);
      const Ry = rot(AY, G.yaw), Rb = mul(Ry, mul(rot(AZ, pit), rot(AX, rol))), HIPC = [-5, 8.4, 0], hw = app(Ry, HIPC), Jb = J(null, Rb, HIPC, [G.x + hw[0], y + hw[1], G.z + hw[2]]);
      // the back bends toward where it looks, and heaves as it breathes; it swells as it draws breath to roar
      const br = Math.sin(t * 1.05), hyaw = G.look * 0.8, hpit = -0.12 + 0.55 * roar - 0.25 * inhale - (G.mode === 'stand' && G.roar < 0 && !A ? 0.18 : 0) + 0.04 * br - 0.35 * rear + 0.3 * Math.max(0, -rear), Rl = mul(rot(AY, hyaw), rot(AZ, hpit));
      const PT = BK0.map((p, j) => { const w = j < 3 ? 0 : (j - 2) / 3, q = app(Rl, [p[0] - BK0[3][0], p[1] - BK0[3][1], p[2]]), lp = [p[0] + (BK0[3][0] + q[0] - p[0]) * w, p[1] + (BK0[3][1] + q[1] - p[1]) * w + (j === 2 || j === 3 ? 0.18 * br + 0.5 * inhale : 0), p[2] + q[2] * w]; return Jb.at(lp); });
      const chest = 1 + 0.12 * inhale;
      back.pose(PT, j => j >= 2 && j <= 3 ? scl3(1, chest, chest) : I3, (j, T) => mul(aim(app(Rb, back.T0[j]), T), Rb));
      const hs = 1 + 0.22 * inhale - 0.08 * roar;
      hJ = J(null, mul(mul(Rb, Rl), scl3(hs, hs, hs)), HEAD0, PT[5]); use('head', hJ);
      use('jaw', J(hJ, rot(AZ, -0.05 - 0.6 * roar - 0.04 * Math.max(0, br) - 0.25 * (A ? ss((A.t - ACT.hold) / 0.1) * (1 - ss((A.t - 2.2) / 0.5)) : 0)), JAW0));
      // the arms: walking on the fists, or, in the smash, up over the head and down. The legs: hooves on the ground
      const cur = [];
      ARM.forEach((L, i) => { let tgt = feet[i].p, lift = feet[i].lift, ex;
        if (A) { const u = A.t, sg = L.sg, up = [G.x, 0, G.z], rq = app(Ry, [6.2, 0, sg * 3.6]), top = [G.x + rq[0], hf(G.x, G.z) + 15.5 + 0.25 * Math.sin(u * 41), G.z + rq[2]];
          const raise = ss((u - 0.15) / (ACT.top - 0.15)), down = ease.in(cl((u - ACT.hold) / (ACT.hit - ACT.hold)));
          const from = A.from[i], land = A.land[i];
          tgt = u < ACT.hold ? [from[0] + (top[0] - from[0]) * raise, from[1] + (top[1] - from[1]) * raise, from[2] + (top[2] - from[2]) * raise] : u < ACT.hit ? [top[0] + (land[0] - top[0]) * down, top[1] + (land[1] - top[1]) * down, top[2] + (land[2] - top[2]) * down] : land.slice();
          if (u >= ACT.hit) tgt[1] += 0.9 * Math.max(0, Math.sin((u - ACT.hit) * 9)) * Math.exp(-(u - ACT.hit) * 4);
          lift = u < ACT.hold ? -1.2 * raise : 0; void up;
          const sm = smear, k = big, syk = k * sq * sm, sxk = k / Math.sqrt(sq * sm);
          ex = { size: scl3(sxk, syk, sxk), hy: L.fist[1] * syk, arm: 1 + 0.35 * (big - 1), along: 1 + 0.6 * (smear - 1) }; cur.push([tgt[0], tgt[1] + L.fist[1] * syk, tgt[2]]); }
        limbIK(L, 'ua' + L.n, 'fa' + L.n, 'fi' + L.n, L.fist, back.JT[3], tgt, Rb, Ry, lift, ex); });
      if (A) A.cur = cur;
      LEG.forEach((L, i) => limbIK(L, 'th' + L.n, 'sh' + L.n, 'ho' + L.n, L.hoof, back.JT[1], feet[i + 2].p, Rb, Ry, feet[i + 2].lift));
      // the tail swings, and lashes when it rears
      // (it is a rope: it hangs off the body and comes after it late, lies on the sand rather than going into it, and is drawn back toward its
      // own shape, which swings from side to side; each length is turned from the one before it, so nothing can flip)
      const wag = mul(Rb, rot(AY, (0.45 + 0.9 * Math.abs(rear)) * Math.sin(t * (0.8 + 3 * Math.abs(rear))))), anchor = Jb.at(TL0[0]);
      const TP = tailStep(Math.min(dt || 1 / 60, 1 / 30), anchor, wag); let Rp = null;
      tail.pose(TP, null, (j, T) => (Rp = j === 0 ? mul(aim(app(Rb, tail.T0[0]), T), Rb) : mul(aim(app(Rp, tail.T0[j]), T), Rp)));
      // on the impact the whole bull squashes into the ground and springs back
      if (A && A.t >= ACT.hit) { const k = 1 - 0.16 * Math.exp(-(A.t - ACT.hit) * 6) * Math.cos((A.t - ACT.hit) * 16); W.anim.warp = Math.abs(k - 1) > 0.004 ? K.deform.squash([G.x, by, G.z], [0, 1, 0], k, true) : null; } else W.anim.warp = null;
      G.head = hJ.at([10.4, 10.2, 0]);
    };
    let hJ = null;
    // the tail's rope: its own few lines, so that the shape it is drawn back toward is its own made shape, turned as the body is turned
    const TLEN = TL0.slice(1).map((p, i) => Math.hypot(p[0] - TL0[i][0], p[1] - TL0[i][1], p[2] - TL0[i][2])), TRL = TL0.map(p => [p[0] - TL0[0][0], p[1] - TL0[0][1], p[2] - TL0[0][2]]);
    let TPp = null, TPq = null;
    const tailStep = (dt, anchor, frame) => { const tgt = TRL.map(q => { const r = app(frame, q); return [anchor[0] + r[0], anchor[1] + r[1], anchor[2] + r[2]]; });
      if (!TPp) { TPp = tgt.map(p => p.slice()); TPq = tgt.map(p => p.slice()); }
      TPp[0] = anchor.slice();
      for (let i = 1; i < TPp.length; i++) { const p = TPp[i], q = TPq[i], v = [(p[0] - q[0]) * 0.88, (p[1] - q[1]) * 0.88, (p[2] - q[2]) * 0.88]; TPq[i] = p.slice();
        for (let a = 0; a < 3; a++) p[a] += v[a] + (tgt[i][a] - p[a]) * 0.09; p[1] -= 14 * dt * dt; }
      for (let it = 0; it < 4; it++) for (let i = 1; i < TPp.length; i++) { const a = TPp[i - 1], b = TPp[i], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1e-6, k = TLEN[i - 1] / l;
        b[0] = a[0] + d[0] * k; b[1] = a[1] + d[1] * k; b[2] = a[2] + d[2] * k; const fy = hf(b[0], b[2]) + 0.45; if (b[1] < fy) b[1] = fy; }
      return TPp; };
    R.bind(W, pose);
    // runners: the dead who may not stop. Each goes its own way across the sand, never for long; they stop to beat at the fire on them with
    // their hands, and run on; they scatter from the bull, shy from you, and when they run scared they fall, and get up.
    const palP = PAL.map(h => ((h >> 16) & 255) + (h & 0xff00) + ((h & 255) << 16)), RCOL = [palP[11], palP[12], palP[10]];
    const okRun = (x, z) => onShelf(x, z, 2.5) && river(x, z) > 2.2 && Math.hypot(x - WOOD[0], z - WOOD[1]) > 8;
    const runners = INF.crowd({ n: RN, ok: okRun, ground: hf, speed: [2.0, 3.2], wander: [5, 12], beat: true, spawn: () => { for (;;) { const x = rr(-18, 18), z = rr(-6, 10); if (okRun(x, z)) return [x, z]; } } }, K.grow.dice(seed * 193 + 17));
    runners.P.forEach((p, k) => p.ids = runIds.slice(k * 6, k * 6 + 6));
    // ---- the director: you are followed; when the bull is near, the view widens and takes it in
    W.dynamic = { start: pool.first, count: W.count - pool.first, focus: [hero.st.x, hero.st.y + 0.8, hero.st.z], actor: [hero.st.x, hero.st.z, 1.1, hero.st.y], fixedCam: true, zoomOut: 2.6, height: walkY, hero, state: hero.st, wide: 0, giant: G,
      update(dt, inp, time) {
        hero.update(dt, inp, time);
        W.anim.update(dt, time);
        runners.update(dt, time, [{ x: G.x + 4 * Math.cos(G.yaw), z: G.z - 4 * Math.sin(G.yaw), r: 13, k: 1.4 }, { x: hero.st.x, z: hero.st.z, r: 2.4, k: 0.7 }].concat(G.act && G.act.land ? [{ x: G.act.land[0][0], z: G.act.land[0][2], r: 16, k: 2 }] : []));
        for (const p of runners.P) INF.drawFigure(st, pool, p.ids, p, RCOL, time, 1.05);
        // the fire coming down: a lump of it every second or so, somewhere near you, falling fast with a tail; where it lands a burst of
        // sparks, a splash of burning sand that dies down slowly, a puff of ash (and if it lands on you, you are knocked over)
        FIRE.t -= dt; if (FIRE.t <= 0) { FIRE.t = rr(0.7, 1.6); for (let tries = 0; tries < 8; tries++) { const a = rr(0, TAU), q = rr(3, 15), x = hero.st.x + Math.cos(a) * q, z = hero.st.z + Math.sin(a) * q * 0.8; if (!onShelf(x, z, 0.5)) continue; FIRE.list.push({ x, z, y: hf(x, z) + rr(32, 40), vx: rr(-0.8, 0.8), vz: rr(-0.8, 0.8), vy: -rr(14, 18), big: rr(0.5, 0.8) }); break; } }
        for (let k = FIRE.list.length - 1; k >= 0; k--) { const f = FIRE.list[k]; f.vy -= 6 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; const g = river(f.x, f.z) < 1.3 ? bloodY(f.x, f.z) : hf(f.x, f.z);
          if (f.y > g + 0.2) { parts.emit({ p: [f.x, f.y, f.z], fixed: true, life: 0.06, size: 0.26 * f.big, cols: [8], fade: 0 }); parts.emit({ p: [f.x, f.y + 0.25, f.z], fixed: true, life: 0.4, size: 0.2 * f.big, cols: [7, 6, 5, 4, 3], fade: 0.6, grow: -0.5 }); continue; }
          FIRE.list.splice(k, 1); const wet = river(f.x, f.z) < 1.3;
          for (let j = 0; j < 10; j++) parts.emit({ p: [f.x, g + 0.15, f.z], v: [rr(-3, 3) * f.big, rr(2.5, 6.5), rr(-3, 3) * f.big], grav: 11, life: rr(0.5, 1.1), size: 0.08, cols: wet ? [14, 13, 4] : [8, 7, 6, 5], streak: 0.12 });
          if (!wet) for (let j = 0; j < 6; j++) { const a = j / 6 * TAU, q = j ? 0.4 * f.big : 0; parts.emit({ p: [f.x + Math.cos(a) * q, g + 0.05, f.z + Math.sin(a) * q], fixed: true, life: rr(3, 5), size: (j ? 0.3 : 0.42) * f.big, cols: [8, 7, 7, 6, 5, 4, 3], fade: 0.35 }); }
          for (let j = 0; j < 3; j++) parts.emit({ p: [f.x + rr(-0.4, 0.4), g + 0.3, f.z + rr(-0.4, 0.4)], v: [rr(-0.4, 0.4), rr(0.6, 1.4), rr(-0.4, 0.4)], drag: 1.4, life: rr(1.4, 2.4), size: 0.26 * f.big, grow: 1.6, cols: wet ? [5, 4, 3, 2] : [3, 2, 1, 1], fade: 0.5 });
          const dh = Math.hypot(f.x - hero.st.x, f.z - hero.st.z); if (dh < 0.9 && hero.st.dead < 0) hero.hurt((hero.st.x - f.x) / (dh || 1), (hero.st.z - f.z) / (dh || 1)); }
        parts.update(dt, time);
        kickT += dt; kick *= Math.exp(-dt * 3.2); this.kick = kick > 0.01 ? [kick * Math.sin(kickT * 41), kick * 0.7 * Math.sin(kickT * 53 + 1), 0] : null;
        const ch = hero.st, d = Math.hypot(ch.x - G.x, ch.z - G.z), near = INF.ss((26 - d) / 16);
        this.wide = 0; void near;   // (the camera is yours: it follows you and does nothing else)
        // the view leans toward the bull as well as following you, so that both are in it
        this.focus = [ch.x, ch.y + 0.8, ch.z]; this.actor = [ch.x, ch.z, 1.1, ch.y];
        return true; } };
    W.dynamic.update(1 / 60, { move: 0 }, 0);
    return W;
  }

  return { id: 'circle7', name: 'VII · The Burning Sand', seed: 7, build: sceneCircle7, animate: attachRebirthDynamics };
}

if (typeof module !== 'undefined') module.exports = rebirthBurningSand;
