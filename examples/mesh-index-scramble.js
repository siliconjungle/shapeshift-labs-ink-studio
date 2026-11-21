module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'mesh-index-scramble',
  name: 'Lacuna Relay',
  seed: 29,
  build(seed) {
    const { sceneGraph: G, drawing2d } = K.procedural;
    const width = 432, height = 224, fps = 12, cols = 12, bandRows = 18;
    const paper = '#fae5be', ice = '#a3e9d1', amber = '#f8bb80', mist = '#a4b7c9';
    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const oval = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
    const line = (points, color) => ({ type: 'path', points, color, width: 1 });
    const text = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x, y], text, color, scale });
    const draw = (width, height, commands) => drawing2d.render({ width, height, commands, edges: 'hard' });
    const pad = n => String(n).padStart(2, '0');

    const bands = [[-1.34, -1.12], [-.96, -.68], [-.51, -.26], [-.10, .14], [.30, .54], [.70, .94], [1.10, 1.36]];
    const pos = [], uvs = [], tri = [], faces = [], donors = [];
    for (const [band, levels] of bands.entries()) {
      const base = pos.length / 3;
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= cols; i++) {
        const u = i / cols, v = j / 2, angle = (u - .5) * 2.55;
        const y = levels[1] * (1 - v) + levels[0] * v + .09 * Math.sin(angle);
        const radius = 1.43 * Math.sqrt(1 - (y / 1.66) ** 2);
        if (band % 2 === 0) donors.push(pos.length / 3);
        pos.push(radius * Math.sin(angle), y, radius * .64 * Math.cos(angle));
        uvs.push(u, ((bands.length - 1 - band) * bandRows + 1 + (bandRows - 3) * v) / (bands.length * bandRows - 1));
      }
      for (let j = 0; j < 2; j++) for (let i = 0; i < cols; i++) {
        const a = base + j * (cols + 1) + i, b = a + cols + 1;
        if (band % 2) faces.push(tri.length / 3, tri.length / 3 + 1);
        tri.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const contacts = [[1, 1.59, -.81, .51], [3, 1.71, .49, .57], [5, 1.54, .81, .57]];
    const spikes = contacts.map(([band, x, y, z]) => {
      const vertex = pos.length / 3;
      pos.push(x, y, z, x + .05, y -.05, z, x + .09, y + .01, z);
      uvs.push(.12, .16, .13, .16, .14, .16);
      tri.push(vertex, vertex + 1, vertex + 2);
      return { face: band * cols * 4 + (cols - 1) * 2, corner: 2, vertex };
    });
    const spikeFaces = new Set(spikes.map(edit => edit.face));
    const shell = { pos, tri, uvs };
    const limits = {
      seed, minDisplacement: .31, maxDisplacement: .92,
      bounds: { min: [-.64, -1.2, 0], max: [1.81, 1.2, 1.04] }
    };
    const seededFaces = faces.filter(face => !spikeFaces.has(face));
    function sample(maxFaces, spikeCount) {
      const split = G.scrambleIndices(shell, { ...limits, faces: seededFaces, donors, amount: 1,
        maxFaces: maxFaces - spikeCount });
      if (!spikeCount) return split;
      const pointed = G.scrambleIndices(split.value, { ...limits, faces: [...spikeFaces], edits: spikes.slice(0, spikeCount) });
      return { value: pointed.value, report: {
        changedFaces: split.report.changedFaces + pointed.report.changedFaces,
        largestDisplacement: Math.max(split.report.largestDisplacement, pointed.report.largestDisplacement)
      } };
    }
    const states = [
      [0, 0, 0], [8, 5, 1], [18, 11, 2], [32, 22, 3], [46, 11, 2], [56, 0, 0]
    ].map(([at, maxFaces, spikeCount]) => ({ at, ...sample(maxFaces, spikeCount) }));
    const stateAt = time => {
      const frame = Math.floor(time * fps + 1e-8) % 64;
      return states.findLast(state => state.at <= frame) ?? states[0];
    };

    const ceramic = draw(112, bands.length * bandRows, bands.flatMap((_, i) => {
      const y = bandRows * i, warm = i === 1 || i === 5;
      const base = warm ? '#885564' : '#336271', rim = warm ? '#f5be89' : '#a1dcca';
      const shade = warm ? '#603c55' : '#25495e', panel = warm ? '#aa7272' : '#487d85';
      return [
        rect(0, y, 112, bandRows, base), rect(0, y + 1, 112, 2, rim),
        rect(0, y + 13, 112, 4, shade), rect(16, y + 4, 80, 8, panel),
        rect(3, y + 4, 2, 9, rim), rect(105, y + 4, 4, 8, rim),
        ...Array.from({ length: 10 }, (_, j) => rect(8 + j * 10, y + 10, 6, 1, rim)),
        ...[14, 33, 53, 74, 95].map(x => rect(x, y + 4, 1, 9, shade)),
        rect(22, y + 6, 8, 2, '#e8a990'), rect(85, y + 6, 6, 2, '#e8a990')
      ];
    }));
    const carrier = draw(96, 114, [
      oval(11, 7, 74, 99, '#263d54'), oval(17, 11, 62, 91, '#4c6d80'), oval(19, 13, 58, 87, '#22384f'),
      oval(29, 20, 38, 73, '#355667'), rect(45, 11, 6, 88, '#71959b'),
      rect(46, 19, 4, 74, '#b2cdb6'),
      ...Array.from({ length: 8 }, (_, i) => rect(34, 21 + i * 10, 28, 1, '#5a8290')),
      oval(33, 43, 30, 28, '#8e5d73'), oval(37, 47, 22, 20, '#e49f87'), oval(42, 51, 12, 11, '#ffe0aa'),
      line([[47, 5], [47, 18]], '#a2c9bc'), line([[47, 96], [47, 108]], '#a2c9bc')
    ]);
    const dock = draw(100, 16, [
      rect(0, 0, 100, 16, '#31465d'), rect(1, 1, 98, 4, '#648795'), rect(4, 12, 92, 2, '#24374d'),
      ...Array.from({ length: 12 }, (_, i) => rect(6 + i * 8, 6, 4, 3, i % 3 ? '#789b9e' : '#e8a684'))
    ]);
    const backing = draw(160, 72, [
      rect(0, 0, 160, 72, '#1a293f'), rect(0, 58, 160, 14, '#23364c'),
      ...Array.from({ length: 11 }, (_, i) => rect(0, i * 7, 160, 1, '#253a51')),
      ...Array.from({ length: 13 }, (_, i) => rect(i * 13, 0, 1, 72, '#253a51')),
      rect(0, 57, 160, 1, '#3a536a')
    ]);
    const palette = new Set([0x17243a]);
    const eachTexel = (image, i) => image.data[i + 3]
      ? (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2] : undefined;
    for (const image of [ceramic, carrier, dock, backing])
      for (let i = 0; i < image.data.length; i += 4) {
        const color = eachTexel(image, i);
        if (color !== undefined) palette.add(color);
      }

    function stageSurface(right) {
      const pack = SpriteSurface.make(512, 256);
      const region = image => pack.reserve(image.width, image.height, (x, y) => eachTexel(image, (y * image.width + x) * 4));
      const shellRegion = region(ceramic), coreRegion = region(carrier), baseRegion = region(dock), background = region(backing);
      pack.faceRegion([-7, -3, -2.2], [14, 0, 0], [0, 6, 0], background);
      for (const [x, mesh] of [[-2.07, states[0].value], [2.07, right]]) {
        pack.faceRegion([x - 1.35, -1.46, -.05], [2.7, 0, 0], [0, 2.92, 0], coreRegion);
        pack.faceRegion([x - 1.3, -1.67, .42], [2.6, 0, 0], [0, .22, 0], baseRegion);
        pack.faceRegion([x - 1.3, -1.45, .42], [2.6, 0, 0], [0, 0, -.72], baseRegion);
        const points = mesh.pos.map((n, i) => i % 3 === 0 ? n + x : n);
        pack.meshRegion({ points, uvs: mesh.uvs, triangles: mesh.tri }, shellRegion);
      }
      return pack.finish();
    }
    const atlases = new Map(states.map(state => [state, stageSurface(state.value)]));
    const overlay = { resolution: [width, height], source({ time }) {
      const { report } = stateAt(time), fault = report.changedFaces > 0;
      const { data } = draw(width, height, [
        rect(0, 0, width, 44, '#151e30'), rect(0, 190, width, 34, '#151e30'),
        rect(16, 10, 3, 15, amber), text(24, 10, 'LACUNA RELAY', paper, 2),
        text(16, 33, 'ORIGINAL MESH', ice), text(219, 33, 'INDEX SCRAMBLE', amber),
        text(16, 197, String(tri.length / 3) + ' TRIANGLES', mist),
        text(219, 197, pad(report.changedFaces) + ' CORNERS REDIRECTED', fault ? amber : mist),
        text(219, 208, 'REACH ' + report.largestDisplacement.toFixed(2) + ' / 0.92', mist)
      ]);
      return { w: width, h: height, rgba: data };
    } };
    const world = makeBuilder(seed, [...palette]).finish({
      cam: { target: [0, .19, 0], dist: 8.08, yaw: .10, pitch: .14, fov: .64, ortho: true },
      spriteSurfaces: atlases.get(states[0]), dither: 0, look: { pixelSize: 1, composite: { layers: [overlay] } }
    });
    K.stage(world).add({ update(_dt, time) { world.spriteSurfaces = atlases.get(stateAt(time)); } });
    return world;
  }
});
