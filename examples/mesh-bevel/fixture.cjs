'use strict';

function consoleMesh() {
  const vertices = [], faces = [];
  function box(id, x0, x1, y0, y1, z0, z1, top, side) {
    const xy = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const ring = (name, z, pigment) => xy.map(([x, y], i) => {
      const key = id + '/' + name + '/' + i;
      vertices.push({ id: key, position: [x, y, z], weights: { fixture: 1 - pigment, knob: pigment } });
      return key;
    });
    const front = ring('front', z1, .6), back = ring('back', z0, .1);
    function face(key, material, ids) {
      const full = id + '/' + key, uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
      faces.push({ id: full, material, corners: ids.map((vertex, i) => ({ id: full + '/c' + i, vertex, uv: uv[i],
        attributes: { mask: i / 3, grain: [i < 2 ? 1 : 0, .25, .4] } })) });
    }
    face('face', top, front);
    face('rear', side, back.slice().reverse());
    for (let i = 0; i < xy.length; i++) {
      const j = (i + 1) % xy.length;
      face('side/' + i, side, [front[j], front[i], back[i], back[j]]);
    }
  }
  box('panel', -1.24, .68, -.77, .77, -.35, .35, 'lettering', 'enclosure');
  box('rail', .735, 1.04, -.72, .72, -.33, .35, 'painted-rail', 'painted-rail');
  return { id: 'relay-console', vertices, faces };
}

function request(api, document, options = {}) {
  const selection = api.select(document, { domain: 'edges',
    ids: document.edges.filter(edge => edge.vertices.every(id => id.startsWith('panel/front/'))).map(edge => edge.id) });
  const right = document.edges.find(edge => edge.vertices.join() === 'panel/front/1,panel/front/2').id;
  return { id: options.id ?? 'soften-rim', revision: api.revision(document),
    bevel: { selection, width: .18, profile: 'round', segments: 4, join: 'patch', material: 'machined-rim',
      weights: [{ edge: right, weight: .65 }], ...options.bevel },
    protect: { materials: ['painted-rail'], paint: [{ face: 'panel/face', min: [.15, .18], max: [.85, .82] }],
      gaps: [{ id: 'rail-clearance', origin: [.705, 0, 3], direction: [0, 0, -1], distance: 6 }], ...options.protect } };
}

function texture(w, h, draw) {
  const pixels = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.push(...draw(x, y), 255);
  return { width: w, height: h, pixels };
}

function materials() {
  const glyph = ['111011101000010', '100010101000101', '110011101000111', '100010001000101', '100010001110101'];
  return [
    { id: 'enclosure', color: 0x2e424e },
    { id: 'machined-rim', color: 0xae7950 },
    { id: 'painted-rail', color: 0x427470 },
    { id: 'lettering', color: 0xffffff, texture: texture(54, 44, (x, y) => {
      const edge = Math.min(x - 7, 46 - x, y - 8, 36 - y);
      const text = glyph[y - 15]?.[x - 19] === '1';
      const cell = Math.floor((x - 14) / 4);
      const status = y >= 26 && y <= 29 && x >= 14 && x < 41 && (x - 14) % 4 < 3;
      const screw = [4, 49].includes(x) && [10, 33].includes(y);
      if (text || screw) return [236, 211, 139];
      if (status) return cell > 4 ? [231, 173, 98] : [91, 179, 156];
      if (edge === 0 || y === 24 && x > 13 && x < 41) return [89, 138, 125];
      if (edge > 0 || x === 1 || y === 1) return [19, 43, 50];
      return [53, 98, 94];
    }) }
  ];
}

module.exports = { consoleMesh, request, materials };
