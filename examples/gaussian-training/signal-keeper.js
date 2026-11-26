'use strict';

module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'signal-keeper',
  name: 'Signal Keeper',
  seed: 102,
  build(seed) {
    const palette = [0x141b24, 0x283949, 0x536778, 0x8b9f9d, 0xbbc6b3, 0x215256, 0x428d85, 0x93d2b8,
      0x743d39, 0xb06148, 0xec9964, 0xe6c175, 0xfae4ac, 0x1c2d36];
    const builder = makeBuilder(seed, palette), sculpt = K.sculpt(makeSculpt(builder));
    const options = { res: .046 };
    const metal = { r: [1, 2, 3, 4] }, enamel = { r: [5, 6, 7] }, copper = { r: [8, 9, 10, 11] };
    const warm = { r: [9, 10, 11, 12] }, black = { r: [13, 1, 2] }, signal = { r: [7, 7, 7] };
    const box = (at, half, material) => sculpt.box(at, half, material, options);
    const ball = (at, radius, material) => sculpt.ball(at, radius, material, options);

    // Dark joints separate the painted panels and broad pads ground the feet.
    for (const x of [-.42, .42]) {
      box([x, .24, .16], [.30, .20, .49], metal);
      box([x, .58, .02], [.17, .25, .18], black);
      box([x, .50, .33], [.20, .09, .13], copper);
    }
    box([0, 1.03, .01], [.57, .38, .38], enamel);
    box([0, 1.04, -.38], [.43, .29, .17], metal);
    box([.19, 1.06, -.55], [.15, .13, .05], copper);
    box([0, 1.14, .395], [.24, .12, .05], black);
    for (const x of [-.14, 0, .14]) ball([x, 1.14, .46], .045, warm);
    ball([.69, 1.22, .02], .24, copper);
    box([.78, .95, .02], [.161, .24, .20], copper);
    ball([-.67, 1.20, .02], .21, metal);
    box([-.76, .95, .02], [.14, .23, .17], enamel);

    box([0, 1.45, 0], [.22, .14, .23], black);
    box([0, 1.83, .02], [.58, .34, .41], metal);
    box([0, 1.90, .411], [.465, .18, .065], black);
    box([-.20, 1.91, .49], [.116, .059, .025], signal);
    box([.215, 1.91, .49], [.127, .059, .025], signal);
    box([0, 1.67, .435], [.23, .052, .04], copper);
    ball([-.61, 1.88, 0], .21, copper);
    ball([.59, 1.88, 0], .19, enamel);
    box([-.36, 2.26, -.09], [.045, .19, .047], metal);
    ball([-.36, 2.48, -.09], .10, warm);
    sculpt.bake();

    return builder.finish({ radius: 3, dither: 0, detail: 14,
      cam: { target: [0, 1.3, 0], dist: 4.9, pitch: .17, yaw: .26, ortho: true } });
  }
});
