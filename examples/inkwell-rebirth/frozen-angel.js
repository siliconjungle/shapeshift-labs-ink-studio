// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthAngel(kit) {
  const { KIT, makeBuilder, makeSculpt } = kit;
  const { makeCharacter, INF } = (typeof module === 'undefined' ? rebirthInfernoSupport : require('./inferno-support.js'))(kit);
  const { attachRebirthDynamics } = (typeof module === 'undefined' ? rebirthMotion : require('./motion.js'))(kit);

  function sceneAngel(seed) {
    // 0 void · 1-9 deep blue, near black to old snow · 10-14 a cold violet-grey, for the shadows of old things and for the angel's hide
    // · 15-16 the crystals' light (and its eyes): the only light here that is its own
    const PAL = [0x05050c, 0x0c0d1f, 0x141a35, 0x1d2b4e, 0x274069, 0x335a8a, 0x4778ab, 0x6d9dcc, 0xa4c8e6, 0xe6f2fb, 0x170f26, 0x2a1c40, 0x40305c, 0x5c4a7a, 0x8574a0, 0x35c3e8, 0xc4f6ff];
    const K = KIT, B = makeBuilder(seed, PAL), { rr, n3, fbm, TAU, norm } = B, ss = INF.ss, G = K.grow, V = K.V;
    const S = K.sculpt(makeSculpt(B));
    S.sun = norm([-0.6, 0.62, 0.3]); S.sunK = 0.62; S.amb = 0.05; S.sky = 0.07; S.res = 0.2; S.shLen = 3;
    // ---- the land: snow in long wind-laid drifts going on into the dark every way; a frozen lake behind the middle; across the near side a
    // crevasse, bridged; ruins to the left, pines to the right
    const START = [-6, 20];
    const LK = [0, -13], LR = [17, 11], LY = 0, A0 = [0, LY, -15];
    const lake = (x, z) => Math.hypot((x - LK[0]) / LR[0], (z - LK[1]) / LR[1]);   // < 1 on the lake
    const far = (x, z) => Math.hypot(x / 1.15, z + 2), rim = (x, z) => ss((far(x, z) - 26) / 24);
    const CRV = INF.path([[-38, 11], [-24, 9], [-12, 12.5], [0, 10], [12, 11.5], [24, 8.5], [38, 10]], false, 10), crev = (x, z) => CRV.near(x, z)[0];
    const BR = [-5, 0];   // the bridge: where it crosses (x) and which way it runs is found from the crevasse
    const drifts = (x, z) => { const wind = x * 0.3 + z * 0.42 + 3.4 * fbm(x * 0.055, z * 0.07 + 5, 1.5, 2), crest = Math.pow(0.5 + 0.5 * Math.sin(wind + 0.3 * Math.sin(wind)), 1.8), swell = 0.7 + 0.7 * fbm(x * 0.09 + 3, z * 0.08, 1.5, 3);
      return 1.3 * swell * crest + 1.2 * (swell - 1); };
    const hf = (x, z) => { const l = lake(x, z), c = crev(x, z);
      let h = LY + 0.25 + ss((l - 1) / 0.5) * (drifts(x, z) + 0.6);   // the lake is level; its shore rises into the drifts
      h -= 7.5 * ss((2.4 - c) / 0.8);                                 // the crevasse
      return h; };
    const onPlain = (x, z, m) => far(x, z) < 27 - m;
    const SNOW = { r: [1, 2, 3, 4, 5, 6], s: [5, 6, 7, 8, 9, 9], g: [7, 8, 16], mod: (x, y, z) => 0.03 * (n3(x * 0.3, z * 0.3, 3) - 0.5) - 1.1 * rim(x, z), tex: (x, y, z) => rim(x, z) > 0.93 ? 0 : undefined };
    const dry = (x, z) => lake(x, z) > 0.98 && crev(x, z) > 2.2;
    // (both grounds keep their depth, so the page can find a hole in either and fill it from the surface round it; they overlap a little)
    S.ground(SNOW, { h: hf, rad: 36, cx: 0, cz: -2, edge: 0, res: 0.24, keep: (x, z) => far(x, z) < 26.6 && dry(x, z) });   // (the two grounds overlap a little: where they only met, the dark showed through between them, a dotted line round the plain)
    S.ground(SNOW, { h: hf, rad: 56, cx: 0, cz: -2, edge: 0.05, res: 0.5, ghost: true, keep: (x, z) => far(x, z) >= 25.7 && rim(x, z) < 0.95 && dry(x, z) });
    // the crevasse's walls: blue ice, laid down them a step at a time by their own length; going dark as they go down
    const ICEW = { r: [0, 1, 2, 3, 4, 5, 6], g: [5, 15, 16], mod: (x, y, z) => 0.15 * Math.sin(y * 3 + 2 * n3(x * 0.4, y * 0.4, z * 0.4)) + 0.1 - 0.09 * Math.max(0, -y) };
    S.add({ bc: [0, 0, 0], br: 90, sd: (x, y, z) => (y - hf(x, z)) * 0.55, sample(f) { const res = this.res; for (let s = 0; s < CRV.tot; s += res) { const a = CRV.at(s); if (rim(a.x, a.z) > 0.9) continue; for (const sg of [-1, 1]) { let py = null; for (let e = 3.0; e > 1.3; ) { const x = a.x - a.tz * sg * e, z = a.z + a.tx * sg * e, y = hf(x, z); f(x, y + 0.05, z); const sl = py === null ? 0 : Math.abs(y - py) / (res * 0.5); py = y; e -= res * 0.5 / Math.sqrt(1 + sl * sl * 0.8); } } } } }, ICEW, { res: 0.22, reach: 0.7 });
    // the bridge: three spans of stone on two piers, a parapet, the deck walkable
    const STONE = { r: [10, 11, 12, 13], s: [11, 12, 13, 14, 8], g: [6, 7, 8], mod: (x, y, z) => 0.14 * (n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) - (Math.abs(((x * 1.1 + 0.37 * Math.floor(y * 2.2)) % 1 + 1) % 1 - 0.5) > 0.46 || Math.abs(((y * 2.2) % 1 + 1) % 1 - 0.5) > 0.44 ? 0.22 : 0) };
    const bs = CRV.near(BR[0], 10.5)[1], ba = CRV.at(bs), bn = [-ba.tz, ba.tx], BX = ba.x, BZ = ba.z, deckY = Math.max(hf(BX + bn[0] * 4.2, BZ + bn[1] * 4.2), hf(BX - bn[0] * 4.2, BZ - bn[1] * 4.2)) + 0.35, bAx = [[bn[0], 0, bn[1]], [0, 1, 0], [ba.tx, 0, ba.tz]];
    S.box([BX, deckY - 0.35, BZ], [5.6, 0.35, 1.5], STONE, { rd: 0.06, ax: bAx, res: 0.13 });
    for (const sg of [-1, 1]) S.box([BX + ba.tx * sg * 1.35, deckY + 0.45, BZ + ba.tz * sg * 1.35], [5.6, 0.45, 0.18], STONE, { rd: 0.05, ax: bAx, res: 0.12 });
    S.box([BX, deckY - 1.6, BZ], [3.6, 0.9, 1.4], STONE, { rd: 0.1, ax: bAx, res: 0.16 }); S.ball([BX, deckY - 2.7, BZ], [3.3, 1.9, 1.6], {}, { neg: true, ax: bAx });   // the arch under the deck
    const onBridge = (x, z) => { const dx = x - BX, dz = z - BZ, u = dx * bn[0] + dz * bn[1], w = dx * ba.tx + dz * ba.tz; return Math.abs(u) < 5.4 && Math.abs(w) < 1.15; };
    // ---- the ruins: a colonnade that has fallen, some columns standing, some broken, drums lying in the snow; an arch still up (built to
    // rule: the lib's pillar and arch)
    const RU = [-17, 1];
    for (let i = 0; i < 7; i++) for (const row of [-1, 1]) { const x = RU[0] - 6 + i * 2.2, z = RU[1] + row * 2.6, standing = (i * 3 + (row > 0 ? 1 : 0)) % 4 !== 0; if (!standing) { for (let j = 0; j < 3; j++) S.lathe([x + j * 1.1 + rr(-0.2, 0.2), hf(x, z) + 0.15, z + rr(-0.6, 0.6)], 0.9, [0.55, 0.55], STONE, { res: 0.13 }); continue; }
      const h = rr(2.5, 6.5) * (i % 3 ? 1 : 0.55); K.build.pillar(S, [x, hf(x, z) - 0.2, z], h, { r: 0.55, flutes: 12, mats: { stone: STONE }, res: 0.16 }); }
    K.build.arch(S, [RU[0] + 3, hf(RU[0] + 3, RU[1]) - 0.2, RU[1]], { span: 4.2, height: 5.4, depth: 0.9, thick: 0.7, face: [0, 1], mats: { stone: STONE }, res: 0.13 });
    // ---- what is older than the angel: a road of stone up to it, rune stones beside the road and in a ring round it in the ice, and the
    // pieces of something like it that fell long ago: a head in its hood, a hand still held up, a wing broken on the snow
    const RUNEO = { r: [4, 5, 15], em: true }, OBS = [];
    const ob = (x, z, h, w, lean, yaw, brk, y0) => { const base = [x, (y0 === undefined ? hf(x, z) : y0) - 0.8, z], U = norm([lean[0], 1, lean[1]]), X0 = [Math.cos(yaw), 0, Math.sin(yaw)], X = norm(V.mad(X0, U, -V.dot(X0, U))), Z = V.cross(X, U);
      const hs = h * (brk ? rr(0.5, 0.75) : 1), pyr = w * 1.3, top = brk ? hs : hs + pyr, w1 = w * (1 - 0.28 * hs / h), hw = a => a <= hs ? w * (1 - 0.28 * a / h) : w1 * Math.max(0, 1 - (a - hs) / pyr);
      const cutN = brk ? norm([rr(-0.7, 0.7), 1, rr(-0.7, 0.7)]) : null, cutP = V.mad(base, U, hs * 0.92);
      const sol = S.add({ bc: V.mad(base, U, top / 2), br: top / 2 + w * 1.6,
        sd(px, py, pz) { const q = [px - base[0], py - base[1], pz - base[2]], a = V.dot(q, U), ac = Math.max(0, Math.min(top, a)); let d = Math.max(Math.max(Math.abs(V.dot(q, X)), Math.abs(V.dot(q, Z))) - hw(ac), -a, a - top) * 0.8;
          if (cutN) d = Math.max(d, V.dot([px - cutP[0], py - cutP[1], pz - cutP[2]], cutN) - 0.45 * (n3(px * 1.4, py * 1.4, pz * 1.4) - 0.5)); return d; },
        sample(f) { const res = this.res; for (let a = 0; a <= top; a += res) { const hh = hw(a); for (const [A, sg, T] of [[X, 1, Z], [X, -1, Z], [Z, 1, X], [Z, -1, X]]) for (let t = -hh; t <= hh; t += res) f(...V.mad(V.mad(V.mad(base, U, a), A, sg * hh), T, t)); }
          if (cutN) for (let u = -w; u <= w; u += res) for (let v = -w; v <= w; v += res) f(...V.mad(V.mad(cutP, X, u), Z, v)); } }, STONE, { res: 0.15 });
      for (const [A, sg] of [[Z, 1], [Z, -1]]) S.engrave(K.poly2.runes(Math.max(2, Math.floor(hs / 1.4)), w * 0.9, (x * 31 + z * 17 + sg * 5) | 0), { on: sol, at: V.mad(V.mad(base, U, 0.8 + hs * 0.5), A, sg * hw(0.8 + hs * 0.5)), n: V.mad([0, 0, 0], A, sg), up: X, depth: 0.08, mat: RUNEO });
      OBS.push([x, z, w * 1.25]); };
    // the road: slabs, two and three across, laid level once and since heaved and broken, some gone; from where you come in to the bridge,
    // and from the bridge down to the shore
    const BE = [-1, 1].map(sg => [BX + bn[0] * sg * 5.9, BZ + bn[1] * sg * 5.9]).sort((a, b) => b[1] - a[1]);
    const ROAD = [INF.path([START, [START[0] + 0.3, (START[1] + BE[0][1]) / 2 + 0.6], BE[0]], false, 6), INF.path([BE[1], [BE[1][0] + 1.2, (BE[1][1] - 2) / 2 + 0.5], [-1.4, -2.6]], false, 6)];
    const onRoad = (x, z, m) => ROAD.some(R2 => R2.near(x, z)[0] < m);
    for (const R2 of ROAD) for (let sl = 0.6; sl < R2.tot - 0.3; sl += 1.25) { const a = R2.at(sl), yaw = Math.atan2(a.tz, a.tx);
      for (let j = -1; j <= 1; j++) { if (rr(0, 1) < 0.16) continue; const x = a.x - a.tz * j * 1.15 + rr(-0.08, 0.08), z = a.z + a.tx * j * 1.15 + rr(-0.08, 0.08), tl = [rr(-0.08, 0.08), rr(-0.08, 0.08)], br2 = rr(0, 1) < 0.2;
        S.box([x, hf(x, z) + rr(-0.12, 0.1), z], [0.56 * (br2 ? 0.6 : 1), 0.2, 0.54], STONE, { rd: 0.05, res: 0.13, ax: [norm([a.tx, tl[0], a.tz]), norm([tl[1], 1, -tl[0]]), norm([-a.tz, tl[1], a.tx])] }); } }
    // rune stones beside the road below the bridge (one broken, one leaning), and seven round the angel standing in the ice
    { const R2 = ROAD[1]; [[0.25, 1, 6.5, 0], [0.3, -1, 7.5, 0.13], [0.8, 1, 5.0, 1], [0.78, -1, 8.2, 0]].forEach(([u, sg, h, kind]) => { const a = R2.at(R2.tot * u); ob(a.x - a.tz * sg * 2.9, a.z + a.tx * sg * 2.9, h, 0.55, kind === 0.13 ? [sg * 0.13, 0.04] : [0, 0], Math.atan2(a.tz, a.tx), kind === 1); });
      for (let k = 0; k < 7; k++) { const a = Math.PI / 2 + (k + 0.5) / 7 * TAU, x = A0[0] + Math.cos(a) * 11.5, z = A0[2] + Math.sin(a) * 11.5 * 0.85; if (Math.abs(Math.cos(a)) < 0.2 && Math.sin(a) > 0) continue;
        ob(x, z, rr(6, 10), rr(0.6, 0.8), k % 3 === 1 ? [rr(-0.15, 0.15), rr(-0.15, 0.15)] : [0, 0], a + Math.PI / 2, k % 3 === 2, LY); } }
    const FACE = { r: [10, 11, 12, 13], s: [12, 13, 14, 8, 9], g: [6, 7], mod: (x, y, z) => 0.18 * (n3(x * 0.5, y * 0.5, z * 0.5) - 0.5), tex: (x, y, z) => Math.abs(n3(x * 0.7, y * 0.7, z * 0.7) - 0.5) < 0.014 ? 10 : undefined };
    // a face, as big as a house: all that is left of an older statue, lying on its back in the snow, its eyes shut, split down one side
    { const C = [15.5, hf(15.5, 3.5) + 1.2, 3.5], f = norm([-0.4, 0.42, 0.8]), u0 = [0.1, 1, 0.1], u = norm(V.mad(u0, f, -V.dot(u0, f))), r = V.cross(u, f), H = q => V.add(C, V.add(V.add(V.mad([0, 0, 0], r, q[0]), V.mad([0, 0, 0], u, q[1])), V.mad([0, 0, 0], f, q[2]))), ax = [r, u, f], DK = { r: [0, 1, 10] };
      S.ball(H([0, 0, 0]), [2.5, 3.4, 1.5], FACE, { ax, res: 0.15 });
      S.tube([H([-1.75, 1.15, 1.05]), H([-0.6, 1.45, 1.42]), H([0, 1.3, 1.5]), H([0.6, 1.45, 1.42]), H([1.75, 1.15, 1.05])], 0.42, 0.42, FACE, { res: 0.12 });   // the brow
      S.tube([H([0, 1.15, 1.5]), H([0, -0.15, 1.95]), H([0, -0.75, 2.05])], 0.32, 0.55, FACE, { res: 0.11 });   // the nose
      for (const sg of [-1, 1]) { S.tube([H([sg * 0.5, 0.72, 1.42]), H([sg * 1.0, 0.62, 1.38]), H([sg * 1.5, 0.8, 1.15])], 0.11, 0.08, DK, { res: 0.06 });   // the shut eyes
        S.ball(H([sg * 1.05, -0.35, 1.05]), [0.9, 0.7, 0.55], FACE, { ax, res: 0.12 }); }   // the cheeks
      S.tube([H([-0.85, -1.45, 1.3]), H([-0.3, -1.3, 1.55]), H([0, -1.38, 1.6]), H([0.3, -1.3, 1.55]), H([0.85, -1.45, 1.3])], 0.08, 0.08, DK, { res: 0.06 });   // the mouth
      S.tube([H([-0.6, -1.75, 1.42]), H([0, -1.7, 1.55]), H([0.6, -1.75, 1.42])], 0.2, 0.2, FACE, { res: 0.09 });   // the lower lip
      S.ball(H([0, -2.55, 1.0]), [1.05, 0.75, 0.7], FACE, { ax, res: 0.12 });   // the chin
      S.tube([H([0.7, 3.3, 0.9]), H([1.05, 1.6, 1.25]), H([0.75, 0.2, 1.45]), H([1.15, -1.4, 1.35]), H([0.8, -3.0, 0.8])], 0.13, 0.08, DK, { res: 0.06 }); }   // split
    // a hand, held up out of the snow, open, the fingers curling; two of them broken off and lying by it
    { const W0 = [-23, hf(-23, -9) + 3.6, -9], d = norm([0.3, 1, 0.1]), side = norm(V.cross(d, [0, 0, 1])), pn = V.cross(side, d);
      S.tube([V.mad(W0, d, -7), W0], 1.5, 1.15, STONE, { res: 0.19 }); S.ball(V.mad(W0, d, 1.5), [1.7, 1.8, 0.85], STONE, { ax: [side, d, pn], res: 0.16 });
      [-1.2, -0.4, 0.4, 1.2].forEach((o, i) => { const k0 = V.mad(V.mad(W0, d, 3.0 - Math.abs(o) * 0.3), side, o), L = [1.4, 1.6, 1.5, 1.15][i], broke = i === 1 || i === 3;
        const k1 = V.mad(V.mad(k0, d, L), pn, 0.3), k2 = V.mad(V.mad(k1, d, L * 0.6), pn, 0.9), k3 = V.mad(V.mad(k2, d, L * 0.15), pn, 0.8);
        S.tube(broke ? [k0, k1] : [k0, k1, k2, k3], 0.48, 0.36, STONE, { res: 0.13 });
        if (broke) { const g = [-23 + (i - 2) * 2.2 + 1.5, -9 + 3.2 + i * 0.4]; S.tube([[g[0], hf(g[0], g[1]) + 0.1, g[1]], [g[0] + 1.3, hf(g[0], g[1]) + 0.25, g[1] + 0.5], [g[0] + 1.9, hf(g[0], g[1]) + 0.6, g[1] + 1.1]], 0.36, 0.27, STONE, { res: 0.12 }); } });
      S.tube([V.mad(V.mad(W0, d, 1.0), side, 1.3), V.mad(V.mad(V.mad(W0, d, 2.2), side, 2.1), pn, 0.6), V.mad(V.mad(V.mad(W0, d, 3.0), side, 2.0), pn, 1.4)], 0.42, 0.3, STONE, { res: 0.12 }); }   // the thumb
    // a wing of stone, broken where it met the shoulder: its bone lying in two pieces and its long feathers fanned out on the snow, some
    // snapped off and scattered
    { const W1 = [19.5, 0, -10.5], dir = norm([0.25, 0, -1]), sd2 = [-dir[2], 0, dir[0]], at = (u, v) => { const x = W1[0] + dir[0] * u + sd2[0] * v, z = W1[2] + dir[2] * u + sd2[2] * v; return [x, hf(x, z), z]; };
      const b0 = at(-5, 0), b1 = at(0, -0.4), b2 = at(0.6, -0.2), b3 = at(6, 0.6);
      S.tube([[b0[0], b0[1] + 0.3, b0[2]], [b1[0], b1[1] + 0.6, b1[2]]], 0.9, 0.75, STONE, { res: 0.16 }); S.tube([[b2[0], b2[1] + 0.5, b2[2]], [b3[0], b3[1] + 0.2, b3[2]]], 0.75, 0.55, STONE, { res: 0.16 });
      const fw = t => 1.35 * (0.2 + 0.8 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.62 + 0.08)), 0.5)) * Math.pow(1 - t, 0.35);
      for (let i = 0; i < 9; i++) { if (i === 3 || i === 6) continue; const u = -4.5 + i * 1.3, q0 = at(u, 0.4), ang = -0.25 + i * 0.07, L = rr(5, 7.5) * (i % 4 === 2 ? 0.55 : 1), dd = norm([sd2[0] * Math.cos(ang) + dir[0] * Math.sin(ang), 0, sd2[2] * Math.cos(ang) + dir[2] * Math.sin(ang)]);
        const q1 = [q0[0] + dd[0] * L * 0.5, 0, q0[2] + dd[2] * L * 0.5], q2 = [q0[0] + dd[0] * L, 0, q0[2] + dd[2] * L]; q1[1] = hf(q1[0], q1[2]) + 0.2; q2[1] = hf(q2[0], q2[2]) + 0.05;
        K.sweep(S, [[q0[0], q0[1] + 0.35, q0[2]], q1, q2], { w: fw, h: 0.16, cup: 0.25 }, STONE, { up: [0, 1, 0], res: 0.16 }); }
      for (let k = 0; k < 4; k++) { const x = W1[0] + rr(-6, 6), z = W1[2] + rr(-5, 5), a = rr(0, TAU), L = rr(1.6, 3); K.sweep(S, [[x, hf(x, z) + 0.15, z], [x + Math.cos(a) * L / 2, hf(x, z) + 0.2, z + Math.sin(a) * L / 2], [x + Math.cos(a) * L, hf(x, z) + 0.1, z + Math.sin(a) * L]], { w: t => 0.9 * Math.pow(Math.sin(Math.PI * (0.15 + 0.7 * t)), 0.6), h: 0.15, cup: 0.2 }, STONE, { up: [0, 1, 0], res: 0.16 }); } }
    const FRAG = [[15.5, 3.5, 6.5], [-23, -9, 5.5], [19.5, -10.5, 8]], clearOf = (x, z) => FRAG.every(([fx, fz, r]) => Math.hypot(x - fx, z - fz) > r) && !onRoad(x, z, 2.6);
    // ---- crystals: clusters of six-sided glass, each with a light at its heart, set round the lake's edge, on the crevasse's lips, in
    // the ruins. (A species: every cluster grows its own number of points at its own lean, on the golden angle)
    const hexSd = (u, v, r) => { const kx = -0.866025, ky = 0.5, kz = 0.57735; let px = Math.abs(u), py = Math.abs(v); const d = 2 * Math.min(kx * px + ky * py, 0); px -= d * kx; py -= d * ky; const cx = Math.max(-kz * r, Math.min(kz * r, px)); return Math.hypot(px - cx, py - r) * Math.sign(py - r); };
    const GLASS = K.look.glass([4, 5, 15, 16], { a: 0.3 }), CORE = { r: [15, 16], em: true };
    const crystal = (base, dir, L, r) => { const D = norm(dir), Ua = norm(V.cross(D, Math.abs(D[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), Va = V.cross(D, Ua);
      S.add({ bc: V.mad(base, D, L / 2), br: L / 2 + r + 0.3, sd: (x, y, z) => { const q = [x - base[0], y - base[1], z - base[2]], a = V.dot(q, D), u = V.dot(q, Ua), v = V.dot(q, Va), rr2 = r * Math.min(1, Math.max(0.02, (L - a) / (r * 1.6))); return Math.max(hexSd(u, v, rr2), -a); },
        sample(f) { for (let a = 0; a < L; a += this.res) { const rr2 = r * Math.min(1, (L - a) / (r * 1.6)); for (let k = 0; k < 6; k++) { const an = k / 6 * TAU + 0.52; for (let w = -0.45; w <= 0.45; w += this.res / Math.max(0.2, rr2)) { const an2 = an + w; f(base[0] + D[0] * a + (Ua[0] * Math.cos(an2) + Va[0] * Math.sin(an2)) * rr2, base[1] + D[1] * a + (Ua[1] * Math.cos(an2) + Va[1] * Math.sin(an2)) * rr2, base[2] + D[2] * a + (Ua[2] * Math.cos(an2) + Va[2] * Math.sin(an2)) * rr2); } } } } }, GLASS, { ghost: true, res: 0.17, reach: 0.3 });
      S.tube([V.mad(base, D, 0.1), V.mad(base, D, L * 0.7)], r * 0.35, r * 0.12, CORE, { ghost: true, res: 0.1 }); };
    const cluster = G.species({ name: 'crystal', seed: seed + 5, vary: { n: [3, 6.99], len: [1.2, 3.2], lean: [0.25, 0.7] }, limits: { n: [1, 14], len: [0.3, 6], lean: [0, 1.2] },
      make(S, at, v, k) { const yaw = v.rnd() * TAU; crystal([at[0], at[1] - 0.2, at[2]], [0.05, 1, 0.05], v.len * k * 1.25, 0.32 * k);
        for (const f of G.arrange('spiral', Math.floor(v.n), { r: 0.6 * k, dome: 0.4 })) { const q = G.put(f, at, yaw, 1), out = norm([q.p[0] - at[0], 0.0001, q.p[2] - at[2]]), d = norm([out[0] * v.lean, 1, out[2] * v.lean]); crystal([q.p[0], at[1] - 0.15, q.p[2]], d, v.len * k * (0.45 + 0.55 * f.s), 0.22 * k * (0.6 + 0.4 * f.s)); } } });
    const CRY = []; for (let k = 0; k < 16; k++) { const a = k / 16 * TAU + rr(-0.15, 0.15), x = LK[0] + Math.cos(a) * LR[0] * rr(1.02, 1.12), z = LK[1] + Math.sin(a) * LR[1] * rr(1.02, 1.12); if (onPlain(x, z, -2) && crev(x, z) > 3) CRY.push([x, z, rr(0.8, 1.4)]); }
    for (let s = 3; s < CRV.tot - 3; s += rr(5, 9)) { const a = CRV.at(s), sg = rr(0, 1) < 0.5 ? -1 : 1, x = a.x - a.tz * sg * 3.1, z = a.z + a.tx * sg * 3.1; if (onPlain(x, z, -4) && Math.hypot(x - BX, z - BZ) > 6) CRY.push([x, z, rr(0.6, 1.1)]); }
    for (let k = 0; k < 4; k++) CRY.push([RU[0] + rr(-6, 6), RU[1] + rr(-3, 3), rr(0.5, 0.9)]);
    for (const [x, z, k] of CRY) if (clearOf(x, z)) cluster.grow(S, [x, hf(x, z), z], k);
    S.box([LK[0], LY - 3.2, LK[1]], [LR[0] + 1, 0.2, LR[1] + 1], { r: [2, 3, 4, 4] }, { res: 0.34 });   // the lake's floor, far down: only dark
    // ---- pines bowed under snow: a trunk and tiers of drooping boughs, each bough a swept blade (a species, sown where the snow is level)
    const BARKP = { r: [10, 11, 12], root: 0.2 }, NEEDLE = { r: [1, 2, 3, 11], s: [2, 3, 4, 12, 13], root: 0.25 };
    const pine = G.species({ name: 'pine', seed: seed + 7, vary: { h: [5, 9], w: [1.6, 2.6], tiers: [4, 6.99], bend: [-0.6, 0.6] }, limits: { h: [2, 14], w: [0.6, 4], tiers: [3, 14] },
      make(S, at, v, k) { const h = v.h * k, w = v.w * k, yaw = v.rnd() * TAU, nt = Math.floor(v.tiers);
        // (twisted: the trunk leans and comes back, as if something had pushed it once and it had grown round it)
        const bx = Math.cos(yaw) * v.bend, bz = Math.sin(yaw) * v.bend, axis = u => [at[0] + bx * h * Math.sin(Math.PI * u) * 0.35, at[1] + h * u, at[2] + bz * h * Math.sin(Math.PI * u) * 0.35];
        S.tube([0, 0.33, 0.66, 1].map(axis).map((p, i) => i ? p : [p[0], p[1] - 0.3, p[2]]), 0.24 * k, 0.05 * k, BARKP, { res: 0.14 });
        for (let i = 0; i < nt; i++) { const u = 0.2 + 0.75 * i / nt, c = axis(u), reach = w * (1 - u * 0.8), per = Math.max(3, Math.round(5 - 2 * u));
          for (let j = 0; j < per; j++) { if (v.rnd() < 0.2) continue; const a = j / per * TAU + yaw + i * 0.9, d = [Math.cos(a), 0, Math.sin(a)], tip = [c[0] + d[0] * reach, c[1] - reach * 0.55, c[2] + d[2] * reach], mid = [c[0] + d[0] * reach * 0.5, c[1] - reach * 0.08, c[2] + d[2] * reach * 0.5];
            K.sweep(S, [[c[0] + d[0] * 0.1, c[1] + 0.1, c[2] + d[2] * 0.1], mid, tip], { w: K.sweep.leaf(reach * 0.3), h: 0.05 * k, cup: 0.6 }, NEEDLE, { up: [0, 1, 0], res: 0.2 }); } } } });
    const pines = G.scatter(S, { box: [5, 27, -6, 22], n: 12, gap: 3.6, slope: [0.8, 1], size: [0.75, 1.3], seed: seed * 3 + 1, where: (x, z) => onPlain(x, z, 1) && lake(x, z) > 1.25 && crev(x, z) > 4 && clearOf(x, z) ? 1 : 0 })
      .concat(G.scatter(S, { box: [-27, -4, -20, 6], n: 6, gap: 3.6, slope: [0.8, 1], size: [0.7, 1.15], seed: seed * 3 + 2, where: (x, z) => onPlain(x, z, 1) && lake(x, z) > 1.3 && Math.hypot(x - RU[0], z - RU[1]) > 8 && clearOf(x, z) ? 1 : 0 }));
    for (const p of pines) pine.grow(S, p.p, p.s);
    S.bake();
    // snow lies on everything that faces up: the stone, the boughs, the bridge
    S.cover({ r: [4, 5, 6], s: [7, 8, 9, 9] }, { up: 0.45, thick: 0.16, lumpy: 0.5, res: 0.22, where: (x, y, z) => y > hf(x, z) + 0.2 || onBridge(x, z) });
    // the lake: ice, clear enough to see down into, cracked, and lying over all of it as glass
    S.terrain(K.look.glass([4, 5, 6, 7, 8], { a: 0.42 }), { h: () => LY, x0: LK[0] - LR[0], x1: LK[0] + LR[0], z0: LK[1] - LR[1], z1: LK[1] + LR[1], keep: (x, z) => lake(x, z) < 1.02, ghost: true, res: 0.22 });
    { const ICE = { r: [6, 7, 8] }; for (let k = 0; k < 900; k++) { const a = rr(0, TAU), q = Math.sqrt(rr(0, 1)), x = LK[0] + Math.cos(a) * LR[0] * q, z = LK[1] + Math.sin(a) * LR[1] * q; if (Math.abs(n3(x * 0.35, z * 0.35, 7) - 0.5) < 0.02 || Math.abs(n3(x * 0.8, z * 0.8, 3) - 0.5) < 0.012) B.iso(x, LY + 0.03, z, 0.09, B.P[k % 3 ? 7 : 8], 3, { nd: true }); } void ICE; }   // cracks in it, pale
    // snow falling, slowly and not much; and lifting off the far drifts into the dark
    for (let k = 0; k < 340; k++) { const x = rr(-30, 30), z = rr(-28, 26), rg = rr(10, 18); if (rim(x, z) > 0.7) continue; B.iso(x, hf(x, z) + rg, z, rr(0.05, 0.08), B.P[k % 4 ? 8 : 7], 2.6, { nd: true, k: 15, ph: rr(0, 1), sp: rr(1.1, 1.7), rg, ex: rr(0.25, 0.5) }); }
    // (nothing lifts off the drifts: the snow coming down is enough)
    K.mist(B, { at: [LK[0], 0, LK[1]], rad: 19, zs: 0.7, y: LY + 0.05, depth: 0.9, n: 240, cols: [2, 3, 11, 4], a: 0.15, size: [1.8, 3.4], drift: 0.7, where: (x, z) => lake(x, z) < 1.1 });   // (a haze on the ice, drifting)
    S.lights.push({ p: [A0[0], LY + 3, A0[2] + 6], r: 18, s: 0.5, c: [15, 16] });
    const walkY = (x, z, y0) => { if (!onPlain(x, z, 1)) return 1e9; if (Math.hypot(x - A0[0], z - A0[2]) < 6.8 || Math.hypot(x - A0[0], z - A0[2] - 5.2) < 1.6) return 1e9; if (onBridge(x, z)) return deckY; if (crev(x, z) < 2.6) return 1e9; if (OBS.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r + 0.35)) return 1e9; if (lake(x, z) < 1) return LY; return S.heightAt(x, z, y0, 8); };

    // =====================================================================
    // The angel. Made where it stands (its own field and light), facing you, on bones: its back, its head, its eyes, its arms, and each wing
    // in three lengths with every long feather of the wingtip on a bone of its own, so that the tip can fan open and shut
    // =====================================================================
    const SG = K.sculpt(makeSculpt(B)), R = K.creature(B, SG), { rot, mul, app, aim, J, use, set } = R;
    SG.sun = norm([-0.45, 0.8, 0.6]); SG.sunK = 0.68; SG.amb = 0.08; SG.sky = 0.1; SG.res = 0.25;
    SG.lights.push({ p: [A0[0], LY + 2, A0[2] + 10], r: 26, s: 0.45, c: [15, 16] }, { p: [A0[0] - 6, LY + 44, A0[2] - 26], r: 56, s: 0.5, c: [8, 9] });   // (the crystals round the lake light it from under; and something high behind it puts a cold edge on it)
    const P = p => [A0[0] + p[0], A0[1] + p[1], A0[2] + p[2]];   // (its own frame: it faces +z, toward where you come from)
    // (it is old: its hide is worn like stone that has stood in weather a long time, cracked, and darker in every crack)
    const crackA = (x, y, z) => Math.abs(n3(x * 0.22 + 3, y * 0.22, z * 0.22) - 0.5) < 0.012 || Math.abs(n3(x * 0.6, y * 0.6 + 9, z * 0.6) - 0.5) < 0.008;
    const worn = (x, y, z) => 0.22 * (n3(x * 0.35, y * 0.35, z * 0.35) - 0.5) + 0.1 * (n3(x * 1.3, y * 1.3, z * 1.3) - 0.5);
    const SNOWT = { min: 0.62, r: [6, 7, 8, 9] }, ROBE = { r: [10, 11, 12, 13], s: [11, 12, 13, 14, 8], top: SNOWT, mod: (x, y, z) => 0.25 * worn(x, y, z), tex: (x, y, z) => crackA(x, y, z) ? 10 : undefined };
    const SKIN = { r: [10, 11, 12, 13], s: [12, 13, 14, 8, 9], mod: (x, y, z) => 0.4 * worn(x, y, z), tex: (x, y, z) => crackA(x, y, z) ? 10 : undefined }, GOLD = { r: [10, 11, 12], s: [11, 12, 13], top: SNOWT, mod: worn };   // (what was ornament is dark now)
    const ICIC = { r: [4, 5, 6, 7], s: [6, 7, 8, 9, 16], mod: (x, y, z) => 0.1 * (n3(x * 2, y * 0.5, z * 2) - 0.5) };
    const FEATH = { r: [10, 11, 12, 13], s: [11, 12, 13, 14, 8], root: 0.45, top: { min: 0.7, r: [6, 7, 8, 9] }, mod: (x, y, z) => 0.25 * worn(x, y, z) }, GOLDF = { r: [12, 13, 14], s: [13, 14, 8, 9], root: 0.2 };   // (the leading edge is frosted, not gilt)
    // (after the guardian angels of old churches: it stands with its head bowed under a hood, both hands on the pommel of a sword whose point
    // is driven down into the ice, and its wings folded high, the bend of each wing above its head and the long feathers falling behind it)
    const BC0 = [[0, -3, 0], [0, 4, 0], [0, 10.5, 0.2], [0, 15.5, 0.2], [0, 18.6, 0.6]].map(P);
    const DR = (o, mat, opts) => INF.drape(SG, Object.assign({ n3 }, o), mat, opts);
    // the robe: a long column of cloth narrowing to the waist, in deep folds that wander as they fall, deepest at the hem
    DR({ c: P([0, -5, 0]), len: 14.2, r: t => 3.3 + 3.1 * Math.pow(1 - t, 2.2), n: 21, amp: t => 0.5 * (1 - t) + 0.12, seed: 3 }, ROBE, { tag: 'ab', res: 0.22 });
    // the breast and shoulders, the cloth drawn up over them to the neck
    DR({ c: P([0, 8.6, 0.2]), len: 8.4, r: t => 3.3 + 0.9 * Math.sin(Math.PI * Math.min(1, t * 0.85)) - 1.6 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.5), n: 12, amp: t => 0.22 * (1 - t) + 0.06, seed: 7 }, ROBE, { tag: 'ab', res: 0.2 });
    for (const sg of [-1, 1]) SG.ball(P([sg * 3.4, 15.6, -0.1]), [1.6, 1.15, 1.6], ROBE, { tag: 'ab', res: 0.2 });
    // the mantle: a shell of cloth from the shoulders round the back to the ice, open at the front, in a few broad folds
    DR({ c: P([0, -4.8, -0.4]), len: 21.3, X: [0, 0, 1], r: t => 6.6 - 3.0 * Math.pow(t, 1.6), n: 9, amp: t => 0.55 * (1 - t) + 0.15, arc: [0.62 * Math.PI, 1.38 * Math.PI], thick: 0.16, seed: 11 }, ROBE, { tag: 'ab', res: 0.22 });
    SG.torus(P([0, 17.3, 0.2]), 2.0, 0.32, GOLD, { tag: 'ab', res: 0.14, ax: [[1, 0, 0], [0, 0, 1], [0, 1, 0]] });   // a collar, gone dark
    // the hood: deep, the face lost in it but for the stone of the chin; two lights come up in it when it wakes
    const HEAD0 = P([0, 18.6, 0.6]), th = q => Object.assign({ tag: 'ah' }, SG.grp(0.35), q);
    SG.ball(P([0, 20.5, 0.2]), [2.5, 2.9, 2.8], ROBE, th());
    SG.ball(P([0, 18.9, 0.0]), [3.4, 1.7, 3.1], ROBE, th());   // where it falls onto the shoulders
    SG.tube([P([0, 21.4, -1.2]), P([0, 23.8, -1.9]), P([0, 25.4, -3.0]), P([0, 25.9, -4.4])], 1.7, 0.12, ROBE, th());   // its peak, tall, bent back at the tip
    SG.tube([P([-1.95, 18.4, 2.5]), P([-1.85, 21.2, 2.9]), P([-0.7, 23.0, 3.3]), P([0, 23.5, 3.45]), P([0.7, 23.0, 3.3]), P([1.85, 21.2, 2.9]), P([1.95, 18.4, 2.5])], 0.62, 0.62, ROBE, th());   // its edge, round the face in a pointed arch
    for (const sg of [-1, 1]) { SG.tube([P([sg * 1.7, 22.6, -0.8]), P([sg * 2.6, 20.9, -0.6]), P([sg * 3.0, 18.7, -0.1])], 0.5, 0.25, ROBE, th());   // folds in it
      SG.tube([P([sg * 2.1, 18.4, 2.4]), P([sg * 2.9, 17.0, 2.2]), P([sg * 3.4, 15.6, 1.2])], 0.7, 0.45, ROBE, th()); }   // its sides, down onto the breast
    SG.ball(P([0, 20.3, 2.9]), [1.6, 2.35, 2.0], {}, th({ neg: true }));   // the opening
    SG.ball(P([0, 20.3, 1.1]), [1.5, 2.2, 1.4], { r: [0, 0, 1] }, th({ res: 0.12 }));   // the dark inside it
    SG.ball(P([0, 18.85, 1.75]), [0.8, 0.5, 0.65], SKIN, th({ res: 0.1, whole: true }));   // the chin, stone
    for (let k = 0; k < 11; k++) { const a = (k / 10 - 0.5) * 2.9, x = Math.sin(a) * 2.2, z = 3.1 + Math.cos(a) * 0.4 - 0.6 * Math.abs(Math.sin(a)), y = 21.0 - Math.cos(a) * 1.0 + 1.5 * Math.cos(a) * Math.cos(a), L = rr(0.5, 1.6);   // icicles off the hood's lip
      SG.tube([P([x, y, z]), P([x * 1.02, y - L, z + 0.05])], 0.13, 0.01, ICIC, { tag: 'ah', res: 0.06 }); }
    // behind the head: a great ring of stone, as the old statues had; a third of it broken away and gone, the rest cracked
    { const HC = P([0, 21.8, -2.6]), RR = 5.4, rt = 0.42, gap = [0.25, 1.15], inGap = a => a > gap[0] && a < gap[1];
      SG.add({ bc: HC, br: RR + 1, sd: (x, y, z) => { const q = [x - HC[0], y - HC[1], z - HC[2]], a = Math.atan2(q[1], q[0]), d = Math.hypot(Math.hypot(q[0], q[1]) - RR, q[2]) - rt * (1 - 0.35 * ss((n3(a * 2.2, 4, 1) - 0.62) / 0.1)); if (inGap(a)) return Math.max(d, Math.min(Math.abs(a - gap[0]), Math.abs(a - gap[1])) * RR); return d; },
        sample(f) { for (let a = -Math.PI; a < Math.PI; a += 0.04) { if (inGap(a)) continue; for (let b = 0; b < TAU; b += 0.4) f(HC[0] + Math.cos(a) * (RR + rt * Math.cos(b)), HC[1] + Math.sin(a) * (RR + rt * Math.cos(b)), HC[2] + rt * Math.sin(b)); } } }, Object.assign({}, GOLD, { fl: { as: 3 } }), { tag: 'ah', res: 0.12 });
      for (let k = 0; k < 9; k++) { const a = gap[1] + 0.3 + k * 0.55, p = [HC[0] + Math.cos(a) * RR, HC[1] + Math.sin(a) * RR - 0.3, HC[2] + 0.1]; if (Math.sin(a) > -0.3) SG.tube([p, [p[0], p[1] - rr(0.5, 1.6), p[2]]], 0.12, 0.01, ICIC, { tag: 'ah', res: 0.06 }); } }
    // the arms: lost in wide sleeves that hang from them in folds; the hands come out of them onto the pommel
    const POM = P([0, 12.2, 5.0]);
    const ARMS = [-1, 1].map(sg => ({ sg, n: sg < 0 ? 'L' : 'R', h: P([sg * 3.7, 15.6, 0.2]), k: P([sg * 4.4, 10.9, 2.2]), f: P([sg * 0.75, 12.4, 4.9]) }));
    for (const a of ARMS) { const ua = V.sub(a.k, a.h), fa = V.sub(a.f, a.k);
      DR({ c: a.h, U: ua, X: [a.sg, 0, 0], len: V.len(ua) * 1.05, r: t => 1.05 + 0.25 * t, n: 6, amp: () => 0.14, seed: 20 + a.sg }, ROBE, { tag: 'au' + a.n, res: 0.18 });
      DR({ c: V.mad(a.k, norm(fa), -0.4), U: fa, X: [0, -1, 0], len: V.len(fa) * 0.82, r: t => 1.15 + 0.85 * t, n: 7, amp: t => 0.12 + 0.18 * t, seed: 30 + a.sg }, ROBE, { tag: 'af' + a.n, res: 0.18 });
      SG.ball([a.f[0], a.f[1] + 0.1, a.f[2]], [0.62, 0.7, 0.88], SKIN, { tag: 'af' + a.n, whole: true, res: 0.09 });
      for (let f = 0; f < 4; f++) SG.tube([[a.f[0] - a.sg * 0.3, a.f[1] + 0.45 - f * 0.28, a.f[2] + 0.55], [a.f[0] - a.sg * 0.95, a.f[1] + 0.42 - f * 0.28, a.f[2] + 0.35], [a.f[0] - a.sg * 1.05, a.f[1] + 0.35 - f * 0.28, a.f[2] - 0.15]], 0.15, 0.12, SKIN, { tag: 'af' + a.n, whole: true, res: 0.07 });   // fingers round the grip
      SG.torus([a.f[0] + a.sg * 0.75, a.f[1] - 0.15, a.f[2] - 0.7], 1.05, 0.24, GOLD, { tag: 'af' + a.n, whole: true, res: 0.12, ax: [norm(fa), [0, 1, 0], [0, 0, 1]] }); }   // manacles
    // the sword: the pommel under its hands, a long grip, a broad guard, the blade going down into the ice and on down through it, with
    // runes cut in it that glow a little
    const BLADE = { r: [10, 11, 12, 13], s: [12, 13, 14, 8], mod: worn }, RUNE = { r: [15, 16], em: true };
    SG.ball(POM, [0.9, 0.7, 0.9], GOLD, { res: 0.1 }); SG.tube([V.add(POM, [0, -0.5, 0]), V.add(POM, [0, -3.2, 0])], 0.42, 0.42, GOLD, { res: 0.1 });
    SG.box(V.add(POM, [0, -3.6, 0]), [3.6, 0.35, 0.55], GOLD, { rd: 0.15, res: 0.1 }); for (const sg of [-1, 1]) SG.ball(V.add(POM, [sg * 3.6, -3.4, 0]), [0.45, 0.6, 0.55], GOLD, { res: 0.1 });
    const bladeSd = (x, y, z) => { const q = [x - POM[0], y - POM[1], z - POM[2]], u = (-q[1] - 3.9) / 22; const w = 1.0 * (1 - 0.55 * Math.max(0, u)) * (u > 0.93 ? (1 - u) / 0.07 : 1), th2 = 0.28 * (1 - 0.5 * Math.max(0, u)); return Math.max(Math.abs(q[0]) - w, Math.abs(q[2]) - th2 * (1 - 0.6 * Math.abs(q[0]) / Math.max(0.1, w)), q[1] + 3.9, -q[1] - 25.9); };
    const blade = SG.add({ bc: V.add(POM, [0, -15, 0]), br: 12, sd: bladeSd, sample(f) { for (let y = -4; y > -26; y -= this.res) for (let x = -1.0; x <= 1.0; x += this.res * 0.7) for (const zz of [-0.3, 0.3]) f(POM[0] + x, POM[1] + y, POM[2] + zz); } }, BLADE, { res: 0.14, reach: 0.4 });
    SG.engrave(K.poly2.runes(7, 0.85, seed * 3 + 1), { on: blade, at: V.add(POM, [0, -8.5, 0.3]), n: [0, 0, 1], up: [1, 0, 0], depth: 0.12, mat: RUNE });
    // chains: from each wrist down to a ring set in the ice, sagging, link by link
    for (const a of ARMS) { const from = [a.f[0] + a.sg * 1.0, a.f[1] - 0.4, a.f[2] - 0.7], to = P([a.sg * 9.5, 0.2, 6.5]), n = 26;
      for (let k = 0; k < n; k++) { const u = (k + 0.5) / n, p = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - 3.5 * Math.sin(Math.PI * u), from[2] + (to[2] - from[2]) * u], d = norm(V.sub(to, from)), side = norm(V.cross(d, [0, 1, 0]));
        SG.torus(p, 0.42, 0.13, GOLD, { tag: k < n * 0.5 ? 'af' + a.n : undefined, res: 0.08, ax: k % 2 ? [d, [0, 1, 0], side] : [d, side, [0, 1, 0]] }); }
      SG.torus(to, 0.9, 0.22, GOLD, { res: 0.1, ax: [[1, 0, 0], [0, 0, 1], [0, 1, 0]] }); }
    // the wings, made open. Their bones (root -> elbow -> wrist -> tip) carry thin arms; every feather is on a bone of its own, so that
    // folded each can hang straight down behind (as a statue's do: a fall of feathers like a cloak) and opening each can come open a little
    // after the one before, the long feathers of the tip last
    const WING = [-1, 1].map(sg => ({ sg, n: sg < 0 ? 'L' : 'R', R0: P([sg * 2.4, 15.8, -2.8]), E0: P([sg * 12, 22.5, -5.2]), W0: P([sg * 21.5, 27.5, -4.8]), T0: P([sg * 33, 33, -3.8]) }));
    const featherW = wide => t => wide * (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.62 + 0.08)), 0.5)) * Math.pow(1 - t, 0.35);   // (narrow at the quill, broad, then drawn to a point)
    const FE = [];   // every feather: { tag, seg, root, d, s (how far out along the wing, 0..1), k (how quick to follow) }
    const feather = (w, seg, s, root, dir, len, wide, mat, res, kq) => { const q = rr(0, 1); if (q < 0.12) return; const broken = q < 0.26, L = len * (broken ? rr(0.45, 0.7) : rr(0.9, 1.08)), curl = q > 0.84 ? rr(0.15, 0.35) : 0;
      const side = norm(V.cross(dir, [0, 0, 1])), tip = V.mad(V.mad(root, dir, L * (1 - curl)), side, L * curl * (rr(0, 1) < 0.5 ? 1 : -1)), mid = V.mad(V.mad(root, dir, L * 0.5), [0, 0, 1], 0.03 * L), tag = 'q' + w.n + FE.length;
      K.sweep(SG, [root, mid, tip], { w: featherW(wide * (broken ? 0.9 : 1)), h: 0.035, cup: 0.35, twist: curl * 0.6 }, mat, { up: [0, 0, 1], tag, res: res || 0.26 });
      FE.push({ w, tag, seg, s, root, d: dir, k: kq }); };
    for (const w of WING) { const sg = w.sg, lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], SEGS = [[w.R0, w.E0], [w.E0, w.W0], [w.W0, w.T0]];
      SEGS.forEach(([a, b], i) => SG.tube([a, b], 0.75 - 0.18 * i, 0.55 - 0.15 * i, FEATH, { tag: 'w' + w.n + i, whole: true }));
      for (let i = 0; i < 11; i++) { const u = i / 10, root = lerp3(w.W0, w.T0, u * 0.95), a = -1.45 + 1.05 * u, d = norm([sg * Math.cos(a) * (0.6 + 0.4 * u), Math.sin(a), -0.08]), len = 9 + 5.5 * Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.15)) - 2.5 * u * u;
        feather(w, 2, 0.66 + 0.34 * u, root, d, len, 0.85, FEATH, 0.25, 16 - 6 * u); }
      for (let i = 0; i < 14; i++) { const u = (i + 0.5) / 14; feather(w, 1, 0.33 + 0.33 * u, lerp3(w.E0, w.W0, u), norm([sg * 0.12, -1, -0.12]), 8.8 - 0.8 * u, 1.05, FEATH, 0.26, 24 - 4 * u); }
      for (let i = 0; i < 6; i++) { const u = (i + 0.5) / 6; feather(w, 0, 0.33 * (0.45 + 0.55 * u), lerp3(w.R0, w.E0, 0.45 + 0.55 * u), norm([sg * 0.05, -1, -0.25]), 6.5 + 1.2 * u, 1.0, FEATH, 0.26, 30); }
      // coverts in rows over the bases of the long feathers, like scales: each row shorter than the one under it and set nearer the bone
      [[0, 6, 4.2], [1, 10, 4.6], [2, 8, 3.8]].forEach(([si, n, len]) => { const [a, b] = SEGS[si]; for (let row = 0; row < 3; row++) for (let i = 0; i < n + row; i++) { const u = Math.min(1, (i + 0.5 + row * 0.33) / (n + row)), root = V.mad(V.mad(lerp3(a, b, u), [0, 0, 1], 0.3 + 0.18 * row), [0, 1, 0], -0.1 * row), d = norm([sg * 0.12, -1, 0.05]), L = len * (1 - 0.3 * row) * (si === 2 ? 1 - 0.45 * u : 1);
        feather(w, si, (si + u) / 3, root, d, L, 0.8 - 0.15 * row, row === 2 ? GOLDF : FEATH, 0.29, 34 - 8 * si - 4 * row); } });
      for (let i = 0; i < 14; i++) { const u = (i + 0.5) / 14, si = i < 5 ? 0 : i < 10 ? 1 : 2, p = lerp3(SEGS[si][0], SEGS[si][1], si === 0 ? u * 2.8 : si === 1 ? (u - 0.36) * 2.8 : (u - 0.71) * 3.4), L = rr(0.6, 1.8); SG.tube([V.add(p, [0, -0.7, 0.5]), V.add(p, [0, -0.7 - L, 0.55])], 0.16, 0.01, ICIC, { tag: 'w' + w.n + si, res: 0.06 }); } }   // icicles off the bones
    SG.bake();

    // ---- the pool, the pilgrim, the finish
    const pool = INF.loose(B, 2200);

    const hero = makeCharacter(B, Object.assign(INF.pilgrim({ cloak: [10, 11, 12, 13], dark: [0, 1, 10], face: [8], fx: 16 }), { res: 0.045, x0: START[0], world: { height: walkY } }), START[1]);
    const W = B.finish({ cam: { target: [START[0], 3, START[1]], dist: 30, pitch: 0.2, yaw: 0.12, sway: 0 }, detail: 10, palName: 'The Frozen Angel', dither: 0, radius: 36, fog: { c: 0, start: 0.5, max: 0.9 }, look: { clean: true, outline: true, pixel: true } });
    hero.bind(W, W.count - hero.total);
    const st = INF.stage(W, pool), parts = K.particles(st, pool, { ground: (x, z) => lake(x, z) < 1 ? LY : hf(x, z) });

    // ---- waking, unfurling, breathing
    const AZ = [];
    const back = R.spine('ab', BC0), AN = { wake: 0, want: 0, fold: 1, fv: 0, eyes: 0, look: [0, -0.5], t: 0, burst: false, far: 0 };
    const scl3 = (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z];
    // a turn that takes one frame (a direction, and a way across it) to another
    const frameTo = (d0, n0, d1, n1) => { const b0 = V.norm(V.cross(d0, n0)), m0 = V.cross(b0, d0), b1 = V.norm(V.cross(d1, n1)), m1 = V.cross(b1, d1);
      const A = [d1, m1, b1], Bm = [d0, m0, b0]; const Rm = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Rm.push(A[0][r] * Bm[0][c] + A[1][r] * Bm[1][c] + A[2][r] * Bm[2][c]); return Rm; };
    const FOLD = w => ({ E: P([w.sg * 5.6, 25.8, -5.6]), Wr: P([w.sg * 8.8, 30.5, -7.6]), T: P([w.sg * 10.2, 8.5, -10.6]) });   // (the bend of the wing high above the head, the hand going down behind)
    const arcLerp = (a, b, u, lift) => { const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; q[2] -= lift * Math.sin(Math.PI * Math.max(0, Math.min(1, u))); return q; };
    let headP = P([0, 22, 1]);
    const pose = (t, dt) => {
      const ch = hero.st, d = Math.hypot(ch.x - A0[0], ch.z - A0[2]);
      AN.far = d > 42 ? AN.far + dt : 0; if (d < 27) AN.want = 1; else if (AN.far > 10) AN.want = 0;
      AN.wake += (AN.want - AN.wake) * Math.min(1, dt * (AN.want ? 0.45 : 0.15));
      // the wings: a spring toward open (or shut), so that they open past open and come back
      const tgt = AN.want ? 0.04 * Math.sin(t * 0.5) - 0.02 : 1, h = Math.min(dt || 0, 1 / 30); const go = ss((AN.wake - 0.25) / 0.35);
      AN.fv += ((AN.want ? (go > 0.01 ? tgt : 1) : 1) - AN.fold) * 26 * h - AN.fv * 5.5 * h; AN.fold = Math.max(-0.25, Math.min(1.05, AN.fold + AN.fv * h));
      if (AN.want && AN.fold < 0.15 && !AN.burst) { AN.burst = true;   // open: the snow comes off them in a storm, and a gust runs out over the snow
        if (K.ascii) AZ.push(K.ascii.zone({ at: () => headP, r: 36, t0: t, grow: 2.8, hold: 5.5, back: 2.6, soft: 4 }));   // (and, where the page draws text, it spreads out from its head over everything near, holds, and draws back)
        for (const w of WING) for (let j = 0; j < 34; j++) { const u = rr(0, 1), p = [w.R0[0] + (w.T0[0] - w.R0[0]) * u, w.R0[1] + (w.T0[1] - w.R0[1]) * u - rr(0, 9), w.R0[2] + rr(-1, 1)]; void p; parts.emit({ p, v: [w.sg * rr(1, 6), rr(-1, 3), rr(1, 6)], drag: 0.6, grav: 1.2, life: rr(2, 3.5), size: rr(0.1, 0.18), streak: 0.06, cols: [7, 6, 6, 5, 4], fade: 0.7 }); }
        for (let j = 0; j < 60; j++) { const a = rr(-1.6, 1.6) + Math.PI / 2, q = rr(7, 10); parts.emit({ p: [A0[0] + Math.cos(a) * q, LY + 0.3, A0[2] + Math.sin(a) * q], v: [Math.cos(a) * rr(6, 11), rr(0.3, 1.5), Math.sin(a) * rr(6, 11)], drag: 0.8, life: rr(1.5, 2.6), size: rr(0.14, 0.24), streak: 0.05, cols: [6, 6, 5, 4, 3], fade: 0.8 }); } }
      if (!AN.want && AN.fold > 0.9) AN.burst = false;
      const fold = AN.fold, open = 1 - Math.max(0, Math.min(1, fold));
      // the body: breathing; rising a little as it wakes
      const br = Math.sin(t * 0.6), PT = BC0.map((p, j) => { const w = j / 4; return [p[0], p[1] + w * (0.25 * br + 0.6 * AN.wake), p[2] - w * 0.4 * (1 - AN.wake)]; });
      back.pose(PT, null, (j, T) => aim(back.T0[j], T));
      // the head: bowed asleep; awake, it looks at you
      const hx = ch.x - PT[4][0], hz = ch.z - PT[4][2], hy = ch.y - (PT[4][1] + 2), hd = Math.hypot(hx, hz), wy = Math.max(-0.9, Math.min(0.9, Math.atan2(hx, hz))), wp = Math.max(-0.75, Math.min(0.2, Math.atan2(hy, hd)));
      AN.look[0] += ((AN.wake > 0.3 ? wy * AN.wake : 0) - AN.look[0]) * Math.min(1, dt * 0.9); AN.look[1] += ((AN.wake > 0.3 ? Math.max(-0.45, wp) : -0.5) - AN.look[1]) * Math.min(1, dt * 0.8);
      const Rh = mul(rot([0, 1, 0], AN.look[0]), rot([1, 0, 0], -AN.look[1])), hj = J(null, Rh, HEAD0, PT[4]); use('ah', hj); headP = hj.at(P([0, 20.4, 1.5]));
      AN.eyes += ((AN.wake > 0.2 ? 1 : 0) - AN.eyes) * Math.min(1, dt * 1.2);
      for (const sg of [-1, 1]) { const n = sg < 0 ? 'L' : 'R', e = AN.eyes, k2 = 0.05 + 1.2 * e + 0.1 * e * Math.sin(t * 3 + sg); use('ae' + n, J(hj, scl3(k2, k2, k2), P([sg * 0.65, 20.6, 2.1]))); }   // (asleep, nothing in the hollows; awake, a light comes up in them)
      // the arms: hands together asleep; awake, they open, palms out
      for (const a of ARMS) { const tgtP = [a.f[0], a.f[1] + 0.15 * br, a.f[2]];   // (the hands stay on the sword)
        const hip = back.JT[3].at(a.h), l1 = V.len(V.sub(a.k, a.h)), l2 = V.len(V.sub(a.f, a.k)), r = K.ik2(hip, tgtP, l1, l2, norm([a.sg, -0.5, -0.3]));
        set('au' + a.n, aim(norm(V.sub(a.k, a.h)), norm(V.sub(r.mid, hip))), a.h, hip); set('af' + a.n, aim(norm(V.sub(a.f, a.k)), norm(V.sub(r.tip, r.mid))), a.k, r.mid); }
      // the wings: the bones between where they are folded and where they are open (on an arc behind, so nothing passes through the body).
      // Each feather: open, it is carried by its bone as it was made; folded, it hangs from where its bone has put it, straight down behind,
      // its face turned toward you; between, each feather goes its own way between the two, on a spring of its own (the long feathers of the
      // tip slowest), so the wing opens in a wave and every feather overshoots a little and comes back
      for (const w of WING) { const F = FOLD(w), u = 1 - Math.max(0, Math.min(1.25, fold)), root = back.JT[3].at(w.R0);
        const E = arcLerp(F.E, w.E0, u, 2), Wr = arcLerp(F.Wr, w.W0, u, 4), Tp = arcLerp(F.T, w.T0, u, 6);
        const lift = Math.max(0, -fold) * 4; Wr[1] += lift; Tp[1] += lift * 2.2;
        const nFold = norm([w.sg * 0.55, 0, 0.85]), nn = norm([nFold[0] * (1 - u), nFold[1] * (1 - u), (1 - u) * nFold[2] + u]);
        const segs = [[w.R0, w.E0, root, E], [w.E0, w.W0, E, Wr], [w.W0, w.T0, Wr, Tp]]; w.cur = [];
        segs.forEach(([a0, b0, a1], i) => { const b1 = [E, Wr, Tp][i], Rm = frameTo(norm(V.sub(b0, a0)), [0, 0, 1], norm(V.sub(b1, a1)), nn); set('w' + w.n + i, Rm, a0, a1); w.cur[i] = { Rm, a0, a1 }; }); }
      const target = 1 - Math.max(0, Math.min(1, fold)), hh = Math.min(dt || 0, 1 / 30);
      for (const f of FE) { if (f.x === undefined) { f.x = target; f.v = 0; }
        f.v += ((target - f.x) * f.k * f.k * 0.06 - f.v * 4.2) * hh * 4; f.x = Math.max(-0.2, Math.min(1.25, f.x + f.v * hh));
        const sgm = f.w.cur[f.seg], at = V.add(app(sgm.Rm, V.sub(f.root, sgm.a0)), sgm.a1), dOpen = app(sgm.Rm, f.d), nOpen = app(sgm.Rm, [0, 0, 1]);
        const dF = norm([f.w.sg * (0.12 + 0.42 * f.s), -1, -0.25 - 0.3 * f.s]), nF = norm([f.w.sg * 0.55, 0, 0.85]), x = f.x, flut = 0.02 * Math.sin(t * 2.1 + f.s * 9) * x;
        const d = norm([dF[0] + (dOpen[0] - dF[0]) * x, dF[1] + (dOpen[1] - dF[1]) * x + flut, dF[2] + (dOpen[2] - dF[2]) * x]), n = norm([nF[0] + (nOpen[0] - nF[0]) * x, nF[1] + (nOpen[1] - nF[1]) * x, nF[2] + (nOpen[2] - nF[2]) * x]);
        set(f.tag, frameTo(f.d, [0, 0, 1], d, n), f.root, at); }
    };
    R.bind(W, pose);
    // the wind: now and then a gust runs over the snow and carries a skin of it with it
    const GUST = { t: 2 };
    W.dynamic = { start: pool.first, count: W.count - pool.first, focus: [hero.st.x, hero.st.y + 0.8, hero.st.z], actor: [hero.st.x, hero.st.z, 1.1, hero.st.y], fixedCam: true, zoomOut: 2.6, height: walkY, hero, state: hero.st, wide: 0, angel: AN,
      update(dt, inp, time) {
        hero.update(dt, inp, time);
        W.anim.update(dt, time);
        GUST.t -= dt; if (GUST.t <= 0) { GUST.t = rr(2.5, 5); const a = rr(-0.4, 0.4) + 0.3, d = [Math.cos(a), 0, Math.sin(a)]; for (let j = 0; j < 40; j++) { const x = hero.st.x + rr(-16, 16) - d[0] * 12, z = hero.st.z + rr(-12, 12) - d[2] * 12; parts.emit({ p: [x, hf(x, z) + rr(0.05, 0.4), z], v: [d[0] * rr(5, 9), rr(0, 0.6), d[2] * rr(5, 9)], drag: 0.3, life: rr(1.5, 3), size: rr(0.06, 0.14), cols: [9, 8, 8, 7], fade: 0.6, streak: 0.06 }); } }
        parts.update(dt, time);
        const ch = hero.st; this.focus = [ch.x, ch.y + 0.8, ch.z]; this.actor = [ch.x, ch.z, 1.1, ch.y]; this.wide = 0;
        this.asciiZ = []; for (let i = AZ.length - 1; i >= 0; i--) { const z = AZ[i].at(time); if (z) this.asciiZ.push(z); else if (time > 1) AZ.splice(i, 1); } this.asciiSoft = 4; this.asciiInk = 16;
        return true; } };
    W.dynamic.update(1 / 60, { move: 0 }, 0);
    return W;
  }

  return { id: 'angel', name: 'The Frozen Angel', seed: 9, build: sceneAngel, animate: attachRebirthDynamics };
}

if (typeof module !== 'undefined') module.exports = rebirthAngel;
