// A retained sculpt pass on a ceramic instrument panel.
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const P = K.procedural;
  const id = 'ceramic-instrument-panel';
  const seed = 11;
  const palette = [0x16222f, 0x273748, 0x385161, 0x58727d, 0x839995,
    0x644355, 0x995f51, 0xd18859, 0xffc481, 0xffe3a8,
    0x254a57, 0x357581, 0x5da8aa, 0x9bd5bd, 0xd8ebcb];
  const box = (min, max) => P.sculptMasks.field({ kind: 'box', min, max });
  const ball = (center, radius) => P.sculptMasks.field({ kind: 'sphere', center, radius });
  const tile = box([-2.29, .49, -.24], [2.31, 2.61, .37]);
  const spine = box([-1.27, .54, -.29], [-.96, 2.56, .52]);
  const wing = box([1.49, .55, -.27], [2.4, 2.55, .53]);
  const rivets = [.78, 2.32].map(y => ball([-1.11, y, .51], .135));
  const materials = [
    { id: 'glaze', color: 0x79a4a3 },
    { id: 'bronze', color: 0xcf8f53 },
    { id: 'side-cover', color: 0x527e95 },
    { id: 'exposed-clay', color: 0xc8795e }
  ];

  function build(value) {
    const B = makeBuilder(value, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.64, .76, .56]), amb: .46, sky: .19, sunK: .7 });
    S.box([0, -.15, .02], [2.88, .27, .99], { r: [1, 2, 3, 4] }, { rd: .13, res: .14 });
    for (const x of [-1.76, 1.76])
      S.box([x, .31, -.06], [.24, .23, .55], { r: [1, 2, 3, 4] }, { rd: .07, res: .1 });
    S.bake();
    const bricks = P.sparseBricks.create({ cell: .092, brickSize: 8,
      base: (...p) => Math.min(tile(...p), spine(...p), wing(...p), ...rivets.map(sdf => sdf(...p))) });
    const panel = P.brickMeshes.create({
      bricks, objectId: 'panel', materials,
      bounds: { min: [-2.65, .28, -.55], max: [2.67, 2.89, .85] },
      materialAt(x) {
        if (x >= 1.49) return 'side-cover';
        if (x >= -1.29 && x <= -.95) return 'bronze';
        return 'glaze';
      },
      derived: { depthProxy: true }
    });
    return B.finish({ id, brickMeshes: [panel], dither: 0, look: { pixelSize: 1 }, radius: 5.3,
      cam: { target: [0, 1.34, 0], yaw: .21, pitch: .16, dist: 8.6, ortho: true },
      fog: { c: 0, start: 1, max: 0 },
      areaLights: [{ id: 'bench-light', shape: 'disk', at: [-2.55, 4.75, 2.66], normal: [.33, -.6, -.75],
        size: [.3, .3], color: '#ffddaa', intensity: 3.6, radius: 8, sampleGrid: 1, visible: false, shadows: false }] });
  }

  return { id, seed, name: 'Ceramic instrument panel', build };
};
