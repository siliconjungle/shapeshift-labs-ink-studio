// A small scene for comparing modeling decisions at fixed native-grid views.
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'moss-bear-sweep', name: 'Moss Bear shape study', seed: 186,
  build(seed, { controls } = {}) {
    const { jaw = 1, overlap = 1 } = controls ?? {};
    const palette = [0x202832, 0x352a34, 0x514044, 0x786051, 0xa68863, 0xd1b181,
      0xe9d3a2, 0x193b39, 0x285448, 0x467551, 0x73a063, 0xa0c875, 0xe6bc6c];
    const B = makeBuilder(seed, palette), S = makeSculpt(B);
    const fur = { r: [1, 2, 3, 4, 5] }, paws = { r: [1, 2, 3, 4] };
    const muzzle = { r: [2, 3, 4, 5, 6] }, bark = { r: [1, 2, 3] };
    const moss = [{ r: [7, 8, 9, 10] }, { r: [7, 8, 10, 11] }];
    const ball = (at, size, material, tag, res = .072) => S.ball(at, size, material, { res, tag });
    ball([0, .98, -.16], [.69, .64, 1.14], fur, 'body');
    ball([0, 1.16, .55], [.61, .62, .65], fur, 'shoulders');
    for (const x of [-.47, .47]) for (const z of [-.79, .61]) {
      ball([x, .50, z], [.29, .51, .32], paws, 'leg');
      ball([x, .18, z + .14], [.26, .18, .34], paws, 'paw', .053);
    }
    ball([0, 1.26, 1.16], [.46, .43, .46], fur, 'head', .055);
    ball([0, 1.02 - .13 * (jaw - 1), 1.47], [.31, .15, .28 * jaw], muzzle, 'jaw', .042);
    ball([0, 1.17, 1.46], [.35, .24, .36], muzzle, 'muzzle', .042);
    ball([0, 1.27, 1.76], [.16, .09, .09], bark, 'nose', .028);
    for (const side of [-1, 1]) {
      ball([side * .34, 1.61, 1.06], [.17, .19, .12], fur, 'ear', .043);
      ball([side * .37, 1.64, 1.15], [.085, .105, .046], bark, 'ear-interior', .027);
      ball([side * .32, 1.39, 1.44], [.065, .055, .035], { r: [12], em: true }, 'eye', .022);
    }
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? -1 : 1, t = Math.floor(i / 2) / 5;
      const bend = K.hash(seed, 61, i) - .5;
      const x = side * (.14 + .31 * overlap + bend * .11);
      const y = 1.67 - .45 * t + bend * .12;
      const z = .65 - 1.49 * t + side * .12;
      ball([x, y, z], [.23, .15, .21 + .12 * overlap], moss[i % moss.length], 'moss', .047);
    }
    ball([0, .91, -1.23], [.16, .17, .23], fur, 'tail', .053);
    S.bake();
    return B.finish({ radius: 3, detail: 21, dither: 0, look: { pixelSize: 1 },
      cam: { target: [0, .94, .20], dist: 5.25, yaw: .48, pitch: .22, ortho: true, sway: 0 } });
  }
});
