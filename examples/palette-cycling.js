module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'palette-cycling',
  name: 'Fernfall',
  seed: 29,
  build(seed, { cycle = true } = {}) {
    const palette = [
      0x142031, 0x1c2c40, 0x29394b, 0x394955, 0x50595c, 0x6d7065, 0x8c876e,
      0x263a34, 0x365047, 0x4b6955, 0x6e895e, 0x99a168, 0xc2b67d,
      0x193b53, 0x205770, 0x287684, 0x41979a, 0x67b4ac, 0x9ad0bc, 0xd8ead2, 0xf2edcc,
      0x306274, 0x4a8790, 0x79aaa5, 0xaccbbe,
      0x446b78, 0x6d949b, 0xa3bdb8, 0xc6d6bd,
      0x5e4945, 0x876750, 0xbd8b5c, 0xe1b574, 0xebb281
    ];
    const roles = {
      fallingWater: [15, 16, 17, 18, 19, 20, 18, 17],
      foam: [16, 17, 19, 20, 18, 15],
      ripples: [13, 21, 22, 23, 24]
    };
    // The two repeated colors occupy independent phases of the falling-water ramp.
    roles.fallingWater[6] = palette.push(palette[18]) - 1;
    roles.fallingWater[7] = palette.push(palette[17]) - 1;
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: K.V.norm([-.46, .81, .41]), amb: .32, sunK: .6, sky: .13, shLen: 0 });

    const rock = { r: [1, 2, 3, 4, 5, 6] };
    const basalt = { r: [0, 1, 2, 3, 4, 5] };
    const moss = { r: [7, 8, 9, 10, 11] };
    const timber = { r: [2, 29, 30, 31] };
    const box = (at, half, mat, res = .12, rd = .055) => S.box(at, half, mat, { res, rd });
    const boulder = (at, half, mat, res = .13) => S.rock(at, half, mat, { res });
    const tile = (width, height, size, paint) => ({
      width, height, size,
      slots: Array.from({ length: width * height }, (_, i) => paint(i % width, Math.floor(i / width)))
    });
    const layer = (projection, raster, role, period, phase = 0) => ({
      type: 'projected', pattern: 'indexed', projection, raster,
      cycles: cycle ? { [role]: { role, period, direction: 'reverse', phase } } : {}
    });
    const front = (x, y, z) => ({ origin: [x, y, z], across: [0, -1, 0] });
    const mod = (n, size) => ((n % size) + size) % size;
    const swatch = (role, step) => roles[role][mod(step, roles[role].length)];

    // Terraced rock frames the water and shows off the stationary swatches.
    box([0, -.34, -.22], [3.74, .20, 2.48], basalt, .16, .11);
    box([-.12, 1.14, -1.23], [2.96, 1.20, .83], basalt, .17, .12);
    for (const [x, y, z, w, h, depth] of [
      [-2.78, .45, -.26, .72, .56, .72], [-2.64, 1.21, -.46, .62, .48, .68],
      [-2.39, 1.95, -.59, .82, .43, .69], [-1.98, 2.51, -.91, .67, .32, .69],
      [-3.13, 1.63, -.82, .43, .71, .49], [-2.74, 2.45, -1.58, .56, .42, .62],
      [-2.18, 2.94, -1.57, .65, .34, .62], [-.40, 2.63, -1.99, .76, .37, .45],
      [.71, 2.72, -1.88, .72, .42, .47], [1.69, 2.81, -1.69, .67, .31, .53],
      [2.38, 2.20, -.97, .67, .48, .73], [1.60, 2.15, -.65, .49, .39, .64],
      [2.63, 1.48, -.67, .66, .62, .83], [1.75, 1.53, -.09, .58, .38, .47],
      [2.33, .79, -.12, .70, .46, .67], [3.08, .51, .43, .52, .41, .68],
      [-3.03, .13, 1.32, .57, .27, .64], [2.57, .12, 1.44, .59, .26, .48],
      [2.95, .10, 1.93, .72, .27, .24]
    ]) boulder([x, y, z], [w, h, depth], y > 2 || (x > 1 && y < 1) ? rock : basalt);

    const canopy = [
      [-2.82, 2.35, -.20, .48], [-2.28, 2.82, -.61, .55], [-2.09, 3.20, -1.41, .37],
      [-3.17, 1.00, .23, .31], [-2.81, .36, 1.36, .43], [-3.44, .44, 1.05, .33],
      [1.85, 3.07, -1.60, .38], [2.65, 2.61, -.55, .47], [1.94, 1.91, .23, .30],
      [2.65, 1.13, .51, .48], [3.31, .91, .61, .41], [2.73, .37, 1.55, .44]
    ];
    for (const [x, y, z, r] of canopy) {
      boulder([x, y, z], [r, .11, r * .66], moss, .081);
      for (let i = 0; i < 6; i++) {
        const turn = i * 2.4 + x, reach = r * (.2 + .14 * (i % 5));
        S.ball([x + Math.cos(turn) * reach, y + .096 + .053 * (i % 3), z + Math.sin(turn) * reach],
          [.22 * r + .043, .045, .16 * r + .035], { r: i % 3 ? [8, 9, 10, 11] : [9, 10, 11, 12] },
          { res: .045, rd: .031 });
      }
    }

    // The phase advances down the painted strands. Their silhouette stays fixed.
    const curtain = K.surface.material({ r: [13, 14, 15] }, { layers: { fall: layer(
      front(-1.71, 2.59, -.26), tile(90, 86, [2.95, 2.44], (x, y) => {
        const axis = x + Math.round(2.3 * Math.sin(y * .072));
        const strand = mod(axis, 17);
        const edge = Math.min(x, 89 - x);
        if (edge < 2 || strand < 2) return null;
        const leg = Math.floor(axis / 17);
        const stride = (strand < 5 || strand > 13) ? 6 : 4;
        const phase = Math.floor(y / stride) + leg * 3 + Math.floor(strand / 5);
        if (strand < 4 || (edge < 5 && (y + axis) % 11 < 5)) return 14;
        return swatch('fallingWater', phase);
      }), 'fallingWater', 1.2
    ) } });
    box([-.24, 1.367, -.295], [1.475, 1.222, .099], curtain, .073, .046);
    const lip = K.surface.material({ r: [14, 15, 16, 17] }, { layers: { stream: layer(
      { origin: [-1.71, 2.60, -1.84] }, tile(90, 28, [2.95, 1.61], (x, y) => {
        const strand = mod(x + Math.floor(y / 4), 17);
        return strand < 3 ? 14 : swatch('fallingWater', Math.floor(y / 4) + Math.floor(x / 17) * 3);
      }), 'fallingWater', 1.2, .375
    ) } });
    box([-.24, 2.557, -1.036], [1.475, .043, .81], lip, .077, .048);

    const basin = K.surface.material({ r: [13, 14, 15] }, { layers: {
      rings: layer({ origin: [-3.09, 0, -.28] }, tile(132, 67, [6.18, 2.45], (x, y) => {
        const dx = (x - 61) * .60, dy = y + 4;
        const distance = Math.hypot(dx, dy * 1.2);
        const ring = Math.floor(distance + 1.4 * Math.sin(x * .22)) % 16;
        if (ring >= 9 || dy > 63 || (x + y * 5) % 23 > 20) return null;
        return swatch('ripples', Math.floor(ring / 2));
      }), 'ripples', 2, .20),
      froth: layer({ origin: [-1.92, 0, -.28] }, tile(88, 33, [3.46, 1.05], (x, y) => {
        const front = 20 + 4 * Math.sin(x * .37) + 3 * Math.sin(x * .77);
        const bank = Math.min(x, 87 - x) * .93;
        if (y > front || y > bank || (x * 7 + y * 11) % 23 < 4 + y * .46) return null;
        const curl = Math.floor((y + 4 * Math.sin(x * .27)) / 2) + Math.floor(x / 7);
        return swatch('foam', curl);
      }), 'foam', .75, .33)
    } });
    box([0, -.047, .925], [3.09, .052, 1.23], basin, .084, .037);

    // Fern tips and gold lanterns give the current a quiet, fixed frame of reference.
    for (const x of [-3.20, 2.96]) {
      box([x, .35, 1.84], [.098, .44, .10], timber, .076, .04);
      box([x, .79, 1.84], [.136, .049, .135], basalt, .064, .025);
      box([x, .888, 1.84], [.080, .08, .081], { r: [30, 31, 32] }, .049, .025);
      box([x, .984, 1.84], [.132, .034, .132], basalt, .060, .024);
    }
    for (const [x, z, r] of [[-2.0, 1.65, .14], [-1.53, 1.91, .16], [1.64, 1.21, .14], [2.12, 1.62, .18]]) {
      S.ball([x, .037, z], [r, .027, r * .86], { r: [8, 9, 10, 11] }, { res: .043, rd: .033 });
      S.ball([x + r * .35, .076, z], [.057, .039, .054], { r: [30, 31, 32, 33] }, { res: .037, rd: .026 });
    }
    S.bake();
    return B.finish({
      cam: { target: [0, 1.33, -.15], dist: 8.6, yaw: .24, pitch: .39, ortho: true, sway: 0 },
      radius: 9, detail: 26, dither: 0, paletteRoles: roles, look: { splatCoverage: 'continuous' }
    });
  }
});
