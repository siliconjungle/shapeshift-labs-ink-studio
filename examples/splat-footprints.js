/* The Mark Foundry: large native marks and the same mixed-media harbour. */
function splatFootprintsDemo(kit) {
  const { KIT: K, makeBuilder, SpriteSurface } = kit,
    F = K.splatFootprints;
  const leaf = {
    width: 16,
    height: 16,
    alpha: Array.from({ length: 256 }, (_, i) => {
      const x = i % 16,
        y = (i / 16) | 0,
        dx = (x - 7.5) / 6,
        dy = (y - 7.5) / 7;
      return dx * dx + dy * dy < 1 && !(x > 6 && x < 10 && y > 5 && y < 10) && !((y === 3 || y === 11) && x < 6)
        ? 255
        : 0;
    })
  };
  const specs = [
    { shape: 'square', rotation: 0.12, softness: 0.025 },
    { shape: 'wedge', rotation: 0.25, softness: 0.025 },
    { shape: 'star', tips: 5, innerRadius: 0.43, softness: 0.025 },
    { shape: 'cross', width: 0.28, softness: 0.04 },
    { shape: 'chip', seed: 39, softness: 0.025 },
    {
      shape: 'polygon',
      vertices: [
        [-0.7, 1],
        [0.7, 1],
        [0.15, 0.15],
        [0.8, 0.15],
        [-0.6, -1],
        [-0.1, -0.15],
        [-0.8, -0.15]
      ],
      softness: 0.02
    },
    { shape: 'mask', mask: leaf, softness: 0.025 },
    { shape: 'circle', softness: 0.35 }
  ];
  const colors = [
    0x081c29, 0x123844, 0x21545e, 0x3a7880, 0x60a5a5, 0xa1d1bd, 0xe1eed0, 0x725035, 0xa5743f, 0xdaab58, 0xffd98c,
    0xffedbd
  ];
  const B = makeBuilder(72, colors),
    positions = [];
  for (let i = 0; i < 8; i++) {
    const x = -4.5 + (i % 4) * 3,
      y = i < 4 ? 1.65 : -1.65;
    positions.push([x, y, 0]);
    B.dab(x, y, 0, [0, 0, 1], [1, 0, 0], 0.68, 0.68, 0.03, B.P[i % 2 ? 10 : 5], 1, { em: true });
    B.describeFootprint(i, i + 1, specs[i]);
  }
  const atlas = SpriteSurface.make(512);
  atlas.face([-6.1, -3.2, -0.16], [12.2, 0, 0], [0, 6.4, 0], 488, 256, (x, y) => {
    const a = x % 122,
      b = y % 128,
      edge = a < 1 || b < 1,
      check = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    return colors[edge ? 2 : check ? 1 : 0];
  });
  const gallery = B.finish({
    spriteSurfaces: atlas.finish(),
    look: { pixel: true, pixelSize: 1 },
    cam: { target: [0, 0, 0], dist: 12.6, yaw: 0, pitch: 0, ortho: true },
    radius: 15,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 }
  });
  const buildHarbour = typeof renderGridScene === 'undefined' ? require('./render-grid') : renderGridScene;
  const harbour = buildHarbour(kit),
    h = harbour.world;
  const targets = [
    ['bridge', 'eaves', 'windows'],
    ['crystals'],
    ['lamps', 'beacon'],
    ['ribs'],
    ['terraces', 'island'],
    ['roofs'],
    ['quay', 'spire'],
    ['water']
  ];
  const index = K.procedural ? kit.TargetSelectors.index(h) : null,
    slots = [];
  for (let i = 0; i < 8; i++) {
    const ids = Array.from({ length: h.count }, (_, j) => j).filter(j => targets[i].includes(index.row(j).object));
    slots.push(F.assign(h, ids, specs[i]));
  }
  const control = K.cameraRig.control(() => ({ camera: gallery.cam }), { handoff: 0.4 });
  control.update(0, 0);
  const state = { view: 'gallery', time: 0, paused: false, spin: false, native: false, selected: 0 };
  const initial = [gallery.splatFootprints, h.splatFootprints];
  return {
    gallery,
    harbour,
    state,
    positions,
    specs,
    leaf,
    slots,
    get world() {
      return state.view === 'gallery' ? gallery : h;
    },
    get control() {
      return state.view === 'gallery' ? control : harbour.control;
    },
    edit(changes) {
      const i = state.selected;
      F.setTransform(gallery, i + 1, changes);
      F.setTransform(h, slots[i], changes);
    },
    paint(alpha) {
      const spec = { ...gallery.splatFootprints.styles[6], mask: { width: 16, height: 16, alpha: Array.from(alpha) } };
      F.update(gallery, 7, spec);
      F.update(h, slots[6], spec);
    },
    reset() {
      gallery.splatFootprints = initial[0];
      h.splatFootprints = initial[1];
      state.spin = false;
      state.native = false;
      control.release();
      harbour.control.release();
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      harbour.state.paused = state.paused;
      harbour.update(dt);
      control.update(dt, state.time);
      if (state.spin) {
        const i = state.selected,
          angle = Math.sin(state.time * 0.5) * 1.2;
        F.setTransform(gallery, i + 1, { rotation: angle });
        F.setTransform(h, slots[i], { rotation: angle });
      }
    }
  };
}
if (typeof module !== 'undefined') module.exports = splatFootprintsDemo;
