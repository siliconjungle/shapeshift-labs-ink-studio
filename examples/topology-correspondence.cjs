/* Trace a relay panel split, service plate merge, and rebased mesh import. */
const path = require('node:path');
const studio = require('..');
const { json } = require('../cli/asset-files.js');
const { grid, upscale } = require('../cli/render.js');
const PNG = require('../cli/png.js');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const topology = KIT.meshTopology;
const z = .32;
const positions = {
  left: [-1.37, .43, z], middle: [.48, .43, z], crown: [.48, 1.66, z], cap: [-1.13, 1.66, z],
  bevel: [-1.37, 1.40, z], foot: [-.25, .43, z], serviceLeft: [.60, .43, z], serviceRight: [1.28, .43, z],
  serviceTop: [1.28, 1.66, z], serviceCap: [.60, 1.66, z],
  plugLeft: [.81, 1.80, z], plugRight: [1.08, 1.80, z], plugTop: [1.08, 1.97, z], plugCap: [.81, 1.97, z]
};
const vertex = id => ({ id, position: positions[id] });
const face = (id, ring, material, bounds) => ({
  id, material, corners: ring.map(vertex => {
    const [x, y] = positions[vertex], [left, right, bottom, top] = bounds;
    return { id: id + '/' + vertex, vertex, uv: [(x - left) / (right - left), 1 - (y - bottom) / (top - bottom)] };
  })
});
const coverBounds = [-1.37, .48, .43, 1.66], serviceBounds = [.60, 1.28, .43, 1.66];
const cover = ring => face('cover', ring, 'enamel', coverBounds);
const service = (id, ring) => face(id, ring, 'bronze', serviceBounds);
const oldCover = cover(['left', 'middle', 'crown', 'cap', 'bevel']);

function atlas(kind, shift) {
  const width = 48, height = 36, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    const teal = kind === 'enamel';
    let color = teal ? (y < 17 ? 0x488a81 : 0x3a706c) : 0x9b714b;
    if (edge < 2) color = edge ? (teal ? 0x6f9e8c : 0xcd9d69) : 0x253b45;
    if (teal && x >= 6 && x < 33 && y >= 7 && y < 27) {
      color = 0x182b3b;
      const r = Math.hypot(x - 19, (y - 25) * 1.13);
      if (r > 8 && r < 11 && y < 23) color = x < 19 ? 0x61a99b : 0xe8b577;
      if (y > 13 && y < 24 && Math.abs(x - 18 - (24 - y) * .62) < 1.1) color = 0xece0ad;
    }
    if (teal && x >= 37 && x <= 42 && y >= 9 && y < 28) color = y % 8 < 3 ? 0xddad72 : 0x2e5558;
    if (!teal && x > 9 && x < 39 && y > 9 && y < 26) color = y % 4 < 2 ? 0x493c37 : 0x795d43;
    if (edge > 1 && shift) {
      const tint = channel => Math.min(255, Math.max(0, channel + shift));
      color = tint(color >> 16) * 65536 + tint(color >> 8 & 255) * 256 + tint(color & 255);
    }
    pixels.set([color >> 16, color >> 8 & 255, color & 255, 255], (y * width + x) * 4);
  }
  return { width, height, pixels };
}

function render(doc, report, side) {
  const rows = report.domains.faces.groups;
  const materials = [
    { id: 'enamel', texture: atlas('enamel', 0) }, { id: 'seam', texture: atlas('enamel', -24) },
    { id: 'bronze', texture: atlas('bronze', 0) }, { id: 'upper', texture: atlas('bronze', -23) },
    { id: 'tungsten', color: 0xbb8583 }
  ];
  const faces = doc.faces.map(face => {
    const row = rows.find(row => row[side].includes(face.id));
    if (row.status === 'split' && face.id === 'access') return { ...face, material: 'seam' };
    if (row.status === 'merged' && face.id === 'service-top') return { ...face, material: 'upper' };
    return face;
  });
  const mesh = topology.toSceneMesh(topology.create({ ...doc, faces }), { materials });
  const builder = makeBuilder(31, [0x192630, 0x2b4151, 0x415d68, 0x687f83, 0x96a89c, 0xc4bc98]);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  Object.assign(sculpt, { sun: [-.58, .7, .45], amb: .43, sky: .14, sunK: .48, wob: 0 });
  sculpt.box([0, .27, -.035], [1.55, .12, .47], { r: [1, 2, 3, 4] }, { res: .045 });
  sculpt.box([-.04, 1.05, .03], [1.38, .65, .25], { r: [1, 2, 3, 4] }, { res: .06 });
  sculpt.bake();
  const world = builder.finish({ meshes: [mesh], cam: { target: [0, 1.05, 0], dist: 4.6, ortho: true, yaw: .20, pitch: .13, sway: 0 },
    radius: 4, dither: 0, look: { splatCoverage: 'continuous' },
    skyEnvironment: { defaults: { zenith: '#2a4058', horizon: '#465c68', ground: '#172735', sunStrength: 0 } } });
  return studio.render(world, { w: 166, h: 108, px: 1, raw: true });
}

function main(directory) {
  const file = name => path.resolve(directory, name);
  const existing = Object.keys(positions).filter(id => id !== 'foot');
  const before = topology.create({
    id: 'signal-panel', vertices: existing.map(vertex),
    edges: [{ id: 'cover-sill', vertices: ['left', 'middle'] }],
    faces: [oldCover, service('service-bottom', ['serviceLeft', 'serviceRight', 'serviceTop']),
      service('service-top', ['serviceLeft', 'serviceTop', 'serviceCap']),
      face('test-clip', ['plugLeft', 'plugRight', 'plugTop', 'plugCap'], 'tungsten', [.81, 1.08, 1.8, 1.97])]
  });
  const patch = {
    vertices: [vertex('foot')], removeVertices: ['plugLeft', 'plugRight', 'plugTop', 'plugCap'],
    removeFaces: ['service-top', 'test-clip'],
    faces: [cover(['left', 'foot', 'crown', 'cap', 'bevel']), face('access', ['foot', 'middle', 'crown'], 'enamel', coverBounds),
      service('service-bottom', ['serviceLeft', 'serviceRight', 'serviceTop', 'serviceCap'])]
  };
  const { document: after, correspondence } = topology.editWithCorrespondence(before, patch);
  const reimport = topology.create({ id: after.id, vertices: after.vertices.map(row =>
    ({ id: 'import/' + row.id, position: [row.position[0], row.position[1], row.position[2] + .012] })),
  faces: after.faces.map(row => ({ ...row, id: 'import/' + row.id, corners: row.corners.map(corner =>
    ({ ...corner, id: 'import/' + corner.id, vertex: 'import/' + corner.vertex })) }))
  });
  const projection = { maxDistance: .08 };
  const projected = topology.correspond(after, reimport, { projection });
  for (const [name, value] of Object.entries({ before, patch, after, correspondence, reimport, projection, projected }))
    json(file(name + '.json'), value);

  const frames = [[before, 'from', 'before'], [after, 'to', 'after']].map(([doc, side, name]) => {
    const frame = render(doc, correspondence, side);
    PNG.write(file(name + '.png'), frame.w, frame.h, frame.rgb);
    return upscale(frame, 2);
  });
  const sheet = grid(frames, 2);
  PNG.write(file('comparison.png'), sheet.w, sheet.h, sheet.rgb);
}

if (require.main === module) main(process.argv[2] ?? 'topology-correspondence-review');
