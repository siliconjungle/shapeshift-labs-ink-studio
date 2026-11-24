function beacon(adjusted = false) {
  const palette = [
    0x101c2b, 0x192937, 0x253b48, 0x37505a, 0x4c6970, 0x68858a, 0x9eafb0, 0xced3bb,
    0x193d46, 0x245963, 0x357e81, 0x51a19b, 0x7db9a8, 0xafd0b7, 0xd1debd, 0xede7ba,
    0x39272c, 0x66403f, 0x8e5c4c, 0xb8835b, 0xd4a56f, 0xe9c48a, 0xf0d7a4, 0xf7e7bc,
    0x252333, 0x3d3446, 0x584960, 0x7e6b83, 0xa48b95, 0xbea29e, 0xe1b7a6, 0xf3c8ac
  ];
  const bakePalette = [...palette.slice(0, 31), 0xf47a58];
  for (let i = 0; i < 32; i++) {
    const light = 32 + i * 3;
    palette.push((light << 16) + ((light + 7) << 8) + light + 14);
  }
  if (adjusted) palette[63] = 0xf47a58;
  else palette.push(0xf47a58);
  const box = (id, at, half, mat, round = .04) => ({ id, kind: 'box', at, half, mat, round, res: .055 });
  const lathe = (id, at, h, r, mat) => ({ id, kind: 'lathe', at, h, r, mat, res: .047 });
  const fog = { id: 'harbor-mist', density: .42, color: '#90b8b6' };
  const scene = {
    id: 'harbor-beacon', name: 'Harbor Beacon', seed: 26,
    palette: bakePalette,
    roles: { steel: [1, 2, 3, 4, 5], tile: [8, 9, 10, 11, 12], roof: [16, 17, 18, 19],
      reed: [2, 3, 9], trim: [4, 5, 6, 7], signal: [31] },
    light: { sun: [-.55, .84, .34], amb: .55 },
    camera: { target: [0, .92, 0], dist: 7.25, yaw: .32, pitch: .18, projection: 'orthographic' },
    finish: { radius: 9, dither: 0, fog: { c: 0, start: 1, max: 0 },
      ...(adjusted ? { atmosphere: [{ ...fog, type: 'box', min: [-2.9, -.2, -1.5], max: [2.9, .71, 1.35] }] } :
        { shapedAtmosphere: [{ ...fog, source: { type: 'path', points: [[-3.2, .31, .18], [3.2, .33, .04]],
          radius: 1.08, aspect: .52, feather: .5 }, step: .18, lit: false }] }) },
    solids: [
      box('ledge', [0, -.28, 0], [2.35, .18, .82], 'steel', .15),
      box('ground', [-.48, -.02, -.03], [1.75, .16, .67], 'tile', .12),
      box('base', [.48, .19, 0], [.59, .12, .58], 'steel', .075),
      box('tower', [.48, .82, 0], [.43, .61, .38], 'tile', .07),
      box('door', [.46, .38, .392], [.14, .27, .022], 'steel', .04),
      box('lintel', [.48, 1.31, 0], [.53, .07, .48], 'trim'),
      box('lantern', [.48, 1.58, 0], [.31, .24, .30], 'signal', .08),
      ...[-.30, .30].flatMap((x, side) => [-.28, .28].map((z, end) =>
        box('lantern-post-' + side + '-' + end, [.48+x, 1.59, z], [.033, .26, .044], 'steel', .01))),
      lathe('copper-roof', [.48, 1.82, 0], .31, [.48, .08], 'roof'),
      lathe('mast', [.48, 2.09, 0], .24, .027, 'steel'),
      { id: 'mast-cap', kind: 'ball', at: [.48, 2.22, 0], r: .065, mat: 'trim', res: .03 },
      ...[-1.7, -1.16, -.62, 1.44, 1.94].map((x, i) => box('pier-post-' + i, [x, .13, .49], [.055, .26, .065], 'steel', .025)),
      box('pier-rail', [-1.17, .27, .49], [.63, .034, .038], 'trim', .025),
      box('east-rail', [1.69, .27, .49], [.30, .034, .038], 'trim', .025),
      { id: 'south-rock', kind: 'rock', at: [-2, -.08, .67], r: [.34, .22, .21], mat: 'steel', res: .047 },
      { id: 'east-rock', kind: 'rock', at: [2.1, -.11, .54], r: [.31, .23, .20], mat: 'tile', res: .047 }
    ],
    timeline: { duration: 1.5, tracks: [{ target: '/camera/yaw', keys: [
      { time: 0, value: .14 }, { time: .75, value: .36 }, { time: 1.5, value: .14 }
    ] }] }
  };
  return { scene, palette };
}

module.exports = beacon;
