module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'uv-atlas-slip',
  name: 'Atlas Address Fault',
  seed: 42,
  build(seed) {
    const width = 424, height = 218, fps = 12;
    const paper = '#f7e8bc', mint = '#9ee4cf', peach = '#ffbf83', gray = '#a1b3c6';
    const atlas = SpriteSurface.make(512, 512);
    const draw = (width, height, commands) => K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const poly = (points, fill) => ({ type: 'polygon', points, fill });
    const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
    const label = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x, y], text, color, scale });
    function art(w, h, commands) {
      const { data } = draw(w, h, commands);
      return atlas.reserve(w, h, (x, y) => {
        const i = (y * w + x) * 4;
        return data[i + 3] ? (data[i] << 16) | (data[i + 1] << 8) | data[i + 2] : undefined;
      });
    }
    const bars = (x, y, entries, color) => entries.map((n, i) => rect(x + i * 3, y - n, 2, n, color));
    const navigation = art(80, 30, [
      rect(0, 0, 80, 30, '#214b5b'), rect(1, 1, 78, 28, '#285f69'),
      rect(1, 2, 78, 1, '#80c3b3'), label(5, 4, 'NAV / A17', paper),
      ...[13, 21, 29, 37, 45, 53, 61, 69].map(x => rect(x, 14, 1, 12, '#4f8184')),
      rect(5, 22, 69, 1, '#376976'), line([[5, 24], [25, 22], [33, 16], [49, 20], [69, 14]], mint),
      rect(26, 20, 3, 3, peach), rect(67, 13, 3, 3, peach)
    ]);
    art(80, 30, [
      rect(0, 0, 80, 30, '#763851'), rect(1, 1, 78, 28, '#a85a62'), rect(1, 2, 78, 1, peach),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i =>
        poly([[i * 8, 29], [i * 8 + 4, 24], [i * 8 + 8, 24], [i * 8 + 4, 29]], '#e89b68')),
      poly([[7, 21], [13, 9], [19, 21]], paper), rect(12, 14, 2, 4, '#a85a62'),
      label(27, 9, 'HOLD', paper), label(27, 18, 'BANK B', '#ffcb8e')
    ]);
    const flow = art(80, 26, [
      rect(0, 0, 80, 26, '#273948'), rect(1, 1, 78, 24, '#365769'),
      rect(2, 3, 4, 20, '#78bcaa'), label(11, 4, 'FLOW 42', paper),
      ...bars(12, 22, [3, 4, 3, 6, 5, 7, 9, 10, 11, 9, 6, 4, 5, 2, 3, 6], '#7dd3b6'),
      rect(64, 16, 10, 2, '#f0ae78'), rect(64, 20, 5, 2, '#98bebd')
    ]);
    const docking = art(80, 22, [
      rect(0, 0, 80, 22, '#303851'), rect(1, 1, 78, 20, '#3f5a74'),
      label(5, 6, 'DOCK / 03', '#cbd7e3'), rect(5, 16, 69, 2, '#78a7b5'),
      rect(59, 6, 4, 4, mint), rect(65, 6, 4, 4, '#657f9b'), rect(71, 6, 4, 4, '#657f9b')
    ]);
    const diagnostics = art(82, 38, [
      rect(0, 0, 82, 38, '#302942'), rect(14, 7, 54, 23, '#805080'),
      rect(17, 9, 48, 19, '#925887'), rect(17, 10, 47, 1, '#e29fbe'),
      ...bars(23, 25, [4, 11, 6, 12, 3, 7, 10, 4, 11, 5, 6, 13], '#c27eae'),
      label(22, 14, 'ECHO', '#ffe4d2'), rect(52, 15, 8, 2, '#eab0cd')
    ]);
    const crop = { x: diagnostics.x + 17, y: diagnostics.y + 9, width: 48, height: 19 };

    const front = art(84, 102, [
      rect(0, 0, 84, 102, '#34465a'), rect(1, 1, 82, 99, '#495d71'),
      rect(2, 0, 79, 2, '#78939e'), rect(3, 3, 77, 96, '#27394f'),
      rect(7, 5, 70, 91, '#303c50'), rect(4, 10, 1, 78, '#688296'), rect(79, 8, 1, 82, '#1f2c42'),
      ...[8, 38, 69, 93].flatMap(y => [rect(8, y, 2, 2, '#7697a3'), rect(73, y, 2, 2, '#9b8b91')]),
      ...[37, 64, 87].map(y => rect(11, y, 61, 1, '#65798a')),
      ...[0, 1, 2, 3].map(i => rect(12 + i * 5, 92, 3, 2, i < 2 ? '#80c5b4' : '#506177'))
    ]);
    const flank = art(32, 102, [
      rect(0, 0, 32, 102, '#2a354d'), rect(1, 0, 31, 2, '#5c7487'), rect(1, 3, 1, 98, '#64798b'),
      rect(5, 8, 22, 55, '#202e44'), rect(7, 10, 18, 50, '#3a4e62'),
      ...Array.from({ length: 10 }, (_, i) => rect(8, 12 + i * 4, 15, 2, '#25354c')),
      rect(5, 76, 22, 15, '#3b4c64'), rect(8, 81, 8, 2, '#bc927d'), rect(8, 85, 13, 1, '#6b8996')
    ]);
    const cap = art(40, 14, [
      rect(0, 0, 40, 14, '#627989'), rect(1, 1, 38, 11, '#516678'), rect(2, 11, 36, 2, '#3c5067'),
      rect(2, 2, 36, 1, '#81999e'), rect(15, 5, 10, 3, '#769299')
    ]);
    const foot = art(52, 10, [
      rect(0, 0, 52, 10, '#384b62'), rect(0, 0, 52, 2, '#708997'),
      rect(1, 9, 50, 1, '#24334d'),
      ...[3, 13, 23, 33, 43].map(x => poly([[x, 8], [x + 4, 4], [x + 7, 4], [x + 3, 8]], '#8d776e'))
    ]);
    const wall = art(160, 70, [
      rect(0, 0, 160, 70, '#17253a'), rect(0, 45, 160, 25, '#203147'),
      ...Array.from({ length: 11 }, (_, i) => rect(0, i * 7 + 1, 160, 1, '#21344a')),
      ...[18, 54, 105, 143].map(x => rect(x, 0, 1, 70, '#25394e')),
      line([[0, 53], [160, 53]], '#31475a')
    ]);
    atlas.faceRegion([-7, -3.4, -2], [14, 0, 0], [0, 6.8, 0], wall);
    function receiver(x, editable) {
      const face = (x0, y, z, w, h, region, id) =>
        atlas.faceRegion([x + x0, y, z], [w, 0, 0], [0, h, 0], region,
          editable && id ? { id } : undefined);
      face(-1.26, -1.43, .44, 2.52, 2.98, front);
      atlas.faceRegion([x + 1.26, -1.43, .44], [0, 0, -.73], [0, 2.98, 0], flank);
      atlas.faceRegion([x - 1.26, 1.55, .44], [2.52, 0, 0], [0, 0, -.73], cap);
      face(-1.42, -1.61, .52, 2.84, .19, foot);
      atlas.faceRegion([x + 1.42, -1.61, .52], [0, 0, -.89], [0, .19, 0], foot);
      atlas.faceRegion([x - 1.42, -1.42, .52], [2.84, 0, 0], [0, 0, -.89], cap);
      face(-.99, .57, .459, 1.98, .76, navigation, 'navigation');
      face(-.99, -.26, .459, 1.98, .64, flow, 'flow');
      face(-.99, -1.06, .459, 1.98, .58, docking, 'docking');
    }
    receiver(-2.14, false);
    receiver(2.14, true);
    const surfaces = atlas.finish();
    const palette = new Set([0x17253a]);
    for (let i = 0; i < surfaces.pixels.length; i += 4) {
      const [r, g, b, a] = surfaces.pixels.subarray(i, i + 4);
      if (a) palette.add((r << 16) | (g << 8) | b);
    }
    const states = [
      { at: 0, text: 'LOCKED', edits: [] },
      { at: 8, text: 'NEXT ATLAS CELL', edits: [{ face: 'navigation', cells: [1, 0] }] },
      { at: 20, text: 'NEXT CELL / U FLIP', edits: [{ face: 'navigation', cells: [1, 0] }, { face: 'flow', flipU: true }] },
      { at: 34, text: 'CELL / FLIP / CROP', edits: [
        { face: 'navigation', cells: [1, 0] }, { face: 'flow', flipU: true }, { face: 'docking', to: crop }
      ] },
      { at: 56, text: 'LOCKED', edits: [] }
    ];
    const stateAt = time => {
      const frame = Math.floor(time * fps + 1e-8) % 64;
      return states.findLast(state => state.at <= frame) ?? states[0];
    };
    const overlay = { resolution: [width, height], source({ time }) {
      const state = stateAt(time), fault = state.edits.length > 0;
      const { data } = draw(width, height, [
        rect(0, 0, width, 44, '#141e30'), rect(0, 191, width, 27, '#141e30'),
        rect(18, 10, 3, 15, peach), label(28, 10, 'ATLAS ADDRESS FAULT', paper, 2),
        label(19, 33, 'AUTHORED UV', mint), label(216, 33, 'LIVE UV SLIP', peach),
        rect(18, 198, 3, 7, mint), label(27, 198, 'ORIGINAL ATLAS', gray),
        rect(216, 198, 3, 7, fault ? peach : mint), label(225, 198, state.text, fault ? peach : gray)
      ]);
      return { w: width, h: height, rgba: data };
    } };
    const world = makeBuilder(seed, [...palette]).finish({
      cam: { target: [0, .14, 0], dist: 8.1, yaw: .13, pitch: .13, fov: .64, ortho: true },
      spriteSurfaces: surfaces, dither: 0, look: { pixelSize: 1, composite: { layers: [overlay] } }
    });
    let active;
    K.stage(world).add({ update(_dt, time) {
      const state = stateAt(time);
      if (state === active) return;
      SpriteSurface.uvSlip(surfaces, state.edits);
      active = state;
    } });
    return world;
  }
});
