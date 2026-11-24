/* A painted relay housing gains a recessed shoulder and a new side facet. */
const fs = require('node:fs');
const path = require('node:path');
const studio = require('..');
const PNG = require('../cli/png.js');
const { grid, upscale } = require('../cli/render.js');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const topology = KIT.meshTopology;

function housing(revised) {
  const ring = [
    ['foot-left', -1.06, -.68], ['foot-right', 1.06, -.68],
    ['shoulder', 1.06, revised ? .12 : .46],
    ...(revised ? [['recess', .51, .12]] : []),
    ['crown-right', revised ? .51 : .82, .72], ['crown-left', -.83, .72],
    ['left-chamfer', -1.06, .46]
  ];
  const vertices = ['front', 'back'].flatMap(side => ring.map(([id, x, y]) =>
    ({ id: side + '/' + id, position: [x, y + 1.05, side === 'front' ? .33 : -.33] })));
  const corner = (face, side, [id, x, y], uv = [(x + 1.1) / 2.2, (0.76 - y) / 1.48]) =>
    ({ id: face + '/' + side + '/' + id, vertex: side + '/' + id, uv });
  const faces = [
    { id: 'cover', material: 'enamel', corners: ring.map(vertex => corner('cover', 'front', vertex)) },
    { id: 'back', material: 'case', corners: ring.slice().reverse().map(vertex => corner('back', 'back', vertex)) }
  ];
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length], id = 'wall/' + a[0];
    const material = a[0] === 'recess' ? 'exposed-metal' : ['crown-right', 'left-chamfer'].includes(a[0]) ? 'rim' : 'case';
    faces.push({ id, material, corners: [
      corner(id, 'front', b, [1, 0]), corner(id, 'front', a, [0, 0]),
      corner(id, 'back', a, [0, 1]), corner(id, 'back', b, [1, 1])
    ] });
  }
  return topology.create({ id: 'relay', vertices, faces,
    edges: [{ id: 'cover-base', vertices: ['front/foot-left', 'front/foot-right'] }] });
}

function paint() {
  const width = 80, height = 56, pixels = new Uint8Array(width * height * 4);
  const digits = [
    ['111', '101', '101', '101', '111'],
    ['111', '001', '111', '001', '111']
  ];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bevel = Math.min(x - 1, 78 - x, y - 1, 54 - y);
    let color = [0x29495a, 0x315968, 0x3d6d74, 0x457b7f][Math.min(3, Math.floor(y / 14))];
    if (bevel < 1) color = 0x172e3d;
    else if (bevel < 3) color = x < 4 || y < 4 ? 0x78a696 : 0x254352;
    if (x > 9 && x < 47 && y > 12 && y < 39) {
      color = y > 34 ? 0x263d4a : 0x172c39;
      const dx = x - 26, dy = (y - 37) * 1.1, radius = Math.hypot(dx, dy);
      if (radius > 13 && radius < 16 && y < 33) color = x < 26 ? 0x509987 : 0xe2a967;
      if (y > 21 && y < 34 && Math.abs(dx + (y - 35) * .57) < 1.3) color = 0xf2d9a5;
      if (Math.abs(dx) < 3 && y >= 33 && y < 36) color = 0x8bb3ac;
    }
    if (x > 49 && x < 69 && y > 23 && y < 43) color = y < 35 ? 0x203849 : 0x597d77;
    if (y >= 25 && y < 30) {
      const gx = x - 55, digit = digits[Math.floor(gx / 5)];
      if (gx >= 0 && digit && digit[y - 25][gx % 5] === '1') color = 0xe9c996;
    }
    if (x > 53 && x < 66 && y >= 37 && y < 41) color = x % 5 < 2 ? 0xeaad67 : 0x2b4e58;
    if ([7, 72].includes(x) && [8, 47].includes(y)) color = 0xdcb382;
    pixels.set([color >> 16, color >> 8 & 255, color & 255, 255], (y * width + x) * 4);
  }
  return { width, height, pixels };
}

function show(document, materials) {
  const mesh = topology.toSceneMesh(document, { objectId: 'signal-relay', partId: 'housing', materials });
  const builder = makeBuilder(7, [0x152130, 0x283947, 0x3a5060, 0x577381, 0x7b9293, 0xa5af9f]);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  Object.assign(sculpt, { sun: [-.56, .65, .47], amb: .43, sky: .14, sunK: .48, wob: 0 });
  sculpt.box([0, .02, 0], [1.35, .13, .63], { r: [1, 2, 3, 4] }, { res: .045 });
  sculpt.box([0, .21, 0], [.65, .13, .41], { r: [1, 2, 3, 4] }, { res: .045 });
  sculpt.bake();
  return builder.finish({ meshes: [mesh], cam: { target: [0, .96, 0], dist: 4.2, ortho: true, yaw: .27, pitch: .17, sway: 0 },
    radius: 4, dither: 0, look: { splatCoverage: 'continuous' },
    skyEnvironment: { defaults: { zenith: '#1c3047', horizon: '#42586a', ground: '#172832', sunStrength: 0 } } });
}

function main(directory) {
  const before = housing(false), design = housing(true);
  const changed = (from, to) => {
    const previous = new Map(from.map(row => [row.id, JSON.stringify(row)]));
    return to.filter(row => previous.get(row.id) !== JSON.stringify(row));
  };
  const patch = { vertices: changed(before.vertices, design.vertices), faces: changed(before.faces, design.faces) };
  const after = topology.edit(before, patch);
  const materials = [
    { id: 'enamel', texture: paint() }, { id: 'case', color: 0x244254 },
    { id: 'rim', color: 0x5b9693 }, { id: 'exposed-metal', color: 0xbc8452 }
  ];
  fs.mkdirSync(directory, { recursive: true });
  function json(name, value) {
    fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  }
  json('patch', patch);
  const reports = {}, frames = [];
  for (const [name, document] of [['before', before], ['after', after]]) {
    const report = topology.inspect(document);
    reports[name] = {
      vertices: report.vertices, edges: report.edges.length, faces: report.faces, triangles: report.triangles,
      coverCorners: document.faces.find(face => face.id === 'cover').corners.map(corner => corner.id),
      preservedEdge: report.edges.find(edge => edge.id === 'cover-base')
    };
    json(name, document);
    const frame = studio.render(show(document, materials), { w: 160, h: 124, px: 1, raw: true });
    PNG.write(path.join(directory, name + '.png'), frame.w, frame.h, frame.rgb);
    frames.push(upscale(frame, 2));
  }
  const sheet = grid(frames, 2, ['original', 'revised']);
  PNG.write(path.join(directory, 'comparison.png'), sheet.w, sheet.h, sheet.rgb);
  json('report', reports);
}

if (require.main === module) main(process.argv[2] ?? 'mesh-topology-review');
