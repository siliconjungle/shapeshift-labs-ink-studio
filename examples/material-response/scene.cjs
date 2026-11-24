module.exports = function scene() {
  const palette = [
    0x121922, 0x273544, 0x43525d, 0x74858b, 0xb1b6a6, 0x674741, 0x935c48, 0xc48664,
    0x18414b, 0x296772, 0x4c9394, 0x9bd3b5, 0x453b47, 0x625260, 0x8a7481, 0xb29da4,
    0x5f3e38, 0x9c6245, 0xca9054, 0xf4ca71, 0xf6e3b5, 0x221f29, 0xdb7651
  ];
  const roles = { water: [8, 9, 10], metal: [1, 2, 3], accent: [18, 19, 20] };
  function role(colors) {
    const name = 'finish-' + colors.join('-');
    roles[name] = colors;
    return name;
  }
  const box = (id, at, half, colors, extra = {}) =>
    ({ id, kind: 'box', at, half, res: .06, round: .035, mat: { role: role(colors) }, ...extra });
  const ball = (id, at, r, colors, extra = {}) =>
    ({ id, kind: 'ball', at, r, res: .052, mat: { role: role(colors) }, ...extra });
  const z = .53;
  const contact = (id, interaction, material, time, x, zz, extra = {}) => ({
    id, interaction, material, time, point: [x, 0, zz], heading: [1, 0, 0], speed: 2, ...extra
  });
  const steps = Array.from({ length: 6 }, (_, i) =>
    contact('boot-' + i, 'step', 'silt', .45 + i * .30, -3.65 + i * .41, z + (i % 2 ? .10 : -.10)));
  const wheels = Array.from({ length: 7 }, (_, i) =>
    contact('wheel-' + i, 'roll', 'water', 2.27 + i * .17, -1.05 + i * .33, .28,
      { entity: 'cart', wheel: 'front', speed: 1.85 }));
  const impacts = [contact('test-strike', 'impact', 'slate', 4.06, 2.86, .37, { speed: 3.1 })];
  const surface = (name, x, half, colors) => box(name, [x, -.105, 0], [half, .105, 1.33], colors,
    { res: .053, round: .018, mat: { role: role(colors), materialId: name } });
  const lane = [
    surface('silt', -2.82, 1.38, [5, 6, 7]), surface('water', 0, 1.37, [8, 9, 10]),
    surface('slate', 2.81, 1.39, [12, 13, 14])
  ];
  const frame = [
    box('foundation', [0, -.39, 0], [4.5, .27, 1.63], [0, 1, 2], { round: .14, res: .085 }),
    box('toe', [0, -.37, 1.59], [4.25, .12, .13], [1, 2, 3]),
    box('back-rail', [0, .08, -1.5], [4.38, .14, .13], [1, 2, 3]),
    ...[-4.38, -1.42, 1.42, 4.38].map((x, i) => box('divider-' + i, [x, -.005, 0],
      [.074, .067, 1.54], [2, 3, 4], { res: .047 })),
    ...Array.from({ length: 15 }, (_, i) => box('front-bolt-' + i, [-4 + i * .57, -.31, 1.73],
      [.025, .035, .026], i % 4 === 0 ? [18, 19, 20] : [2, 3, 4], { res: .024 })),
    ...[-3.73, -2.2, 2.26, 3.8].map((x, i) =>
      box('back-stanchion-' + i, [x, .49, -1.39], [.058, .42, .06], [2, 3, 4])),
    box('rear-pipe', [-2.97, .76, -1.43], [1.15, .046, .043], [17, 18, 19]),
    box('rear-pipe-right', [3.01, .76, -1.43], [1.02, .046, .043], [17, 18, 19])
  ];
  const texture = [
    ...Array.from({ length: 14 }, (_, i) => box('silt-fragment-' + i,
      [-4.0 + i % 7 * .367, .013, i < 7 ? -.91 + (i % 3) * .07 : 1.08 - (i % 3) * .07],
      [.026 + (i % 3) * .016, .014, .042], [5, 6, 7], { res: .029 })),
    ...Array.from({ length: 9 }, (_, i) => box('water-fleck-' + i,
      [-1.15 + i * .28, .013, -.55 - (i % 3) * .23], [.059, .009, .012], [8, 10, 11], { res: .025 })),
    ...[1.65, 2.06, 3.81, 4.05].map((x, i) => box('slate-inlay-' + i,
      [x, .013, -.48], [.009, .012, .73], [12, 14, 15], { res: .035 }))
  ];
  const props = [
    box('coat', [-3.85, .48, z], [.15, .22, .12], [16, 18, 19], { part: 'walker' }),
    box('visor', [-3.81, .72, z], [.142, .091, .128], [17, 19, 20], { part: 'walker' }),
    box('pack', [-4.02, .5, z - .02], [.064, .145, .1], [1, 2, 3], { part: 'walker' }),
    ...[-.087, .087].map((o, i) => box('boot-' + i, [-3.84, .145, z + o],
      [.09, .13, .066], [21, 0, 2], { part: i ? 'boot-b' : 'boot-a' })),
    box('cart-shell', [-1.27, .28, .07], [.29, .135, .173], [16, 18, 19], { part: 'cart' }),
    box('cart-window', [-1.18, .435, .07], [.096, .048, .118], [8, 10, 11], { part: 'cart' }),
    ...[-.17, .17].flatMap((x, i) => [-.174, .174].map((offset, j) =>
      ball('wheel-' + i + '-' + j, [-1.27 + x, .125, .07 + offset], [.125, .125, .071], [21, 2, 3], { part: 'cart' }))),
    box('press-column', [3.51, .63, -.72], [.105, .64, .115], [1, 2, 3]),
    box('press-arm', [3.19, 1.22, -.18], [.46, .065, .62], [2, 3, 4]),
    box('press-ram', [2.86, .86, .37], [.059, .34, .062], [2, 3, 4], { part: 'ram' }),
    box('press-head', [2.86, .49, .37], [.145, .069, .145], [5, 17, 22], { part: 'ram' })
  ];
  const track = (target, keys) => ({ target, keys: keys.map(([time, value]) => ({ time, value, ease: 'linear' })) });
  const motion = [[0, 0], [.45, .2], [1.95, 2.25], [2.2, 2.35], [5.8, 2.35]];
  const boot = phase => [
    [0, [0, 0, 0]],
    ...steps.map((step, i) => [step.time, [step.point[0] + 3.84, i % 2 === phase ? 0 : .105, 0]]),
    [2.2, [2.34, 0, 0]], [5.8, [2.34, 0, 0]]
  ];
  const chart = bounds => ({ bounds, reach: .105 });
  return {
    id: 'silt-lock', name: 'Silt Lock', seed: 37, palette, roles,
    camera: { target: [0, .28, 0], dist: 10.1, yaw: -.17, pitch: .79, projection: 'orthographic' },
    light: { sun: [-.45, .8, .38], ambient: .53 },
    finish: {
      radius: 10, dither: 0, look: { pixelSize: 1 },
      materialResponse: {
        recipe: { format: 'ink-studio/material-response', version: 1, materials: {
          silt: { chart: chart([-4.21, -1.35, -1.42, 1.35]),
            mark: { radius: .21, duration: 6, decay: .065, color: '#633e36' },
            particles: { count: 6, speed: 1.45, radius: .032, color: '#ebb785' }, sound: { cue: 'silt', gain: .78 } },
          water: { chart: chart([-1.39, -1.35, 1.39, 1.35]),
            ripple: { radius: .12, speed: .7, width: .061, duration: 1.28, decay: .68, color: '#a8dfcf' },
            particles: { count: 9, speed: 1.85, radius: .031, duration: .53, color: '#b5e9cb' },
            sound: { cue: 'water', gain: .64, rollInterval: .24 } },
          slate: { chart: chart([1.41, -1.35, 4.23, 1.35]),
            mark: { radius: .26, duration: 5, color: '#332737' },
            ripple: { radius: .14, speed: 1.35, width: .044, duration: .74, color: '#e5aaa0' },
            particles: { count: 22, speed: 2.6, radius: .033, color: '#ffd788' },
            sound: { cue: 'strike', gain: .85 } }
        } },
        contacts: [...steps, ...wheels, ...impacts]
      }
    },
    parts: Object.fromEntries(['walker', 'boot-a', 'boot-b', 'cart', 'ram'].map(id => [id, { joint: [0, 0, 0] }])),
    solids: [...frame, ...lane, ...texture, ...props],
    timeline: { duration: 5.8, tracks: [
      track('/camera/yaw', [[0, -.17], [5.8, .13]]),
      track('/poses/walker/translation', motion.map(([t, x]) => [t, [x, 0, 0]])),
      track('/poses/boot-a/translation', boot(0)), track('/poses/boot-b/translation', boot(1)),
      track('/poses/cart/translation', [[0, [0, 0, 0]], [2.12, [0, 0, 0]], [3.45, [2.48, 0, 0]], [5.8, [2.48, 0, 0]]]),
      track('/poses/ram/translation', [[0, [0, 0, 0]], [3.86, [0, 0, 0]], [4.06, [0, -.42, 0]],
        [4.19, [0, -.42, 0]], [4.55, [0, 0, 0]], [5.8, [0, 0, 0]]])
    ] }
  };
};
