/* Native paper sheets, genuine apertures, layered silhouettes and paper stock. */
function paperReliefDemo({ KIT: K }) {
  const state = { view: 'orchard', separation: 1, shadows: true, grain: true, paused: false, time: 0 },
    worlds = {},
    cameras = {},
    plans = {},
    stats = {};
  const rect = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ];
  const ellipse = (x, y, rx, ry, n = 48) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i * Math.PI * 2) / n;
      return [x + Math.cos(a) * rx, y + Math.sin(a) * ry];
    });
  const leaf = (x, y, w, h, angle = 0) =>
    Array.from({ length: 20 }, (_, i) => {
      const a = (i * Math.PI * 2) / 20,
        u = Math.cos(a) * w,
        v = Math.sin(a) * h * (0.75 + 0.25 * Math.cos(a));
      return [x + u * Math.cos(angle) - v * Math.sin(angle), y + u * Math.sin(angle) + v * Math.cos(angle)];
    });
  function orchard() {
    const layers = [
      { id: 'backing', profile: rect(-3.25, -2.45, 3.25, 2.45), color: '#173f51', depth: 0 },
      {
        id: 'moon',
        rings: K.paper.cut(
          (x, y) => Math.max(Math.hypot(x - 1.05, y - 1.1) - 0.46, -(Math.hypot(x - 1.2, y - 1.2) - 0.36)),
          { bounds: { min: [0.55, 0.6], max: [1.55, 1.6] }, cell: 0.04 }
        ),
        color: '#f5cc8b',
        depth: 0.06
      }
    ];
    // Distant rolling hills are actual cut silhouettes rather than translucent fog.
    for (let band = 0; band < 3; band++) {
      const outline = [
        [-3, -2.2],
        [3, -2.2]
      ];
      for (let j = 0; j <= 35; j++) {
        const x = 3 - (j * 6) / 35;
        outline.push([x, -0.65 - band * 0.25 + 0.22 * Math.sin(x * 1.3 + band) + 0.12 * Math.sin(x * 2.4 - band)]);
      }
      layers.push({
        id: 'hill-' + band,
        profile: outline,
        color: ['#3f7981', '#315f6c', '#244e5d'][band],
        depth: 0.1 + band * 0.12
      });
    }
    const capsule = (x, y, a, b, r) => {
      const ex = b[0] - a[0],
        ey = b[1] - a[1],
        t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
      return Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t) - r;
    };
    for (const [i, [cx, cy, scale]] of [
      [-1.25, -1.35, 1.05],
      [0.4, -1.4, 0.8],
      [1.45, -1.3, 0.58]
    ].entries()) {
      const field = (x, y) => {
        x = (x - cx) / scale;
        y = (y - cy) / scale;
        let d = capsule(x, y, [0, 0], [0.12, 1.45], 0.075);
        for (const [a, b, r] of [
          [[-0.02, 0.65], [-0.45, 1.2], 0.045],
          [[0.05, 0.8], [0.45, 1.45], 0.045],
          [[0.08, 1.2], [-0.14, 1.95], 0.04]
        ])
          d = Math.min(d, capsule(x, y, a, b, r));
        for (const [a, b, rx, ry] of [
          [-0.43, 1.43, 0.36, 0.4],
          [0.4, 1.65, 0.4, 0.44],
          [-0.12, 2.03, 0.43, 0.48],
          [0.12, 1.55, 0.4, 0.36]
        ])
          d = Math.min(d, (Math.hypot((x - a) / rx, (y - b) / ry) - 1) * Math.min(rx, ry));
        return d * scale;
      };
      const rings = K.paper.cut(field, {
        bounds: { min: [cx - 0.9 * scale, cy - 0.1], max: [cx + 0.9 * scale, cy + 2.65 * scale] },
        cell: 0.065,
        maxVertices: 2048
      });
      layers.push({ id: 'tree-' + i, rings, color: ['#7caaa3', '#477b80', '#244f61'][i], depth: 0.42 + i * 0.1 });
      for (let j = 0; j < 3; j++)
        layers.push({
          id: 'fruit-' + i + '-' + j,
          profile: ellipse(
            cx + Math.sin(j * 3.2) * 0.35 * scale,
            cy + (1.45 + j * 0.2) * scale,
            0.055 * scale,
            0.075 * scale,
            12
          ),
          color: '#e4ae76',
          depth: 0.465 + i * 0.1
        });
    }
    // Frames get wider toward the viewer, exposing each recessed inner cut edge.
    for (let i = 0; i < 3; i++)
      layers.push({
        id: 'aperture-' + i,
        rings: [rect(-3.25, -2.45, 3.25, 2.45), ellipse(0, 0.15, 2.28 + i * 0.18, 1.72 + i * 0.16, 64)],
        color: ['#3e7780', '#79a79f', '#ead5b3'][i],
        edgeColor: ['#244c59', '#497b7d', '#b5a180'][i],
        depth: 0.74 + i * 0.18
      });
    // Foreground blossoms cross the window edge, with independently spaced petals.
    for (const [i, x] of [-1.95, 1.75].entries()) {
      const y = -1.4,
        stem = rect(x - 0.026, -2.05, x + 0.026, y);
      layers.push({ id: 'stem-' + i, profile: stem, color: '#305f6b', depth: 1.18 });
      for (let j = 0; j < 5; j++) {
        const a = (j * Math.PI * 2) / 5;
        layers.push({
          id: 'petal-' + i + '-' + j,
          profile: leaf(x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, 0.2, 0.095, a),
          color: j % 2 ? '#e9b579' : '#f4d39d',
          depth: 1.25 + j * 0.045
        });
      }
      layers.push({ id: 'flower-heart-' + i, profile: ellipse(x, y, 0.065, 0.065, 16), color: '#b77958', depth: 1.49 });
      layers.push({
        id: 'leaf-' + i,
        profile: leaf(x + (i ? -0.13 : 0.13), -1.8, 0.2, 0.08, i ? 2.5 : 0.65),
        color: '#739b8f',
        depth: 1.225
      });
    }
    return layers;
  }
  function tides() {
    const field = (x, y) =>
      1.8 * Math.exp(-((x + 0.8) ** 2 / 1.5 + (y - 0.15) ** 2 / 0.8)) +
      1.35 * Math.exp(-((x - 1.15) ** 2 / 0.65 + (y + 0.2) ** 2 / 0.7)) -
      0.48 * Math.exp(-((x + 0.6) ** 2 / 0.12 + (y - 0.25) ** 2 / 0.1)) +
      0.04 * Math.sin(x * 6 + y * 4);
    const model = K.paper.relief(field, {
      bounds: { min: [-2.8, -1.8], max: [2.8, 1.8] },
      levels: [0.18, 0.36, 0.56, 0.78, 1.02, 1.25, 1.48],
      gap: 0.11,
      cell: 0.09,
      colors: ['#244d61', '#316b7b', '#548f98', '#8ab4ac', '#c2cfb1', '#e8cb94', '#e7ad75']
    });
    const layers = [
      { id: 'ocean', profile: rect(-3.25, -2.45, 3.25, 2.45), color: '#173e54', depth: -0.16 },
      ...model.layers.map(l => ({ ...l, depth: l.depth + 0.02 }))
    ];
    // Printed tide rings are clipped geometric strips, all on the same stock plane.
    for (let j = 0; j < 3; j++) {
      const outer = ellipse(-0.25, 0, 2.4 + j * 0.2, 1.4 + j * 0.18, 64),
        inner = ellipse(-0.25, 0, 2.385 + j * 0.2, 1.385 + j * 0.18, 64);
      layers.push({ id: 'tide-ring-' + j, rings: [outer, inner], thickness: 0, color: '#477a8c', depth: -0.13 });
    }
    const hull = [
        [-0.24, 0],
        [0.25, 0],
        [0.14, -0.1],
        [-0.13, -0.1]
      ],
      sail = [
        [-0.01, 0.03],
        [-0.01, 0.36],
        [-0.24, 0.03]
      ];
    for (const [i, [x, y]] of [
      [1.9, -1.1],
      [-1.9, 1.15]
    ].entries()) {
      layers.push({ id: 'hull-' + i, profile: hull.map(p => [p[0] + x, p[1] + y]), color: '#d09d71', depth: 0.05 });
      layers.push({ id: 'sail-' + i, profile: sail.map(p => [p[0] + x, p[1] + y]), color: '#f2dbad', depth: 0.075 });
    }
    return layers;
  }
  function rebuild() {
    const previous = { ...cameras };
    for (const [id, layers] of [
      ['orchard', orchard()],
      ['tides', tides()]
    ]) {
      const plan = K.paper.stack(
        layers.map(l => ({ ...l, depth: l.depth * state.separation })),
        { thickness: 0.04, maxVertices: 12000, maxChecks: 30000000 }
      );
      plans[id] = plan;
      const world = K.paper.world(plan, {
        background: '#0c1c28',
        camera: {
          target: [0, 0, 0.45],
          dist: 9.6,
          yaw: id === 'orchard' ? 0.15 : 0.32,
          pitch: id === 'orchard' ? 0.08 : 0.16
        },
        draw: {
          shadowStrength: state.shadows ? 0.38 : 0,
          texel: 0.025,
          shadowSamples: 3,
          shadowStep: 0.24,
          softness: 0.075,
          maxShadowTests: 40000000,
          texture: state.grain ? { grain: 0.08, fibers: 0.035, scale: 0.035 } : false,
          ambient: 0.65
        }
      });
      worlds[id] = world;
      cameras[id] = { ...world.cam, ...previous[id] };
      stats[id] = { count: world.count, layers: plan.layers.length };
    }
  }
  rebuild();
  return {
    state,
    rebuild,
    plans,
    stats,
    get world() {
      return worlds[state.view];
    },
    get camera() {
      return cameras[state.view];
    },
    update(dt) {
      if (!state.paused) state.time += dt;
    }
  };
}
if (typeof module !== 'undefined') module.exports = paperReliefDemo;
