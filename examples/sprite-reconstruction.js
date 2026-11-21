/* One source object supplies the turntable bake and every full-detail copy in the studies. */
function makeSpriteReconstructionStudies({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const palette = [
    0x101421, 0x151b2a, 0x222c40, 0x374656, 0x516575, 0x6b8390, 0x283d42, 0x416767, 0x749792, 0xa6c0a3, 0x342737,
    0x65404a, 0x996256, 0xd98f64, 0xeab888, 0xf5d6a2, 0x225967, 0x248995, 0x57d1c0, 0xa7ffdc, 0xf4fff2, 0x726069,
    0xc07f88, 0xe479a9, 0xffbfbd, 0x454361
  ];
  const metal = { r: [1, 2, 3, 4, 5] },
    ceramic = { r: [10, 11, 12, 13, 14, 15] },
    cool = { r: [6, 7, 8, 9] };
  const jade = { r: [16, 17, 18, 19], em: true },
    amber = { r: [12, 13, 14, 15], em: true },
    glass = { r: [1, 6, 7, 16, 17] };
  const stone = { r: [0, 1, 2, 3] },
    pink = { r: [11, 22, 23, 24], em: true };
  const cameraBase = { target: [0, 0, 0], dist: 4.85, yaw: 0, pitch: 0.14, sway: 0 };
  const art = { pixelSize: 1, splatCoverage: 'continuous' };
  const modes = ['approach', 'bay'];
  function setup(seed) {
    const B = makeBuilder(seed, palette),
      S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-0.48, 0.68, 0.64]);
    S.amb = 0.38;
    S.sky = 0.29;
    S.sunK = 0.55;
    S.wob = 0.015;
    S.aoK = 0.55;
    return { B, S, lamps: [] };
  }
  function actor({ B, S, lamps }, kind, object, at, yaw = 0, scale = 1) {
    const c = Math.cos(yaw),
      s = Math.sin(yaw),
      frame = B.frame(yaw, 0, 0);
    const p = ([x, y, z]) => [at[0] + scale * (c * x + s * z), at[1] + scale * y, at[2] + scale * (c * z - s * x)];
    const dims = h => h.map(n => n * scale);
    const opt = (res, more) => ({ objectId: object, res: res * scale, ...more });
    const box = (at, half, mat, res = 0.084, rd = 0.044) =>
      S.box(p(at), dims(half), mat, opt(res, { rd: rd * scale, ax: frame }));
    const ball = (at, rad, mat, res = 0.064) =>
      S.ball(p(at), Array.isArray(rad) ? dims(rad) : rad * scale, mat, opt(res, { ax: frame }));
    const lathe = (at, h, r, mat, res = 0.065) =>
      S.lathe(p(at), h * scale, Array.isArray(r) ? dims(r) : r * scale, mat, opt(res));
    const tube = (points, r, mat, res = 0.068) => S.tube(points.map(p), r * scale, r * scale, mat, opt(res));
    function lens(at, r, offset) {
      lamps.push({ object, at: p(at), r: r * scale, offset });
    }
    if (kind === 'courier') {
      box([0, -0.04, -0.12], [0.78, 0.32, 0.63], metal, 0.055, 0.16);
      box([0, 0.18, -0.1], [0.775, 0.165, 0.57], ceramic, 0.053, 0.14);
      box([0, 0.062, 0.52], [0.61, 0.223, 0.16], ceramic, 0.045, 0.102);
      box([0, 0.096, 0.64], [0.525, 0.153, 0.063], metal, 0.038, 0.058);
      box([0, 0.102, 0.699], [0.442, 0.102, 0.025], glass, 0.031, 0.021);
      for (const sign of [-1, 1]) {
        box([sign * 0.83, -0.15, -0.22], [0.3, 0.117, 0.42], metal, 0.058, 0.102);
        box([sign * 1.03, -0.09, -0.265], [0.196, 0.16, 0.373], ceramic, 0.049, 0.081);
        lathe([sign * 1.04, -0.33, -0.25], 0.154, [0.177, 0.166], ceramic, 0.042);
        ball([sign * 1.04, -0.38, -0.25], [0.117, 0.061, 0.117], amber, 0.043);
        box([sign * 0.964, -0.018, 0.067], [0.129, 0.052, 0.051], cool, 0.032, 0.02);
        box([sign * 0.847, -0.148, 0.224], [0.15, 0.039, 0.038], jade, 0.026, 0.016);
        tube(
          [
            [sign * 0.738, 0.2, 0.28],
            [sign * 0.74, 0.24, -0.05],
            [sign * 0.65, 0.25, -0.36]
          ],
          0.022,
          cool,
          0.048
        );
        lens([sign * 0.218, 0.106, 0.737], 0.047, sign < 0 ? 0 : 2);
      }
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 0.115;
        box([x, -0.065, -0.727], [0.032, 0.105, 0.041], metal, 0.029, 0.02);
        if (i % 2 === 1) box([x, -0.065, -0.762], [0.023, 0.054, 0.009], amber, 0.019, 0.008);
      }
      box([-0.275, 0.332, -0.124], [0.3, 0.034, 0.315], metal, 0.035, 0.022);
      for (let i = 0; i < 5; i++) box([-0.445 + i * 0.078, 0.368, -0.128], [0.024, 0.023, 0.215], cool, 0.022, 0.016);
      tube(
        [
          [0.39, 0.3, -0.27],
          [0.44, 0.54, -0.27],
          [0.57, 0.68, -0.32]
        ],
        0.032,
        ceramic,
        0.028
      );
      ball([0.57, 0.683, -0.32], 0.052, amber, 0.026);
      box([-0.38, -0.24, 0.42], [0.075, 0.126, 0.1], cool, 0.038, 0.032);
      box([0.38, -0.24, 0.42], [0.075, 0.126, 0.1], cool, 0.038, 0.032);
    } else {
      lathe([0, -1.34, 0], 0.15, [0.46, 0.41], metal, 0.083);
      lathe([0, -1.24, 0], 0.19, [0.4, 0.24], ceramic, 0.072);
      lathe([0, -1.14, 0], 1.66, [0.198, 0.14], metal, 0.072);
      lathe([0, 0.76, 0], 0.32, [0.27, 0.16], ceramic, 0.064);
      lathe([0, 0.89, 0], 0.2, [0.154, 0.061], metal, 0.049);
      for (const h of [-0.78, -0.45, -0.12]) lathe([0, h, 0], 0.029, [0.217, 0.205], cool, 0.05);
      lathe([0, 0.59, 0], 0.155, [0.24, 0.24], jade, 0.054);
      lathe([0, 0.49, 0], 0.107, [0.228, 0.253], metal, 0.051);
      tube(
        [
          [0, 0.26, 0],
          [0.18, 0.42, 0],
          [0.47, 0.44, 0]
        ],
        0.071,
        ceramic,
        0.06
      );
      box([0.48, 0.51, 0], [0.172, 0.095, 0.134], metal, 0.042, 0.056);
      box([0.48, 0.509, 0.121], [0.105, 0.052, 0.026], jade, 0.028, 0.016);
      for (const sign of [-1, 1]) {
        tube(
          [
            [0, 0.845, sign * 0.14],
            [0, 1.15, sign * 0.143],
            [0, 1.255, sign * 0.055]
          ],
          0.038,
          cool,
          0.044
        );
        ball([0, 1.258, sign * 0.056], 0.047, amber, 0.03);
      }
    }
  }
  function finish(context, options = {}) {
    const { B, S, lamps } = context;
    S.bake();
    for (const lamp of lamps) {
      lamp.index = B.count();
      B.iso(...lamp.at, lamp.r, [143, 235, 205], 2.3, { em: true });
      B.describeSplats(lamp.index, lamp.index + 1, {
        object: lamp.object,
        target: { entity: lamp.object, surface: 'navigation-light' }
      });
    }
    const world = B.finish({ cam: cameraBase, radius: 80, dither: 0, look: art, ...options });
    function pose(time) {
      const phase = Math.floor(Math.max(0, time) * 4 + 1e-7) % 4;
      for (const { index, offset } of lamps) {
        const c = (phase + offset) % 4;
        const colors = [0xe2ffb2, 0xcce77c, 0x889b31, 0xb4c957];
        world.data[index * 16 + 7] = colors[c];
      }
    }
    pose(0);
    return { world, pose, changedRows: () => [...new Set(lamps.map(lamp => lamp.index >> 9))] };
  }
  function prototype(kind) {
    if (!['courier', 'beacon'].includes(kind)) throw new RangeError('Unknown sprite study prototype');
    const context = setup(38);
    actor(context, kind, kind, [0, 0, 0]);
    return finish(context, {
      cam: { ...cameraBase, dist: kind === 'courier' ? 4.32 : 5.9 },
      radius: 4,
      fog: { c: 0, start: 1, max: 0 }
    });
  }

  function scene(study, atlases) {
    if (!modes.includes(study)) throw new RangeError('Unknown sprite reconstruction study');
    const context = setup(41),
      { B, S } = context;
    const artAtlas = SpriteSurface.make(512),
      font = K.inspection.font({});
    function label(text, at, width, color) {
      const columns = text.length * 6,
        letters = [...text].map(c => font.get(c));
      artAtlas.face(at, [width, 0, 0], [0, (width * 7) / columns, 0], columns, 7, (u, v) =>
        letters[Math.floor(u / 6)]?.[v * 6 + (u % 6)] ? color : undefined
      );
    }
    const box = (at, half, mat) => {
      const rgb = value => [value >> 16, (value >> 8) & 255, value & 255];
      for (let axis = 0; axis < 3; axis++)
        for (const side of [-1, 1]) {
          const u = (axis + 1) % 3,
            v = (axis + 2) % 3;
          const tone = Math.max(0, side * [-0.48, 0.68, 0.64][axis]);
          const ramp = mat.r;
          const color = rgb(palette[ramp[Math.min(ramp.length - 1, Math.floor((0.32 + tone * 0.87) * ramp.length))]]);
          let face = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1]
          ].map(([x, y]) => {
            const point = at.slice();
            point[axis] += side * half[axis];
            point[u] += x * half[u];
            point[v] += y * half[v];
            return point;
          });
          if (side < 0) face = face.reverse();
          panel(...face, color);
        }
    };
    const strip = (a, b, r, mat) => {
      box(K.V.mul(K.V.add(a, b), 0.5), [r, r, Math.abs(a[2] - b[2]) * 0.5], mat);
    };
    const field = K.sprite.reconstruction;
    const source = {
      courier: field.asset({ atlas: atlases.courier, range: study === 'approach' ? [7.2, 11.1] : [6.2, 10.6] }),
      beacon: field.asset({ atlas: atlases.beacon, range: study === 'approach' ? [6.4, 10.2] : [6.8, 11.7] })
    };
    const placements = [];
    function place(kind, at, yaw, scale = 1) {
      const object = kind + '-' + placements.length;
      actor(context, kind, object, at, yaw, scale);
      placements.push({ asset: source[kind], object, at, yaw, scale, ...(kind === 'courier' && { playback: 'loop' }) });
    }
    const panel = (a, b, c, d, color) => {
      K.surfacePatches.triangle(B, [a, b, c], { color, object: 'deck' });
      K.surfacePatches.triangle(B, [a, c, d], { color, object: 'deck' });
    };
    if (study === 'approach') {
      for (let n = 0; n < 16; n++) {
        const z = -n * 2.38 + 3;
        panel(
          [-5.8, -0.1, z],
          [-5.8, -0.1, z - 2.38],
          [5.8, -0.1, z - 2.38],
          [5.8, -0.1, z],
          n % 2 ? [31, 38, 54] : [28, 35, 49]
        );
        for (const side of [-1, 1]) {
          box([side * 4.92, 0.037, z - 1.09], [0.21, 0.14, 1.08], metal);
          box([side * 3.25, -0.061, z - 0.53], [0.097, 0.03, 0.46], n % 3 === 0 ? amber : cool);
          if (n % 2 === 0) {
            box([side * 5.43, 2.65, z - 1.5], [0.34, 2.8, 0.23], metal);
            box([side * 5.38, 4.97, z - 1.51], [0.79, 0.16, 0.14], cool);
            box([side * 5.45, 2.1, z - 1.27], [0.089, 0.39, 0.057], n % 4 ? jade : pink);
          }
        }
      }
      for (const side of [-1, 1]) {
        strip([side * 3.12, 0.061, 6], [side * 3.12, 0.061, -35], 0.048, metal);
        strip([side * 5.2, 4.95, 3], [side * 5.2, 4.95, -36], 0.077, pink);
        strip([side * 5.5, 4.79, 3], [side * 5.5, 4.79, -36], 0.115, metal);
      }
      for (let i = 0; i < 19; i++)
        for (const side of [-1, 1]) {
          const z = -i * 3.5 + 6,
            x = side * (7.8 + 3.8 * K.hash(i, side, 77)),
            h = 3.8 + 7.2 * K.hash(i, side, 49);
          box([x, h * 0.46 - 0.45, z], [1.14, h * 0.5, 1.36], i % 2 ? stone : metal);
          for (let y = 1.15; y < h - 0.6; y += 0.67)
            for (const zt of [-0.72, 0, 0.72]) {
              if (K.hash(i, (y * 100) | 0, (zt * 100) | 0) > 0.31)
                box([x - side * 1.15, y, z + zt], [0.012, 0.065, 0.12], ((i + y) | 0) % 3 ? cool : pink);
            }
        }
      box([0, 3.8, -35.8], [5.5, 3.9, 0.18], stone);
      box([0, 2.48, -35.45], [2.86, 2.6, 0.15], metal);
      box([0, 2.42, -35.21], [2.42, 2.54, 0.105], stone);
      for (const side of [-1, 1]) {
        box([side * 2.56, 2.5, -35.03], [0.064, 2.4, 0.065], jade);
        for (let j = 0; j < 7; j++) box([side * 4.15, 1.05 + j * 0.67, -35.42], [0.48, 0.024, 0.043], pink);
      }
      for (const z of [-1.5, -10.8, -22.1]) {
        box([0, 5.75, z], [5.49, 0.295, 0.28], metal);
        box([0, 5.29, z], [1.85, 0.26, 0.1], stone);
        label('SIGNAL TRANSIT', [-1.5, 5.2, z + 0.111], 3, 0x94f0cb);
      }
      for (const [x, z, yaw] of [
        [-3.73, -2.6, 0.13],
        [3.73, -5.6, -0.22],
        [-3.73, -11.4, 0.03],
        [3.73, -14.4, 0.42],
        [-3.73, -18.5, -0.35],
        [3.73, -21.7, 0.09]
      ])
        place('beacon', [x, 1.25, z], yaw, 0.92);
      for (const [x, y, z, yaw] of [
        [0.12, 1.98, -12.25, 0.22],
        [-1.82, 1.52, -4.1, -0.19],
        [2.02, 1.28, -7.05, 0.35],
        [-1.71, 2.01, -19.5, -0.4],
        [1.8, 1.53, -21.2, 0.48],
        [0.3, 2.15, -26.0, -0.14]
      ])
        place('courier', [x, y, z], yaw, 0.92);
    } else {
      for (let j = -6; j <= 6; j++)
        for (let i = -6; i <= 6; i++) {
          if (Math.hypot(i, j) > 8) continue;
          const l = i * 0.81,
            z = j * 0.81;
          panel(
            [l, -0.15, z],
            [l + 0.78, -0.15, z],
            [l + 0.78, -0.15, z + 0.78],
            [l, -0.15, z + 0.78],
            (i + j) % 2 ? [34, 44, 61] : [29, 39, 53]
          );
        }
      artAtlas.face([-2.19, 0.14, 2.19], [4.38, 0, 0], [0, 0, -4.38], 144, 144, (u, v) => {
        const x = (u + 0.5 - 72) / 72,
          y = (v + 0.5 - 72) / 72,
          r = Math.hypot(x, y);
        if (r >= 1) return;
        if (r > 0.958) return 0x4d7074;
        if (r > 0.921) return 0x1c323a;
        if (r > 0.76 && Math.abs(x - y) < 0.014) return 0x598480;
        if (Math.abs(x) < 0.021 || Math.abs(y) < 0.021) return r > 0.67 ? 0x52777a : 0x344f57;
        return (Math.floor(u / 12) + Math.floor(v / 12)) % 2 ? 0x314d52 : 0x354f56;
      });
      for (let i = 0; i < 36; i++) {
        const at = (n, y, r) => [r * Math.sin((n * Math.PI) / 18), y, r * Math.cos((n * Math.PI) / 18)];
        panel(at(i, -0.14, 2.28), at(i + 1, -0.14, 2.28), at(i + 1, 0.14, 2.19), at(i, 0.14, 2.19), [39, 62, 72]);
      }
      for (let n = 0; n < 28; n++) {
        const a = (n * Math.PI * 2) / 28,
          x = 2.09 * Math.sin(a),
          z = 2.09 * Math.cos(a);
        S.box([x, 0.15, z], [0.094, 0.022, 0.073], n % 4 === 0 ? amber : jade, { res: 0.063, ax: B.frame(a, 0, 0) });
        if (n % 4 === 0)
          S.box([x * 1.185, 0.039, z * 1.185], [0.145, 0.019, 0.064], metal, { res: 0.08, ax: B.frame(a, 0, 0) });
      }
      for (const side of [-1, 1]) {
        box([side * 3.48, 1.49, -2.12], [0.26, 1.9, 0.29], metal);
        box([side * 3.45, 1.61, -1.82], [0.1, 1.24, 0.051], pink);
        box([side * 2.65, 0.21, 1.5], [0.54, 0.26, 0.6], ceramic);
        for (let i = 0; i < 5; i++) box([side * 2.65, 0.484, 1.14 + i * 0.15], [0.47, 0.021, 0.018], metal);
      }
      box([0, 3.43, -2.15], [3.61, 0.2, 0.31], metal);
      box([0, 3.09, -1.86], [1.47, 0.19, 0.062], stone);
      label('COURIER BAY', [-1.23, 3.035, -1.789], 2.46, 0xffd596);
      place('courier', [0, 1.74, 0], 0.16, 1.09);
      place('beacon', [-2.3, 1.2, -1.28], 0.52, 0.89);
      place('beacon', [2.3, 1.2, -1.28], -0.12, 0.89);
    }
    const result = finish(context, {
      spriteSurfaces: artAtlas.finish(),
      fog: { c: 0, start: study === 'approach' ? 0.43 : 0.88, max: study === 'approach' ? 0.79 : 0.1 }
    });
    field.bind(result.world, placements);
    const target = study === 'approach' ? [0, 1.65, -12.25] : [0, 1.53, 0];
    function camera(progress, orbit = 0) {
      const t = Math.max(0, Math.min(1, progress));
      return {
        target,
        dist: study === 'approach' ? 22 - 16 * t : 12.6 - 8.6 * t,
        yaw: (study === 'approach' ? 0.028 : 0.19) + orbit,
        pitch: study === 'approach' ? 0.083 : 0.18,
        sway: 0
      };
    }
    result.world.cam = camera(0);
    return {
      ...result,
      camera,
      title: study === 'approach' ? 'Signal Approach' : 'Courier Bay',
      focus: 'courier-' + (study === 'approach' ? 6 : 0)
    };
  }
  return { prototype, scene, modes };
}
if (typeof module !== 'undefined') module.exports = makeSpriteReconstructionStudies;
