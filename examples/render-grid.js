/* Prism Harbour: native SDF sculptures and an atlas quay, seen through three lattices. */
function renderGridScene({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const colors = [
    0x081c29, 0x123844, 0x21545e, 0x3a7880, 0x60a5a5, 0xa1d1bd, 0xe1eed0, 0x3b3330, 0x725035, 0xa5743f, 0xdaab58,
    0xffd98c, 0xffedbd
  ];
  const B = makeBuilder(172, colors),
    S = K.sculpt(makeSculpt(B)),
    tags = K.deform.tags(S);
  Object.assign(S, { pixel: true, sun: K.V.norm([-0.55, 0.85, 0.4]), amb: 0.32, sky: 0.22, sunK: 0.84, aoK: 0.26 });
  S.pixelSize(40);
  const deep = { r: [0, 1, 2] },
    stone = { r: [1, 2, 3, 4, 5] },
    pale = { r: [3, 4, 5, 6] },
    gold = { r: [7, 8, 9, 10, 11] },
    light = { r: [9, 10, 11, 12], em: true },
    water = { r: [1, 2, 3, 4], alpha: 0.88 };
  const box = (at, h, mat, options = {}) => S.box(at, h, mat, { res: 0.16, rd: 0.02, ...options });
  box([0, -0.48, 0], [5.8, 0.45, 4.2], deep, { rd: 0.18, objectId: 'island' });
  box([0, 0.01, 1.7], [5.5, 0.025, 2.2], water, { objectId: 'water' });
  // Broad terraces with different heights and deep shadowed stairs.
  box([0, 0.28, -1.75], [4.85, 0.28, 1.9], stone, { objectId: 'terraces' });
  box([-2.15, 0.69, -1.9], [2.1, 0.15, 1.5], gold, { objectId: 'terraces' });
  box([-2.55, 0.96, -1.95], [1.65, 0.14, 1.25], pale, { objectId: 'terraces' });
  for (let i = 0; i < 7; i++)
    box([0.15, 0.08 + i * 0.1, -0.15 - i * 0.23], [0.74, 0.06, 0.13], gold, { objectId: 'stairs', res: 0.08 });
  for (const x of [-4.75, 4.75]) box([x, 0.25, 1.6], [0.2, 0.25, 2], stone, { objectId: 'quay' });
  // Long bridge and paired pylons; the lattice gives the cables angular silhouettes.
  box([0, 0.33, 2.3], [4.7, 0.09, 0.31], gold, { objectId: 'bridge' });
  for (const x of [-3.7, 3.7]) {
    box([x, 1.3, 2.3], [0.13, 1.3, 0.18], gold, { objectId: 'bridge' });
    box([x, 2.62, 2.3], [0.2, 0.055, 0.22], light, { objectId: 'lamps' });
    for (const side of [-1, 1])
      S.tube(
        [
          [x, 2.55, 2.3],
          [x + side * 0.65, 1.25, 2.3],
          [x + side * 1.2, 0.43, 2.3]
        ],
        0.022,
        0.022,
        pale,
        { res: 0.13, objectId: 'cables' }
      );
  }
  // A luminous conservatory, with separate dark gaps between the ribs.
  S.lathe([-2.5, 1.12, -1.9], 0.45, 1.03, gold, { res: 0.1, objectId: 'observatory' });
  S.ball([-2.5, 1.8, -1.9], [1.12, 0.88, 1.12], deep, { res: 0.13, objectId: 'observatory' });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      points = [];
    for (let j = 0; j <= 12; j++) {
      const t = ((j / 12) * Math.PI) / 2;
      points.push([
        -2.5 + Math.cos(a) * Math.cos(t) * 1.15,
        1.75 + Math.sin(t) * 0.97,
        -1.9 + Math.sin(a) * Math.cos(t) * 1.15
      ]);
    }
    S.tube(points, 0.035, 0.035, gold, { res: 0.1, objectId: 'ribs' });
  }
  S.torus([-2.5, 1.8, -1.9], 1.15, 0.065, light, { res: 0.08, objectId: 'lamps' });
  S.lathe([-2.5, 2.7, -1.9], 0.5, [0.14, 0], gold, { res: 0.06, objectId: 'spire' });
  // Tiered pagoda/relay tower: warm roofs and cool, slim window bands.
  for (let level = 0; level < 4; level++) {
    const y = 0.6 + level * 0.76,
      r = 0.85 - level * 0.13;
    box([1.7, y + 0.28, -2.25], [r * 0.62, 0.29, r * 0.62], deep, { objectId: 'tower' });
    for (const z of [-2.25 - r * 0.63, -2.25 + r * 0.63])
      for (const x of [1.7 - r * 0.4, 1.7, 1.7 + r * 0.4])
        box([x, y + 0.32, z], [0.038, 0.18, 0.025], light, { res: 0.045, objectId: 'windows' });
    S.lathe([1.7, y + 0.57, -2.25], 0.3, t => r * (1 - t * 0.8), gold, { res: 0.09, objectId: 'roofs' });
    S.torus([1.7, y + 0.6, -2.25], r, 0.035, pale, { res: 0.08, objectId: 'eaves' });
  }
  S.lathe([1.7, 3.75, -2.25], 0.9, [0.13, 0], gold, { res: 0.06, objectId: 'spire' });
  // Glassy crystals, built from polygon SDFs rather than hundreds of loose particles.
  for (const [x, z, h, r] of [
    [-4, -0.25, 1.75, 0.42],
    [-4.5, -2.9, 1.2, 0.33],
    [3.7, -0.9, 2.2, 0.54],
    [4.4, -2.8, 1.6, 0.4],
    [2.8, -3.25, 1.1, 0.32]
  ]) {
    S.solid(
      [x, 0.5 + h / 2, z],
      Math.hypot(h / 2, r * 1.16),
      (px, py, pz) => {
        const qy = py + h / 2,
          rad = r * Math.max(0, 1 - qy / h);
        let d = -1e9;
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          d = Math.max(d, px * Math.cos(a) + pz * Math.sin(a) - rad);
        }
        return Math.max(d, -qy, qy - h);
      },
      (res, emit) => {
        const levels = Math.ceil(h / res),
          steps = Math.ceil(r / res);
        for (let j = 0; j <= levels; j++)
          for (let side = 0; side < 6; side++)
            for (let k = 0; k < steps; k++) {
              const t = j / levels,
                u = k / steps,
                a = ((side + 0.5) * Math.PI) / 3,
                b = a + Math.PI / 3,
                rad = ((r * 2) / Math.sqrt(3)) * (1 - t);
              emit(
                rad * ((1 - u) * Math.cos(a) + u * Math.cos(b)),
                t * h - h / 2,
                rad * ((1 - u) * Math.sin(a) + u * Math.sin(b))
              );
            }
      },
      pale,
      { res: 0.09, reach: 0.04, objectId: 'crystals' }
    );
    S.torus([x, 0.55, z], r * 0.8, 0.04, gold, { res: 0.07, objectId: 'crystal-bases' });
  }
  // Hovering instrument with a retained bone, so the original surface animates in every mode.
  S.ball([-0.15, 2.75, -0.5], [0.31, 0.52, 0.31], light, { res: 0.07, tag: 'beacon', objectId: 'beacon' });
  S.torus([-0.15, 2.75, -0.5], 0.65, 0.045, pale, { res: 0.06, tag: 'beacon', objectId: 'beacon', ax: S.AZ });
  S.bake();
  let spriteSurfaces;
  if (SpriteSurface) {
    const atlas = SpriteSurface.make(256);
    atlas.face([-4.65, 0.575, -0.02], [9.3, 0, 0], [0, 0, -3.58], 128, 64, (x, y) => {
      const seam = x % 16 === 0 || y % 8 === 0,
        trim = y < 3 || y > 60;
      return colors[trim ? 10 : seam ? 1 : (x * 7 + y * 11) % 37 === 0 ? 4 : 2];
    });
    spriteSurfaces = atlas.finish();
  }
  const world = B.finish({
    ...(spriteSurfaces && { spriteSurfaces }),
    look: { pixel: true, pixelSize: 1, splatCoverage: 'continuous', clean: 1 },
    cam: { target: [0, 1, -0.25], dist: 19.7, yaw: 0.35, pitch: 0.52, ortho: true },
    radius: 20,
    dither: 0.08,
    fog: { c: 0, start: 1, max: 0 }
  });
  const M = new Float32Array(12),
    ids = tags.beacon;
  const rig = K.bones.bind(world, {
    ids,
    bid: new Float32Array(ids.length),
    M,
    pose(t) {
      const a = t * 0.35,
        c = Math.cos(a),
        s = Math.sin(a);
      M.set([c, 0, s, 0, 1, 0, -s, 0, c, 0, 0.12 * Math.sin(t * 1.2), 0]);
    }
  });
  const control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.5 });
  control.update(0, 0);
  const state = { time: 0, paused: false, turntable: false };
  return {
    world,
    control,
    state,
    update(dt) {
      if (!state.paused) state.time += dt;
      rig.update(dt, state.time);
      if (state.turntable) control.input({ yaw: dt * 0.1 });
      control.update(dt, state.time);
    },
    presets: {
      hex: { mode: 'hex', size: 9 },
      triangle: { mode: 'triangle', size: 14 },
      diamond: { mode: 'diamond', size: 14 }
    }
  };
}
if (typeof module !== 'undefined') module.exports = renderGridScene;
