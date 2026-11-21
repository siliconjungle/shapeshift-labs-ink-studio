module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'stale-instance-transforms',
  name: 'Phase Register',
  seed: 71,
  build(seed) {
    const { animationGraph: A, graph, drawing2d } = K.procedural;
    const width = 464, height = 230, fps = 12, period = 64 / fps;
    const palette = [0x142236, 0x34495e, 0x688aa0, 0xaecbc2, 0xe89593, 0xffd0ad,
      0xeec87f, 0xffe9a9, 0x7bbfc1, 0xc2f2d0, 0x3a6176];
    const body = [
      '......L.....', '.....LL.....', '..F..LWWL...', '.FLLLLWWLL..',
      'CCFFFFLWWLLL', '..LLLLWWLL..', '.....LL.....', '......L.....'
    ];
    function model(light, bodyInk) {
      const B = makeBuilder(seed, palette), ink = { F: 10, L: bodyInk, W: light, C: 3 };
      for (let y = 0; y < body.length; y++) for (let x = 0; x < body[y].length; x++) {
        const color = ink[body[y][x]];
        if (color === undefined) continue;
        B.disc((x - 5.5) * .047, (3.5 - y) * .043, 0, [0, 0, 1], .024, .012, B.P[color], 3.5, { em: true });
      }
      return K.frameSplats.capture(B.finish());
    }
    const models = [model(3, 2), model(5, 4), model(7, 6), model(9, 8)];
    const objects = ['position', 'rotation', 'scale'];
    const ids = objects.flatMap(lane => [lane + '-guide', lane, lane + '-wing']);
    function samples(time) {
      const phase = 2 * Math.PI * time / period;
      return ids.map((id, i) => {
        const lane = Math.floor(i / 3), cell = i % 3, angle = phase * 2 + i * .58;
        const subject = cell === 1;
        const scale = lane === 2 && cell === 0 ? 1.20 + .19 * Math.sin(angle) :
          (lane === 2 && subject ? .66 : .79) + .10 * Math.cos(angle);
        return {
          id,
          position: [(cell - 1) * .92 + .22 * Math.sin(angle), .82 - lane * .76 + .103 * Math.cos(angle), 0],
          rotation: K.M.rot([0, 0, 1], lane === 1 && subject ? 2.7 * Math.sin(angle) : .7 * Math.sin(angle)),
          scale
        };
      });
    }
    const snapshots = { held: A.captureTransforms(samples(7 / fps)) };
    const edits = [
      { id: 'position', snapshot: 'held', channels: ['position'] },
      { id: 'rotation', snapshot: 'held', channels: ['rotation'] },
      { id: 'scale', from: 'scale-guide', channels: ['scale'] }
    ];
    const program = graph.create({
      inputs: { live: 'array<record>', changes: 'array<record>' },
      nodes: { stale: { op: 'anim.staleTransforms', inputs: {
        source: { input: 'live' }, edits: { input: 'changes' }, snapshots: { value: snapshots }
      } } },
      outputs: { value: { node: 'stale' } }
    });
    const activeAt = time => {
      const frame = Math.floor(time * fps + 1e-8) % 64;
      return frame >= 8 && frame < 54;
    };
    const B = makeBuilder(seed, palette);
    const shaped = ids.map((_, i) => models[i % 3 === 1 ? Math.floor(i / 3) + 1 : 0]);
    const capacity = shaped.reduce((count, model) => count + model.count, 0) * 2;
    const replicas = K.frameSplats(B, capacity, (draw, _dt, time) => {
      time %= period;
      const live = samples(time), { value } = program.evaluate({ live, changes: activeAt(time) ? edits : [] }, { time }).outputs;
      for (const [offset, poses] of [[-1.89, live], [1.89, value]]) {
        for (const [i, pose] of poses.entries()) {
          const [x, y, z] = pose.position;
          draw.model(shaped[i], [x + offset, y, z], { matrix: A.instanceMatrix(pose) });
        }
      }
    });
    const pale = '#f5e7c4', mist = '#9bb0c2', cyan = '#b9e6d1';
    const inks = ['#ffb09f', '#f4d388', '#a4e4c5'];
    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const text = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x, y], text, color, scale });
    const overlay = { resolution: [width, height], source({ time }) {
      const active = activeAt(time);
      const { data } = drawing2d.render({ width, height, edges: 'hard', commands: [
        rect(0, 0, width, 44, '#131e30'), rect(0, 198, width, 32, '#131e30'),
        rect(16, 10, 3, 15, inks[0]), text(26, 10, 'PHASE REGISTER', pale, 2),
        text(16, 34, 'LIVE TRANSFORMS', cyan), text(248, 34, 'SELECTIVE STALE TRANSFORMS', pale),
        rect(231, 45, 1, 151, '#425870'),
        ...[88, 135, 182].flatMap((y, i) => [
          ...[17, 248].flatMap(x => [rect(x, y, 199, 1, '#354a60'),
            ...[2, 41, 82, 122, 162, 197].map(k => rect(x + k, y - 3, 1, 3, '#435e73'))]),
          text(17, y + 3, objects[i].toUpperCase() + ' LIVE', mist),
          text(248, y + 3, active ? ['POSITION HELD', 'ROTATION HELD', 'SCALE COPIED FROM GUIDE'][i] : 'LIVE',
            active ? inks[i] : mist)
        ]),
        text(16, 207, 'NINE FLIGHT MARKERS', mist),
        text(248, 207, active ? 'SNAPSHOT 07 / ONE CHANNEL PER MARKER' : 'CHANNELS SYNCHRONIZED', active ? pale : mist)
      ] });
      return { w: width, h: height, rgba: data };
    } };
    const world = B.finish({
      cam: { target: [0, .02, 0], dist: 5.56, yaw: 0, pitch: 0, fov: .66, ortho: true },
      dither: 0, look: { pixelSize: 1, composite: { layers: [overlay] } }
    });
    K.stage(world).add(replicas);
    return world;
  }
});
