/* Optional SDF-to-plane representations in a living garden and machine court. */
function facetedSurfacesDemo({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const palette = [0x101725, 0x1e293a, 0x34364e, 0x594765, 0x806181, 0xab869e, 0xe1b172, 0xffdfa5];
  const state = { view: 'quarry', faceted: true, size: 0.36, grouping: 'normal', grain: 0, paused: false, time: 0 };
  let worlds = {},
    rig,
    cameras = {},
    buildStats = {};
  const finish = (B, cam, extra = {}) =>
    B.finish({
      cam,
      radius: 30,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' },
      ...extra
    });
  function setup(seed) {
    const B = makeBuilder(seed, palette),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, { wob: 0, fat: 0.36, amb: 0.32, sun: [-0.6, 0.8, 0.5], aoK: 0.16, sky: 0.15 });
    return { B, S };
  }
  function object(B, S, kind, at, half, colors, name, options = {}) {
    const ramp = colors.map(c => palette.indexOf(c)).filter(i => i >= 0),
      mat = { r: ramp.length ? ramp : [2, 3, 4] };
    const p =
      kind === 'ball'
        ? S.ball(at, half, mat, { hold: state.faceted, res: 0.065 })
        : S.box(at, half, mat, { hold: state.faceted, res: 0.075, rd: options.round ?? 0.1 });
    if (!state.faceted) return;
    const plan = K.facets.fromSdf(p.sd, {
      bounds: { min: at.map((x, i) => x - half[i] - 0.12), max: at.map((x, i) => x + half[i] + 0.12) },
      size: options.size ?? state.size,
      orientation: (options.orientation ?? [0, 0, 0]).map((x, i) => x + state.grain * [0.5, 1, 0.3][i]),
      method: kind === 'ball' ? 'surfaceNets' : 'dualContour'
    });
    const batch = K.facets.draw(B, plan, {
      palette: colors.map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255]),
      grouping: state.grouping,
      normalAngle: 0.44,
      groupSize: 0.65,
      shadeSteps: 7,
      ambient: 0.36,
      variation: 0.04,
      object: name,
      seed: seedOf(name)
    });
    return batch;
  }
  function seedOf(s) {
    let h = 1;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function leaf(B, a, b, side, color) {
    const mid = K.V.mul(K.V.add(a, b), 0.5),
      p = K.V.add(mid, side),
      q = K.V.sub(mid, side);
    for (const points of [
      [a, p, b],
      [a, b, q]
    ])
      K.surfacePatches.triangle(B, points, { color, opacity: 1, object: 'golden-foliage', material: 'petal' });
  }
  function quarry() {
    const { B, S } = setup(43);
    object(B, S, 'box', [0, -0.25, 0], [3, 0.3, 2.15], [0x1e293a, 0x34364e, 0x594765], 'quarry-plinth', {
      size: 0.45,
      round: 0.2
    });
    const rocks = [
      [-0.8, 0.9, -0.25, 1.04, 1.4, 0.9],
      [0.75, 0.58, 0.15, 0.85, 1.08, 0.7],
      [1.65, 0.25, -0.7, 0.65, 0.72, 0.58],
      [-1.8, 0.28, 0.65, 0.58, 0.65, 0.55],
      [-0.45, 0.12, 1.3, 0.55, 0.4, 0.42]
    ];
    for (const [i, [x, y, z, rx, ry, rz]] of rocks.entries())
      object(B, S, 'ball', [x, y, z], [rx, ry, rz], [0x34364e, 0x594765, 0x806181, 0xab869e], 'basalt-' + i, {
        orientation: [0.18 + i * 0.13, 0.3 + i * 0.27, 0.14]
      });
    for (let i = 0; i < 25; i++) {
      const a = i * 2.4,
        x = Math.cos(a) * (1.5 + (i % 4) * 0.28),
        z = Math.sin(a) * (1.15 + (i % 3) * 0.22);
      for (let j = 0; j < 3; j++) {
        const t = a + j * 1.5,
          root = [x, 0.06, z],
          tip = [x + Math.cos(t) * 0.13, 0.22 + (i % 4) * 0.04, z + Math.sin(t) * 0.13];
        leaf(B, root, tip, [0.035 * Math.cos(t + 1.5), 0, 0.035 * Math.sin(t + 1.5)], [100 + (i % 3) * 18, 99, 108]);
      }
      if (i % 3) continue;
      const top = [x, 0.42 + (i % 3) * 0.06, z];
      S.tube([[x, 0.04, z], [x - 0.03, 0.26, z], top], 0.012, 0.009, { r: [4, 6] }, { res: 0.03 });
      for (let j = 0; j < 5; j++) {
        const t = (j * Math.PI * 2) / 5;
        leaf(
          B,
          top,
          [x + Math.cos(t) * 0.18, top[1] + 0.035, z + Math.sin(t) * 0.18],
          [-Math.sin(t) * 0.07, 0.045, Math.cos(t) * 0.07],
          [225 + (j % 2) * 20, 169 + (j % 2) * 24, 111]
        );
      }
      S.ball(top, 0.038, { r: [7], em: true }, { res: 0.025 });
    }
    S.bake();
    return finish(B, { target: [0, 0.7, 0], dist: 9.7, yaw: 0.48, pitch: 0.43 });
  }
  function foundry() {
    const { B, S } = setup(79),
      atlas = SpriteSurface.make(512);
    object(B, S, 'box', [0, -0.3, 0], [3.05, 0.22, 2.05], [0x1e293a, 0x34364e], 'court-foundation', {
      size: 0.5,
      round: 0.12
    });
    for (const [i, x] of [-1.65, 0.15, 1.65].entries()) {
      const h = [1.4, 2.15, 1.12][i],
        z = [-0.35, -0.85, -0.38][i];
      object(B, S, 'box', [x, h / 2, z], [0.6, h / 2, 0.52], [0x594765, 0x806181, 0xab869e], 'tower-' + i, {
        size: [state.size, state.size * 1.7, state.size],
        round: 0.12
      });
      object(B, S, 'box', [x, h + 0.13, z], [0.66, 0.13, 0.58], [0x34364e, 0x594765], 'crown-' + i, {
        size: 0.25,
        round: 0.06
      });
      atlas.face([x - 0.46, 0.18, z + 0.53], [0.92, 0, 0], [0, h - 0.34, 0], 32, Math.round(h * 42), (u, v) => {
        if (u < 2 || u > 29 || v % 12 < 4) return 0x242d40;
        if (u % 8 === 0) return 0x5a5667;
        return (Math.floor(u / 8) + Math.floor(v / 12) + i) % 4 === 0 ? 0x583e50 : 0xe6bc79;
      });
      for (let k = 0; k < 3; k++)
        object(
          B,
          S,
          'box',
          [x - 0.3 + k * 0.3, h + 0.42, z],
          [0.07, 0.18, 0.09],
          [0x806181, 0xe1b172],
          'vent-' + i + '-' + k,
          { size: 0.13, round: 0.025 }
        );
    }
    const pivot = [-0.7, 1.15, 1.02],
      shape = (x, y, z) => {
        x -= pivot[0];
        y -= pivot[1];
        z -= pivot[2];
        let d = Math.hypot(Math.hypot(x, y) - 0.64, z) - 0.11;
        for (let j = 0; j < 8; j++) {
          const a = (j * Math.PI) / 4,
            c = Math.cos(a),
            s = Math.sin(a),
            u = x * c + y * s,
            v = -x * s + y * c;
          d = Math.min(d, Math.max(Math.abs(u - 0.68) - 0.21, Math.abs(v) - 0.075, Math.abs(z) - 0.13));
        }
        d = Math.min(
          d,
          Math.max(Math.abs(x) - 0.61, Math.abs(y) - 0.055, Math.abs(z) - 0.095),
          Math.max(Math.abs(x) - 0.055, Math.abs(y) - 0.61, Math.abs(z) - 0.095)
        );
        return d;
      };
    const rotor = K.facets.fromSdf(shape, {
      bounds: { min: pivot.map(x => x - 1), max: pivot.map(x => x + 1) },
      size: Math.min(state.size, 0.17),
      method: 'dualContour'
    });
    const moving = K.facets.draw(B, rotor, {
      palette: ['#d69a60', '#e8b77c', '#ad7a58'],
      grouping: state.grouping,
      ambient: 0.42,
      object: 'flywheel'
    });
    object(B, S, 'box', [pivot[0], 0.22, pivot[2]], [0.78, 0.22, 0.3], [0x34364e, 0x594765], 'machine-plinth', {
      size: 0.25,
      round: 0.08
    });
    S.ball(pivot, 0.16, { r: [6, 7] }, { res: 0.045 });
    atlas.face([1.12, 0.58, 1.05], [1.3, 0, 0], [0, 0.36, 0], 78, 22, (x, y) => {
      const letters = ['111101111001110', '100001001010001', '111001111011111', '100001010010001', '100001001010001'];
      if (x < 2 || y < 2 || x > 75 || y > 19) return 0xd8a468;
      const row = Math.floor((y - 3) / 3),
        col = Math.floor((x - 8) / 4);
      return row >= 0 && row < 5 && col >= 0 && col < 15 && letters[row][col] === '1' ? 0xf2c88b : 0x282b3a;
    });
    S.bake();
    const w = finish(B, { target: [0, 0.8, 0], dist: 10, yaw: 0.38, pitch: 0.34 }, { spriteSurfaces: atlas.finish() });
    const matrices = new Float32Array(12);
    rig = K.bones.bind(w, {
      ids: moving.ids,
      bid: new Float32Array(moving.ids.length),
      M: matrices,
      pose(t) {
        const R = K.M.rot([0, 0, 1], t * 0.45),
          q = K.V.sub(pivot, K.M.app(R, pivot));
        matrices.set([...R, ...q]);
      }
    });
    return w;
  }
  function rebuild() {
    const previous = cameras;
    worlds = { quarry: quarry(), foundry: foundry() };
    cameras = {};
    for (const id of Object.keys(worlds)) {
      cameras[id] = { ...worlds[id].cam, ...previous[id] };
      buildStats[id] = worlds[id].count;
    }
    rig.update(0, state.time);
  }
  rebuild();
  return {
    state,
    rebuild,
    get world() {
      return worlds[state.view];
    },
    get camera() {
      return cameras[state.view];
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      rig.update(dt, state.time);
    },
    get counts() {
      return buildStats;
    }
  };
}
if (typeof module !== 'undefined') module.exports = facetedSurfacesDemo;
