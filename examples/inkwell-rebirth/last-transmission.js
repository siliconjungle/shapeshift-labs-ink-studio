// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthTransmission(kit) {
  const { KIT, makeBuilder, makeSculpt, lilies } = kit;
  const { makeCharacter, INF } = (typeof module === 'undefined' ? rebirthInfernoSupport : require('./inferno-support.js'))(kit);
  const { attachRebirthDynamics } = (typeof module === 'undefined' ? rebirthMotion : require('./motion.js'))(kit);
  const { sculptGardenMushroom, sculptGardenFrog } = (typeof module === 'undefined' ? rebirthGardenSupport : require('./garden-support.js'))(kit);
  const { kanaGlyphs } = (typeof module === 'undefined' ? rebirthKanaGlyphs : require('./kana-glyphs.js'))(kit);

  function sceneTransmission(seed) {
    const palette = [
      0x080913, 0x101423, 0x1b2133, 0x303344, 0x505064, 0x777888,
      0x381b2b, 0x652a37, 0x963f43, 0xc76c56, 0xe6a476, 0xffd8a2, 0xffefd3,
      0x10283a, 0x1a4655, 0x287078, 0x4bb0ac, 0x8ce0c4, 0xd1ffdc,
      0x5f542e, 0x91864d, 0xd1a757, 0xf8cc78, 0x29182a, 0x192d41, 0x331f35,
      0x141924, 0x26343b, 0x3c5a51, 0x5f8070, 0x9dad80, 0xbce892,
      0x352c37, 0x625467, 0x8a7c84, 0xc4b9ac,
      0x283c35, 0x49644d, 0x7f9557, 0xc2cb78, 0x6b3c63, 0xac628b, 0xe294b6, 0xf0ccd9, 0xe0a878, 0x40313e, 0x304552, 0x597277,
      0x142820, 0x233d2d, 0x35583b, 0x4e7546, 0x729651, 0x9daf62,
      0x132f38, 0x164955, 0x207078, 0x319397, 0x6cb8ae, 0xace0c5, 0xe3f9dd,
      0x55586c, 0x88828b, 0xc4ad90
    ];
    const B = makeBuilder(seed, palette), S = KIT.sculpt(makeSculpt(B)), V = KIT.V;
    const { rr, R, TAU, n3, path, norm, smooth, clamp } = B;
    const C = [-0.28, 3.72, 0], light = norm([-0.40, 0.81, 0.43]);
    const radial = a => [Math.cos(a), Math.sin(a), 0];
    const tangent = a => [-Math.sin(a), Math.cos(a), 0];
    const xy = (a, r, z = 0) => [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), z];
    const ramp = (colors, t) => B.P[colors[clamp(Math.floor(t * colors.length), 0, colors.length - 1)]];
    const brightness = (normal, gain) => 0.23 + Math.max(-0.15, V.dot(normal, light)) * gain;
    const copper = [23, 6, 7, 8, 9, 10], steel = [1, 2, 3, 4, 5], warm = [7, 8, 9, 10, 11, 12];
    const cast = { r: [1, 2, 3], s: [2, 3, 4], mod: (x, y, z) => {
      const crack = Math.sin(y * 7.1 + n3(x * 7, z * 7, y * 0.4) * 0.45);
      return 0.53 * (n3(x * 3.5, y * 1.7, z * 3.5) - 0.52) - (crack > 0.96 ? 0.56 : 0);
    } };
    const patina = { r: [6, 7, 8, 9], s: [8, 9, 10], mod: (x, y, z) => 0.45 * (n3(x * 3, y * 1.5, z * 2) - 0.5) };
    const ranges = {}, parts = {};
    const waterY = -0.16, ellipse = [-0.19, 5.05, 5.45, 5.82];
    const eyeField = makeSculpt(B);
    const eyeAxis = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
    eyeField.lathe([C[0], C[1], -1.40], 2.19, k => k < 0.32 ? B.mix(0.63, 3.06, Math.sqrt(k / 0.32)) :
      B.mix(3.06, 2.39, Math.pow((k - 0.32) / 0.68, 4)), { r: [1] }, { ax: eyeAxis });
    eyeField.ready();
    const eyeLight = [C[0], C[1] - 0.45, 0.76];
    const beamDirection = norm([-0.24, -0.54, 0.81]);
    const pillars = [
      { x: -3.52, z: -1.95, height: 3.76 }, { x: 3.06, z: -1.76, height: 3.52 },
      { x: -3.98, z: -4.44, height: 5.24 }, { x: 3.76, z: -4.20, height: 4.63 }
    ];
    const floorAnchor = [4.56, 0.22, -0.48];
    const spawn = [-5.12, 4.72];
    const poolEdge = (x, z) => Math.hypot((x - ellipse[0]) / ellipse[2], (z - ellipse[1]) / ellipse[3]);
    const shelfX = 12.35, shelfZ = 13.1, shelfCenterZ = 0.74;
    const shelfEdge = (x, z) => Math.hypot(x / shelfX, (z - shelfCenterZ) / shelfZ);
    const banks = [[-8.41, -5.20, 2.71, 3.1, 4.3], [7.18, -4.55, 3.24, 3.18, 4.64],
      [8.77, 5.56, 1.21, 2.94, 3.36], [-8.47, 3.25, 0.57, 2.8, 3.11]];
    const groundY = KIT.tab2((x, z) => {
      const grit = n3(0.64 * x, 0.77 * z, 4);
      const rise = banks.reduce((height, [bx, bz, h, rx, rz]) =>
        height + h * Math.exp(-(((x - bx) / rx) ** 2 + ((z - bz) / rz) ** 2)), 0);
      const pond = smooth(1.0, 1.19, poolEdge(x, z));
      const lip = 1 - smooth(0.76, 1.06, shelfEdge(x, z));
      const lane = 0.52 * smooth(2.1, 0.55, Math.abs(x + 5.15)) * smooth(-5.0, 0.7, z);
      return waterY + 0.17 * grit ** 3 + (rise + 0.16 * (grit - 0.38)) * pond * lip * (1 - lane);
    }, [-13.3, 13.3, -13.0, 14.2], 0.12);
    const walkY = (x, z, fromY) => {
      const wet = poolEdge(x, z) < 0.99;
      if (!wet && shelfEdge(x, z) > 1.01) return 1e9;
      const ground = wet ? waterY - 0.16 : groundY(x, z);
      const radius = Math.hypot(x - C[0], z + 1.40);
      const terrace = radius < 7.3 ? terraceField.heightAt(x, z, fromY, 8) : -1e9;
      if (terrace >= 1e9) return terrace;
      const housing = Math.abs(x - C[0]) < 3.14 && z > -1.43 && z < 0.82 ? eyeField.heightAt(x, z, fromY, 8) : -1e9;
      return Math.max(ground, walkField.heightAt(x, z, fromY, 8), terrace,
        meadowField.heightAt(x, z, fromY, 8), cascadeField.heightAt(x, z, fromY, 8), housing);
    };
    const ids = ([lo, hi]) => Array.from({ length: hi - lo }, (_, i) => lo + i);
    function group(name, draw) {
      const start = B.count();
      draw();
      ranges[name] = [start, B.count()];
    }
    function torus(start, end, radius, thickness, depth, colors, pitch = 0.122) {
      const length = (end - start) * radius, turns = Math.ceil(length / pitch);
      const sides = Math.max(5, Math.ceil(TAU * thickness / (pitch * 1.06)));
      for (let i = 0; i <= turns; i++) {
        const a = start + (end - start) * i / turns;
        const r = radial(a), t = tangent(a);
        for (let j = 0; j < sides; j++) {
          const b = TAU * (j + 0.3 * (i & 1)) / sides;
          const normal = [r[0] * Math.cos(b), r[1] * Math.cos(b), Math.sin(b)];
          const p = xy(a, radius + thickness * Math.cos(b), depth + thickness * Math.sin(b));
          const weather = (n3(p[0] * 2, p[1] * 3, p[2] * 5) - 0.5) * 0.23 + rr(-0.075, 0.075);
          const facing = Math.max(0, Math.sin(b));
          const metal = brightness(normal, 0.48) + weather + 0.075 * facing;
          B.dab(...p, normal, t, length / turns * 0.55, Math.max(0.021, TAU * thickness / sides * 0.59), 0.023, ramp(colors, metal), 1);
        }
      }
    }

    // The terrace folds round a deep, blue-green pool with lighter water over the shallows.
    group('water', () => {
      for (let z = -0.85; z <= 11.1; z += 0.26) for (let x = -5.74; x <= 5.45; x += 0.26) {
        const edge = poolEdge(x, z);
        if (edge >= 1.015) continue;
        const bed = n3(x * 0.46, z * 0.39, 4), shallows = smooth(0.63, 1.0, edge);
        const flow = Math.exp(-0.13 * ((x - 2.55) ** 2 + (z - 4.4) ** 2));
        B.dab(x, waterY, z, [0, 1, 0], [1, 0, 0], 0.178, 0.174, 0.014,
          ramp([13, 54, 55, 56, 57], 0.10 + 0.34 * bed + 0.32 * shallows + 0.26 * flow),
          0.20 + 0.31 * shallows + 0.16 * flow, { nd: true });
      }
    });
    const meadowField = drawTransmissionMeadow(B, seed, shelfEdge, poolEdge, groundY);
    // Low platforms and shadowed stanchions carry the weight of the receiver.
    S.sun = light; S.sunK = 0.43; S.amb = 0.13;
    for (const { x, z, height: h } of pillars) {
      S.box([x, h / 2, z], [0.19, h / 2, 0.28], cast, { res: 0.145 });
      S.box([x, 0.27, z], [0.63, 0.27, 0.76], cast, { res: 0.15 });
      for (const y of [0.81, h * 0.63, h - 0.29]) {
        S.box([x, y, z], [0.27, 0.083, 0.34], patina, { res: 0.135 });
        S.box([x, y - 0.13, z], [0.29, 0.035, 0.38], cast, { res: 0.13 });
      }
      S.box([x - 0.13, h * 0.53, z + 0.2], [0.05, h * 0.42, 0.1], cast, { res: 0.124 });
    }
    for (let i = 0; i < 24; i++) {
      const a = rr(0, TAU), d = rr(3.45, 5.45), size = rr(0.11, 0.4);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 0.86;
      if (poolEdge(x, z) < 0.78) continue;
      S.ball([x, size * 0.13, z], [size * 1.7, size * rr(0.29, 0.82), size], cast, { res: 0.12 });
    }
    for (let i = 0; i < 4; i++) S.box([-3.61 + 0.45 * i, 0.052 + 0.035 * i, 1.28 - 0.46 * i],
      [0.35, 0.10, 0.29], cast, { res: 0.115 });
    S.box([floorAnchor[0], 0.075, floorAnchor[2]], [0.31, 0.145, 0.26], cast, { res: 0.105 });
    S.ball([spawn[0], 0.015, spawn[1]], [0.66, 0.21, 0.48], cast, { res: 0.095 });

    const terraceField = buildTransmissionTerrace(B, C, seed);
    const garden = [
      [-6.78, 3.98, 1.22, 0.91], [-3.92, 6.04, 1.05, 0.72], [3.62, 6.48, 1.33, 0.91],
      [6.78, 1.17, 1.29, 1.0], [-6.86, -1.74, 0.96, 0.86], [6.10, 4.75, 0.82, 0.69]
    ];
    for (const [x, z, rx, rz] of garden) {
      const base = groundY(x, z);
      S.ball([x, base, z], [rx, 0.32, rz], { r: [27, 2, 36], s: [2, 36, 37] }, { res: 0.19 });
      for (let i = 0; i < 7; i++) {
        const a = i * TAU / 7;
        S.box([x + rx * 0.91 * Math.cos(a), base + 0.137, z + rz * 0.91 * Math.sin(a)],
          [0.16, 0.16, 0.13], cast, { res: 0.145, round: 0.045 });
      }
    }
    const trunks = [[-7.56, 2.28, 1.53, 0.31], [6.65, -1.06, 1.93, 0.31], [-5.7, -5.92, 1.24, 0.24]];
    for (const [x, z, height, radius] of trunks) {
      const y = Math.max(-0.075, groundY(x, z));
      S.tube([[x, y - 0.12, z], [x, y + height * 0.58, z + 0.09], [x, y + height, z]],
        radius * 0.93, 0.16, { skip: true });
    }
    const walkField = S.modelSource().field;
    // Seed the masonry at wet joints and project each growing step against its supporting surface.
    const oldGrowth = { r: [26, 27, 28], s: [27, 28, 29] };
    const moss = { r: [27, 27, 28], s: [29, 30, 28] };
    for (const [i, x, z, steps] of [[0, -3.52, -1.95, 41], [1, 3.06, -1.76, 31], [2, -3.98, -4.44, 23]]) {
      const creeper = KIT.grow.creep(S, { from: [x + 0.12, 0.57, z + 0.29], dir: [0.09, 1, 0.04],
        step: 0.127, steps, branch: 0.085, depth: 1, every: 2, seed: seed * 17 + i });
      KIT.grow.vine(S, creeper, oldGrowth, moss, { grow: 0.102, r: 0.045, res: 0.118, leafRes: 0.155,
        size: 0.25, leaves: 0.91, seed: seed + i });
    }
    S.bake();
    const terraces = [[-6.13, 0.92, 0.71, 0.45, 0.91], [-4.18, 0.72, 0.46, 0.55, 0.91],
      [-6.48, -3.47, 0.72, 0.57, 1.94], [-4.59, -3.75, 0.62, 0.58, 1.94]];
    plantTransmissionGarden(B, garden.concat(terraces), seed, groundY,
      (x, z) => poolEdge(x, z) > 0.98 && shelfEdge(x, z) < 0.99);
    const { fish, field: cascadeField } = drawTransmissionWater(B, seed, waterY, parts, groundY);
    const frogs = plantTransmissionWildlife(B, seed, waterY, parts, groundY);
    const flyers = makeTransmissionFlyers(B, parts, groundY);
    const deer = makeTransmissionDeer(B, parts, groundY);
    // Reeds at the edges of the flooded floor, where the reflection breaks.
    for (const [x, z] of [[-3.7, 1.85], [3.85, 1.5], [-4.25, -0.25], [2.2, 3.7], [-3.3, 3.14]]) {
      for (let i = 0; i < 12; i++) {
        const offset = rr(-0.38, 0.38), height = rr(0.10, 0.65), lean = offset * rr(0.8, 1.6);
        const blade = path(6, t => [x + offset + lean * t * t, t * height - 0.08, z + offset * 0.65 - t * t * 0.08]);
        B.tube(blade, 0.021, 0.011, [0, 13, 14]);
      }
    }
    // The split outer case is thick enough to hold its silhouette from the side.
    group('housing', () => {
      const sectors = [[-2.92, -1.83], [-1.69, -0.08], [0.07, 1.40], [1.51, 2.99]];
      for (const [start, end] of sectors) {
        torus(start, end, 2.96, 0.31, -0.24, copper);
        torus(start + 0.04, end - 0.034, 3.29, 0.09, -0.24, steel, 0.113);
      }
      torus(0, TAU, 2.64, 0.145, 0.05, [6, 7, 19, 20, 10], 0.09);
      torus(0, TAU, 2.49, 0.088, 0.11, [0, 1, 2, 6, 9], 0.095);
      torus(0, TAU, 2.46, 0.033, 0.22, [6, 8, 9, 10, 11], 0.08);
      torus(0, TAU, 2.91, 0.13, -0.73, steel, 0.12);
      const backDepth = radius => -0.77 - 0.61 * (1 - (radius / 2.94) ** 2);
      for (let r = 0.04; r <= 2.93; r += 0.107) {
        const steps = Math.max(7, Math.ceil(TAU * r / 0.115));
        for (let i = 0; i < steps; i++) {
          const a = TAU * i / steps, sector = (a * 6 / TAU + 0.5) % 1;
          const p = xy(a, r, backDepth(r)), d = radial(a);
          const n = norm([d[0] * r * 0.18, d[1] * r * 0.18, -1]);
          const panel = n3(p[0] * 1.4, p[1] * 1.9, 22), rim = smooth(2.61, 2.92, r);
          const seam = sector < 0.043 || sector > 0.957;
          const colors = r < 0.66 ? [1, 2, 3, 6] : [1, 2, 3, 46, 47, 62];
          B.dab(...p, n, tangent(a), 0.065, 0.063, 0.022,
            ramp(colors, 0.23 + 0.22 * panel + Math.max(0, d[1]) * 0.22 + rim * 0.12 - (seam ? 0.30 : 0)), 1.18);
          if (i % 4 === 0 && r > 0.8 && panel > 0.72 && !seam) {
            B.stick(p[0], p[1], p[2] - 0.033, tangent(a), 0.05, 0.012, B.P[47], 0.95);
          }
        }
      }
      torus(0, TAU, 2.77, 0.095, -0.96, [6, 7, 8, 9, 10], 0.104);
      torus(0, TAU, 2.46, 0.051, -1.03, [2, 3, 46, 47, 52], 0.101);
      torus(0, TAU, 0.65, 0.066, -1.47, [6, 8, 9, 10, 21], 0.074);
      for (let i = 0; i < 12; i++) {
        const a = TAU * i / 12 + 0.14, r = i % 2 ? 2.70 : 2.56;
        B.dab(...xy(a, r, -1.031), [0, 0, -1], radial(a), 0.088, 0.085, 0.058, B.P[8], 1.2);
        B.dab(...xy(a, r, -1.081), [0, 0, -1], tangent(a), 0.066, 0.015, 0.016, B.P[11], 1.12);
      }
      for (let i = 0; i < 6; i++) {
        const a = TAU * i / 6;
        const rib = path(12, t => { const r = 0.77 + t * 1.68; return xy(a, r, backDepth(r) - 0.045); });
        B.tube(rib, 0.060, 0.043, [1, 8, 9, 19, 20]);
      }
      const service = xy(-Math.PI / 2, 0.27, -1.52);
      B.dab(...service, [0, 0, -1], [1, 0, 0], 0.39, 0.24, 0.046, B.P[1], 1.65);
      for (let i = -3; i <= 3; i++) {
        B.stick(service[0] + i * 0.079, service[1] + 0.03, service[2] - 0.049, [0, 1, 0], 0.128, 0.019,
          B.P[i % 3 === 0 ? 20 : 61], 1.16);
      }
    });
    // The front collar turns on the bearing. The rear shell and cable sockets stay fixed.
    group('collar', () => {
      for (const [a, b] of [[-2.92, -1.83], [-1.69, -0.08], [0.07, 1.40], [1.51, 2.99]]) {
        torus(a + 0.02, b - 0.018, 3.12, 0.066, 0.12, warm, 0.103);
      }
      torus(0, TAU, 2.79, 0.047, 0.23, [6, 7, 8, 9, 21, 11], 0.082);
      for (let i = 0; i < 128; i++) {
        const a = TAU * i / 128;
        const r = i % 8 === 0 ? 2.81 : i % 4 === 0 ? 2.85 : 2.90;
        B.dab(...xy(a, r, 0.288), [0, 0, 1], radial(a), i % 4 === 0 ? 0.060 : 0.031, 0.013, 0.013,
          B.P[i % 8 === 0 ? 11 : i % 4 === 0 ? 10 : 6], 1);
      }
      for (let i = 0; i < 12; i++) {
        const a = i * TAU / 12 + 0.22;
        const r = radial(a);
        B.dab(...xy(a, 3.11, 0.14), [0, 0, 1], r, 0.154, 0.106, 0.063, B.P[i % 2 ? 8 : 9], 1);
        B.iso(...xy(a, 3.11, 0.245), 0.048, B.P[11], 1);
        B.dab(...xy(a, 3.11, 0.291), [0, 0, 1], tangent(a), 0.039, 0.007, 0.006, B.P[7], 1);
      }
      for (const [angle, length, color] of [[0.75, 0.57, 22], [3.41, 0.43, 17], [5.33, 0.28, 11]]) {
        for (let i = 0; i < 15; i++) {
          const a = angle + length * i / 15;
          B.dab(...xy(a, 2.96, 0.29), [0, 0, 1], tangent(a), 0.064, i % 4 ? 0.033 : 0.060, 0.016,
            B.P[i % 4 === 0 ? color : 8], 1.2);
        }
      }
    });
    parts.collar = { ids: ids(ranges.collar), pivot: C };

    // Each cable ends at a clevis on the case and a plate bolted to the post or floor.
    const postEye = (index, lowerBy, dx) => {
      const { x, z, height } = pillars[index];
      return [x + dx, height - lowerBy, z + 0.34];
    };
    const terminations = [
      [2.92, postEye(2, 0.29, 0.09), 0.32], [-2.65, postEye(0, 0.35, 0.08), 0.16],
      [0.20, postEye(3, 0.29, -0.09), 0.24], [-0.31, postEye(1, 0.33, -0.09), 0.16],
      [-2.07, [-3.21, 0.73, 0.16], 0.14], [-1.01, [2.94, 0.72, 0.09], 0.13]
    ];
    group('cables', () => {
      for (const [angle, end, sag] of terminations) {
        const start = xy(angle, 3.14, -0.15);
        const cable = KIT.procedural.spans.catenary(start, end, { sag });
        B.tube(path(30, t => cable.sample(t).point), 0.058, 0.051, [2, 3, 6, 8]);
        for (const [point, t] of [[start, 0], [end, 1]]) {
          const { tangent: axis } = cable.sample(t);
          B.iso(...point, 0.112, B.P[8], 1);
          B.stick(...point, axis, 0.17, 0.072, B.P[6], 1);
          B.dab(point[0], point[1], point[2] + 0.081, [0, 0, 1], [1, 0, 0], 0.076, 0.071, 0.026, B.P[10], 1);
          B.iso(point[0], point[1] + 0.016, point[2] + 0.111, 0.025, B.P[11], 1);
        }
      }
    });

    // Tendrils wrap the curved outside of the copper, splitting into new tips as they climb.
    const torusSurface = (x, y, z) => Math.hypot(Math.hypot(x - C[0], y - C[1]) - 2.96, z + 0.24) - 0.31;
    for (const [i, a, turn] of [[0, -2.14, -1], [1, -1.12, 1], [2, 2.47, -1], [3, 0.31, 1]]) {
      const from = xy(a, 3.00, 0.10), d = V.mul(tangent(a), turn);
      const plant = KIT.grow.creep(S, { from, dir: d, on: torusSurface, step: 0.104, hug: 0.048,
        steps: i === 3 ? 15 : 28, every: 2, branch: 0.098, depth: 1, wander: 0.62, seed: seed * 31 + i });
      group('runner' + i, () => {
        for (const stem of plant.paths) {
          for (let k = 1; k < stem.length; k++) {
            const end = stem[k], start = stem[k - 1], p = V.lerp(start, end, 0.5);
            B.born((i === 2 ? 6.8 : 4.5) + (stem.start + k) * 0.127);
            B.stick(...p, V.norm(V.sub(end, start)), V.dist(start, end) * 0.78, 0.034, B.P[k % 3 ? 28 : 29], 1);
          }
        }
        for (const node of plant.nodes) {
          const side = V.mul(V.cross(node.dir, node.n), node.k % 4 === 1 ? -1 : 1);
          const direction = V.norm(V.add(V.mul(side, 0.79), V.add(V.mul(node.n, 0.55), V.mul(node.dir, 0.28))));
          const length = 0.13 + 0.17 * (1 - node.t);
          const tip = V.mad(node.p, direction, length);
          B.born((i === 2 ? 6.96 : 4.66) + node.k * 0.127);
          B.dab(...V.mad(node.p, direction, length * 0.53), node.n, direction, length * 0.50,
            length * 0.24, 0.016, B.P[29 + node.k % 2], 1);
          if (node.k % 3 === 1) B.iso(...tip, 0.028, B.P[31], 0.85, { nd: true, k: 7, ph: node.k, sp: 3.2 });
        }
        B.born(null);
      });
    }

    const lensDepth = r => 0.15 + 0.58 * Math.sqrt(Math.max(0, 1 - (r / 2.41) ** 2));
    group('lens', () => {
      for (let r = 0.038; r < 2.4; r += 0.054) {
        const steps = Math.max(9, Math.ceil(TAU * r / 0.060));
        for (let j = 0; j < steps; j++) {
          const a = TAU * (j + (Math.round(r / 0.054) % 2) * 0.46) / steps;
          const d = radial(a), p = xy(a, r, lensDepth(r));
          const n = norm([d[0] * r * 0.22, d[1] * r * 0.22, 1]);
          const thread = Math.cos(a * 39 + 3.8 * Math.sin(r * 2.05 + a * 3.0) + r * 3.6);
          const glint = smooth(0.63, 0.95, thread) * smooth(0.49, 0.82, r) * (1 - smooth(1.77, 2.08, r));
          const vein = Math.sin(a * 23 - r * 6 + Math.sin(a * 7) * 2) * 0.5 + 0.5;
          const grain = n3(d[0] * r * 7, d[1] * r * 7, r);
          const rim = smooth(1.83, 2.39, r);
          let col;
          if (r > 2.12) col = ramp([0, 6, 7, 9, 10], (1 - rim) * 0.73 + grain * 0.31);
          else {
            const spark = Math.exp(-75 * (r - 0.97 - 0.035 * Math.sin(a * 7)) ** 2) *
              (0.15 + 0.16 * Math.sin(a * 7 + 0.8) ** 2) + Math.exp(-115 * (r - 1.49) ** 2) * 0.14;
            const energy = 0.13 + 0.32 * glint + 0.19 * vein + 0.13 * grain + spark + 0.15 * Math.sin(a + 0.53);
            col = ramp([6, 7, 8, 9, 10, 21, 11, 12], energy);
          }
          B.dab(...p, n, tangent(a), 0.035, 0.035, 0.016, col, 1);
        }
      }
      // A curved reflected strip follows the glass, interrupted by fine scratches.
      for (let i = 0; i < 100; i++) {
        const a = 0.83 + i / 99 * 1.38, r = 1.86 + 0.035 * Math.sin(a * 31);
        if (i % 21 > 16) continue;
        const point = xy(a, r, lensDepth(r) + 0.032);
        B.stick(...point, tangent(a), 0.034 + (i % 8 === 0 ? 0.04 : 0), 0.011, B.P[i % 5 ? 11 : 12], 1);
      }
    });

    // A separate pupil rides just above the curved glass so its gaze and dilation have depth.
    const pupilAt = [C[0], C[1], 0.768];
    group('pupil', () => {
      for (let y = -0.95; y <= 0.96; y += 0.057) for (let x = -0.62; x <= 0.63; x += 0.052) {
        const r = Math.hypot(x / 0.61, y / 0.94);
        if (r > 1.01) continue;
        const band = n3(x * 13, y * 13, 7);
        const color = r > 0.92 ? (band > 0.42 ? 23 : 6) : r > 0.78 ? 23 : band > 0.74 ? 26 : 0;
        B.dab(pupilAt[0] + x, pupilAt[1] + y, pupilAt[2] + 0.009 * (1 - r), [0, 0, 1], [1, 0, 0],
          0.039, 0.039, 0.015, B.P[color], 1);
      }
      for (const [dx, dy, size] of [[-0.23, 0.4, 0.105], [-0.29, 0.26, 0.043], [0.17, -0.54, 0.038]]) {
        B.stick(pupilAt[0] + dx, pupilAt[1] + dy, pupilAt[2] + 0.039, [0.85, 0.45, 0], size, size * 0.5, B.P[11], 1);
      }
    });
    parts.pupil = { ids: ids(ranges.pupil), pivot: pupilAt };

    // Recessed shutter plates with beveled edges and stamped hatching.
    for (let blade = 0; blade < 6; blade++) {
      const angle = TAU * blade / 6 + 0.26, tag = 'shutter' + blade;
      group(tag, () => {
        for (let r = 1.48; r <= 2.49; r += 0.068) {
          const along = (r - 1.48) / 1.01;
          const width = 0.22 + along * 0.66, center = angle + 0.10 * (1 - along);
          const count = Math.ceil(width * r / 0.059);
          for (let j = 0; j <= count; j++) {
            const f = j / count, a = center + (f - 0.5) * width;
            const p = xy(a, r, 0.87 + 0.05 * blade + 0.10 * (1 - along) - 0.35 * along * along);
            const bevel = Math.min(f, 1 - f) < 0.095 || along < 0.048 || along > 0.94;
            const scratch = n3(p[0] * 2.1, p[1] * 2.1, 4) + rr(-0.15, 0.15);
            const seam = Math.abs(((along * 7 + f * 0.24) % 1) - 0.5) < 0.065 && f > 0.15 && f < 0.85;
            const col = bevel ? ramp(warm, 0.16 + 0.36 * f + 0.14 * scratch) :
              seam ? B.P[6] : ramp([23, 6, 7, 8, 9, 10], 0.13 + 0.47 * f + 0.31 * scratch);
            B.dab(...p, [0, 0, 1], tangent(a), 0.045, 0.044, 0.017, col, 1);
          }
        }
      });
      parts[tag] = { ids: ids(ranges[tag]), pivot: xy(angle, 2.3, 0.51) };
    }

    for (let i = 0; i < 72; i++) {
      const a = rr(0, TAU), r = rr(3.3, 5.7), z = rr(-3.3, 1.2), p = xy(a, r, z);
      if (p[1] < 0.45) continue;
      B.stick(...p, [0.2, 0.96, 0.18], rr(0.017, 0.062), rr(0.009, 0.023),
        B.P[R() < 0.15 ? 10 : 4], rr(0.43, 0.83), { nd: true, k: 2, ph: R(), sp: rr(0.08, 0.21), rg: 1.5 });
    }

    // The projected branches stay anchored to the glass while a pulse runs through them.
    const crown = [0, -0.47, 1.16];
    const antlerPaths = [{ points: [[-0.05, -1.51, 1.10], [-0.08, -0.95, 1.14], crown], width: 0.049 }];
    for (const sign of [-1, 1]) {
      const side = (x, y, z = 1.16) => [sign * x, y + (sign > 0 ? x * 0.055 : 0), z];
      const knee = side(0.70, -0.08, 1.22), brow = side(1.05, 0.46, 1.18), tip = side(1.42, 0.98);
      antlerPaths.push(
        { points: [crown, knee, brow, tip, side(1.91, 1.40, 1.05)], width: 0.045 },
        { points: [knee, side(0.52, 0.34, 1.25), side(0.62, 0.89, 1.16)], width: 0.025 },
        { points: [brow, side(1.33, 0.49, 1.25), side(1.74, 0.72, 1.14)], width: 0.024 },
        { points: [tip, side(1.34, 1.37, 1.19), side(1.48, 1.66, 1.09)], width: 0.021 }
      );
    }
    const random = KIT.grow.dice(seed * 97 + 203), antlerDabs = [];
    const antlers = antlerPaths.flatMap(({ points, width }) => {
      const curve = KIT.curve.resample(B.spline(points, 10),
        Math.ceil(points.slice(1).reduce((length, p, i) => length + V.dist(p, points[i]), 0) / 0.044) + 1);
      return curve.map((p, i) => ({
        point: [C[0] + p[0], C[1] + p[1], p[2]],
        axis: V.norm(V.sub(curve[Math.min(curve.length - 1, i + 1)], curve[Math.max(0, i - 1)])),
        width: width * (1 - 0.61 * i / (curve.length - 1)),
        color: B.P[i % 9 === 0 ? 12 : i % 3 === 0 ? 17 : 18],
        distance: Math.min(1, Math.hypot(p[0], p[1] + 0.48) / 2.15),
        rank: 0.04 + 0.49 * random() + 0.41 * Math.min(1, Math.hypot(p[0], p[1] + 0.48) / 2.7), alpha: 0.66 + random() * 0.20
      }));
    });
    const reflectedPoint = p => [p[0], 2 * waterY - p[1], p[2]];
    function stampAntlers(reflected) {
      for (const [i, dab] of antlers.entries()) {
        if (reflected && i % 2) continue;
        const { point, axis, width, color, rank, alpha, distance } = dab;
        const p = reflected ? reflectedPoint(point) : point;
        const dir = reflected ? [axis[0], -axis[1], axis[2]] : axis;
        antlerDabs.push({ id: B.count(), rank, distance, alpha: reflected ? alpha * 0.73 : alpha });
        B.stick(...p, dir, reflected ? 0.062 : 0.042, width, color, 0, { nd: true });
      }
    }
    group('antlers', () => stampAntlers(false));

    // Reflect elected surfaces at lower density. Ghost splats use the corresponding mirrored rig.
    const reflectionNames = ['housing', 'collar', 'lens', 'pupil', 'cables', ...Array.from({ length: 6 }, (_, i) => 'shutter' + i)];
    group('reflection', () => {
      const d = new Array(10);
      for (const name of reflectionNames) {
        const [lo, hi] = ranges[name], start = B.count(), lens = name === 'lens';
        const stride = lens ? 6 : name === 'housing' || name === 'collar' ? 8 : 4;
        for (let i = lo; i < hi; i++) {
          if ((i * 97 + Math.floor(i / 31) * 19) % stride || !B.dabAt(i, d)) continue;
          const [x, y, z, nx, ny, nz,,,, col] = d;
          const normal = [nx, -ny, nz], along = V.norm(V.cross([0, 1, 0], normal), [1, 0, 0]);
          const shade = B.P[col] || B.P[7];
          B.dab(x, 2 * waterY - y, z, normal, along, lens ? 0.10 : 0.096, 0.066, 0.021, shade, 0.79, { nd: true });
        }
        if (parts[name]) parts[name + 'Reflection'] = {
          ids: ids([start, B.count()]), pivot: reflectedPoint(parts[name].pivot)
        };
      }
      stampAntlers(true);
    });

    KIT.mist(B, { at: [-0.8, 0, 4.4], rad: 8.3, zs: 0.64, y: 0.12, depth: 0.54,
      cols: [14, 24, 46], a: 0.075, n: 62, size: [0.78, 1.51], drift: 0.23, where: (x, z) => shelfEdge(x, z) < 0.97 });
    KIT.mist(B, { at: [0.32, 0, -3.23], rad: 6.9, zs: 0.53, y: 1.22, depth: 1.08,
      cols: [1, 24, 46], a: 0.067, n: 29, size: [0.83, 1.67], drift: 0.18 });
    const heroStart = B.count();
    const hero = makeCharacter(B, {
      ...INF.pilgrim({ cloak: [32, 33, 34, 35], dark: [0, 1, 32], face: [3], fx: 17 }),
      res: 0.054, x0: spawn[0], world: { height: walkY, water: (x, z) => poolEdge(x, z) < 1 ? waterY : -99 }
    }, spawn[1]);
    const world = B.finish({
      cam: { target: [-0.24, 2.90, 2.30], dist: 35, yaw: -0.28, pitch: 0.46 },
      detail: 22.8, radius: 23, palName: 'The Last Transmission', dither: 0.11,
      fog: { c: 0, start: 0.57, max: 0.53 }, look: { clean: true, native: true, pixel: true }
    });
    hero.bind(world, heroStart);
    hero.st.face = Math.atan2(C[2] - spawn[1], C[0] - spawn[0]);
    const period = 15.15, tempo = 1.20;
    const stage = KIT.stage(world);
    const phaseAt = elapsed => Math.max(0, elapsed) * tempo % period;
    const relative = sceneTime => phaseAt(sceneTime - (stage.t0 ?? sceneTime));
    const gate = (start, end) => ({ start: start / tempo, duration: (end - start) / tempo, every: period / tempo });
    const envelope = (t, start, attack, release, end) => smooth(start, attack, t) * (1 - smooth(release, end, t));
    const aperture = t => envelope(t, 0.21, 4.22, 12.53, 14.75);
    const charge = t => envelope(t, 0.68, 6.3, 12.60, 14.78);
    const rippleCapacity = 6;
    const tracks = KIT.ripple.field({ amplitude: 0.31, scale: 0.49, width: 0.85, speed: 2.85, damping: 0.34,
      capacity: rippleCapacity });
    const wakes = [];
    let stepDistance = 0, foot = 1;
    const wading = ({ x, y, z, ground }) => ground && y < waterY + 0.08 && poolEdge(x, z) < 0.99;
    function wakeAt(time, before, after, dt) {
      while (wakes.length && time - wakes[0].at > 3.0) tracks.remove(wakes.shift().id);
      if (!wading(after)) {
        stepDistance = 0;
        return;
      }
      const distance = Math.hypot(after.x - before.x, after.z - before.z);
      const speed = distance / dt;
      const landed = !before.ground && before.vy < -0.3;
      const entered = !wading(before) && distance > 0.015;
      const dash = after.dash > 0 && after.dashAge >= 0;
      const dashStart = dash && (before.dash <= 0 || before.dashAge < 0);
      stepDistance += distance;
      const stride = dash ? 1.09 : 0.58 + 0.043 * Math.min(speed, 6);
      if (stepDistance < stride && !landed && !entered && !dashStart) return;
      if (wakes.length >= rippleCapacity) tracks.remove(wakes.shift().id);
      foot *= -1;
      const offset = 0.085 * foot;
      const at = [after.x - Math.sin(after.face) * offset, waterY, after.z + Math.cos(after.face) * offset];
      const strength = landed ? clamp(0.78 - before.vy * 0.13, 0.85, 1.55) :
        dash ? 1.12 : clamp(0.25 + speed * 0.10, 0.42, 0.87);
      wakes.push({ id: tracks.add({ at, start: time, strength }), at: time });
      stepDistance = 0;
    }
    world.reflectivePool = {
      ranges: new Int32Array([...ranges.water, ...ranges.reflection]), level: waterY, ellipse, ripple: tracks,
      time: sceneTime => sceneTime, charge: time => charge(relative(time))
    };
    world.grow = { rate: tempo, fade: 0.38, loop: period };
    // Ease between scan directions, including the gaps between their readouts.
    const sensor = { weight: 0, gaze: [0, 0] };
    function trackSubject(dt, time, reset = false) {
      const delta = V.sub([hero.st.x, hero.st.y + 0.62, hero.st.z], eyeLight);
      const distance = V.len(delta), face = delta[2] / Math.max(Math.hypot(delta[0], delta[2]), 0.001);
      const near = (1 - smooth(13.7, 16, distance)) * smooth(0.22, 0.53, face) *
        (1 - smooth(-0.48, -0.12, delta[1]));
      const speed = reset ? 1 : 1 - Math.exp(-dt * 6.5);
      const gazeSpeed = reset ? 1 : 1 - Math.exp(-dt * 4.0);
      sensor.weight += (near - sensor.weight) * speed;

      const t = relative(time), lead = 0.29;
      const upcoming = targets.findIndex(target => t < target.at - lead);
      const index = upcoming < 0 ? targets.length - 1 : upcoming - 1;
      const current = targets[index];
      const resting = V.lerp(beamDirection, V.norm(delta, beamDirection), sensor.weight);
      const aim = target => target && !target.player ? V.norm(V.sub(target.point(), eyeLight), beamDirection) : resting;
      const arrival = current ? smooth(current.at - lead, current.at + 0.24, t) : 1;
      let direction = aim(current);
      if (arrival < 1) direction = V.lerp(aim(targets[index - 1]), direction, arrival);
      if (index === targets.length - 1) direction = V.lerp(direction, resting, smooth(current.end, current.end + 0.65, t));
      sensor.gaze[0] += (clamp(direction[0] * 0.32, -0.17, 0.17) - sensor.gaze[0]) * gazeSpeed;
      sensor.gaze[1] += (clamp(direction[1] * 0.20, -0.090, 0) - sensor.gaze[1]) * gazeSpeed;
      world.glass.dir = V.norm(V.lerp(world.glass.dir, direction, speed));
    }
    world.glass = {
      mode: 'gaps', at: [eyeLight[0], 1.85, 4.0], r: 11, floor: waterY, dir: beamDirection,
      gaps: [[eyeLight[0] - 0.47, eyeLight[1] + 0.20, eyeLight[2] - 0.02, 0.42],
        [...eyeLight, 0.53], [eyeLight[0] + 0.40, eyeLight[1] - 0.05, eyeLight[2] - 0.04, 0.36]],
      cols: [15, 16, 15], steps: 96, softness: 0.91,
      k: time => 0.59 * envelope(relative(time), 0.44, 1.24, 12.83, 14.61)
    };
    const puppet = KIT.puppet(world, {
      parts,
      pose(clock, dt, rig) {
        const t = phaseAt(clock);
        const windup = envelope(t, 0.12, 0.38, 0.38, 0.59);
        const turn = 0.83 * envelope(t, 0.46, 4.25, 12.1, 14.76) - 0.11 * windup +
          0.088 * envelope(t, 4.32, 4.73, 4.90, 5.45) + 0.31 * envelope(t, 5.36, 6.12, 8.0, 8.55);
        rig.pose.collar = { turn: KIT.M.rot([0, 0, 1], turn) };
        rig.pose.collarReflection = { turn: KIT.M.rot([0, 0, 1], -turn) };
        // A small horizontal adjustment before lock, followed by a single dilation change.
        const look = envelope(t, 2.55, 3.64, 4.4, 5.64) * (1 - sensor.weight);
        const locked = envelope(t, 5.38, 6.48, 12.61, 14.70);
        const gaze = [0.13 * look + sensor.gaze[0] * (0.76 + 0.24 * locked), 0.018 * look + sensor.gaze[1], 0.018];
        const size = 0.93 + 0.11 * aperture(t) - 0.25 * locked;
        const pupilScale = [size * (1 - 0.09 * locked), size, 1];
        rig.pose.pupil = { pos: gaze, scale: pupilScale };
        rig.pose.pupilReflection = { pos: [gaze[0], -gaze[1], gaze[2]], scale: pupilScale };
        for (let i = 0; i < 6; i++) {
          const delay = (i % 3) * 0.09, angle = TAU * i / 6 + 0.26;
          const open = aperture(t - delay) + 0.13 * envelope(t - delay, 4.31, 4.7, 4.7, 5.35);
          const pos = [Math.cos(angle) * open * 0.31, Math.sin(angle) * open * 0.31, -0.30 * open];
          const name = 'shutter' + i;
          rig.pose[name] = { pos };
          rig.pose[name + 'Reflection'] = { pos: [pos[0], -pos[1], pos[2]] };
        }
        poseTransmissionWildlife(rig.pose, clock, t, tempo, fish, frogs, envelope);
        poseTransmissionFlyers(rig.pose, clock, flyers);
        const graze = envelope(clock % 7.8, 1.13, 1.84, 4.10, 4.85);
        rig.pose.deer = { rot: [0, deer.yaw, 0] };
        rig.pose.deerNeck = { rot: [0, 5 * Math.sin(clock * 0.9), -106 * graze] };
        rig.pose.deerSkull = { rot: [0, 7 * Math.sin(clock * 1.23 + 0.4), -6 * graze - 3 * Math.sin(clock * 4.7)] };
        rig.pose.deerTail = { rot: [0, 19 * Math.sin(clock * 3.7) * Math.pow(Math.sin(clock * 0.81), 6), 0] };
      }
    });
    let lastVisibility = -1;
    const revealAntlers = (visibility, pulse = -1) => {
      if (!visibility && visibility === lastVisibility) return;
      lastVisibility = visibility;
      for (const { id, rank, alpha, distance } of antlerDabs) {
        const glow = 1 - smooth(0.015, 0.24, Math.abs(pulse - distance));
        world.data[id * 16 + 3] = alpha * smooth(rank, rank + 0.055, visibility) * (0.71 + 0.78 * glow);
        stage.touch(id);
      }
    };
    stage.add({ update(dt, time) {
      const t = phaseAt(time);
      const visibility = envelope(t, 7.48, 8.04, 10.52, 11.54);
      revealAntlers(visibility, t < 9.65 ? (t - 7.73) / 0.94 : (t - 9.62) / 0.68);
    } });
    stage.resetClock = time => {
      stage.t0 = time;
      revealAntlers(0);
      tracks.clear();
      wakes.length = 0;
      stepDistance = 0;
      trackSubject(0, time, true);
    };

    const lens = { object: 'iris' }, casing = { object: 'housing' };
    const housingBounds = { min: [C[0] - 3.43, C[1] - 3.43, -0.9], max: [C[0] + 3.43, C[1] + 3.43, 0.44] };
    const lensBounds = { min: [C[0] - 2.46, C[1] - 2.46, 0.1], max: [C[0] + 2.46, C[1] + 2.46, 0.78] };
    const clock = { rate: tempo, loop: period };
    const curve = keys => ({ keys, ease: 'smooth' });
    const lock = ({ sceneTime }) => relative(sceneTime);
    const strips = [
      { at: 5.79, end: 6.43, band: [0.23, 0.127], slip: -0.12, zoom: 0.58, name: 'RIM 04',
        probe: xy(2.13, 1.52, 0.67), shift: [-65, -25],
        palette: ['#09061b', '#24145e', '#7454f5', '#86d0ff', '#ebffef'] },
      { at: 5.91, end: 6.57, band: [0.46, 0.188], slip: 0.12, zoom: 0.69, name: 'IRIS 09',
        probe: { part: 'pupil', point: pupilAt }, shift: [37, -28],
        palette: ['#070719', '#3a1b63', '#b93f94', '#ffa873', '#fff3b9'] },
      { at: 6.07, end: 6.66, band: [0.70, 0.118], slip: -0.09, zoom: 0.67, name: 'LENS 07',
        probe: xy(4.01, 1.21, 0.73), shift: [-68, 18],
        palette: ['#05091c', '#10354a', '#346bb4', '#56d3da', '#ddfff0'] }
    ];
    const scanProgress = (context, strip) => envelope(lock(context), strip.at, strip.at + 0.15, strip.end - 0.21, strip.end);
    const scanFocus = (context, strip) => context.project.point(strip.probe);
    const rearCenter = [C[0], C[1], -1.39];
    function lensVisible(context) {
      const front = context.project.point(pupilAt), rear = context.project.point(rearCenter);
      return front && rear && front[2] < rear[2] - 1e-6;
    }
    function stripRect(context, strip) {
      if (!lensVisible(context)) return null;
      const bounds = context.project.bounds(lensBounds), focus = scanFocus(context, strip);
      if (!bounds || !focus || focus[0] < 0.035 || focus[0] > 0.965 || focus[1] < 0.035 || focus[1] > 0.965) return null;
      const [x, y, w, h] = bounds.rect;
      const progress = scanProgress(context, strip);
      const [v, height] = strip.band;
      const pulse = 0.014 * Math.sin((lock(context) - strip.at) * 13.0) * progress;
      const sw = w * (0.83 + 0.19 * progress);
      return [x + (w - sw) * 0.5 + (strip.slip * progress + pulse) * w,
        y + h * (v + pulse * 0.38), sw, h * height * (0.63 + progress * 0.37)];
    }
    function stripSource(context, strip) {
      const dst = stripRect(context, strip), focus = scanFocus(context, strip);
      if (!dst || !focus) return null;
      const zoom = strip.zoom - 0.15 * scanProgress(context, strip);
      return [focus[0] - dst[2] * zoom * 0.5, focus[1] - dst[3] * zoom * 0.5, dst[2] * zoom, dst[3] * zoom];
    }
    const kana = kanaGlyphs;
    const targets = [
      { label: '04 / BLOSSOM ハナ', color: '#fad9b5', note: 'ハナ ノ キロク', at: 0.58, end: 1.66, extent: [0.59, 0.34, 0.43],
        point: () => [3.62, groundY(3.62, 6.48) + 0.52, 6.48] },
      { label: '05 / DEER シカ', color: '#f4c59a', note: 'シカ ノ アト', at: 1.76, end: 3.22, extent: [0.69, 0.60, 0.42],
        point: () => puppet.point('deer', parts.deer.pivot) },
      { label: '01 / FROG カエル', color: '#d3f3a1', note: 'ウキハ ノ ウエ', at: 3.38, end: 4.54, extent: [0.44, 0.37, 0.31],
        point: () => puppet.point(frogs[0].name, V.add(frogs[0].pivot, [0.03, 0.19, 0])) },
      { label: '02 / KOI コイ', color: '#ffcf9f', note: 'ミナモ ノ ナミ', at: 4.58, end: 5.72, extent: [0.40, 0.20, 0.43],
        point: () => puppet.point(fish[1].name, fish[1].pivot) },
      { label: '03 / PILGRIM ロック', color: '#c9e8ff', note: 'ホソク ズミ', at: 6.65, end: 9.92, extent: [0.36, 0.78, 0.31],
        player: true, point: () => [hero.st.x, hero.st.y + 0.75, hero.st.z] },
      { label: '06 / CASCADE タキ', color: '#b3ebe6', note: 'タキ ノ ナガレ', at: 10.04, end: 11.45, extent: [0.50, 0.74, 0.52],
        point: () => [4.37, 1.02, 2.78] },
      { label: '07 / FUNGI キノコ', color: '#ffdca2', note: 'ホウシ ノ アト', at: 11.63, end: 13.13, extent: [0.61, 0.51, 0.46],
        point: () => [-6.45, groundY(-6.45, 6.15) + 0.57, 6.15] }
    ];
    const waveBeats = targets.map(target => [target.at, target.at + 0.58, 0.062, 0.016, 0.70]);
    waveBeats.push([7.32, 8.39, 0.129, 0.038, 0.92], [8.47, 9.49, 0.154, 0.034, 0.64]);
    waveBeats.sort((a, b) => a[0] - b[0]);
    const activeTarget = t => targets.find(target => t >= target.at && t < target.end);
    const readoutFade = 0.25;
    function targetRect(context, target) {
      if (!target || (target.player && sensor.weight < 0.28)) return null;
      const p = target.point();
      const box = context.project.bounds({ min: V.sub(p, target.extent), max: V.add(p, target.extent) });
      const at = box?.at;
      return at && at[0] > 0.04 && at[0] < 0.96 && at[1] > 0.05 && at[1] < 0.95 ? box.rect : null;
    }
    const readouts = new WeakMap();
    function scanReadout(context) {
      if (readouts.has(context)) return readouts.get(context);
      const t = lock(context), target = activeTarget(t), rect = targetRect(context, target);
      const readout = rect && { target, rect, amount: envelope(t, target.at, target.at + readoutFade, target.end - readoutFade, target.end) };
      readouts.set(context, readout);
      return readout;
    }
    const inspection = context => scanReadout(context)?.amount || 0;
    const portraitFrame = [0.772, 0.112, 0.172, 0.174];
    const portraitRect = context => scanReadout(context) ? portraitFrame : null;
    function portraitSource(context) {
      const readout = scanReadout(context), dst = portraitRect(context);
      if (!readout || !dst) return null;
      const { rect: [x, y, w, h], target } = readout, aspect = dst[2] / dst[3];
      const sw = Math.max(w, h * aspect) * (target.player ? 1.25 : 1.35), sh = sw / aspect;
      return [x + (w - sw) * 0.5, y + (h - sh) * 0.5, sw, sh];
    }
    const portraitCorner = (context, u, v) => {
      const dst = portraitRect(context);
      return dst && [dst[0] + dst[2] * u, dst[1] + dst[3] * v];
    };
    const subjectVisible = context => inspection(context) > 0;
    function focusWaveAt(context) {
      const target = scanReadout(context)?.target;
      if (!target) return null;
      return context.project.point(target.player ? [hero.st.x, hero.st.y + 0.36, hero.st.z] : target.point());
    }
    const callouts = [
      ...strips.map(strip => ({
        kind: 'corners', rect: context => stripRect(context, strip), size: 9, width: 0.7, color: '#b7d3f7',
        opacity: context => 0.29 * scanProgress(context, strip), occlusion: 'overlay'
      })),
      ...targets.filter(target => ['01', '02', '03'].some(id => target.label.startsWith(id))).flatMap((target, i) => [
        { kind: 'corners', rect: context => targetRect(context, target), padding: 4, size: 5, width: 0.75,
          color: target.color, opacity: 0.52, occlusion: 'overlay',
          visible: context => lock(context) > 3.0 && lock(context) < 6.66 && scanReadout(context)?.target !== target },
        { kind: 'leader', at: context => targetRect(context, target) && target.point(),
          offset: i === 0 ? [-26, 13] : i === 1 ? [14, -17] : [-30, -24], scale: 0.92,
          text: target.label.slice(0, 2), color: target.color, background: '#101321', opacity: 0.82, occlusion: 'overlay',
          visible: context => lock(context) > 3.0 && lock(context) < 6.66 && scanReadout(context)?.target !== target }
      ]),
      { kind: 'corners', rect: context => scanReadout(context)?.rect, color: '#dcefff', padding: 5, size: 11, glow: 1, width: 1.15,
        opacity: inspection, visible: subjectVisible, occlusion: 'overlay' },
      { kind: 'polyline', points: [context => {
        const box = scanReadout(context)?.rect;
        return box && [box[0] + box[2], box[1] + box[3] * 0.39];
      }, context => {
        const box = scanReadout(context)?.rect;
        return box && [box[0] + box[2] + 0.043, box[1] - 0.036];
      }, context => portraitCorner(context, 0, 0.68)], color: '#b7d9f5', width: 0.85,
        opacity: context => 0.70 * inspection(context), visible: subjectVisible, occlusion: 'overlay' },
      { kind: 'corners', rect: portraitRect, size: 12, width: 1.04, color: '#e1deff', padding: 2,
        opacity: inspection, visible: subjectVisible, occlusion: 'overlay' },
      { kind: 'label', at: context => portraitCorner(context, 0, 0), offset: [0, -17], scale: 1.18,
        text: context => scanReadout(context)?.target.label, color: '#e1efff', background: '#101321',
        opacity: inspection, visible: subjectVisible, occlusion: 'overlay' },
      { kind: 'label', at: context => portraitCorner(context, 0, 1), offset: [0, 6], scale: 1.02,
        text: context => {
          const target = scanReadout(context).target;
          return target.note + ' / ' + V.dist(target.point(), eyeLight).toFixed(1) + ' M';
        },
        color: '#c4c9ee', background: '#101321', opacity: inspection, visible: subjectVisible, occlusion: 'overlay' },
      ...[[1.07, 8.3], [2.31, 10.5]].map(([angle, start]) => ({
        kind: 'sparkle', at: xy(angle, 1.95, lensDepth(1.95) + 0.08), pixel: 1.5, color: '#b3f1d9',
        opacity: context => 0.8 * envelope(lock(context), start, start + 0.10, start + 0.14, start + 0.46)
      }))
    ];
    world.renderEffects = {
      seed,
      groups: [
        { range: ranges.housing, object: 'housing', material: 'copper' },
        { range: ranges.collar, object: 'housing', material: 'copper' },
        { range: ranges.lens, object: 'iris', material: 'glass' },
        { range: ranges.antlers, object: 'antlers', material: 'light' },
        ...Array.from({ length: 6 }, (_, i) => ({
          range: ranges['shutter' + i], object: 'shutters', material: 'bronze', part: 'shutter' + i
        }))
      ],
      point: (name, point) => puppet.point(name, point),
      annotations: callouts,
      annotationGlyphs: kana,
      layers: [
        { effect: 'tone', target: casing, bounds: housingBounds, palette: ['#171020', '#4e2639', '#a65754', '#f6b480', '#ffe4a9'],
          scale: 1, pattern: 'blue-noise', dither: 0.54, opacity: 0.14 },
        { target: lens, bounds: lensBounds, color: '#705474', blend: 'multiply', clock,
          opacity: curve([[0, 0.89], [1.12, 0.89], [3.06, 0], [12.91, 0], [14.74, 0.89], [period, 0.89]]) },
        { target: lens, bounds: lensBounds, palette: ['#080a18', '#112944', '#2f777b', '#b8ddd0'], inputRange: [0.10, 0.79],
          clock, opacity: 0.94, reveal: { pattern: 'blue-noise', scale: 1.4, lumaBias: 0.30,
            progress: curve([[0, 0], [4.52, 0], [5.72, 0.37], [7.2, 1], [12.52, 1], [14.55, 0], [period, 0]]) } },
        { effect: 'scanlines', target: lens, bounds: lensBounds, color: '#92ffe0', blend: 'screen', spacing: 4.4, thickness: 0.52,
          dash: 4, gap: 1, speed: 8, clock,
          opacity: curve([[4.39, 0], [4.72, 0.33], [5.50, 0.27], [5.79, 0], [6.65, 0], [6.88, 0.24], [7.38, 0]]) },
        { effect: 'glitch', variant: 'rows', block: [29, 3], offset: [25, 2], chance: 0.47,
          cadence: 20, when: gate(5.68, 5.99), opacity: 0.88 },
        { effect: 'glitch', variant: 'channels', red: [3.5, 0], blue: [-4, 1.5],
          when: gate(5.74, 6.05), opacity: 0.56 },
        { effect: 'glitch', variant: 'blocks', block: [32, 14], offset: [18, 3], chance: 0.31,
          cadence: 12, when: gate(13.04, 13.38), opacity: 0.81 },
        { effect: 'glitch', variant: 'rows', block: [38, 4], offset: [-11, 2], chance: 0.32,
          cadence: 19, when: gate(9.89, 10.12), opacity: 0.60 },
        ...strips.map(strip => ({
          effect: 'inset', target: { rect: context => stripRect(context, strip) }, sourceRect: context => stripSource(context, strip),
          palette: strip.palette, inputRange: [0.105, 0.74], when: gate(strip.at, strip.end),
          clock, reveal: { pattern: 'bayer', scale: 1, progress: curve([
            [strip.at, 0], [strip.at + 0.14, 1], [strip.end - 0.22, 1], [strip.end, 0]
          ]) }
        })),
        // The projected characters sit on the curved glass and tear before the subject lock.
        { effect: 'glyphs', target: lens, bounds: lensBounds, space: 'surface',
          frame: { origin: pupilAt, right: [1, 0, 0], up: [0, -1, 0] },
          set: '  0137ACEヒカリ', glyphs: kana, cell: [0.31, 0.40], gap: [0.050, 0.074],
          cutoff: 0.08, refresh: 6, color: '#c6ffe8', background: '#0c2537', clock, when: gate(4.31, 7.47),
          opacity: curve([[4.31, 0], [4.55, 0.36], [4.75, 0.24], [4.98, 0], [5.36, 0], [5.83, 0.88],
            [6.17, 0.94], [6.35, 0.78], [6.65, 0.0], [6.95, 0], [7.11, 0.30], [7.25, 0.20], [7.47, 0]]),
          reveal: { pattern: 'bayer', scale: 2, progress: curve([[4.31, 0], [4.61, 0.84], [4.82, 0.45], [4.98, 0],
            [5.36, 0], [5.92, 1], [6.29, 1], [6.65, 0], [6.95, 0], [7.16, 0.70], [7.47, 0]]) } },
        { effect: 'glitch', target: lens, bounds: lensBounds, variant: 'rows', block: [12, 3], offset: [16, 2],
          chance: 0.70, cadence: 19, background: '#112438', clock, when: gate(0.26, 6.35),
          opacity: curve([[0.26, 0], [0.33, 0.69], [0.46, 0], [6.07, 0], [6.12, 0.81], [6.29, 0.77], [6.35, 0]]) },
        { effect: 'inset', target: { rect: portraitRect }, sourceRect: portraitSource,
          palette: ['#07091e', '#1b1744', '#584d9b', '#ecb2bf', '#fff2c9'], inputRange: [0.04, 0.84], clock,
          when: gate(targets[0].at, targets.at(-1).end),
          opacity: curve(targets.flatMap(({ at, end }) => [[at, 0], [at + readoutFade, 1], [end - readoutFade, 1], [end, 0]])),
          reveal: { pattern: 'bayer', scale: 1, progress: curve(targets.flatMap(({ at, end }) => [
            [at, 0.5], [at + readoutFade, 1], [end - readoutFade, 1], [end, 0.5]
          ])) } },
        { effect: 'glyphs', target: { rect: context => {
          const at = focusWaveAt(context);
          return at && [at[0] - 0.25, at[1] - 0.19, 0.50, 0.38];
        } },
          set: ' .:+*#@01ARXヒカリナミト', cell: [6, 8], gap: [0, 0], cutoff: 0.06, glow: 0.22, refresh: 12,
          glyphs: kana,
          palette: ['#0e2633', '#499aad', '#93f4ee', '#f6ffcb'], inputRange: [0.04, 0.58], blend: 'screen',
          clock, when: gate(targets[0].at, waveBeats.at(-1)[1]),
          opacity: curve(waveBeats.flatMap(([start, end, , , gain]) =>
            [[start, 0], [start + 0.056, gain], [end - 0.16, gain * 0.58], [end, 0]])),
          wave: { at: focusWaveAt, radius: { keys: waveBeats.flatMap(([start, end, radius]) => [[start, 0.009], [end, radius]]) },
            width: curve(waveBeats.flatMap(([start, end, , width]) => [[start, width], [end, width * 0.54]])) } },
        { effect: 'glow', target: lens, bounds: lensBounds, radius: 4.5, threshold: 0.37, gain: 0.61, spill: true,
          clock, opacity: curve([[0, 0], [3.1, 0], [5.6, 0.72], [6.36, 0.85], [8.15, 0.42],
            [12.8, 0.24], [14.2, 0], [period, 0]]) }
      ]
    };
    const heroSpan = [heroStart, hero.total];
    const motionSpans = [heroSpan];
    const playerFocus = () => [hero.st.x, hero.st.y + 0.82, hero.st.z];
    world.dynamic = {
      start: heroStart, count: hero.total, spans: motionSpans, hero, state: hero.st,
      focus: playerFocus(), centerPlayer: true, fixedCam: true, zoomIn: 0.18, zoomOut: 3.2, height: walkY,
      update(dt, input, time) {
        if (dt <= 0) return false;
        const { x, y, z, ground, vy, dash, dashAge } = hero.st;
        hero.update(dt, input, time);
        this.focus = playerFocus();
        trackSubject(dt, time);
        wakeAt(time, { x, y, z, ground, vy, dash, dashAge }, hero.st, dt);
        stage.update(dt, time);
        motionSpans.length = 1;
        for (let row = 0; row < stage.rows.length; row++) {
          if (!stage.rows[row]) continue;
          stage.rows[row] = 0;
          motionSpans.push([row * 512, 512]);
        }
        return true;
      }
    };
    world.dynamic.update(1 / 60, { move: 0 }, 0);
    return world;
  }

  function drawTransmissionMeadow(B, seed, shelfEdge, poolEdge, ground) {
    const { n3, smooth, P } = B, V = KIT.V, rng = KIT.grow.dice(seed * 61 + 17);
    const meadow = [48, 49, 50, 51, 52, 53], shale = [1, 24, 26, 46, 61, 62];
    const lawn = KIT.pixel.lawn({ r: meadow, px: 0.045, seed, cell: 5, patch: 1.44, tufts: 0.68 });
    const path = KIT.pixel.masonry({ r: shale, px: 0.045, stone: [10, 7], seed: seed + 12, joint: 1, vary: 0.65 });
    const step = 0.218, half = step * 0.72;
    for (let j = -55; j <= 65; j++) for (let i = -60; i <= 60; i++) {
      const x = (i + ((j & 1) ? 0.5 : 0)) * step, z = j * step * 0.88;
      const edge = shelfEdge(x, z), pond = poolEdge(x, z);
      const drift = n3(x * 0.43, z * 0.51, 32);
      if (edge > 1.00 + 0.074 * (drift - 0.5) || pond < 0.995 + 0.020 * (drift - 0.5)) continue;
      const y = ground(x, z), h = 0.123;
      const normal = V.norm([ground(x - h, z) - ground(x + h, z), 2 * h, ground(x, z - h) - ground(x, z + h)]);
      const u = V.norm(V.cross([0, 0, 1], normal)), v = V.cross(normal, u);
      const track = Math.abs(x - (-4.93 - 0.24 * (z - 5))) < 0.42 + (drift - 0.5) * 0.31 && z > 4.90;
      const stone = track || pond < 1.022 + drift * 0.028 || edge > 0.979 && drift > 0.63;
      const mat = stone ? path : lawn;
      const light = Math.min(0.94, 0.36 + 0.24 * (normal[1] - 0.62 - 0.36 * normal[0] + 0.19 * normal[2]) +
        (drift - 0.5) * 0.47 + (n3(0.23 * x, 0.26 * z, 7) - 0.5) * 0.45 - 0.12 * smooth(0.91, 1.01, edge));
      const uvX = V.mul(u, half), uvY = V.mul(v, half);
      const texel = (qx, qz) => mat.tex(qx, y, qz, normal[1], light + (n3(qx * 17.2, qz * 15.6, 11) - 0.46) * (stone ? 0.33 : 0.48),
        normal[0], normal[2]);
      const col = texel(x, z);
      const tile = [0, 0, 0, 0];
      for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        const a = (column - 1.5) * 0.5, b = (row - 1.5) * 0.5;
        tile[row] += texel(x + uvX[0] * a + uvY[0] * b, z + uvX[2] * a + uvY[2] * b) * 64 ** column;
      }
      B.fineTile(...tile, ...uvX, ...uvY, P[col]);
      B.dab(x, y, z, normal, u, half * 0.90, half * 0.85, 0.014, P[col], 1.48);
      if (stone || rng() > 0.25 || drift < 0.25) continue;
      const a = rng() * B.TAU, dx = Math.cos(a), dz = Math.sin(a), tall = 0.061 + 0.12 * rng();
      const wind = { k: 14, ph: x * 0.49 + z * 0.65, sp: 1.53, rg: 0.143, ex: y };
      B.stick(x - dx * 0.026, y + tall * 0.42, z - dz * 0.026, V.norm([dx * 0.46, 1, dz * 0.46]),
        tall * 0.65, 0.012, P[drift > 0.58 ? 52 : 51], 1.10, wind);
      B.stick(x + dx * 0.036, y + tall * 0.25, z + dz * 0.036, V.norm([-dx * 0.69, 1, -dz * 0.69]),
        tall * 0.55, 0.010, P[drift > 0.58 ? 51 : 50], 1.04, wind);
    }
    // Moss and grass soften the low edge of the terrace while the few bare boulders break its outline.
    const S = KIT.sculpt(makeSculpt(B));
    S.sun = B.norm([-0.49, 0.79, 0.26]);
    const rock = { ...KIT.pixel.rock({ r: [1, 24, 26, 46, 61, 62], px: 0.043, seed: seed + 11 }), fine: true,
      mod: (x, y, z) => {
        const grain = n3(x * 3.1 + 7, y * 6.2, z * 4.6);
        const seam = Math.sin(y * 15 + x * 2.6 + z * 1.6 + 4 * n3(x * 1.4, z * 1.4, 2));
        return 0.26 * (grain - 0.45) - (seam > 0.80 && grain < 0.54 ? 0.14 : 0);
      } };
    const colonies = [];
    for (const [x, z, size, rise] of [[-7.8, 6.7, 0.89, 0.82], [-8.8, 7.1, 0.63, 0.43], [5.6, 8.1, 0.9, 0.67],
      [6.2, 8.8, 0.60, 0.37], [-8.1, -3.6, 1.25, 0.9], [7.7, -3.3, 1.39, 0.9], [-4.7, 10.5, 0.47, 0.34]]) {
      const floor = ground(x, z);
      S.rock([x, floor - 0.13 + rise * 0.55, z], size, rock, { res: 0.131, squash: [1.3, rise, 0.81] });
      colonies.push([x - size * 0.41, floor + rise * 0.47, z + size * 0.59]);
    }
    const field = S.modelSource().field;
    S.bake();
    paintTransmissionLichen(B, field, colonies, seed + 28, (x, y, z, n) => n[1] > -0.48 && y > ground(x, z) + 0.13);
    return field;
  }

  function drawTransmissionWater(B, seed, level, parts, ground) {
    const { P, TAU, mix, norm } = B, rng = KIT.grow.dice(seed * 301 + 24);
    const stages = [
      { lip: [4.98, 3.02, 0.56], base: [4.72, 1.43, 1.55], width: 0.67 },
      { lip: [4.47, 1.41, 2.20], base: [4.08, level, 3.11], width: 0.91 }
    ];
    const S = KIT.sculpt(makeSculpt(B));
    S.sun = norm([-0.49, 0.80, 0.36]);
    S.sunK = 0.8; S.amb = 0.14; S.shLen = 2.5; S.merge = 0.44;
    const slate = KIT.pixel.rock({ r: [1, 24, 46, 61, 62, 63], px: 0.046, seed: seed + 8 });
    const wet = { ...slate, fine: true,
      mod: (x, y, z) => 0.17 * (B.n3(x * 4, y * 3.3, z * 2.0) - 0.57) -
        0.12 * B.smooth(0.72, 0.99, Math.sin(y * 19 + x * 3.9 + z * 2.8 + B.n3(x, y, z) * 3)) };
    const channel = KIT.pixel.masonry({ r: [2, 26, 46, 61, 62], stone: [13, 7], seed: seed + 61, px: 0.046 });
    const course = { ...channel, fine: true };
    const moss = { r: [27, 36, 49, 50, 51], min: 0.76, fine: true };
    // Two slate shelves hold the catch basin and the upper outflow against the right knoll.
    for (const [x, z, y, rx, rz] of [[6.19, -1.65, 2.72, 0.89, 0.68], [4.76, -0.18, 2.37, 0.94, 0.73], [4.70, 1.04, 0.71, 0.99, 0.70],
      [4.50, 1.36, 0.24, 0.91, 0.56], [5.65, 0.03, 2.43, 0.62, 0.57],
      [3.40, 3.04, -0.24, 0.52, 0.28], [4.86, 3.02, -0.25, 0.44, 0.29]]) {
      S.rock([x, y, z], 0.70, wet, { res: 0.104, squash: [rx, 0.62, rz] });
    }
    KIT.form.wall(S, course, { from: [4.23, 0.30], to: [5.81, 0.25], y0: 1.15, h: 1.76, thick: 0.38,
      brick: [0.41, 0.202], gap: 0.027, round: 0.027, jitter: 0.042, missing: 0.063, seed: seed * 23 + 2, res: 0.107 });
    KIT.form.wall(S, course, { from: [3.68, 1.82], to: [5.41, 1.71], y0: 0.03, h: 1.27, thick: 0.33,
      brick: [0.436, 0.202], gap: 0.026, round: 0.026, jitter: 0.039, missing: 0.042, seed: seed * 23 + 4, res: 0.104 });
    for (const { lip: [x, y, z], width } of stages) {
      S.box([x, y - 0.107, z - 0.23], [width * 0.64, 0.107, 0.38], course, { res: 0.095, rd: 0.046 });
      for (const sign of [-1, 1]) {
        S.box([x + sign * width * 0.61, y - 0.005, z - 0.22], [0.104, 0.15, 0.43], { ...course, top: moss },
          { res: 0.087, rd: 0.043 });
      }
    }
    const field = S.modelSource().field;
    S.bake();
    paintTransmissionLichen(B, field, [[4.14, 2.30, 0.55], [5.23, 2.72, 0.43], [4.69, 0.83, 1.96],
      [5.08, 0.77, 1.94], [3.39, 0.02, 3.08]], seed + 56, (x, y, z, n) => n[1] > -0.36 && y > -0.07);

    // Feed water slides down the upper runnel, then crosses the first ledge before spilling again.
    const V = KIT.V;
    function run(open, close, upstream, downstream, joinTerrain = false) {
      const length = V.dist(open, close), rows = Math.ceil(length / 0.095);
      const along = V.norm(V.sub(close, open)), side = norm([along[2], 0, -along[0]]), normal = V.norm(V.cross(along, side));
      for (let i = 0; i <= rows; i++) for (let j = -4; j <= 4; j++) {
        const u = i / rows, dx = j * 0.24, p = V.mad(V.lerp(open, close, u), side, mix(upstream, downstream, u) * dx * 0.5);
        if (joinTerrain) p[1] = Math.max(p[1], ground(p[0], p[2]) + 0.021);
        const foam = (j === -4 || j === 4) && rng() > 0.54;
        B.dab(...p, normal, along, 0.068, mix(upstream, downstream, u) * 0.102, 0.012,
          P[foam ? 58 : u < 0.3 ? 56 : rng() > 0.79 ? 58 : 57], foam ? 0.77 : 1.13,
          { k: 4, ph: i * 0.31 + j * 0.62, sp: 10.2, nd: true });
      }
    }
    run([6.18, 3.14, -1.69], [5.42, 3.06, -0.29], 0.34, 0.48, true);
    run([5.42, 3.06, -0.29], stages[0].lip, 0.48, 0.59);
    run(stages[0].base, stages[1].lip, 0.80, 0.91);
    for (const { lip, base, width } of stages) {
      const drop = lip[1] - base[1];
      // The sheet curves out from the lip and separates into thin strands as it falls.
      for (let row = 0; row <= 28; row++) {
        const t = row / 28, p = [mix(lip[0], base[0], t), lip[1] - t * drop, mix(lip[2], base[2], Math.sqrt(t))];
        const tangent = norm([base[0] - lip[0], -drop, (base[2] - lip[2]) * 0.5 / Math.sqrt(0.035 + t)]);
        const normal = V.norm(V.cross(tangent, [1, 0, 0]), [0, 0, 1]);
        for (let j = -8; j <= 8; j++) {
          const side = j / 8, edge = Math.abs(side), flutter = B.n3(j * 0.29, row * 0.29, drop * 3);
          if (edge > 0.82 && flutter + (1 - t) * 0.6 < 0.88) continue;
          const strand = j % 4 === 1 || j % 5 === 2;
          const color = strand ? (flutter > 0.63 ? 60 : 59) : flutter > 0.61 ? 58 : flutter < 0.28 ? 54 : 56;
          B.dab(p[0] + side * width * (0.41 + 0.23 * t), p[1], p[2] - edge * edge * 0.13 + (flutter - 0.5) * 0.06,
            normal, tangent, 0.046 + t * 0.019, width * (strand ? 0.026 : 0.043), 0.015,
            P[color], (strand ? 1.03 : 0.67) * (1 - edge * 0.26), { k: 7, ph: j * 0.93 + t * 34, sp: 17.3, nd: true });
        }
      }
      for (let i = 0; i < 172; i++) {
        const side = rng() - 0.5, phase = rng(), edge = Math.abs(side) * 2;
        B.stick(lip[0] + width * side - drop * 0.06, lip[1] - rng() * 0.14, mix(lip[2], base[2], 0.40 + rng() * 0.38),
          norm([-0.04, 1, -0.07]), 0.035 + 0.12 * rng(), 0.008 + rng() * 0.020, P[i % 7 ? 58 + i % 2 : 60],
          0.72 + 0.60 * (1 - edge), { k: 2, ph: phase, sp: drop * (1.53 + rng() * 0.82), rg: drop * (0.92 + rng() * 0.084), ex: 0.42, nd: true });
      }
      for (let i = 0; i < 98; i++) {
        const a = rng() * TAU, q = Math.sqrt(rng()) * width * 0.95;
        const x = base[0] + Math.cos(a) * q, z = base[2] + Math.sin(a) * q * 0.51;
        const white = i % 5 === 0 || q < width * 0.25;
        B.dab(x, base[1] + 0.020 + rng() * 0.035, z, [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)],
          0.037 + 0.057 * rng(), 0.021 + 0.018 * rng(), 0.012, P[white ? 60 : 58 + i % 2], 0.90,
          { k: 7, ph: a + q * 9, sp: 8.0, nd: true });
        if (i % 2 === 0) B.iso(x, base[1] + 0.03, z, 0.019 + 0.025 * rng(), P[white ? 60 : 59], 1.20,
          { k: 3, ph: rng(), sp: 0.42 + rng() * 0.95, rg: 0.27 + rng() * 0.61, ex: 1.02, nd: true });
      }
    }
    const impact = stages[1].base;
    for (let ring = 0; ring < 4; ring++) for (let i = 0; i < 47; i++) {
      const a = i * TAU / 47, r = 0.44 + ring * 0.28;
      if (Math.sin(a) < -0.21 || rng() < 0.47) continue;
      B.dab(impact[0] + Math.cos(a) * r, level + 0.029, impact[2] + Math.sin(a) * r * 0.91, [0, 1, 0],
        [-Math.sin(a), 0, Math.cos(a)], 0.051 + ring * 0.017, 0.017, 0.011, P[ring < 2 ? 59 : 57], 0.47,
        { k: 7, ph: ring * 1.76 + i * 0.21, sp: 4.7, nd: true });
    }
    for (const [x, z, r] of [[-3.17, 7.3, 1.38], [3.57, 6.66, 1.29], [0.86, 9.13, 1.03], [-3.51, 3.08, 0.83]]) {
      lilies(B, 7, x, z, r, level + 0.045, () => true, [49, 51, 43]);
    }
    for (const [x, z] of [[-4.4, 6.94], [4.38, 6.14], [2.63, 8.87], [-3.2, 9.1]]) {
      for (let i = 0; i < 21; i++) {
        const a = rng() * TAU, h = rng() * 0.80 + 0.21, d = rng() * 0.64;
        const u = Math.cos(a), v = Math.sin(a), wind = { k: 11, ph: a, sp: 1.18, rg: 0.051 };
        const bx = x + u * d, bz = z + v * d;
        B.stick(bx, level + h * 0.54, bz, norm([u * 0.25, 1, v * 0.25]), h * 0.62, 0.025, P[50 + i % 3], 1.2, wind);
        if (i % 3 === 0) B.stick(bx + 0.1 * u, level + h, bz + 0.1 * v, [0, 1, 0], 0.098, 0.044, P[20], 1.2, wind);
      }
    }
    // Gnats and falling petals give the bank a little life with shader-driven animation.
    for (let i = 0; i < 43; i++) {
      const a = rng() * TAU, d = 2.0 + rng() * 3.4, phase = rng() * TAU;
      B.iso(Math.cos(a) * d, level + 0.48 + rng() * 1.3, 5.6 + Math.sin(a) * d * 0.49, 0.021 + rng() * 0.024,
        P[i % 6 ? 44 : 60], 1, { k: 11, ph: phase, sp: 1.6 + rng(), rg: 0.19, nd: true, em: true });
    }
    KIT.weather.fall(B, { kind: 'leaf', box: [-9.1, -6.7, 1.8, 4.8], top: 4.0, n: 28,
      size: 0.06, cols: [41, 42, 43], speed: 0.71, sway: 0.38, ground: () => level, seed: seed * 15 + 2 });
    const fish = [];
    for (const [x, z, radius, phase, speed, heading] of [[-1.36, 5.16, 0.93, 2.46, 0.82, 0],
      [1.17, 6.57, 1.26, 0.54, 0.71, 1.43], [1.94, 7.48, 0.81, 3.19, 0.88, 0]]) {
      const name = 'fish' + fish.length, pivot = [x, level - 0.065, z], start = B.count();
      const scales = fish.length ? [7, 9, 44, 11] : [46, 55, 57, 58];
      const y = pivot[1];
      for (const [dx, dy, length, width, shade] of [[0.04, 0, 0.246, 0.119, 0], [0.14, 0.022, 0.157, 0.089, 1],
        [-0.03, 0.038, 0.173, 0.070, 2], [0.094, 0.061, 0.109, 0.043, 3]]) {
        B.dab(x + dx, y + dy, z, [0, 1, 0], [1, 0, 0], length, width, 0.025, P[scales[shade]], 1.4);
      }
      for (const sign of [-1, 1]) {
        B.iso(x + 0.192, y + 0.051, z + 0.068 * sign, 0.024, P[1], 1.25);
        B.dab(x + 0.061, y + 0.042, z + 0.064 * sign, [0, 1, 0], [0, 0, 1], 0.064, 0.017, 0.014, P[scales[1]], 1.10);
      }
      parts[name] = { ids: Array.from({ length: B.count() - start }, (_, j) => start + j), pivot };
      const tailStart = B.count();
      B.stick(x - 0.22, y + 0.008, z, [1, 0, 0], 0.066, 0.041, P[scales[0]], 1.4);
      for (const sign of [-1, 1]) {
        B.dab(x - 0.30, y + 0.013, z + sign * 0.072, [0, 1, 0], norm([-1, 0, sign * 0.77]),
          0.132, 0.041, 0.015, P[scales[2]], 1.35);
        B.dab(x - 0.365, y + 0.018, z + sign * 0.112, [0, 1, 0], norm([-1, 0, sign * 0.62]),
          0.067, 0.022, 0.014, P[scales[3]], 1.1);
      }
      parts[name + 'Tail'] = { ids: Array.from({ length: B.count() - tailStart }, (_, j) => tailStart + j), parent: name,
        pivot: [x - 0.18, y, z] };
      for (const [fin, side] of [['Left', -1], ['Right', 1]]) {
        const p = [x + 0.025, y + 0.02, z + side * 0.070], id = B.count();
        B.dab(p[0] - 0.042, p[1], p[2] + side * 0.053, [0, 1, 0], norm([-0.4, 0, side]),
          0.088, 0.031, 0.011, P[scales[2]], 1.23);
        parts[name + fin] = { ids: [id], parent: name, pivot: p };
      }
      const jumps = name === 'fish1';
      if (jumps) {
        const start = B.count();
        for (let i = 0; i < 17; i++) {
          const a = rng() * TAU, d = 0.10 + rng() * 0.16;
          B.stick(x + Math.cos(a) * d, level + 0.055 + rng() * 0.20, z + Math.sin(a) * d,
            norm([Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4]), 0.024 + rng() * 0.036, 0.012 + rng() * 0.009,
            P[i % 4 ? 59 : 60], 1.25, { nd: true });
        }
        parts.koiSplash = { ids: Array.from({ length: B.count() - start }, (_, i) => start + i), pivot: [x, level, z] };
      }
      fish.push({ name, radius, phase, speed, heading, jumps, pivot });
    }
    return { fish, field };
  }

  function plantTransmissionWildlife(B, seed, water, parts, ground) {
    const K = KIT, S = K.sculpt(makeSculpt(B)), tags = K.deform.tags(S), rng = K.grow.dice(seed * 31 + 82);
    S.sun = B.norm([-0.46, 0.82, 0.35]); S.sunK = 0.82; S.amb = 0.19; S.merge = 0.3;
    const stem = { r: [32, 33, 34, 35], s: [34, 63, 11, 12] };
    const fungi = [
      { cap: { r: [6, 7, 8, 9], s: [8, 9, 9, 10] }, stem, spot: { r: [11, 12], em: true } },
      { cap: { r: [19, 8, 9, 10], s: [9, 44, 22, 11] }, stem, spot: { r: [11, 12], em: true } }
    ];
    // Put the largest umbrellas beside the near path and on a clear patch of the opposite bank.
    for (const [x, z, lift, scale, shade] of [[-6.42, 6.14, 0, 1.63, 0], [4.27, 9.05, 0, 1.32, 0],
      [-6.75, 1.12, 1.00, 1.13, 1], [7.79, 3.13, 0, 1.29, 1], [-8.19, -1.49, 0, 1.03, 0]]) {
      for (let j = 0; j < 3; j++) {
        const sx = x + [-0.20, 0.40, 0.15][j], sz = z + [0.06, 0.33, -0.50][j];
        const v = { h: 0.47 + rng() * 0.22, cap: 0.27 + rng() * 0.067, dome: 0.41,
          tip: rng() * 0.17 - 0.085, spots: 8 + j, rnd: rng };
        const k = scale * [1, 0.62, 0.5][j], base = lift || ground(sx, sz);
        const mush = sculptGardenMushroom(S, [sx, base, sz], v, k, fungi[shade], j ? 1.57 : 1.49);
        if (!j) {
          const gx = mush.top[0], gz = mush.top[2], under = base + v.h * k - mush.cap * 0.28;
          S.ball([gx, under, gz], [mush.cap * 0.82, mush.cap * 0.18, mush.cap * 0.82], { r: [32, 35, 44, 11] }, { res: 0.052 });
        }
        if (j === 0) for (let i = 0; i < 5; i++) {
          const a = rng() * B.TAU, d = 0.09 + rng() * 0.22;
          B.iso(mush.top[0] + d * Math.cos(a), mush.top[1], mush.top[2] + d * Math.sin(a), 0.022, B.P[43 + shade], 1.0,
            { k: 3, ph: rng(), sp: 0.13 + rng() * 0.16, rg: 0.36 + rng() * 0.19, ex: 1.05, nd: true });
        }
      }
    }
    const frogs = [
      { name: 'frog0', start: [-2.83, 7.34], end: [-1.62, 7.86], phase: 0.45, scale: 1.8 },
      { name: 'frog1', start: [2.66, 8.18], end: [3.27, 7.26], phase: 2.23, scale: 1.51 }
    ];
    const materials = { body: { r: [27, 36, 49, 50], s: [50, 51, 52, 53] }, eye: { r: [0, 1], s: [20, 22] },
      throat: { r: [37, 52, 53], s: [53, 60] } };
    for (const f of frogs) {
      f.pivot = [f.start[0], water + 0.094, f.start[1]];
      sculptGardenFrog(S, f.pivot, f.scale, materials, { tag: f.name, throatTag: f.name + 'Throat', resolution: 1.57 });
      for (const [i, [x, z]] of [f.start, f.end].entries()) {
        const y = water + 0.054, id = B.count(), name = f.name + 'Pad' + i;
        for (let j = 0; j < 55; j++) {
          const a = rng() * B.TAU, r = Math.sqrt(rng()) * 0.44;
          if (a > 0.17 && a < 0.64) continue;
          B.dab(x + Math.cos(a) * r, y, z + Math.sin(a) * r, [0, 1, 0], [1, 0, 0], 0.107, 0.087, 0.02,
            B.P[r > 0.34 ? 49 : j % 3 ? 51 : 52], 1.18);
        }
        parts[name] = { ids: Array.from({ length: B.count() - id }, (_, j) => id + j), pivot: [x, y, z] };
      }
    }
    S.bake();
    for (const { name, pivot, scale } of frogs) {
      parts[name] = { ids: tags[name], pivot, axis: [1, 0, 0], slices: 3 };
      parts[name + 'Throat'] = { ids: tags[name + 'Throat'], parent: name,
        pivot: [pivot[0] + scale * 0.12, pivot[1] + scale * 0.12, pivot[2]] };
    }
    return frogs;
  }

  function poseTransmissionWildlife(pose, time, stage, tempo, fish, frogs, envelope) {
    for (const { name, phase, speed, radius, heading, jumps } of fish) {
      const a = time * speed + phase + heading + 0.18 * Math.sin(time * 1.11 + phase);
      const surface = envelope((time + phase) % 6.2, 3.60, 4.02, 4.96, 5.37);
      const stroke = time * 11.0 + phase, turn = Math.atan2(-Math.cos(a) * 0.63, -Math.sin(a));
      const leap = jumps ? Math.max(0, Math.min(1, (stage - 4.72) / 0.71)) : 0;
      const arc = 4 * leap * (1 - leap), clearance = 0.74 * arc;
      const lift = 0.025 * Math.sin(time * 1.5 + phase) + 0.177 * surface + clearance;
      pose[name] = { pos: [Math.cos(a) * radius, lift, Math.sin(a) * radius * 0.63],
        rot: [surface * 19, (turn + Math.sin(stroke) * 0.045) * 180 / Math.PI, surface * 9 + arc * (1 - 2 * leap) * 100] };
      pose[name + 'Tail'] = { rot: [0, Math.sin(stroke - 0.63) * (24 + surface * 20), Math.sin(stroke * 0.54) * 7] };
      pose[name + 'Left'] = { rot: [Math.sin(stroke * 0.86) * 22, Math.cos(stroke * 0.86) * 17, 0] };
      pose[name + 'Right'] = { rot: [-Math.sin(stroke * 0.86 + 0.7) * 22, -Math.cos(stroke * 0.86 + 0.7) * 17, 0] };
      if (jumps) {
        const landing = stage - 5.39, pulse = envelope(landing, 0, 0.065, 0.235, 0.39);
        const impactTime = time - landing / tempo;
        const d = impactTime * speed + phase + heading + 0.18 * Math.sin(impactTime * 1.11 + phase);
        pose.koiSplash = { show: pulse, pos: [Math.cos(d) * radius, 0, Math.sin(d) * radius * 0.63],
          scale: [1 + 2 * Math.max(0, landing), pulse, 1 + 2 * Math.max(0, landing)] };
      }
    }
    for (const { name, start, end, phase } of frogs) {
      const half = 3.64, age = (time + phase) % (2 * half), away = age >= half;
      const u = age % half, leap = Math.max(0, (u - 3.01) / (half - 3.01));
      const travel = away ? 1 - leap : leap, arc = 4 * leap * (1 - leap);
      const crouch = envelope(u, 2.6, 2.96, 3.03, 3.20), settle = u < 0.5 ? Math.exp(-10 * u) * Math.sin(17 * u) : 0;
      const face = Math.atan2(start[1] - end[1], end[0] - start[0]) * 180 / Math.PI;
      const spin = envelope(u, 0.39, 0.83, half, half + 1);
      pose[name] = { pos: [(end[0] - start[0]) * travel, 0.61 * arc, (end[1] - start[1]) * travel],
        rot: [0, face + 180 * (Number(!away) + spin), 23 * arc * (1 - 2 * leap)],
        scale: [1 + 0.33 * arc + 0.14 * crouch, 1 - 0.26 * crouch - 0.18 * settle, 1 + 0.12 * crouch] };
      pose[name + 'Throat'] = { scale: 1 + 1.25 * envelope(u, 1.13, 1.71, 1.79, 2.14) };
      for (const i of [0, 1]) {
        const dip = Number(Number(away) === i) * settle * -0.073;
        pose[name + 'Pad' + i] = { pos: [0, dip + 0.013 * Math.sin(time * 2.2 + i + phase), 0] };
      }
    }
  }

  function makeTransmissionFlyers(B, parts, ground) {
    const insects = [[-7.13, 0.73, 4.13, 0.64], [-5.2, 1.34, 2.26, 0.47], [5.73, 0.65, 6.50, 0.62]];
    const birds = [[-3.8, 7.53, -5.63, 2.64], [-2.73, 7.91, -6.23, 3.01], [-1.91, 7.22, -6.84, 3.3]];
    const flyers = [];
    for (const [bird, list] of [[false, insects], [true, birds]]) for (const [i, [x, y, z, radius]] of list.entries()) {
      const name = (bird ? 'bird' : 'butterfly') + i;
      const pivot = [x, bird ? y : ground(x, z) + y, z];
      const [px, py, pz] = pivot, start = B.count(), s = bird ? 1.47 : 0.86 + i * 0.11;
      B.stick(px, py, pz, [1, 0, 0], s * 0.087, s * 0.024, B.P[bird ? 46 : 23], 1.35);
      const bodyColor = bird ? 58 : 44;
      B.iso(px + s * 0.053, py + s * 0.015, pz, s * 0.034, B.P[bodyColor], 1.30);
      parts[name] = { ids: [start, start + 1], pivot };
      for (const [sideName, side] of [['Left', -1], ['Right', 1]]) {
        const first = B.count();
        if (bird) {
          const points = [[0.01, 0.0, 0.025, 0.075], [-0.025, 0.008, 0.105, 0.071], [-0.083, 0.023, 0.19, 0.047],
            [-0.135, 0.03, 0.239, 0.031], [-0.162, 0.025, 0.26, 0.017]];
          for (const [dx, dy, dz, breadth] of points) {
            B.dab(px + dx * s, py + dy * s, pz + side * dz * s, [0, 1, 0], B.norm([-0.5, 0, side]),
              s * 0.067, s * breadth, 0.014, B.P[dz < 0.08 ? 58 : dz < 0.20 ? 47 : 46], 1.35);
          }
        } else {
          for (const [i, [dx, dz, width, length]] of [[0.049, 0.105, 0.069, 0.095], [-0.058, 0.083, 0.069, 0.071],
            [0.039, 0.137, 0.055, 0.048], [-0.057, 0.108, 0.033, 0.044]].entries()) {
            B.dab(px + dx * s, py + 0.008, pz + side * dz * s, [0, 1, 0], B.norm([dx * 3, 0, side]),
              length * s, width * s, 0.012, B.P[[40, 41, 43, 44][i]], 1.40);
          }
        }
        parts[name + sideName] = { ids: Array.from({ length: B.count() - first }, (_, j) => first + j), parent: name, pivot };
      }
      flyers.push({ name, bird, radius, phase: i * 1.69 });
    }
    return flyers;
  }

  function poseTransmissionFlyers(pose, time, flyers) {
    for (const { name, bird, radius, phase } of flyers) {
      const a = time * (bird ? 0.48 : 1.37) + phase;
      const flap = Math.sin(time * (bird ? 10.5 : 23.6) + phase);
      const pitch = Math.sin(a * 0.89 + phase);
      const heading = Math.atan2(-Math.cos(a) * 0.64, -Math.sin(a));
      const bank = bird ? 9 * pitch : 17 * pitch;
      pose[name] = { pos: [Math.cos(a) * radius, pitch * (bird ? 0.31 : 0.20) + flap * 0.035,
        Math.sin(a) * radius * 0.64], rot: [bank, heading * 180 / Math.PI, 8 * pitch] };
      const amplitude = bird ? 28 + 22 * Math.pow(Math.sin(a), 6) : 51;
      pose[name + 'Left'] = { rot: [flap * amplitude, 0, 0] };
      pose[name + 'Right'] = { rot: [-flap * amplitude, 0, 0] };
    }
  }

  function makeTransmissionDeer(B, parts, ground) {
    const K = KIT, V = K.V, S = K.sculpt(makeSculpt(B)), tags = K.deform.tags(S);
    S.sun = B.norm([-0.49, 0.81, 0.33]); S.sunK = 0.82; S.amb = 0.20; S.merge = 0.30;
    const x = 7.61, z = 6.22, y = ground(x, z);
    const at = (u, v, w = 0) => [x + u, y + v, z + w];
    const torso = at(0, 0.73), neck = at(0.42, 0.76), skull = at(0.67, 1.12), rump = at(-0.57, 0.72);
    const chestnut = { r: [23, 6, 32, 7, 8], s: [19, 8, 9, 44, 10] };
    const belly = { r: [7, 8, 19], s: [9, 44, 11] }, hoof = { r: [0, 1, 23], s: [1, 32] };
    const body = { tag: 'deer', whole: true, res: 0.06 }, head = { tag: 'deerSkull', whole: true, res: 0.039 };
    S.ball(torso, [0.60, 0.252, 0.222], chestnut, body);
    S.ball(at(0.31, 0.71), [0.277, 0.263, 0.193], chestnut, body);
    S.ball(at(-0.14, 0.62), [0.39, 0.126, 0.182], belly, body);
    S.tube([neck, at(0.54, 0.96), skull], 0.133, 0.073, chestnut, { tag: 'deerNeck', res: 0.045, whole: true });
    S.ball(at(0.73, 1.13), [0.142, 0.117, 0.104], chestnut, head);
    S.ball(at(0.841, 1.061), [0.106, 0.071, 0.072], belly, head);
    S.ball(at(0.926, 1.070), [0.039, 0.041, 0.068], hoof, head);
    for (const side of [-1, 1]) {
      S.tube([at(0.67, 1.20, 0.058 * side), at(0.615, 1.342, 0.157 * side)], 0.052, 0.013, chestnut, head);
      S.ball(at(0.768, 1.156, 0.096 * side), 0.026, hoof, { ...head, res: 0.024 });
      for (const front of [false, true]) {
        const start = front ? 0.352 : -0.42, offset = side * 0.13;
        const upper = at(start, 0.70, offset), knee = at(start + (front ? -0.015 : 0.105), 0.33, offset);
        const foot = at(start - (front ? 0.02 : 0.11), 0.045, offset + 0.016 * side);
        S.tube([upper, knee], front ? 0.067 : 0.091, 0.043, chestnut, body);
        S.tube([knee, foot], 0.046, 0.029, chestnut, { ...body, res: 0.04 });
        S.ball(V.add(foot, [0.014, -0.016, 0]), [0.052, 0.039, 0.032], hoof, { ...body, res: 0.034 });
      }
    }
    S.tube([rump, at(-0.68, 0.651), at(-0.695, 0.590)], 0.065, 0.023, belly, { tag: 'deerTail', res: 0.036, whole: true });
    const spots = [];
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
      const localX = -0.36 + (i % 4) * 0.17, localY = i < 4 ? 0.835 : 0.764;
      const wing = 0.214 * Math.sqrt(Math.max(0, 1 - (localX / 0.60) ** 2 - ((localY - 0.73) / 0.252) ** 2));
      spots.push(B.count());
      B.dab(...at(localX, localY, (wing + 0.020) * side), [0, 0, side], [1, 0, 0], 0.026, 0.023, 0.015, B.P[11], 1.14);
    }
    S.bake();
    parts.deer = { ids: tags.deer.concat(spots), pivot: torso };
    parts.deerNeck = { ids: tags.deerNeck, parent: 'deer', pivot: neck };
    parts.deerSkull = { ids: tags.deerSkull, parent: 'deerNeck', pivot: skull };
    parts.deerTail = { ids: tags.deerTail, parent: 'deer', pivot: rump };
    return { yaw: 151 };
  }

  function buildTransmissionTerrace(B, center, seed) {
    const S = KIT.sculpt(makeSculpt(B));
    S.sun = B.norm([-0.44, 0.81, 0.39]);
    S.sunK = 0.73; S.amb = 0.15; S.sky = 0.12; S.shLen = 2.7; S.merge = 0.38; S.wob = 0;
    const at = (angle, radius, y) => [center[0] + radius * Math.cos(angle), y, -1.4 + radius * Math.sin(angle)];
    const axes = angle => [[Math.cos(angle), 0, Math.sin(angle)], [0, 1, 0], [-Math.sin(angle), 0, Math.cos(angle)]];
    const stone = [1, 24, 3, 46, 61, 62], course = [24, 3, 46, 61, 62, 63];
    const tread = [26, 46, 3, 61, 62, 63], trim = [6, 7, 8, 9, 10];
    const brick = [23, 45, 32, 33, 62, 63];
    const materials = new Map();
    function stoneMat(colors, flag = false) {
      const key = colors.join(',') + (flag ? '/flags' : '');
      if (!materials.has(key)) {
        const mineral = KIT.pixel.masonry({ r: colors, px: 0.045, stone: flag ? [9, 6] : [22, 11],
          joint: flag ? 2 : 1, vary: 0.60, seed: seed + colors[0] });
        materials.set(key, { ...mineral, fine: true, mod: (x, y, z) => {
          const band = B.n3(x * 1.8 + 4, y * 4.6, z * 1.9);
          const mineralVein = Math.sin(y * 20 + x * 0.8 + z * 0.72 + 1.6 * B.n3(y, z, x));
          return 0.28 * (band - 0.49) + (mineralVein > 0.92 && band > 0.55 ? 0.12 : 0);
        } });
      }
      return materials.get(key);
    }
    function block(point, half, angle, colors, pitch, bevel, detailed = false) {
      const flag = half[0] > 0.64 && half[1] < 0.25;
      S.box(point, half, detailed ? stoneMat(colors, flag) : { r: colors }, {
        ax: axes(angle), rd: bevel, res: pitch * (detailed ? 0.64 : 0.78)
      });
    }

    // Staggered, individually uneven brick courses and chipped openings in the old headwall.
    for (const [i, a, b, height, color] of [[0, 2.34, 3.42, 1.67, course], [1, 3.52, 5.54, 1.16, stone], [2, 5.61, 6.83, 1.79, brick]]) {
      const path = B.path(17, u => { const [x, , z] = at(B.mix(a, b, u), 4.0, 0); return [x, z]; });
      KIT.form.wall(S, stoneMat(color), { path, y0: -0.23, h: height + 0.32, thick: 0.57,
        brick: i === 2 ? [0.64, 0.226] : [0.65, 0.265], gap: 0.032, round: 0.042, jitter: 0.055,
        missing: 0.036, top: u => height * (0.88 + 0.15 * B.n3(u * 0.75, i + 7, 2)) -
          0.43 * B.smooth(0.65, 0.95, B.n3(u * 0.84, i + 2, 7)),
        seed: seed * 171 + i * 13 + 1, res: i === 1 ? 0.18 : 0.135 });
    }
    KIT.form.wall(S, stoneMat(brick), { from: [-6.57, 3.88], to: [-6.71, 1.28], y0: -0.14, h: 0.94,
      thick: 0.34, brick: [0.48, 0.192], gap: 0.026, round: 0.031, jitter: 0.033,
      missing: 0.055, top: u => 0.79 + 0.15 * Math.sin(u * 2), res: 0.102, seed: seed * 24 + 15 });
    for (const [angle, rows] of [[-2.83, 7], [-1.97, 9], [-1.37, 6], [-0.47, 8], [0.34, 7], [2.28, 5], [2.78, 6]]) {
      for (let row = 0; row < rows; row++) {
        const lip = row === 0 || row === rows - 1 || row === 4;
        block(at(angle, 4.19, 0.19 + row * 0.42), [lip ? 0.53 : 0.44, 0.202, lip ? 0.46 : 0.36],
          angle, lip ? tread : stone, 0.22, 0.035, true);
      }
    }
    // The cracked instrument cradle has two anchor shoes at the water's edge.
    for (const [x, z, angle] of [[-3.21, 0.16, 0.24], [2.94, 0.09, -0.24]]) {
      block([x, 0.11, z], [0.77, 0.23, 0.55], angle, tread, 0.26, 0.074, true);
      block([x, 0.38, z], [0.62, 0.11, 0.37], angle, stone, 0.20, 0.041, true);
      block([x, 0.54, z], [0.30, 0.11, 0.33], angle, trim, 0.17, 0.025, true);
    }
    block([center[0], -0.04, -1.35], [2.37, 0.26, 0.82], 0, stone, 0.31, 0.067, true);
    for (const a of [-0.05, -0.38, -0.71]) {
      block(at(a, 4.37, 1.41), [0.56, 0.19, 0.46], a, tread, 0.20, 0.035, true);
    }
    // Two straight flights meet at a planted landing along the outside wall.
    for (const [x, z, height] of [[-4.95, 4.30, 0.13], [-5.48, 0.09, 1.17]]) {
      for (let i = 0; i < 7; i++) {
        const y = height + 0.145 * i, treadZ = z - i * 0.49;
        block([x, y - 0.13, treadZ], [0.78, 0.13, 0.28], 0, tread, 0.24, 0.026, true);
        block([x - 0.74, y - 0.29, treadZ], [0.14, 0.39, 0.27], 0, stone, 0.25, 0.038);
        if (i === 0 || i === 5) {
          block([x - 0.74, y + 0.15, treadZ], [0.17, 0.16, 0.17], 0, course, 0.17, 0.036, true);
        }
      }
    }
    block([-4.95, -0.055, 4.77], [0.81, 0.076, 0.28], 0, stone, 0.24, 0.035, true);
    for (const [x, y, z, w, d] of [[-5.26, 1.029, 0.74, 1.49, 0.65], [-5.56, 2.069, -3.59, 1.53, 0.56]]) {
      block([x, y - 0.16, z], [w, 0.16, d], 0, course, 0.26, 0.046, true);
      for (const side of [-1, 1]) for (let row = 0; row < 3; row++) for (let j = 0; j < 4; j++) {
        const zBrick = z - d + 0.16 + (j + (row % 2) * 0.28) * d * 0.43;
        block([x + side * w * 0.91, y - 0.44 - row * 0.233, zBrick], [0.16, 0.104, d * 0.196], 0,
          row === 1 ? brick : course, 0.20, 0.036, true);
      }
      for (let i = 0; i < 9; i++) {
        const k = i / 8, p = x + (k - 0.5) * w * 1.89;
        block([p, y - 0.36, z + d * 0.86], [0.17, 0.19, 0.15], 0, stone, 0.19, 0.028, true);
        if ((i < 2 || i > 6) && i !== 7) block([p, y + 0.15, z + d * 0.78], [0.16, 0.19, 0.13], 0, tread, 0.18, 0.04, true);
      }
    }
    // Fragments of the old arcade are still standing at the edge of the upper beds.
    for (const [x, z, n] of [[-6.68, -4.01, 5], [-4.78, -4.08, 3]]) {
      for (let i = 0; i < n; i++) {
        block([x, 2.25 + i * 0.36, z], [0.21 + (i === 0 ? 0.07 : 0), 0.181, 0.27], 0, course, 0.19, 0.037, true);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1 - (i + 0.32) / 12);
      block([-5.73 + Math.cos(a) * 0.93, 3.78 + Math.sin(a) * 0.94, -4.02],
        [0.16, 0.165, 0.25], 0, tread, 0.19, 0.043, true);
    }
    const field = S.modelSource().field;
    S.bake();
    growTransmissionStone(B, field, at, seed);
    return field;
  }

  function growTransmissionStone(B, S, at, seed) {
    const K = KIT, V = K.V;
    const rng = K.grow.dice(seed * 117 + 91);
    const seeds = [[0.28, 4.66, 1.22], [0.34, 4.32, 1.62], [0.35, 4.17, 2.83], [0.56, 4.32, 1.29],
      [2.29, 4.51, 1.43], [2.54, 4.45, 1.55], [2.88, 4.38, 2.59], [0.12, 4.11, 1.62],
      [-0.45, 4.5, 2.91], [-1.96, 4.5, 3.48], [-2.84, 4.23, 2.62], [0.01, 5.71, 0.43]];
    const terraces = [[-6.35, 0.96, 1.32], [-4.21, 0.81, 1.30], [-6.77, 2.11, -3.22], [-4.82, 2.04, -3.04],
      [-6.76, 0.43, 3.19], [-6.73, 0.56, 2.08], [-6.73, 0.68, 1.56], [-5.93, 1.00, 0.94], [-5.48, 2.09, -3.58]];
    paintTransmissionLichen(B, S, seeds.map(p => at(...p)).concat(terraces), seed,
      (x, y, z, n) => n[1] > -0.49 && z > -5.75 && y > 0.13 && Math.abs(x) > 2.85);
    for (const [i, a, r, height, length, way] of [[0, 2.28, 4.63, 2.08, 27, -1], [1, 2.81, 4.48, 2.44, 28, -1],
      [2, 0.37, 4.58, 2.78, 26, -1], [3, 2.86, 4.48, 0.35, 22, 1], [4, 0.28, 4.48, 0.59, 23, 1],
      [5, -0.48, 4.61, 3.12, 26, -1], [6, -2.83, 4.47, 2.66, 23, -1]]) {
      const vine = K.grow.creep(S, { from: at(a, r, height), dir: [-Math.sin(a) * 0.17, way, Math.cos(a) * 0.17],
        step: 0.131, steps: length, hug: 0.064, branch: 0.102, depth: 1, every: 2, wander: 0.82, seed: seed * 197 + i });
      for (const branch of vine.paths) for (let j = 1; j < branch.length; j++) {
        const before = branch[j - 1], after = branch[j], t = j / branch.length;
        B.stick(...V.lerp(before, after, 0.50), V.norm(V.sub(after, before)), V.dist(before, after) * 0.69,
          0.024 + (1 - t) * 0.036, B.P[j % 3 ? 49 : 19], 1.40);
      }
      for (const node of vine.nodes) {
        const side = V.mul(V.cross(node.n, node.dir), node.k % 4 < 2 ? -1 : 1);
        const axis = V.norm(V.add(side, V.mul(node.dir, 0.35))), s = 0.13 + 0.06 * rng();
        const base = V.mad(node.p, node.n, 0.085);
        const shade = node.k % 5 ? 50 + node.k % 3 : 53;
        B.dab(...V.mad(base, axis, s * 0.56), node.n, axis, s, s * 0.43, 0.016, B.P[shade], 1.34);
        B.dab(...V.mad(base, node.dir, s * 0.48), node.n, node.dir, s * 0.57, s * 0.38, 0.017, B.P[49], 1.20);
      }
    }
  }

  function paintTransmissionLichen(B, S, from, seed, ok) {
    const K = KIT, V = K.V, rng = K.grow.dice(seed * 43 + 8);
    const spread = K.grow.spread(S, { from, steps: 8, gap: 0.086, ok, seed: seed * 41 });
    for (const p of spread.pts) {
      const [x, y, z] = p, h = 0.018;
      const n = V.norm([S.sdf(x + h, y, z) - S.sdf(x - h, y, z), S.sdf(x, y + h, z) - S.sdf(x, y - h, z),
        S.sdf(x, y, z + h) - S.sdf(x, y, z - h)], [0, 1, 0]);
      const u = V.norm(V.cross([0, 1, 0.002], n), [1, 0, 0]), size = 0.028 + rng() * 0.046;
      const color = B.n3(x * 1.2, y * 1.9, z * 1.1) < 0.48 ? [28, 29, 30, 53] : [19, 20, 53, 39];
      const rim = p.step > 6, offset = rim ? 0 : 1;
      B.dab(...V.mad(p, n, 0.025), n, u, size, size * (0.59 + 0.33 * rng()), 0.012,
        B.P[color[offset + Math.floor(rng() * 3)]], rim ? 1.14 : 1.33);
    }
  }

  function plantTransmissionGarden(B, beds, seed, ground, onBank) {
    const K = KIT, V = K.V, rng = K.grow.dice(seed * 431 + 121);
    const S = K.sculpt(makeSculpt(B));
    S.sun = V.norm([-0.32, 0.83, 0.46]);
    S.sunK = 0.79; S.amb = 0.15; S.sky = 0.10;
    const leaves = [[27, 36, 37, 38, 39], [28, 37, 38, 39, 44], [40, 41, 42, 43, 12], [27, 29, 36, 37, 38]];
    function placeLeaf(point, dir, colors, size, wind) {
      const up = [0.08, 1, 0.12 + 0.24 * dir[2]];
      const normal = V.norm(V.sub(up, V.mul(dir, V.dot(up, dir))));
      const across = V.cross(normal, dir);
      const length = (0.15 + rng() * 0.089) * size, width = length * (0.36 + 0.12 * rng());
      const shade = Math.max(1, Math.min(3, Math.floor(2.55 + V.dot(normal, S.sun) * 0.78 + (rng() - 0.55) * 1.8)));
      const row = (a, b, c, d) => colors[a] + 64 * colors[b] + 4096 * colors[c] + 262144 * colors[d];
      const dark = shade - 1, high = shade + 1;
      B.fineTile(row(dark, shade, shade, dark), row(shade, high, shade, shade),
        row(shade, shade, high, shade), row(dark, shade, shade, dark),
        ...V.mul(dir, length * 1.13), ...V.mul(across, width * 1.14), B.P[colors[shade]]);
      B.dab(...point, normal, dir, length, width, 0.018, B.P[colors[shade]], 1,
        { ...wind, ph: wind.ph + (rng() - 0.5) * 0.15, rg: wind.rg * 1.19 });
    }
    const bark = { r: [23, 45, 19, 20], s: [45, 19, 20], root: -0.28,
      mod: (x, y, z) => 0.22 * Math.sin(x * 15 + z * 8 + B.n3(x * 3, y * 0.6, z * 3) * 3.5) };
    const specimens = [
      { base: [-7.56, -0.055, 2.28], crown: [-8.12, 3.77, 2.40], radii: [1.87, 1.25, 1.44], trunk: 1.53, pink: 0.23 },
      { base: [6.65, -0.055, -1.06], crown: [7.41, 4.37, -1.6], radii: [1.99, 1.61, 1.52], trunk: 1.93, pink: 0.05 },
      { base: [-5.70, -0.075, -5.92], crown: [-6.15, 3.12, -6.12], radii: [1.52, 1.32, 1.26], trunk: 1.24, pink: 0 }
    ];
    for (const [i, tree] of specimens.entries()) {
      const [x, root, z] = tree.base, [cx, , cz] = tree.crown;
      const y = Math.max(root, ground(x, z)), base = [x, y, z];
      const crown = V.add(tree.crown, [0, y - root, 0]);
      const upper = [B.mix(x, cx, 0.48), y + tree.trunk, B.mix(z, cz, 0.45)];
      const elbow = [x + (i === 1 ? -0.24 : 0.16), y + tree.trunk * 0.53, z + 0.11];
      const wind = { k: 14, ph: i * 0.82, sp: 1.15 + 0.09 * i, rg: 0.069 - 0.01 * i, ex: upper[1] };
      S.tube(B.spline([base, elbow, upper], 5), i === 2 ? 0.24 : 0.31, 0.16, bark, { res: 0.087 });
      const form = K.form.colonize({ at: upper, trunk: 0.17, crown: { c: crown, r: tree.radii },
        n: i === 2 ? 88 : 146, step: 0.20, influence: 1.40, kill: 0.35, r: 0.029, seed: seed * 117 + i + 1 });
      K.grow.limbs(S, form, { ...bark, fl: wind }, { res: 0.092, melt: 0.05 });
      for (const [j, tip] of form.tips.entries()) {
        const field = K.grow.arrange('spiral', i === 2 ? 6 : 9, { r: 0.35 + 0.079 * (j % 4), dome: 0.57 });
        const top = B.smooth(0.0, 1.4, tip.p[1] - crown[1] + 0.45);
        const bloom = rng() < tree.pink * (0.75 + top);
        for (const f of field) {
          const l = K.grow.put(f, V.mad(tip.p, tip.dir, 0.09), rng() * B.TAU, 1);
          const dir = V.norm([l.dir[0] + tip.dir[0] * 0.28, l.dir[1] * 0.60, l.dir[2] + tip.dir[2] * 0.28]);
          const color = bloom && rng() < 0.68 ? 2 :
            i === 2 ? 3 : top > 0.42 || rng() > 0.80 ? 1 : 0;
          placeLeaf(l.p, dir, leaves[color], color === 2 ? 0.72 : 1, wind);
        }
      }
      for (let k = 0; k < 5; k++) {
        const a = k * B.TAU / 5 + i, r = 0.29 + 0.04 * k;
        S.tube([[x, y + 0.21, z], [x + Math.cos(a) * r, y + 0.08, z + Math.sin(a) * r],
          [x + Math.cos(a) * (r + 0.34), y, z + Math.sin(a) * (r + 0.34)]], 0.11, 0.024, bark, { res: 0.091 });
      }
    }
    S.bake();
    // Fern rosettes feather out beneath the trees and through the gaps between the beds.
    for (const [cx, cz, rx, rz, lift = 0] of beds) {
      if (lift) continue;
      for (let i = 0; i < 49; i++) {
        const a = rng() * B.TAU, q = 0.64 + rng() * 1.32;
        const x = cx + rx * q * Math.cos(a), z = cz + rz * q * Math.sin(a);
        if (!onBank(x, z)) continue;
        const y = ground(x, z), spread = 0.09 + rng() * 0.085;
        B.dab(x, y + 0.025, z, [0, 1, 0], [Math.cos(a), 0, Math.sin(a)], spread * 1.45,
          spread * 0.91, 0.024, B.P[36 + (i % 3 ? 0 : 1)], 1);
        if (i % 6 !== 0 || q < 1.05) continue;
        for (let fan = 0; fan < 5; fan++) {
          const angle = a + fan * B.TAU / 5;
          const out = [Math.cos(angle), 0, Math.sin(angle)], side = [-out[2], 0, out[0]];
          const reach = 0.29 + rng() * 0.32;
          const root = [x, y, z], tip = V.add(V.mad(root, out, reach), [0, reach * 0.58, 0]);
          const wind = { k: 11, ph: a, sp: 1.0, rg: 0.016 };
          B.stick(...V.lerp(root, tip, 0.50), V.norm(V.sub(tip, root)), reach * 0.59, 0.013, B.P[37], 1, wind);
          for (let j = 1; j < 5; j++) for (const sign of [-1, 1]) {
            const t = j / 5, dir = V.norm(V.add(V.mul(side, sign), V.mul(out, 0.63)));
            const size = reach * (0.24 - 0.14 * t), point = V.mad(V.lerp(root, tip, t), dir, size * 0.57);
            B.dab(...point, [0, 1, 0], dir, size, size * 0.37, 0.013, B.P[j % 2 ? 37 : 38], 1, wind);
          }
        }
      }
    }
    for (const [j, bed] of beds.entries()) {
      const [cx, cz, rx, rz, lift = 0] = bed;
      for (let i = 0; i < 39; i++) {
        const angle = rng() * B.TAU, d = 0.85 * Math.sqrt(rng()), x = cx + Math.cos(angle) * d * rx, z = cz + Math.sin(angle) * d * rz;
        const y = lift ? lift - 0.14 + 0.34 * Math.sqrt(1 - d * d) : ground(cx, cz) + 0.29 * Math.sqrt(1 - d * d), stem = 0.13 + rng() * 0.33;
        const dx = (rng() - 0.48) * 0.28, phase = rng() * B.TAU;
        const wind = { k: 11, ph: phase, sp: 0.9, rg: 0.018 };
        B.stick(x + dx * 0.42, y + stem * 0.44, z, V.norm([dx, stem, 0.02]), stem * 0.48, 0.022, B.P[37], 1, wind);
        for (const sign of [-1, 1]) {
          const dir = V.norm([0.68 * sign, 0.48, Math.sin(phase) * 0.52]);
          B.stick(x + dir[0] * 0.06, y + stem * 0.38 + dir[1] * 0.06, z + dir[2] * 0.06,
            dir, 0.079 + stem * 0.14, 0.037, B.P[sign < 0 ? 36 : 38], 1, wind);
        }
        if (i % 4 === 0) continue;
        const n = V.norm([0.22 * Math.cos(phase), 1, 0.38 * Math.sin(phase)]), c = j % 2 ? [41, 42, 43] : [40, 41, 42];
        const r = 0.042 + rng() * 0.044;
        if (i % 6 === 0) {
          for (let rung = 0; rung < 4; rung++) {
            const sign = rung % 2 ? -1 : 1, tall = y + stem + rung * 0.074, span = r * (1 - 0.11 * rung);
            B.stick(x + dx + sign * span * 0.67, tall, z, V.norm([sign, -0.38, 0.1]), span, span * 0.61,
              B.P[c[rung % c.length]], 1, wind);
          }
          continue;
        }
        for (let p = 0; p < 5; p++) {
          const a = phase + p * B.TAU / 5, tx = Math.cos(a), tz = Math.sin(a);
          const plane = V.norm(V.sub([tx, 0, tz], V.mul(n, V.dot(n, [tx, 0, tz]))));
          B.dab(x + dx + tx * r, y + stem + plane[1] * r, z + tz * r, n, plane, r * 0.96, r * 0.51, 0.016,
            B.P[c[(i + p) % c.length]], 1, wind);
        }
        B.iso(x + dx, y + stem + 0.018, z, 0.026, B.P[44], 1, wind);
      }
    }
  }

  return { id: 'transmission', name: 'The Last Transmission', seed: 9, build: sceneTransmission, animate: attachRebirthDynamics };
}

if (typeof module !== 'undefined') module.exports = rebirthTransmission;
