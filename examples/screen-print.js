/* Two little moving worlds printed in separately registered native ink plates. */
function screenPrintDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const V = K.V,
    TAU = Math.PI * 2,
    state = {
      view: 'flower',
      recipe: 'duotone',
      shape: 'circle',
      space: 'surface',
      spacing: 0.22,
      dotGain: 0.02,
      registration: 0.025,
      proof: 'all',
      knockout: false,
      reverse: false,
      grain: true,
      native: false,
      paused: false,
      turntable: false,
      movingLight: true,
      time: 0
    };
  const palette = [0xf6e9cc, 0x183f59, 0x2c6781, 0x6195a0, 0xa3c4be, 0xe27655, 0xf6ad79, 0xf0d6ad, 0xfff3d8];
  const single = (id, ink, solid = false) => ({
    paper: '#f6e9cc',
    spacing: 0.22,
    plates: [{ id, ink, channel: 'luma', gain: solid ? 2 : 1 }],
    chart: { projection: 'plane' },
    lighting: solid ? 0 : 1
  });
  const cool = single('blue', '#14607e'),
    warm = single('vermilion', '#ed6744'),
    coolSolid = single('blue', '#14607e', true),
    warmSolid = single('vermilion', '#ed6744', true);
  const dark = { r: [2], screenPrint: coolSolid },
    blue = { r: [7], screenPrint: cool },
    red = { r: [7], screenPrint: warm },
    cream = { r: [7], screenPrint: cool },
    outline = { r: [2], screenPrint: warmSolid };
  const controls = {},
    worlds = {},
    rigs = {};
  function setup(seed) {
    const B = makeBuilder(seed, palette),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, {
      pixel: false,
      amb: 0.35,
      sky: 0.25,
      sunK: 0.8,
      fat: 0.42,
      aoK: 0.05,
      wob: 0,
      shK: 1,
      sun: V.norm([-0.5, 0.8, 0.6])
    });
    return { B, S };
  }
  function finish(B, cam) {
    return B.finish({
      cam,
      radius: 18,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: {
        pixelSize: 1,
        clean: 1,
        splatCoverage: 'continuous',
        screenPrint: { ...K.screenPrint.preset('duotone'), spacing: 0.22, lighting: 0.8 }
      }
    });
  }
  function matrix(a, pivot, axis = [0, 0, 1], translation = [0, 0, 0]) {
    const R = K.M.rot(axis, a),
      p = K.M.app(R, pivot);
    return [...R, ...pivot.map((v, i) => v - p[i] + translation[i])];
  }
  {
    const { B, S } = setup(26),
      tags = K.deform.tags(S),
      axes = a => {
        const m = K.M.rot([0, 0, 1], a);
        return [
          [m[0], m[3], m[6]],
          [m[1], m[4], m[7]],
          [m[2], m[5], m[8]]
        ];
      };
    // Three petal whorls form a real layered, curved sculpture.
    for (let ring = 0; ring < 2; ring++)
      for (let j = 0; j < 12; j++) {
        const a = ((j + ring * 0.5) * TAU) / 12,
          r = ring ? 0.64 : 1.1,
          c = [Math.cos(a) * r, 2.7 + Math.sin(a) * r, -0.08 + ring * 0.18];
        S.ball(c, [0.37, ring ? 0.77 : 1.06, 0.17], red, {
          ax: axes(a - Math.PI / 2),
          res: 0.068,
          tag: 'bloom',
          objectId: 'petal-' + ring
        });
        // Raised petal veins retain tiny independent print contours.
        S.tube(
          [
            [c[0] * 0.65, 2.7 + (c[1] - 2.7) * 0.65, c[2] + 0.13],
            [c[0] * 1.2, 2.7 + (c[1] - 2.7) * 1.2, c[2] + 0.1]
          ],
          0.022,
          0.012,
          blue,
          { res: 0.045, tag: 'bloom', objectId: 'petal-veins' }
        );
      }
    S.ball([0, 2.7, 0.36], [0.57, 0.57, 0.22], dark, { res: 0.06, tag: 'bloom', objectId: 'seed-head' });
    for (let j = 0; j < 60; j++) {
      const a = j * 2.399963,
        r = 0.48 * Math.sqrt((j + 0.5) / 60);
      S.ball([r * Math.cos(a), 2.7 + r * Math.sin(a), 0.55 + 0.06 * (1 - r / 0.5)], 0.039, cream, {
        res: 0.03,
        tag: 'bloom',
        objectId: 'seeds'
      });
    }
    S.tube(
      [
        [0, -0.16, 0],
        [0.13, 0.7, 0],
        [-0.13, 1.7, -0.08],
        [0, 2.7, 0]
      ],
      0.12,
      0.08,
      dark,
      { res: 0.075, objectId: 'stem' }
    );
    for (const sign of [-1, 1]) {
      const c = [sign * 0.87, 0.85 + sign * 0.22, 0.06];
      S.ball(c, [0.95, 0.34, 0.14], blue, { ax: axes(sign * 0.38), res: 0.072, objectId: 'leaves' });
      S.tube(
        [
          [0, 0.65, 0],
          [c[0] * 0.6, c[1], 0.2],
          [c[0] * 1.65, c[1] + 0.15, 0.1]
        ],
        0.033,
        0.012,
        dark,
        { res: 0.045, objectId: 'leaf-veins' }
      );
      for (let j = 0; j < 6; j++) {
        const x = sign * (0.26 + j * 0.18),
          y = c[1] + (j - 2) * 0.05;
        S.tube(
          [
            [x, y, 0.18],
            [x + sign * 0.12, y + 0.15, 0.15]
          ],
          0.014,
          0.007,
          cream,
          { res: 0.035, objectId: 'leaf-veins' }
        );
      }
    }
    // A tiny butterfly flaps above the lower leaf.
    for (const sign of [-1, 1])
      S.ball([1.45 + sign * 0.28, 1.25, 0.4], [0.35, 0.37, 0.065], red, {
        ax: axes(sign * 0.35),
        res: 0.048,
        tag: sign < 0 ? 'wing-left' : 'wing-right',
        objectId: 'butterfly'
      });
    S.ball([1.45, 1.23, 0.48], [0.055, 0.29, 0.06], dark, { res: 0.03, objectId: 'butterfly-body' });
    S.lathe([0, -0.42, 0], 0.3, 2.25, cream, { res: 0.13, objectId: 'ceramic-plinth' });
    S.torus([0, -0.08, 0], 2.1, 0.055, red, { res: 0.07, objectId: 'plinth-rim' });
    for (let j = 0; j < 12; j++) {
      const a = (j * TAU) / 12;
      S.ball([Math.cos(a) * 1.6, -0.04, Math.sin(a) * 1.1], [0.14, 0.08, 0.14], blue, {
        res: 0.07,
        objectId: 'pebbles'
      });
    }
    S.ball([0.12, 2.75, -0.48], [2.15, 2.15, 0.07], { r: [8] }, { res: 0.105, objectId: 'registered-sun-disc' });
    S.bake();
    const w = finish(B, { target: [0, 1.8, 0], dist: 11.5, yaw: 0.19, pitch: 0.13, ortho: true }),
      ids = tags.of('bloom', 'wing-left', 'wing-right'),
      left = new Set(tags['wing-left']),
      right = new Set(tags['wing-right']),
      M = new Float32Array(36);
    rigs.flower = K.bones.bind(w, {
      ids,
      bid: Float32Array.from(ids, i => (left.has(i) ? 1 : right.has(i) ? 2 : 0)),
      M,
      pose(t) {
        M.set(matrix(0.045 * Math.sin(t * 0.8), [0, 2.7, 0]), 0);
        for (let b = 1; b < 3; b++)
          M.set(matrix((b === 1 ? -1 : 1) * (0.2 + 0.6 * Math.sin(t * 3.1)), [1.45, 1.25, 0.4], [0, 1, 0]), b * 12);
      }
    });
    worlds.flower = w;
  }
  {
    const { B, S } = setup(67),
      tags = K.deform.tags(S);
    S.lathe([0, 1.1, 0], 3.2, t => 0.67 * Math.sqrt(Math.max(0.0001, 1 - Math.max(0, (t - 0.58) / 0.42) ** 2)), cream, {
      maxRadius: 0.7,
      res: 0.078,
      tag: 'rocket',
      objectId: 'hull'
    });
    for (const y of [1.16, 1.4, 3.25])
      S.torus([0, y, 0], 0.68, 0.055, outline, { res: 0.055, tag: 'rocket', objectId: 'hull-bands' });
    S.torus([0, 2.9, 0.65], 0.32, 0.078, blue, { ax: S.AZ, res: 0.05, tag: 'rocket', objectId: 'porthole-rim' });
    S.ball([0, 2.9, 0.7], [0.265, 0.265, 0.07], dark, { res: 0.04, tag: 'rocket', objectId: 'porthole' });
    S.ball([-0.07, 2.99, 0.77], [0.08, 0.08, 0.025], cream, { res: 0.03, tag: 'rocket', objectId: 'porthole-glint' });
    S.bake();
    const rocketStart = 0;
    // Polygon fins combine the previous representation with attached print screens.
    const finStart = B.count();
    for (let j = 0; j < 3; j++) {
      const a = (j * TAU) / 3 + 0.15,
        co = Math.cos(a),
        si = Math.sin(a),
        mesh = K.mosaic.mesh(
          [
            {
              key: 'fin-' + j,
              polygon: [
                [0, 0],
                [0.9, 0],
                [0.12, 1.4]
              ]
            }
          ],
          {
            gap: 0,
            bevel: 0.018,
            bevelDepth: 0.018,
            thickness: 0.07,
            grout: false,
            palette: ['#e27655'],
            sample: ([u, v], h) => [(0.52 + u) * co + h * si, 0.67 + v, (0.52 + u) * si - h * co]
          }
        );
      K.mosaic.emit(B, mesh, { object: 'rocket-fins', ambient: 0.85 });
    }
    const rocketEnd = B.count();
    S.lathe([0, 0.32, 0], 0.85, t => 0.3 + Math.sin(Math.PI * t) * 0.2, red, {
      res: 0.06,
      tag: 'flame',
      objectId: 'exhaust'
    });
    S.lathe([0, 0.18, 0], 0.78, t => 0.08 + 0.19 * Math.sin(Math.PI * t), cream, {
      res: 0.06,
      tag: 'flame',
      objectId: 'flame-core'
    });
    S.bake();
    const flame = tags.flame ?? [];
    S.lathe([0, -0.5, 0], 0.34, 2.75, dark, { res: 0.14, objectId: 'launch-island' });
    S.torus([0, -0.11, 0], 2.4, 0.06, red, { res: 0.075, objectId: 'landing-circle' });
    for (let j = 0; j < 10; j++) {
      const a = j * 2.4,
        r = 1.2 + (j % 3) * 0.35;
      S.torus([Math.cos(a) * r, -0.1, Math.sin(a) * r], 0.14 + 0.03 * (j % 3), 0.035, dark, {
        res: 0.055,
        objectId: 'craters'
      });
    }
    S.ball([-1.8, 3.5, -1.3], 0.82, red, { res: 0.1, objectId: 'planet' });
    S.torus([-1.8, 3.5, -1.3], 1.18, 0.085, dark, {
      res: 0.07,
      ax: [
        [1, 0, 0],
        [0, 0.8, 0.6],
        [0, -0.6, 0.8]
      ],
      objectId: 'planet-rings'
    });
    S.ball([1.6, 4.6, -1], 0.19, blue, { res: 0.045, objectId: 'moon' });
    for (const [x, y] of [
      [-2.8, 2.4],
      [2.1, 3.7],
      [1.3, 4.9],
      [-1.4, 4.95]
    ]) {
      S.tube(
        [
          [x - 0.12, y, -0.8],
          [x + 0.12, y, -0.8]
        ],
        0.018,
        0.018,
        dark,
        { res: 0.04, objectId: 'stars' }
      );
      S.tube(
        [
          [x, y - 0.12, -0.8],
          [x, y + 0.12, -0.8]
        ],
        0.018,
        0.018,
        dark,
        { res: 0.04, objectId: 'stars' }
      );
    }
    S.bake();
    const w = finish(B, { target: [-0.2, 2.1, -0.2], dist: 12.8, yaw: 0.32, pitch: 0.17, ortho: true }),
      ids = Array.from({ length: rocketEnd - rocketStart }, (_, i) => i + rocketStart).concat(flame),
      flames = new Set(flame),
      M = new Float32Array(24);
    rigs.rocket = K.bones.bind(w, {
      ids,
      bid: Float32Array.from(ids, i => (flames.has(i) ? 1 : 0)),
      M,
      pose(t) {
        const bob = 0.14 * Math.sin(t * 1.2);
        M.set(matrix(0.025 * Math.sin(t * 0.8), [0, 1.1, 0], [0, 0, 1], [0, bob, 0]), 0);
        M.set(matrix(0.06 * Math.sin(t * 5), [0, 1, 0], [0, 0, 1], [0, bob, 0]), 12);
      }
    });
    worlds.rocket = w;
  }
  for (const [id, w] of Object.entries(worlds))
    controls[id] = K.cameraRig.control(() => ({ camera: w.cam }), { handoff: 0.3 });
  function recipe() {
    const base = K.screenPrint.preset(state.recipe, {
      spacing: state.space === 'screen' ? state.spacing * 42 : state.spacing,
      space: state.space,
      dotGain: state.dotGain,
      grain: state.grain ? 0.05 : 0,
      lighting: 0.8
    });
    return {
      ...base,
      chart: { projection: 'plane' },
      plates: base.plates.map((p, i) => ({
        ...p,
        shape: state.shape,
        offset: [state.registration * i, state.registration * i * 0.55],
        blend: state.knockout ? 'knockout' : 'overprint',
        order: state.reverse ? -i : i,
        enabled: state.proof === 'all' || p.id === state.proof
      }))
    };
  }
  const roles = new Map(
    Object.values(worlds).map(w => [
      w,
      w.engraving.styles.map(s => {
        const p = s.screenPrint;
        return p?.plates.length === 1 ? { id: p.plates[0].id, solid: p.plates[0].gain === 2 } : null;
      })
    ])
  );
  function edit() {
    const p = recipe();
    for (const w of Object.values(worlds))
      for (let slot = 1; slot <= w.engraving.styles.length; slot++)
        if (w.engraving.styles[slot - 1].screenPrint) {
          const role = roles.get(w)[slot - 1],
            inks =
              role && state.recipe === 'duotone'
                ? p.plates
                    .filter(q => q.id === role.id)
                    .map(q => ({ ...q, channel: 'luma', gain: role.solid ? 2 : 1.05, gamma: 1.1 }))
                : p.plates;
          K.screenPrint.update(w, slot, {
            ...p,
            lighting: role?.solid ? 0 : role ? 1 : 0.45,
            exposure: role?.solid ? 0 : role ? -0.1 : 0.15,
            contrast: role ? 1.15 : 1.05,
            plates: inks
          });
        }
  }
  edit();
  return {
    state,
    worlds,
    recipe,
    edit,

    get world() {
      return worlds[state.view];
    },
    get control() {
      return controls[state.view];
    },
    get light() {
      const t = state.movingLight ? state.time : 0.7;
      return V.norm([-0.6 + 0.5 * Math.sin(t * 0.45), 0.75, 0.5 + 0.3 * Math.cos(t * 0.45)]);
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      rigs.flower.update(dt, state.time);
      rigs.rocket.update(dt, state.time);
      if (state.turntable) this.control.input({ yaw: dt * 0.1 });
    },
    reset() {
      Object.assign(state, {
        recipe: 'duotone',
        shape: 'circle',
        space: 'surface',
        spacing: 0.22,
        dotGain: 0.02,
        registration: 0.025,
        proof: 'all',
        knockout: false,
        reverse: false,
        grain: true,
        native: false,
        paused: false,
        turntable: false,
        movingLight: true,
        time: 0
      });
      edit();
      for (const c of Object.values(controls)) c.release();
    }
  };
}
if (typeof module !== 'undefined') module.exports = screenPrintDemo;
