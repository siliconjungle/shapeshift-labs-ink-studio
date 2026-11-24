'use strict';

function mesh(id) {
  const vertices = [], faces = [];
  function vertex(id, position) {
    vertices.push({ id, position, weights: { chassis: 1 } });
    return id;
  }
  function face(id, material, ring, uv = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
    faces.push({ id, material, corners: ring.map((vertex, i) => ({
      id: id + '/corner/' + i, vertex, uv: uv[i], attributes: { pigment: i / (ring.length - 1) }
    })) });
  }
  return { vertex, face, document: { id, vertices, faces } };
}

function meter() {
  const { vertex, face, document } = mesh('relay-meter');
  const outline = [[-1.30, -.88], [1.30, -.88], [1.30, .88], [-1.30, .88]];
  const front = outline.map(([x, y], i) => vertex('front/' + i, [x, y, .28]));
  const back = outline.map(([x, y], i) => vertex('rear/' + i, [x, y, -.54]));
  face('gauge', 'dial', front);
  face('back', 'case', back.slice().reverse());
  for (const [i, a] of front.entries()) {
    const j = (i + 1) % front.length;
    face('case/' + i, 'case', [front[j], a, back[i], back[j]]);
  }
  return document;
}

function collar() {
  const { vertex, face, document } = mesh('antenna-collar');
  const sides = 12, at = (layer, ring, i) => layer + '/' + ring + '/' + (i % sides);
  for (const [layer, z] of [['front', .17], ['rear', -.32]]) {
    for (const [ring, radius] of [['edge', 1.29], ['rim', 1.09], ['bore', .70]]) {
      if (layer === 'rear' && ring === 'rim') continue;
      for (let i = 0; i < sides; i++) {
        const a = (i + .5) * Math.PI * 2 / sides;
        vertex(at(layer, ring, i), [radius * Math.cos(a), radius * Math.sin(a), z]);
      }
    }
  }
  for (let i = 0; i < sides; i++) {
    const j = i + 1, f = (ring, key) => at('front', ring, key), b = (ring, key) => at('rear', ring, key);
    face('flange/' + i, i % 3 === 0 ? 'strap' : 'case', [f('edge', i), f('edge', j), f('rim', j), f('rim', i)]);
    face('rim/' + i, i % 3 === 0 ? 'index' : 'paint', [f('rim', i), f('rim', j), f('bore', j), f('bore', i)]);
    face('out/' + i, 'case', [f('edge', j), f('edge', i), b('edge', i), b('edge', j)]);
    face('in/' + i, 'cavity', [f('bore', i), f('bore', j), b('bore', j), b('bore', i)]);
    face('back/' + i, 'case', [b('edge', j), b('edge', i), b('bore', i), b('bore', j)]);
  }
  return document;
}

function canopy() {
  const { vertex, face, document } = mesh('conduit-hood');
  const count = 9, start = -.93, end = .93;
  for (let i = 0; i <= count; i++) {
    const angle = start + (end - start) * i / count;
    const taper = 1 - .13 * Math.abs(angle);
    const x = 1.63 * Math.sin(angle), y = 1.7 * (Math.cos(angle) - .8);
    vertex('front/' + i, [x, y, .81 * taper]);
    vertex('rear/' + i, [x, y, -.81 * taper]);
  }
  for (let i = 0; i < count; i++) {
    face('roof/' + i, i === 0 || i === count - 1 ? 'index' : 'paint',
      ['rear/' + i, 'front/' + i, 'front/' + (i + 1), 'rear/' + (i + 1)]);
  }
  return document;
}

function request(api, document, id, kind, distance, ids, styles) {
  return { id, revision: api.revision(document), selection: api.select(document, { domain: 'faces', ids }),
    operation: { kind, distance }, ...styles };
}

module.exports = { collar, meter, canopy, request };
