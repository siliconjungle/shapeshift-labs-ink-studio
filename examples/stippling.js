function stipplingDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const state = {
    view: 'owl',
    density: 1.2,
    detail: 1,
    coarse: 2.7,
    adaptive: true,
    paper: true,
    paused: false,
    time: 0
  };
  const palette = [0xf3e7ce, 0x183c50, 0x315d75, 0x6a8a97, 0xb2c5bb, 0xd6a35e, 0xeac280, 0xf5d6a1];
  let worlds = {},
    rigs = {},
    controls = {};
  function setup(seed, style, zones) {
    const B = makeBuilder(seed, palette),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: 0.35, aoK: 0.17, shK: 1.8, wob: 0, fat: 0.4 });
    S.stipple = {
      style,
      density: state.density,
      coarse: state.adaptive ? state.coarse : 1,
      fine: state.adaptive ? 0.55 : 1,
      toneDensity: state.adaptive ? 0.6 : 0,
      curvature: state.adaptive ? 0.2 : 1,
      views: state.adaptive ? [[0, 0.15, 1]] : [],
      zones: state.adaptive ? zones.map(z => ({ ...z, strength: state.detail })) : [],
      size: style === 'ink' ? [0.1, 0.34] : [0.18, 0.48],
      radiusLimit: 0.26,
      paper: state.paper ? '#f3e7ce' : false,
      ink: '#183c50',
      palette: ['#214e72', '#6293a5', '#3b8296', '#e9bb68', '#cf844e', '#d7ad68'],
      shadowSteps: 4,
      maxChecks: 5000000
    };
    return { B, S };
  }
  const finish = (B, cam) =>
    B.finish({
      cam,
      radius: 15,
      fog: { c: 0, start: 1, max: 0 },
      dither: 0,
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
    });
  function owl() {
    const { B, S } = setup(41, 'ink', [
        { at: [-0.48, 2.5, 0.77], radius: 0.53 },
        { at: [0.48, 2.5, 0.77], radius: 0.53 },
        { at: [0, 2.15, 0.92], radius: 0.24 }
      ]),
      tags = K.deform.tags(S),
      soft = { r: [3, 4, 6, 7] },
      dark = { r: [1, 2], stipple: false };
    S.ball([0, 1.55, 0], [0.96, 1.26, 0.69], soft, { res: 0.11, objectId: 'breast' });
    S.ball([0, 2.45, 0.02], [0.87, 0.7, 0.66], soft, { res: 0.085, objectId: 'head' });
    for (const sign of [-1, 1]) {
      S.ball([sign * 0.49, 2.5, 0.52], [0.49, 0.54, 0.22], soft, { res: 0.07, objectId: 'facial-disc' });
      S.torus([sign * 0.47, 2.5, 0.76], 0.24, 0.042, { r: [2, 3, 5] }, { ax: S.AZ, res: 0.045, objectId: 'eye-rings' });
      S.ball([sign * 0.47, 2.5, 0.81], 0.15, dark, { res: 0.04, objectId: 'pupils' });
      S.ball([sign * 0.51, 2.55, 0.94], 0.039, { r: [7], stipple: false }, { res: 0.025, objectId: 'eye-glints' });
      S.ball([sign * 0.71, 1.42, 0.05], [0.34, 0.93, 0.43], soft, {
        res: 0.08,
        tag: sign < 0 ? 'left' : 'right',
        whole: true,
        objectId: 'wings'
      });
      S.ball([sign * 0.67, 3.02, -0.08], [0.19, 0.45, 0.19], soft, { res: 0.065, objectId: 'ear-tufts' });
      for (let j = 0; j < 5; j++)
        S.ball(
          [sign * (0.69 + 0.025 * j), 0.72 + j * 0.21, 0.44],
          [0.17, 0.28, 0.1],
          { r: [3, 4, 5] },
          { res: 0.065, tag: sign < 0 ? 'left' : 'right', whole: true, objectId: 'wing-feathers' }
        );
    }
    S.lathe([0,1.95,.85],.36,t=>.02+.12*t,{r:[1,2,5],stipple:false},{res:.03,maxRadius:.14,objectId:'beak'});
    S.tube(
      [
        [-1.55, 0.2, 0.08],
        [-0.65, 0.33, 0.08],
        [0.6, 0.2, 0.1],
        [1.5, 0.35, -0.05]
      ],
      0.13,
      0.09,
      dark,
      { res: 0.08, objectId: 'perch' }
    );
    for (const sign of [-1, 1])
      for (let j = 0; j < 3; j++)
        S.tube(
          [
            [sign * 0.3 + j * 0.055, 0.55, 0.21],
            [sign * 0.3 + j * 0.055, 0.32, 0.32],
            [sign * 0.3 + j * 0.055, 0.2, 0.22]
          ],
          0.034,
          0.026,
          dark,
          { res: 0.04, objectId: 'talons' }
        );
    S.bake();
    const w = finish(B, { target: [0, 1.65, 0], dist: 7.7, yaw: 0.1, pitch: 0.1 }),
      M = new Float32Array(24),
      ids = tags.of('left', 'right');
    rigs.owl = K.bones.bind(w, {
      ids,
      bid: Float32Array.from(ids, i => (tags.left.includes(i) ? 0 : 1)),
      M,
      pose(t) {
        for (let b = 0; b < 2; b++) {
          const a = (b ? 1 : -1) * (0.025 + 0.035 * Math.sin(t * 1.1)),
            R = K.M.rot([0, 0, 1], a);
          M.set([...R, 0, 0, 0], b * 12);
        }
      }
    });
    w.markStats = S.stippleStats;
    return w;
  }
  function orchard() {
    const { B, S } = setup(72, 'pointillism', []),
      wood = { r: [1, 2, 5] },
      stone = { r: [2, 3, 4, 6] },
      fruit = { r: [5, 6, 7] },
      leaf = { r: [2, 3, 4, 6] };
    S.ball([0, -0.22, 0], [2.55, 0.55, 1.9], stone, { res: 0.17, objectId: 'island' });
    S.tube(
      [
        [0, 0, 0],
        [-0.18, 0.75, 0.1],
        [0.04, 1.5, 0],
        [0.22, 2.35, -0.05]
      ],
      0.22,
      0.09,
      wood,
      { res: 0.095, objectId: 'trunk' }
    );
    for (let j = 0; j < 5; j++) {
      const a = j * 1.2,
        x = Math.cos(a) * 0.95,
        z = Math.sin(a) * 0.6,
        y = 1.4 + (j % 2) * 0.35;
      S.tube(
        [
          [0, y, 0],
          [x * 0.6, y + 0.38, z * 0.6],
          [x, y + 0.55, z]
        ],
        0.1,
        0.035,
        wood,
        { res: 0.08, objectId: 'branches' }
      );
      S.ball([x, y + 0.56, z], [0.48, 0.37, 0.36], leaf, { res: 0.11, objectId: 'canopy' });
      S.ball([x * 1.06, y + 0.28, z + 0.26], 0.24, fruit, { res: 0.065, objectId: 'sunfruit' });
      for (let k = 0; k < 3; k++)
        S.ball([x + 0.35 * Math.sin(k * 2), y + 0.7 + 0.1 * k, z + 0.25 * Math.cos(k * 2)], [0.29, 0.11, 0.2], leaf, {
          res: 0.085,
          objectId: 'leaves'
        });
    }
    for (let j = 0; j < 4; j++) {
      const x = j * 0.65 - 1.2,
        z = 0.8 + Math.sin(j) * 0.2;
      S.ball([x, 0.2, z], [0.27, 0.21, 0.23], stone, { res: 0.08, objectId: 'path-stones' });
    }
    for (let j = 0; j < 6; j++) {
      const x = 1.5 * Math.cos(j),
        z = 1.05 * Math.sin(j);
      S.tube(
        [
          [x, 0, z],
          [x, 0.22, z],
          [x + 0.06, 0.38, z]
        ],
        0.035,
        0.025,
        wood,
        { res: 0.055, objectId: 'mushroom-stems' }
      );
      S.ball([x, 0.4, z], [0.22, 0.12, 0.22], fruit, { res: 0.07, objectId: 'mushroom-caps' });
    }
    S.bake();
    const w = finish(B, { target: [0, 0.9, 0], dist: 8.7, yaw: 0.46, pitch: 0.3 });
    w.markStats = S.stippleStats;
    return w;
  }
  function rebuild() {
    worlds = { owl: owl(), orchard: orchard() };
    controls = {};
    for (const [id, w] of Object.entries(worlds))
      controls[id] = K.cameraRig.control(() => ({ camera: w.cam }), { handoff: 0.3 });
  }
  rebuild();
  return {
    state,
    rebuild,
    get world() {
      return worlds[state.view];
    },
    get control() {
      return controls[state.view];
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      rigs.owl.update(dt, state.time);
    }
  };
}
if (typeof module !== 'undefined') module.exports = stipplingDemo;
