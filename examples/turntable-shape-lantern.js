function turntableShapeLantern({ KIT: K, makeBuilder, makeSculpt }) {
  const bounds = { min: [-1.45, 1.32, -0.52], max: [1.45, 3.55, 0.52] }, cell = 0.043;
  const arch = (x, y, z, radius) => {
    const shoulder = 2.12, span = 0.88;
    if (y >= shoulder) return Math.hypot(Math.hypot(x, y - shoulder) - span, z) - radius;
    return Math.hypot(Math.abs(x) - span, z, Math.max(0, 1.66 - y)) - radius;
  };
  const distance = (x, y, z) => Math.min(arch(x, y, z, 0.145),
    Math.max(Math.abs(x) - 0.88, Math.abs(y - 2.15) - 0.15, Math.abs(z) - 0.12));
  const target = (x, y, z) => arch(x, y, z, 0.225);

  function build(shape) {
    const B = makeBuilder(421, [0x101a21, 0x15252c, 0x244049, 0x395c60, 0x597f7b, 0x769e91,
      0x442e29, 0x754731, 0xb17445, 0xe4a967, 0xf4d795, 0x7b3324, 0xc0572d, 0xf2843c, 0xffbb62, 0xffeaad]);
    const S = makeSculpt(B);
    Object.assign(S, { res: 0.05, wob: 0, amb: 0.36, sky: 0.23, sunK: 0.7 });
    const enamel = { r: [1, 2, 3, 4, 5] }, brass = { r: [6, 7, 8, 9, 10] };
    const panes = { r: [11, 12, 13, 14, 15], em: true,
      mod: (x, y, z) => 0.23 * Math.cos(Math.atan2(x, z) * 2 - 0.7) + 0.26 * Math.cos((y - 0.75) * 3) };
    S.lathe([0, 0.03, 0], 0.18, [1.06, 0.98], enamel);
    S.lathe([0, 0.19, 0], 0.10, [0.99, 0.98], brass);
    S.lathe([0, 0.27, 0], 0.24, [0.95, 0.78], enamel);
    S.lathe([0, 0.46, 0], 0.87, t => 0.71 + 0.085 * Math.sin(t * Math.PI), panes);
    S.lathe([0, 1.31, 0], 0.13, [0.76, 1.02], brass);
    S.lathe([0, 1.43, 0], 0.24, [1.04, 0.68], enamel);
    S.lathe([0, 1.64, 0], 0.17, [0.52, 0.40], brass);
    S.lathe([0, 1.79, 0], 0.09, [0.43, 0.33], enamel);
    for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) * Math.PI / 3, x = Math.cos(a), z = Math.sin(a);
      S.tube([[0.82 * x, 0.42, 0.82 * z], [0.86 * x, 0.85, 0.86 * z],
        [0.80 * x, 1.38, 0.80 * z]], 0.055, 0.07, enamel);
      S.ball([0.903 * x, 1.49, 0.903 * z], 0.068, brass);
    }
    for (const side of [-1, 1]) {
      S.box([side * 0.80, 1.56, 0], [0.16, 0.15, 0.18], brass, { rd: 0.06 });
    }
    S.bake();
    if (shape) K.voxelSurface.draw(B, K.turntableShape.proxy(shape), {
      color: '#e2aa6b', ambient: 0.36, shadeSteps: 5, object: 'lantern-handle', material: 'cast-brass'
    });
    return B.finish({
      cam: { target: [0, 1.58, 0], dist: 6.6, yaw: 0.48, pitch: 0.13, ortho: true },
      radius: 10, dither: 0, fog: { c: 0, start: 1, max: 0 }, look: { splatCoverage: 'continuous' }
    });
  }

  return { distance, target, bounds, cell, build };
}
if (typeof module !== 'undefined') module.exports = turntableShapeLantern;
