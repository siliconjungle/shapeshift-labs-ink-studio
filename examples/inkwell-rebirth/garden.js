// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthGarden(kit) {
  const { KIT, makeBuilder, makeSculpt, courses } = kit;
  const { sculptGardenMushroom, sculptGardenFrog } = (typeof module === 'undefined' ? rebirthGardenSupport : require('./garden-support.js'))(kit);

  function sceneGarden(seed, { controls } = {}) {
    // 0 void · 1-7 indigo, from the dark to a pale periwinkle · 8-14 gold, from umber to cream · 15-19 what grows, teal in the shade to olive
    // gold in the sun · 20 haze
    const PAL = [0x07060f, 0x0f0d1f, 0x1a1736, 0x27264f, 0x383a6b, 0x4f5689, 0x6c78a8, 0x98a6cc, 0x2a160f, 0x4e2a14, 0x7e4716, 0xb2701c, 0xdea032,
      0xf4cf5e, 0xfff1b6, 0x16233a, 0x213a48, 0x36533f, 0x5f6c36, 0x8f8a30, 0x2e2c5c];
    const canopy = controls?.canopy ?? 'gold';
    if (!['gold', 'rose'].includes(canopy)) throw new RangeError('Choose a gold or rose canopy');
    const rose = canopy === 'rose';
    if (rose) PAL.push(0x27203c, 0x56335b, 0x8c4979, 0xc6678f, 0xeb93a8, 0xffc6bc);
    const K = KIT, G = K.grow, B = makeBuilder(seed, PAL);
    const { rr, pick, n3, fbm, P, TAU, UP, norm, iso, stick, disc } = B, S = K.sculpt(makeSculpt(B)), cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
    const lineD = (x, z, pts) => { let d = 1e9; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segD(x, z, pts[i], pts[i + 1])); return d; };
    S.sun = norm([-0.68, 0.36, -0.64]); S.sunK = 0.95; S.amb = 0.15; S.sky = 0.22; S.res = 0.09; S.shLen = 8; S.merge = 0.3;
    const tags = K.deform.tags(S);
    // what each thing is made of: a ramp for its shade, all indigo, and one for its sun, gold
    const GRASS = { r: [15, 15, 16, 17], s: [16, 17, 18, 19], blade: { h: 0.12, w: 0.03 } }, MOSS = { r: [15, 16], s: [17, 18, 19], min: 0.62 };
    const STONE = { r: [1, 2, 3, 4], s: [4, 10, 11, 12], top: MOSS }, ROCK = { r: [1, 2, 3, 4], s: [4, 10, 11, 12], top: { r: [15, 16], s: [17, 18, 19], min: 0.7 } };
    const BARK = { r: [1, 8, 9], s: [9, 10, 11], root: -0.35, mod: K.tex.range(K.tex.wave(9, { dir: [1, 0.15, 0.6], warp: 0.4, sharp: 0.5 }), 0, 1, -0.12, 0.1) };

    // ---- the lie of the ground: a low bed, the knoll on it, the pool, and the water's way down to it
    const KX = -2.7, KZ = -2.9, KA = 4.1, KB = 3.3, KH = 1.5;
    const kd = (x, z) => Math.hypot((x - KX) / KA, (z - KZ) / KB), kang = (x, z) => Math.atan2((z - KZ) / KB, (x - KX) / KA), walled = a => Math.sin(a) > -0.35;
    const kpt = (a, d) => [KX + KA * d * Math.cos(a), KZ + KB * d * Math.sin(a)], kout = a => { const v = norm([Math.cos(a) / KA, 0, Math.sin(a) / KB]); return [v[0], v[2]]; };
    const PD = [2.8, 2.6, 2.35, 1.85], WY = -0.14, pd = (x, z) => Math.hypot((x - PD[0]) / PD[2], (z - PD[1]) / PD[3]);
    const SA = 1.25, SE = kpt(SA, 1.03), SN = kout(SA), NS = 6, RISE = KH / NS, RUN = 0.36, SF = [SE[0] + SN[0] * NS * RUN, SE[1] + SN[1] * NS * RUN];
    const CA = 0.12, CE = kpt(CA, 1.03), CN = kout(CA), CF = [CE[0] + CN[0] * 0.9, CE[1] + CN[1] * 0.9];
    const SPRING = [-0.6, -3.7], UPPER = [SPRING, [0.3, -3.1], [CE[0] - CN[0] * 0.2, CE[1] - CN[1] * 0.2]], LOWER = [CF, [2.4, -0.4], [2.6, 0.9]];
    const PATH = [[SF[0] + SN[0] * 0.3, SF[1] + SN[1] * 0.3], [-0.6, 3.9], [-1.4, 5.4], [-1.8, 7.4]];
    // (the ground is laid as a height field, so it must never jump except where a wall stands in front of the jump: where the wall gives
    // out, and where the water comes over, the knoll's edge eases from a drop into a bank)
    const adiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const hold = a => smooth(-0.3, 0.05, Math.sin(a)) * smooth(0.04, 0.16, adiff(a, CA));
    const hf0 = (x, z) => {
      const base = 0.32 * fbm(x * 0.18 + 3, z * 0.18, 1.7, 2) - 0.16 - 0.003 * (x * x + z * z), d = kd(x, z), a = kang(x, z), wv = hold(a);
      const top = KH + 0.1 * Math.max(0, 1 - d * d) + 0.04 * (n3(x * 0.8, z * 0.8, 9) - 0.5) * smooth(1.05, 0.9, d);
      const bank = Math.max(base, KH * (1 - smooth(0.95, 1.6, d)) + 0.1 * Math.max(0, 1 - d * d) + 0.04 * (n3(x * 0.8, z * 0.8, 9) - 0.5) * smooth(1.05, 0.9, d));
      let y = d < 1.02 ? top * wv + bank * (1 - wv) : base * wv + bank * (1 - wv);
      const u = lineD(x, z, UPPER); y -= 0.16 * smooth(0.32, 0.12, u) * smooth(1.12, 0.95, d);
      const p = pd(x, z); if (p < 1.3) y = Math.min(y, WY - 0.42 + (y - WY + 0.42) * smooth(0.5, 1.3, p));
      const l = lineD(x, z, LOWER), lw = smooth(0.98, 1.15, d); if (l < 0.5 && lw > 0) y = Math.min(y, y + (WY - 0.2 + (y - WY + 0.2) * smooth(0.18, 0.5, l) - y) * lw);
      return y;
    };
    const hf = K.tab2(hf0, [-10.6, 10.6, -10.6, 10.6], 0.04);   // (asked for at every look at the ground: worked out once on a fine grid)
    const onPath = (x, z) => lineD(x, z, PATH) < 0.42 + 0.12 * n3(x * 2, z * 2, 5);
    const wet = (x, z) => pd(x, z) < 1.02 || lineD(x, z, LOWER) < 0.3 || kd(x, z) < 1.02 && lineD(x, z, UPPER) < 0.22;
    const flag = courses(0.5, 0.36, n3);
    GRASS.tex = (x, y, z, ny, t) => wet(x, z) ? pick(t < 0.4 ? [2, 3] : [3, 4]) : onPath(x, z) ? (flag(x, z, 0) < 0.25 ? 16 : t > 0.55 ? pick([10, 11]) : pick([3, 4])) : undefined;
    S.ground(GRASS, { rad: 9.6, zs: 0.9, h: hf, res: 0.11 });

    // ---- the wall round the knoll: old courses of block, broken along the top, with a gap for the steps and one where the water comes over
    const A0 = -0.35, A1 = Math.PI + 0.35, NW = 90, wallPts = [], wallU = [0];
    for (let i = 0; i <= NW; i++) { wallPts.push(kpt(A0 + (A1 - A0) * i / NW, 1.04)); if (i) wallU.push(wallU[i - 1] + Math.hypot(wallPts[i][0] - wallPts[i - 1][0], wallPts[i][1] - wallPts[i - 1][1])); }
    const uOf = a => { const f = (a - A0) / (A1 - A0) * NW, i = Math.max(0, Math.min(NW - 1, Math.floor(f))); return wallU[i] + (wallU[i + 1] - wallU[i]) * (f - i); };
    const aOf = u => { let i = 0; while (i < NW - 1 && wallU[i + 1] < u) i++; return A0 + (A1 - A0) * (i + (u - wallU[i]) / (wallU[i + 1] - wallU[i])) / NW; };
    const wallTop = a => KH + 0.42 + 0.22 * n3(a * 3, 1, 4) - (a > 2.2 ? 0.35 * smooth(2.2, 3.0, a) : 0) - (a < 0.6 ? 0.3 * smooth(0.6, 0.15, a) : 0);
    K.form.wall(S, STONE, { path: wallPts, y0: -0.3, h: KH + 0.75, thick: 0.42, brick: [0.46, 0.24], gap: 0.03, round: 0.03, jitter: 0.02, top: u => wallTop(aOf(u)) + 0.3,
      openings: [[uOf(SA - 0.15), uOf(SA + 0.15)], [uOf(CA - 0.07), uOf(CA + 0.07)]], missing: 0.025, rubble: 0.6, ground: hf, seed: seed * 13, res: 0.09 });
    for (const sg of [-1, 1]) {
      const pa = SA + sg * 0.19, p = kpt(pa, 1.04), h = sg > 0 ? KH + 1.25 : KH + 0.7;
      S.box([p[0], h / 2 - 0.15, p[1]], [0.3, h / 2 + 0.15, 0.3], STONE, { ax: B.frame(-Math.atan2(SN[1], SN[0]), 0, 0), res: 0.07 });
      if (sg > 0) S.box([p[0], h + 0.08, p[1]], [0.38, 0.09, 0.38], STONE, { ax: B.frame(-Math.atan2(SN[1], SN[0]) + 0.1, 0, 0.03), res: 0.06 });
    }
    // ---- the steps, worn, each block filled in under
    const TREAD = { r: [1, 2, 3, 4], s: [4, 10, 11, 12], top: { r: [3, 4, 5], s: [10, 11, 12], min: 0.7, tex: (x, y, z) => n3(x * 2.4, z * 2.4, 7) > 0.66 ? pick([16, 17]) : undefined } };
    K.form.steps(S, TREAD, { at: [SF[0], hf(SF[0], SF[1]) - 0.02, SF[1]], dir: [-SN[0], 0, -SN[1]], n: NS, rise: RISE, run: RUN, width: 1.5, seed: seed * 3 + 5, res: 0.06 });
    for (let k = 1; k < NS; k++) { const d = (NS - k) * RUN * 0.5 + 0.05, c = [SF[0] - SN[0] * (k * RUN + d), RISE * k / 2 - 0.15, SF[1] - SN[1] * (k * RUN + d)];
      S.box(c, [0.72, RISE * k / 2 + 0.15, d], { r: [1, 2, 3], s: [3, 10, 11] }, { ax: B.frame(-Math.atan2(SN[1], SN[0]) + Math.PI / 2, 0, 0), res: 0.08 }); }

    // ---- the moon gate: a wall a little way in from the steps, a round way through it ringed with wedge stones, two of them fallen
    const GC = [SE[0] - SN[0] * 1.35, SE[1] - SN[1] * 1.35], GT = [-SN[1], SN[0]], GR = 1.02, GY = KH + 1.32;
    K.form.wall(S, STONE, { from: [GC[0] - GT[0] * 1.95, GC[1] - GT[1] * 1.95], to: [GC[0] + GT[0] * 1.95, GC[1] + GT[1] * 1.95], y0: KH - 0.2, h: 3.0, thick: 0.38,
      brick: [0.44, 0.22], gap: 0.03, round: 0.03, top: u => 2.75 + 0.3 * Math.sin(u * 2.2) - (u > 2.9 ? 0.9 * smooth(2.9, 3.9, u) : 0) - (u < 0.5 ? 0.4 : 0), missing: 0.02, rubble: 0.7, ground: hf, seed: seed * 17, res: 0.07 });
    const GN3 = [SN[0], 0, SN[1]], GT3 = [GT[0], 0, GT[1]];
    S.lathe([GC[0] - SN[0] * 0.6, GY, GC[1] - SN[1] * 0.6], 1.2, GR, { r: [1] }, { neg: true, ax: [GT3, GN3, [0, 1, 0]] });
    const fallen = [], gapAt = [];
    for (let i = 0; i < 20; i++) {
      const th = (i + 0.5) / 20 * TAU, rd = [Math.cos(th) * GT[0], Math.sin(th), Math.cos(th) * GT[1]], tg = [-Math.sin(th) * GT[0], Math.cos(th), -Math.sin(th) * GT[1]];
      const at = [GC[0] + rd[0] * (GR + 0.15), GY + rd[1] * (GR + 0.15), GC[1] + rd[2] * (GR + 0.15)];
      if (i === 3 || i === 4) { fallen.push(i); gapAt.push(at); continue; }
      S.box(at, [0.16, 0.15, 0.24], STONE, { ax: [rd, tg, GN3], res: 0.05 });
    }
    fallen.forEach((i, k) => { const x = GC[0] + GT[0] * (0.9 + k * 0.5) + SN[0] * (0.7 + k * 0.3), z = GC[1] + GT[1] * (0.9 + k * 0.5) + SN[1] * (0.7 + k * 0.3);
      S.box([x, hf(x, z) + 0.12, z], [0.16, 0.14, 0.23], STONE, { ax: B.frame(rr(0, 3), rr(-0.4, 0.4), rr(-0.3, 0.3)), res: 0.05 }); });

    // ---- rocks: the spring's, the cascade's, round the pool, and a few in the grass, each laid in beds and settled
    for (const [x, z, r] of [[-0.95, -3.9, 0.42], [-0.3, -4.15, 0.35], [-1.25, -3.45, 0.28]]) S.rock([x, hf(x, z) + r * 0.3, z], r, ROCK, { res: 0.06 });
    for (let k = 0; k < 7; k++) { const t = k / 6, x = CE[0] + CN[0] * (t * 0.95 - 0.05), z = CE[1] + CN[1] * (t * 0.95 - 0.05), y = KH * (1 - t) - 0.05;
      for (const sg of [-1, 1]) { const ox = -CN[1] * sg * 0.42, oz = CN[0] * sg * 0.42; S.rock([x + ox, y + 0.05, z + oz], rr(0.22, 0.34), ROCK, { res: 0.055 }); } }
    for (let k = 0; k < 4; k++) { const t = k / 3, x = CE[0] + CN[0] * (t * 0.8), z = CE[1] + CN[1] * (t * 0.8); S.rock([x, KH * (1 - t) - 0.32, z], 0.24, ROCK, { res: 0.055 }); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + rr(-0.15, 0.15), x = PD[0] + Math.cos(a) * PD[2] * 1.06, z = PD[1] + Math.sin(a) * PD[3] * 1.06; if (lineD(x, z, LOWER) < 0.55) continue; S.rock([x, hf(x, z) + 0.02, z], rr(0.16, 0.34), ROCK, { res: 0.055 }); }
    [[[6.2, 0, -2.6], 0.9, [1.2, 0.8, 1]], [[-6.4, 0, 1.6], 0.75, [1, 0.85, 1.2]], [[5.4, 0, 5.4], 0.55, [1, 0.7, 1.1]]].forEach(([c, r, sq], i) => {
      c[1] = hf(c[0], c[2]) + 2; G.rock(S, c, r, ROCK, { seed: seed * 31 + i * 7, squash: sq, facets: 8, chip: 0.3, beds: { n: 5, depth: 0.07 * r, tilt: [0.16, 0.06] }, worn: 0.12, res: 0.07, settle: true, lean: 0.4, bury: 0.18, flat: 0.12 }); });
    S.ready();

    // ---- the tree: grown on the knoll, leaning a little to the light, its leaves swept blades gathered at every tip, all of them gold
    const TX = -3.7, TZ = -3.9;
    const tree = G.branch({ at: [TX, hf(TX, TZ) - 0.15, TZ], dir: [0.15, 1, 0.2], len: 2.15, r: 0.27, depth: 4, forks: 2, spread: 0.66, shrink: 0.71, light: S.sun, lean: 0.25, droop: 0.12, sdf: S.sdf, margin: 0.45, seed: seed * 13 + 4 });
    G.limbs(S, tree, BARK, { res: 0.055 });
    let cx = 0, cy = 0, cz = 0; tree.tips.forEach(t => { cx += t.p[0] / tree.tips.length; cy += t.p[1] / tree.tips.length; cz += t.p[2] / tree.tips.length; });
    // where the sun gets down through the crown: a few gaps, and one more on the line from the gate's middle back toward the sun
    const CRW = Math.max(...tree.tips.map(t => Math.hypot(t.p[0] - cx, t.p[2] - cz))) + 0.6, SY = cy;
    const under = (x, z) => tree.tips.some(t => Math.hypot(x - t.p[0], z - t.p[2]) < 0.95);
    const lineAt = y => [GC[0] + S.sun[0] * (y - GY) / S.sun[1], GC[1] + S.sun[2] * (y - GY) / S.sun[1]], hero = lineAt(SY).concat([0.4]);
    const sh0 = K.dapple({ sun: S.sun, y: SY, at: [cx, cz], r: CRW * 0.8, n: 6, size: [0.18, 0.36], seed: seed * 7 + 3 });
    const sh = K.dapple({ sun: S.sun, y: SY, gaps: sh0.gaps.filter(q => Math.hypot(q[0] - hero[0], q[1] - hero[1]) > q[2] + 0.7).concat([hero]), cover: under, under: 0.24, floor: 0, bound: [0, 0.5, 9.4] });
    S.mask = sh.mask;
    S.clip = (x, y, z) => { for (const g of sh.gaps) { const t = (SY - y) / S.sun[1], gx = x + S.sun[0] * t - g[0], gz = z + S.sun[2] * t - g[1]; if (gx * gx + gz * gz < g[2] * g[2] * 0.85) return false; } return true; };
    const LEAF = { r: rose ? [22, 23, 23, 24] : [10, 11, 11, 12], s: rose ? [24, 25, 25, 26] : [12, 13, 13, 14], root: -0.25, fl: { k: 11, ph: 2, sp: 1.6, rg: 0.018 } };
    const leafPut = G.leaves(S, LEAF, { res: 0.17, sway: { amp: 0.04, sp: 1.6 } }), leafPut2 = G.leaves(S, Object.assign({}, LEAF, { r: rose ? [21, 22, 23] : [9, 10, 11], s: rose ? [23, 24, 25] : [11, 12, 13] }), { res: 0.17, wide: 0.34, sway: { amp: 0.04, sp: 1.6 } });
    tree.tips.forEach((t, i) => { const R = G.dice(seed * 7 + i * 11);
      for (const f of G.arrange('spiral', 44, { r: 0.58, dome: 0.85 })) {
        const q = G.put(f, [t.p[0] + t.dir[0] * 0.15, t.p[1] + t.dir[1] * 0.15, t.p[2] + t.dir[2] * 0.15], R() * 6.28, 1), d = norm([q.dir[0] + t.dir[0] * 0.5, q.dir[1] + 0.2, q.dir[2] + t.dir[2] * 0.5]), L = 0.25 + 0.1 * R();
        (R() < 0.4 ? leafPut2 : leafPut)(q.p, [d[0], d[1] - 0.25, d[2]], norm(cr(d, [0, 0.001, 1])).map((v, k) => v * 0.4 + [0, 1, 0][k] * 0.6), L);
      } });
    S.clip = null;

    // ---- what grows in the beds, each described once and grown wherever there is room for it: mushrooms where the wall and the tree keep
    // the sun off, small gold flowers where it does not, ferns in the shade, low leafy mounds in drifts
    const CAP = { r: [9, 10, 11], s: [11, 12, 13, 14] }, STEM = { r: [4, 5], s: [5, 6, 7], root: -0.3 }, SPOT = { r: [7, 14], s: [14, 14] };
    const shroomMake = (Sx, at, v, k) => sculptGardenMushroom(Sx, at, v, k, { cap: CAP, stem: STEM, spot: SPOT });
    const shroom = G.species({ name: 'mushroom', seed: seed + 1, vary: { h: [0.3, 0.75], cap: [0.2, 0.4], spots: [3, 7.99], tip: [-0.12, 0.12] }, limits: { h: [0.1, 1.4], cap: [0.08, 0.7], spots: [0, 14], tip: [-0.4, 0.4] }, make: shroomMake });
    const awayFrom = (x, z) => !wet(x, z) && !onPath(x, z) && !(kd(x, z) > 0.94 && kd(x, z) < 1.12) && Math.hypot(x - SF[0] + SN[0], z - SF[1] + SN[1]) > 1.3 && Math.hypot(x - GC[0], z - GC[1]) > 2.1;
    shroom.sow(S, G.scatter(S, { disc: [-2.4, -1.8, 5.6], n: 18, gap: 0.55, shade: [0, 0.5], slope: [0.75, 1], size: [0.7, 1.2], where: (x, z) => awayFrom(x, z) && (kd(x, z) > 1.1 && kd(x, z) < 1.5 && walled(kang(x, z)) || Math.hypot(x - TX, z - TZ) < 1.4) ? 1 : 0, seed: seed * 5 + 1 }), { instances: 5, sway: { amp: 0.03, sp: 1.2 } });
    const PET = { r: [11, 12], s: [12, 13, 14] }, EYE = { r: [9, 10], s: [10, 11] }, STALK = { r: [15, 16], s: [17, 18] };
    const flower = G.species({ name: 'flower', seed: seed + 2, vary: { h: [0.22, 0.5], r: [0.12, 0.22], open: [0.55, 0.95], lean: [-0.1, 0.1] }, limits: { h: [0.1, 1.2], r: [0.05, 0.5], open: [0, 1], lean: [-0.4, 0.4] },
      make(Sx, at, v, k) { const h = v.h * k, head = [at[0] + v.lean * h, at[1] + h, at[2] + v.lean * 0.5 * h], yaw = v.rnd() * 6.28;
        Sx.tube([[at[0], at[1] - 0.04, at[2]], head], 0.022 * k, 0.018 * k, STALK, { res: 0.045 });
        Sx.ball([head[0], head[1] + 0.02, head[2]], 0.05 * k, EYE, { res: 0.045 });
        for (const f of G.arrange('rosette', 0, { rings: 2, per: 5, r: v.r * k, open: v.open })) { const q = G.put(f, head, yaw, 1), U = q.dir, L = q.s;
          K.sweep(Sx, [q.p, [q.p[0] + U[0] * L * 0.5, q.p[1] + U[1] * L * 0.5 + 0.01, q.p[2] + U[2] * L * 0.5], [q.p[0] + U[0] * L, q.p[1] + U[1] * L, q.p[2] + U[2] * L]], { w: K.sweep.leaf(L * 0.32, 0.01), h: 0.01, cup: 2 }, PET, { up: norm(cr(U, cr([0, 1, 0.001], U))), res: 0.045 }); } } });
    flower.sow(S, G.scatter(S, { disc: [0.8, 2.2, 8], n: 40, gap: 0.45, shade: [0.7, 1], slope: [0.86, 1], height: [-1, 0.9], size: [0.75, 1.3], where: (x, z) => awayFrom(x, z) && kd(x, z) > 1.1 ? 1 : 0, seed: seed * 5 + 2 }), { instances: 6, sway: { amp: 0.09, sp: 1.6 }, solid: false });
    const FROND = { r: [15, 16, 17], s: [17, 18, 19], root: -0.3 };
    const fern = G.species({ name: 'fern', seed: seed + 3, vary: { h: [0.4, 0.8], r: [0.24, 0.4] }, limits: { h: [0.15, 1.5], r: [0.1, 0.8] },
      make(Sx, at, v, k) { const h = v.h * k, yaw = v.rnd() * 6.28; Sx.tube([[at[0], at[1] - 0.04, at[2]], [at[0], at[1] + h, at[2]]], 0.022 * k, 0.012 * k, FROND, { res: 0.035 });
        for (const f of G.arrange('whorl', 0, { rings: 4, per: 5, r: v.r * k, rise: h / 4.4, taper: 0.62, lift: 0.45 })) { const q = G.put(f, [at[0], at[1] + h * 0.16, at[2]], yaw, 1);
          K.sweep(Sx, [q.p, [q.p[0] + q.dir[0] * q.s * 0.55, q.p[1] + q.dir[1] * q.s * 0.55, q.p[2] + q.dir[2] * q.s * 0.55], [q.p[0] + q.dir[0] * q.s, q.p[1] + q.dir[1] * q.s * 0.5, q.p[2] + q.dir[2] * q.s]], { w: K.sweep.leaf(q.s * 0.22), h: 0.008, fold: 0.25 }, FROND, { up: [0, 1, 0], res: 0.045 }); } } });
    fern.sow(S, G.scatter(S, { disc: [-1.5, -0.5, 8.4], n: 24, gap: 1.0, shade: [0, 0.5], slope: [0.85, 1], size: [0.8, 1.3], where: (x, z) => awayFrom(x, z) ? 1 : 0, seed: seed * 5 + 3 }), { instances: 4, sway: { amp: 0.07, sp: 1.4 }, solid: false });
    // the mound: a low clump of broad leaves arching out from the middle, the inner ones more upright, and a few short sprays of small
    // bells over it. They grow in drifts, thickest at the middle of a drift
    const MLEAF = { r: [15, 16, 16, 17], s: [17, 18, 19], root: -0.3 }, BELL = { r: [4, 5], s: [5, 6, 7] }, BSTEM = { r: [15, 16], s: [16, 17] };
    const mound = G.species({ name: 'mound', seed: seed + 4, vary: { r: [0.3, 0.5], open: [0.6, 0.85], sprays: [0, 3.99], tall: [0.25, 0.45] }, limits: { r: [0.1, 1], open: [0, 1], sprays: [0, 8], tall: [0.1, 1] },
      make(Sx, at, v, k) { const yaw = v.rnd() * 6.28, R0 = v.r * k;
        for (const f of G.arrange('rosette', 0, { rings: 3, per: 6, r: R0, open: v.open })) { const q = G.put(f, [at[0], at[1] + 0.03 * k, at[2]], yaw, 1), U = q.dir, L = Math.max(0.12, q.s * R0 * 1.1);
          const mid = [q.p[0] + U[0] * L * 0.5, q.p[1] + U[1] * L * 0.5 + 0.06 * L, q.p[2] + U[2] * L * 0.5], tip = [q.p[0] + U[0] * L, q.p[1] + U[1] * L * 0.55 - 0.08 * L, q.p[2] + U[2] * L];
          K.sweep(Sx, [q.p, mid, tip], { w: K.sweep.leaf(L * 0.42, 0.012), h: 0.012, cup: 1.4 }, MLEAF, { up: norm(cr(U, cr([0, 1, 0.001], U))), res: 0.06 }); }
        for (let i = 0; i < Math.floor(v.sprays); i++) { const a = yaw + i * 2.2, h = v.tall * k * (0.8 + 0.4 * v.rnd()), b = [at[0] + Math.cos(a) * R0 * 0.25, at[1], at[2] + Math.sin(a) * R0 * 0.25], tp = [b[0] + Math.cos(a) * h * 0.25, b[1] + R0 * 0.5 + h, b[2] + Math.sin(a) * h * 0.25];
          Sx.tube([b, [b[0], b[1] + R0 * 0.4 + h * 0.5, b[2]], tp], 0.015 * k, 0.011 * k, BSTEM, { res: 0.04 });
          for (let j = 0; j < 5; j++) { const t = 0.45 + j * 0.13; Sx.ball([b[0] + (tp[0] - b[0]) * t + Math.cos(a + j * 2.4) * 0.035 * k, b[1] + (tp[1] - b[1]) * t, b[2] + (tp[2] - b[2]) * t + Math.sin(a + j * 2.4) * 0.035 * k], 0.032 * k * (1.1 - 0.4 * (j / 4)), BELL, { res: 0.03 }); } } } });
    const drift = (x, z) => n3(x * 0.3 + 3, z * 0.3, 5);
    mound.sow(S, G.scatter(S, { disc: [0, 1, 8.6], n: 90, gap: 0.62, slope: [0.82, 1], size: [0.8, 1.3], where: (x, z) => awayFrom(x, z) && kd(x, z) > 1.18 && Math.hypot(x, z * 0.9) < 8.4 ? smooth(0.48, 0.66, drift(x, z)) : 0, seed: seed * 5 + 4 }), { instances: 5, sway: { amp: 0.035, sp: 1.3 }, solid: false });

    // ---- the three mushrooms by the wall that will move, grown from the same description, and a camellia whose buds will burst
    const tagged = tag => new Proxy(S, { get: (t, k) => k === 'tube' ? (pts, r0, r1, m, o) => S.tube(pts, r0, r1, m, Object.assign({}, o, { tag })) : k === 'ball' ? (c, r, m, o) => S.ball(c, r, m, Object.assign({}, o, { tag })) : t[k] });
    const MUSH = [];
    [[0.62, 1.2, 1.55], [0.7, 1.3, 1.2], [0.55, 1.35, 1.0]].forEach(([a, d, k], i) => {
      const p = kpt(a, d), at = [p[0], hf(p[0], p[1]) - 0.02, p[1]], v = { h: [0.6, 0.48, 0.42][i], cap: [0.34, 0.3, 0.26][i], spots: [7, 5, 4][i], tip: [0.06, -0.08, 0.1][i], rnd: G.dice(seed + 40 + i) };
      const m = shroomMake(tagged('mush' + i), at, v, k); MUSH.push({ at, top: m.top, s: k * v.cap });
    });
    const WX = SF[0] + SN[0] * 1.25 + 0.2, WZ = SF[1] + SN[1] * 1.25, BX = SF[0] + GT[0] * 1.55 + SN[0] * 0.5, BZ = SF[1] + GT[1] * 1.55 + SN[1] * 0.5, by0 = hf(BX, BZ);
    const CAM = { r: [15, 16], s: [16, 17, 18], leaf: {} };
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU, q = 0.28; S.ball([BX + Math.cos(a) * q, by0 + 0.42 + 0.12 * Math.sin(a * 2), BZ + Math.sin(a) * q], [0.38, 0.32, 0.38], CAM, { ghost: true, res: 0.06, fl: { k: 11, ph: a, sp: 1.2, rg: 0.015 } }); }
    S.ball([BX, by0 + 0.72, BZ], [0.42, 0.34, 0.42], CAM, { ghost: true, res: 0.06, fl: { k: 11, ph: 1, sp: 1.2, rg: 0.015 } });
    const BUD = [];
    [[0.35, 0.95, 0.3], [-0.35, 0.82, 0.38], [0.05, 1.12, 0.12]].forEach(([dx, dy, dz], i) => {
      const c = [BX + dx * SN[0] + dz * SN[0] + dx * GT[0], by0 + dy, BZ + dx * SN[1] + dz * SN[1] + dx * GT[1]];
      S.ball(c, [0.09, 0.13, 0.09], { r: [9, 10], s: [10, 11, 12] }, { res: 0.016, tag: 'bud' + i });
      for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; S.ball([c[0] + Math.cos(a) * 0.11, c[1] + 0.02, c[2] + Math.sin(a) * 0.11], [0.1, 0.04, 0.1], { r: [12, 13], s: [13, 14] }, { res: 0.016, tag: 'bloom' + i, ax: B.frame(-a, 0.35, 0) }); }
      S.ball([c[0], c[1] + 0.04, c[2]], 0.05, { r: [10, 11], s: [11, 12] }, { res: 0.015, tag: 'bloom' + i });
      BUD.push(c);
    });

    // ---- the one who came: small, cloaked in the dark, at the foot of the steps looking up at the gate; a gold scarf out on the wind
    const wy = hf(WX, WZ) - 0.02, face = Math.atan2(-SN[0], -SN[1]), CLOAK = { r: [1, 2, 2], s: [3, 4, 5] };
    const fw = [Math.sin(face), 0, Math.cos(face)], fr = [Math.cos(face), 0, -Math.sin(face)], wp = (f, r, u) => [WX + fw[0] * f + fr[0] * r, wy + u, WZ + fw[2] * f + fr[2] * r];
    S.lathe([WX, wy, WZ], 0.6, t => 0.085 + 0.1 * Math.pow(1 - t, 1.6), { r: CLOAK.r, s: CLOAK.s, mod: (x, y, z) => 0.25 * Math.sin(Math.atan2(z - WZ, x - WX) * 7) }, { res: 0.022, tag: 'cloak' });
    S.ball(wp(0, 0, 0.66), [0.1, 0.11, 0.1], CLOAK, { res: 0.02, tag: 'hood' });
    S.ball(wp(-0.06, 0, 0.74), [0.06, 0.07, 0.06], CLOAK, { res: 0.018, tag: 'hood' });
    S.tube([wp(0.05, 0.17, 0), wp(0.06, 0.18, 1.0), wp(0.11, 0.18, 1.08)], 0.016, 0.014, { r: [8, 9], s: [9, 10] }, { res: 0.018, tag: 'staff' });
    S.tube([wp(-0.03, 0, 0.56), wp(-0.22, -0.18, 0.5), wp(-0.42, -0.42, 0.42), wp(-0.6, -0.68, 0.36)], 0.035, 0.012, { r: [10, 11], s: [12, 13] }, { res: 0.016, tag: 'scarf' });

    // ---- the frog: round, olive in the shade and gold in the sun, pale under the chin, with a sac that will swell (built facing +x)
    const PA = [1.75, 1.75], PB = [3.55, 3.05], FROG = { r: [16, 17, 18], s: [18, 19, 12] }, FS = 1.45;
    const fy = WY + 0.07;
    sculptGardenFrog(S, [PA[0], fy, PA[1]], FS, {
      body: FROG, eye: { r: [0, 1], s: [13, 13] }, throat: { r: [13, 14], s: [14, 14] }
    });

    // ---- the koi: long and pale, gold in patches, its tail a soft fan
    const KC = [2.75, WY - 0.2, 2.65], KR = 1.05;
    const KOI = { r: [11, 12, 14], s: [12, 14], tex: (x, y, z) => n3(x * 9 + 2, y * 9, z * 9) > 0.55 ? 14 : 12 };
    S.ball([KC[0] + KR, KC[1], KC[2]], [0.07, 0.055, 0.22], KOI, { res: 0.014, tag: 'koi' });
    S.ball([KC[0] + KR, KC[1], KC[2] + 0.22], [0.055, 0.04, 0.08], KOI, { res: 0.013, tag: 'koi' });
    S.ball([KC[0] + KR, KC[1], KC[2] - 0.3], [0.012, 0.06, 0.09], { r: [12, 14], s: [14] }, { res: 0.012, tag: 'koi' });
    for (const sg of [-1, 1]) S.ball([KC[0] + KR + sg * 0.08, KC[1] - 0.02, KC[2] + 0.09], [0.055, 0.01, 0.04], { r: [14], s: [14] }, { res: 0.01, tag: 'koi' });

    S.bake();
    // ---- moss over the tops of the rocks and the wall's broken courses
    S.cover(MOSS, { up: 0.72, thick: 0.04, where: (x, y, z) => y > hf(x, z) + 0.15 && !wet(x, z) });

    // ---- the water: the runnel on the knoll, then the pool and its stream, each a still sheet of its own, gold where it holds the sky
    const WATER = { r: [3], em: true, a: 0.62, tex: (x, y, z) => { const v = n3(x * 0.6 + 3, z * 0.6, 2); if (Math.sin(z * 6 + 2 * Math.sin(x * 1.6)) > 0.975 && n3(x * 1.5, z * 1.5, 4) > 0.55) return sh.lit(x, y, z) ? 14 : 6; return sh.lit(x, y, z) ? (v > 0.5 ? 12 : 11) : v > 0.6 ? 4 : v < 0.38 ? 2 : 3; } };
    const RUNY = KH - 0.06;
    S.ground(WATER, { y: RUNY, cx: (SPRING[0] + CE[0]) / 2, cz: (SPRING[1] + CE[1]) / 2, rad: 1.9, edge: 0, res: 0.07, keep: (x, z) => kd(x, z) < 1.0 && lineD(x, z, UPPER) < 0.18 || Math.hypot(x - SPRING[0], z - SPRING[1]) < 0.32 });
    S.bake();
    S.ground(WATER, { y: WY, cx: 2.3, cz: 1.2, rad: 3.5, edge: 0, res: 0.07, keep: (x, z) => (pd(x, z) < 1.3 || lineD(x, z, LOWER) < 0.5) && kd(x, z) > 1.06 && hf(x, z) < WY - 0.02 });
    S.bake();
    S.mask = null;

    // ---- falling water over the wall and down the rocks, and the spray at its foot
    for (let i = 0; i < 380; i++) { const s = rr(-1, 1) * 0.22, x = CE[0] + CN[0] * 0.05 - CN[1] * s, z = CE[1] + CN[1] * 0.05 + CN[0] * s, drop = KH - WY - 0.05;
      stick(x, RUNY, z, UP, rr(0.06, 0.14), rr(0.025, 0.04), P[pick([4, 5, 6, 6, 7])], 2.6, { k: 2, ph: rr(0, 1), sp: drop / 0.75, rg: drop, ex: 0.3 }); }
    for (let i = 0; i < 70; i++) { const a = rr(0, TAU), q = rr(0, 0.35); iso(CF[0] + Math.cos(a) * q, WY + 0.02, CF[1] + Math.sin(a) * q, rr(0.03, 0.06), P[pick([7, 14])], 2.4, { k: 3, ph: rr(0, 1), sp: rr(0.15, 0.3), rg: rr(0.15, 0.4), ex: 1.4, em: true, nd: true }); }
    // ---- the gate's broken top lets go: crumbs and lumps that drop, shrink and are gone before they reach the ground
    for (let i = 0; i < 90; i++) {
      const g = gapAt[i % 2], x = g[0] + rr(-0.3, 0.3) * GT[0] + rr(-0.15, 0.15) * SN[0], y = g[1] + rr(-0.25, 0.1), z = g[2] + rr(-0.3, 0.3) * GT[1] + rr(-0.15, 0.15) * SN[1];
      const rg = y - KH - rr(0.1, 0.6), an = { k: 2, ph: rr(0, 1), sp: rg / rr(2.2, 4.5), rg, ex: -0.8, nd: true }, lump = i % 5 === 0 ? 4 : 1;
      for (let k = 0; k < lump; k++) iso(x + rr(-0.04, 0.04) * (lump > 1), y + rr(-0.03, 0.03) * (lump > 1), z + rr(-0.04, 0.04) * (lump > 1), lump > 1 ? rr(0.035, 0.05) : rr(0.018, 0.03), P[pick([3, 4, 10, 11])], 3, an);
    }

    // ---- lily pads (the frog's two are its own), flowers on a few, reeds at the back of the pool
    const pad = (x, z, s, cols, an) => { const cut = rr(0, TAU); for (let k = 0; k < 90 * s * s + 30; k++) { const t = rr(0, TAU), d = Math.sqrt(rr(0, 1)) * s; if (Math.abs(((t - cut + 9.42) % 6.283) - 3.14) < 0.3) continue;
      disc(x + Math.cos(t) * d, WY + 0.012, z + Math.sin(t) * d, UP, 0.07, 0.016, P[d > s * 0.75 ? cols[0] : cols[1]], 3, an); } };
    const nP0 = B.count(); pad(PA[0], PA[1], 0.4, [16, 17]); const nP1 = B.count(); pad(PB[0], PB[1], 0.42, [16, 17]); const nP2 = B.count();
    for (let i = 0; i < 9; i++) { const a = rr(0, TAU), q = Math.sqrt(rr(0.05, 1)) * 0.9, x = PD[0] + Math.cos(a) * PD[2] * q, z = PD[1] + Math.sin(a) * PD[3] * q;
      if (Math.hypot(x - PA[0], z - PA[1]) < 0.8 || Math.hypot(x - PB[0], z - PB[1]) < 0.8) continue;
      pad(x, z, rr(0.22, 0.34), [15, 16], { k: 6, ph: rr(0, 6), sp: 1.1, rg: 0.008 });
      if (i % 3 === 0) for (let k = 0; k < 6; k++) stick(x + 0.06 * Math.cos(k * 1.05), WY + 0.07, z + 0.06 * Math.sin(k * 1.05), norm([Math.cos(k * 1.05), 1.1, Math.sin(k * 1.05)]), 0.065, 0.028, P[k % 2 ? 13 : 14], 3);
    }
    for (let i = 0; i < 60; i++) { const a = rr(0, TAU), x = PD[0] + Math.cos(a) * PD[2] * rr(0.86, 1.0), z = PD[1] + Math.sin(a) * PD[3] * rr(0.86, 1.0); if (Math.sin(a) > -0.2 || lineD(x, z, LOWER) < 0.6) continue;
      const h = rr(0.5, 1.0), ph = rr(0, 6); stick(x, WY + h / 2, z, norm([rr(-0.1, 0.1), 1, rr(-0.1, 0.1)]), h / 2, 0.02, P[pick([16, 17, 18])], 3, { k: 11, ph, sp: 1.5, rg: 0.05 }); }
    // rings for where the frog lands and the koi goes in, the splash, the petals and the spores: drawn here, kept hidden till wanted
    const ring = (x, z, r) => { const n0 = B.count(), pcs = []; for (let k = 0; k < 36; k++) { const t = k / 36 * TAU, p = [x + Math.cos(t) * r, WY + 0.02, z + Math.sin(t) * r]; pcs.push(p); disc(p[0], p[1], p[2], UP, 0.024, 0.008, P[k % 3 ? 6 : 7], 2.4, { em: true }); } return { ids: [n0, B.count()], pieces: pcs }; };
    const ringA = ring(PA[0], PA[1], 0.34), ringB = ring(PB[0], PB[1], 0.36);
    const LA = 2.4, LEAP = [KC[0] + Math.cos(LA) * KR, WY, KC[2] + Math.sin(LA) * KR], ringK = ring(LEAP[0], LEAP[2], 0.14);
    const drops = (c, n, r, h, cols) => { const n0 = B.count(), pcs = []; for (let k = 0; k < n; k++) { const a = k / n * TAU + rr(-0.2, 0.2), q = r * rr(0.4, 1), p = [c[0] + Math.cos(a) * q, c[1] + rr(0, h), c[2] + Math.sin(a) * q]; pcs.push(p); iso(p[0], p[1], p[2], rr(0.025, 0.045), P[pick(cols)], 2.6, { em: true }); } return { ids: [n0, B.count()], pieces: pcs }; };
    const splash = drops(LEAP, 22, 0.16, 0.06, [7, 14, 6]);
    const petals = BUD.map(c => drops(c, 14, 0.14, 0.06, [12, 13, 14, 13]));
    const spores = MUSH.map(m => drops(m.top, 16, 0.1 + m.s * 0.4, 0.05, [14, 13, 7]));

    // ---- the light: dust turning in the shafts, and leaves coming down out of the crown, gold to the last
    sh.motes(B, 110, [14, 13, 14], { size: 0.013, k: 6, low: -0.2 });
    sh.motes(B, 40, [14, 13], { size: 0.011, k: 3, low: -0.2 });
    for (let i = 0; i < 110; i++) { const a = rr(0, TAU), q = Math.sqrt(rr(0, 1)) * CRW, x = cx + Math.cos(a) * q, z = cz + Math.sin(a) * q, top = cy + rr(-0.8, 0.6), rg = Math.max(0.8, top - hf(x, z) + rr(-0.2, 0.6));
      disc(x, top, z, norm([rr(-1, 1), 1, rr(-1, 1)]), 0.045, 0.012, P[pick([11, 12, 12, 13])], 3, { k: 15, ph: rr(0, 1), sp: rg / rr(7, 12), rg, ex: rr(0.2, 0.55), nd: true }); }

    const W = B.finish({ cam: { target: [-0.2, 2.1, -0.4], dist: 23.5, pitch: 0.34, yaw: 0.42, sway: 0.18 }, detail: 13, palName: 'Garden', dither: 0.3, radius: 10.5,
      fog: { c: 20, start: 0.5, max: 0.45 }, ao: { k: 0.4, range: 0.35 } });
    W.glass = sh.air([13, 12, 14, 13, 12, 13], 0.3, 2);
    const HY = Math.min(...tree.tips.map(t => t.p[1])) - 0.3;
    W.glass.gaps[W.glass.gaps.length - 1] = [lineAt(HY)[0], HY, lineAt(HY)[1], hero[2]];   // (the gate's shaft starts where it leaves the crown)
    const span = r => Array.from({ length: r[1] - r[0] }, (_, i) => r[0] + i);
    W.tags = {};
    for (const k of Object.keys(tags)) W.tags[k] = Int32Array.from(tags[k]);
    Object.assign(W.tags, { padA: Int32Array.from(span([nP0, nP1])), padB: Int32Array.from(span([nP1, nP2])), ringA: Int32Array.from(span(ringA.ids)), ringB: Int32Array.from(span(ringB.ids)), ringK: Int32Array.from(span(ringK.ids)), splash: Int32Array.from(span(splash.ids)) });
    petals.forEach((p, i) => (W.tags['petals' + i] = Int32Array.from(span(p.ids))));
    spores.forEach((p, i) => (W.tags['spores' + i] = Int32Array.from(span(p.ids))));
    W.garden = { PA, PB, fy, FS, KC, KR, LA, LEAP, rings: [ringA.pieces, ringB.pieces, ringK.pieces], WY, BUD, MUSH, splash: splash.pieces, petals: petals.map(p => p.pieces), spores: spores.map(p => p.pieces), cloak: [WX, wy, WZ], face };
    return W;
  }

  function gardenMove(W, seed) {
    const K = KIT, D = K.deform, g = W.garden, T = W.tags;
    if (!g || !T || !T.frog) return W;
    const clamp01 = x => Math.max(0, Math.min(1, x)), ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
    const win = (t, a, b) => clamp01((t - a) / (b - a));
    // a spring let go at time 0: 1 + a decaying wobble
    const boing = (t, f, d) => (t <= 0 ? 0 : Math.exp(-d * t) * Math.cos(f * t));
    const cen = ids => { const c = [0, 0, 0]; for (const i of ids) { c[0] += W.data[i * 16] / ids.length; c[1] += W.data[i * 16 + 1] / ids.length; c[2] += W.data[i * 16 + 2] / ids.length; } return c; };
    const fdir = K.V.norm([g.PB[0] - g.PA[0], 0, g.PB[1] - g.PA[1]]), hop = Math.hypot(g.PB[0] - g.PA[0], g.PB[1] - g.PA[1]), Y0 = Math.atan2(-fdir[2], fdir[0]) * 57.3;
    const FN = [g.PA[0] + 0.2 * g.FS, g.fy + 0.1 * g.FS, g.PA[1]], KN = [g.KC[0] + g.KR, g.KC[1], g.KC[2] + 0.24];   // (the frog's nose and the koi's, as they were built)
    const parts = {
      frog: { ids: T.frog, slices: 4, pivot: [g.PA[0], g.fy + 0.09 * g.FS, g.PA[1]] },
      throat: { ids: T.throat, parent: 'frog', pivot: K.V.add(cen(T.throat), [-0.045 * g.FS, 0.03 * g.FS, 0]) },   // (it swells from where it hangs, under the jaw)
      padA: { ids: T.padA, pivot: [g.PA[0], g.WY, g.PA[1]] }, padB: { ids: T.padB, pivot: [g.PB[0], g.WY, g.PB[1]] },
      ringA: { ids: T.ringA, pieces: g.rings[0] }, ringB: { ids: T.ringB, pieces: g.rings[1] },
      koi: { ids: T.koi, axis: [0, 0, 1], slices: 6, pivot: [g.KC[0] + g.KR, g.KC[1], g.KC[2]] },
      ringK: { ids: T.ringK, pieces: g.rings[2] }, splash: { ids: T.splash, pieces: g.splash, pivot: g.LEAP },
      cloak: { ids: T.cloak, slices: 6, pivot: g.cloak }, hood: { ids: T.hood, parent: 'cloak', pivot: [g.cloak[0], g.cloak[1] + 0.6, g.cloak[2]] },
      scarf: { ids: T.scarf, parent: 'cloak', slices: 5, axis: [-Math.sin(g.face) - Math.cos(g.face), -0.3, -Math.cos(g.face) + Math.sin(g.face)], pivot: [g.cloak[0], g.cloak[1] + 0.56, g.cloak[2]] }
    };
    g.BUD.forEach((c, i) => { parts['bud' + i] = { ids: T['bud' + i], pivot: [c[0], c[1] - 0.1, c[2]] }; parts['bloom' + i] = { ids: T['bloom' + i], pivot: c }; parts['petals' + i] = { ids: T['petals' + i], pieces: g.petals[i], pivot: c }; });
    g.MUSH.forEach((m, i) => { parts['mush' + i] = { ids: T['mush' + i], slices: 4, pivot: m.at }; parts['spores' + i] = { ids: T['spores' + i], pieces: g.spores[i], pivot: m.top }; });
    const petalB = g.petals.map(p => D.burst({ pieces: p, speed: 0.9, up: 0.9, gravity: -0.5, drag: 1.6, shrink: 0.1, life: 2.6 }));
    const sporeB = g.spores.map(p => D.burst({ pieces: p, speed: 0.5, up: 1.6, gravity: 0.25, drag: 1.2, shrink: 0, life: 2.2 }));
    const splashB = D.burst({ pieces: g.splash, speed: 1.4, up: 2.4, gravity: -5, drag: 0.4, shrink: 0.2, life: 0.75 });
    const ripple = g.rings.map(p => D.burst({ pieces: p, speed: 0.55, up: 0, gravity: 0, drag: 1.3, shrink: 0.15, life: 1.4, vary: 0 }));
    const frogSmear = D.smear({ max: 0.22, gain: 0.07, threshold: 1, extent: 0.3, power: 1.4 });
    const koiSmear = D.smear({ max: 0.3, gain: 0.08, threshold: 1.5, extent: 0.4, power: 1.5 });
    const HALF = 4.2, KP = 11, BP = 9, MP = 6;
    K.puppet(W, {
      parts,
      pose(t, dt, pup) {
        const P = pup.pose;
        // -- the frog: lands, sits, turns round, swells its throat till the sac is near as big as its head and lets it go, crouches, and leaps
        const cyc = t % (2 * HALF), leg = cyc < HALF ? 0 : 1, u = cyc - leg * HALF, home = leg ? g.PB : g.PA;
        const spin = ease(win(u, 0.9, 1.25)), yaw = Y0 + (leg === 0 ? 180 : 0) + spin * 180;
        let stretch = 1, waist = 0, sc = [1, 1, 1], pitch = 0, pos = [home[0] - g.PA[0], Math.sin(Math.PI * win(u, 0.9, 1.25)) * 0.06, home[1] - g.PA[1]];
        const land = u < 0.8 ? boing(u, 16, 6) : 0;
        stretch = 1 - 0.4 * land; waist = -0.3 * land;
        const swell = ease(win(u, 1.5, 2.45)), pop = u > 2.45 ? boing(u - 2.45, 24, 6) : 0, sac = u < 2.45 ? 1 + 1.8 * swell * swell : 1 + 0.55 * pop;
        if (u > 1.5 && u < 2.45) { stretch *= 1 - 0.1 * swell; waist -= 0.12 * swell; }
        if (u >= 2.45 && u < 3.1) stretch *= 1 + 0.18 * pop;
        const ac = ease(win(u, 3.1, 3.55));
        if (u >= 3.1 && u < 3.55) { stretch = 1 - 0.45 * ac; waist = -0.3 * ac; pitch = 10 * ac; }
        if (u >= 3.55) {
          // in the air: long along its flight, nose up then down, the back of it smeared out behind
          const T0 = HALF - 3.55, s = win(u, 3.55, HALF), dirv = leg ? -1 : 1, H = 0.75, vy = 4 * H * (1 - 2 * s) / T0, vh = hop / T0;
          pos = [home[0] - g.PA[0] + fdir[0] * hop * s * dirv, 4 * H * s * (1 - s), home[1] - g.PA[1] + fdir[2] * hop * s * dirv];
          const ext = Math.sin(Math.PI * Math.min(1, s * 1.25));
          sc = [1 + 0.5 * ext, 1 - 0.22 * ext, 1 - 0.15 * ext];
          pitch = Math.atan2(vy, vh) * 57.3 * 0.8;
          frogSmear.from([vh, vy, 0]); frogSmear.dir = K.V.norm([vh, vy * 0.5, 0]); frogSmear.front = FN; pup.deform('frog', frogSmear);
        }
        P.frog = { pos, rot: [0, yaw, pitch], scale: sc, stretch, waist };
        P.throat = { scale: sac };
        // the pads: each dips when it is landed on and when it is left, and the water rings out from it
        const pads = ['padA', 'padB'];
        for (let k = 0; k < 2; k++) {
          const arrive = (k === leg ? u : u + HALF) % (2 * HALF), leave = ((k === leg ? u : u + HALF) - 3.55 + 2 * HALF) % (2 * HALF);
          const dip = -0.05 * boing(arrive, 9, 4) * (arrive < 2 ? 1 : 0) - 0.03 * boing(leave, 9, 4) * (leave < 2 ? 1 : 0);
          P[pads[k]] = { pos: [0, dip, 0] };
          const rn = k ? 'ringB' : 'ringA'; ripple[k].t = arrive; P[rn] = arrive < 1.4 ? {} : { show: 0 }; pup.deform(rn, ripple[k]);
        }
        // -- the koi: round and round under the lilies, and once in a while a run, a leap, and the water closing over it
        const kt = t % KP, LT = KP - 1.3, kx = a => [g.KC[0] + Math.cos(a) * g.KR, g.KC[1], g.KC[2] + Math.sin(a) * g.KR];
        let ka, lift = 0, kpitch = 0, karc = 0.3 * Math.sin(t * 7), kst = 1;
        if (kt < LT) { ka = g.LA + 0.1 + (Math.PI * 2 - 0.2) * kt / LT; if (kt > LT - 0.9) karc = 0.75 * Math.sin(t * 17); }
        else {
          const s = (kt - LT) / 1.3, H = 1.15;
          ka = g.LA - 0.1 + 0.2 * s; lift = 4 * H * s * (1 - s); kpitch = -62 * (1 - 2 * s); karc = -0.8 * (1 - 2 * s); kst = 1 + 0.35 * Math.abs(1 - 2 * s);
          koiSmear.from([0, 4 * H * (1 - 2 * s) / 1.3, 1]); koiSmear.dir = [0, 0, 1]; koiSmear.front = KN; pup.deform('koi', koiSmear);
        }
        const kc = kx(ka), k0 = pup.parts.koi.pivot;
        P.koi = { pos: [kc[0] - k0[0], kc[1] + lift - k0[1], kc[2] - k0[2]], rot: [kpitch, 0, 0], turn: K.M.rot([0, 1, 0], -ka), arc: karc, stretch: kst };
        const out = kt - LT, back = (kt - (KP - 0.1) + KP) % KP;
        splashB.t = back; P.splash = back < 0.75 ? {} : { show: 0 }; pup.deform('splash', splashB);
        ripple[2].t = out >= 0 && out < 1.4 ? out : back; P.ringK = ripple[2].t < 1.4 ? {} : { show: 0 }; pup.deform('ringK', ripple[2]);
        // -- the buds: each swells, slow and then shaking with it, till it bursts into the flower, which throws its petals and grows a new bud
        g.BUD.forEach((c, i) => {
          const bt = (t + i * 3.1) % BP, sw = ease(win(bt, 0.5, 4.2)), burst = 4.2, bl = bt - burst;
          if (bt < burst) {
            const sh = bt > 3.3 ? Math.sin(bt * 60) * 0.012 * win(bt, 3.3, 4.2) : 0;
            P['bud' + i] = { scale: 0.35 + 0.65 * ease(win(bt, 0, 0.5)) + 0.0, inflate: 1.1 * sw * sw, stretch: 1 + 0.25 * sw, pos: [sh, 0, sh * 0.7] };
            P['bloom' + i] = { show: 0 }; P['petals' + i] = { show: 0 };
          } else {
            P['bud' + i] = { show: 0 };
            const open = 1 + 0.45 * boing(bl, 13, 5), wilt = 1 - ease(win(bl, 3.8, 4.8));
            P['bloom' + i] = wilt > 0.02 ? { scale: Math.max(0.01, Math.min(1, bl * 9) * open * wilt) } : { show: 0 };
            petalB[i].t = bl; P['petals' + i] = bl < 2.6 ? {} : { show: 0 }; pup.deform('petals' + i, petalB[i]);
          }
        });
        // -- the mushrooms: one at a time each squats, gathering itself, then springs up tall and puffs out a cloud of spores
        g.MUSH.forEach((m, i) => {
          const mt = (t + i * 2.2) % MP, sq = ease(win(mt, 0.4, 1.5)), go = mt - 1.5;
          let st = 1 - 0.3 * sq, wa = -0.35 * sq;
          if (go > 0) { st = 1 + 0.35 * boing(go, 15, 5.5); wa = 0.15 * boing(go, 15, 5.5); }
          P['mush' + i] = { stretch: st, waist: wa };
          sporeB[i].t = go; P['spores' + i] = go > 0 && go < 2.2 ? {} : { show: 0 }; if (go > 0) pup.deform('spores' + i, sporeB[i]);
        });
        // -- the cloak, in the wind: steady, then a gust lifts it out sideways and lets it fall back with a shake
        const gt = t % 7, gust = ease(win(gt, 2.0, 2.6)) * (1 - ease(win(gt, 3.2, 4.4))), shake = gt > 3.2 ? 0.25 * boing(gt - 3.2, 11, 3) : 0;
        const sway = 0.05 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 2.9);
        P.cloak = { bend: [0.16 * gust + sway + shake * 0.3, 0.05 * gust], waist: -0.08 * gust, stretch: 1 + 0.015 * Math.sin(t * 1.7) };
        P.hood = { rot: [0, 0, -4 * gust] };
        // the scarf streams out and snaps back: a wave runs down it, faster and wider in the gust
        P.scarf = { arc: 0.35 * Math.sin(t * 5.5) * (0.4 + gust) + shake, bend: [0.25 * gust + 0.08 * Math.sin(t * 3.1), 0.12 * Math.sin(t * 4.3)], stretch: 1 + 0.12 * gust };
      }
    });
    return W;
  }

  return { id: 'garden', name: 'The Garden', seed: 3, build: sceneGarden, animate: gardenMove };
}

if (typeof module !== 'undefined') module.exports = rebirthGarden;
