'use strict';

function assembly(id) {
  const doc = { id, vertices: [], faces: [] };
  function vertex(id, position, root = 1) {
    doc.vertices.push({ id, position, weights: { root, tip: 1 - root } });
    return id;
  }
  function face(id, material, ring, uvs) {
    const uv = uvs ?? [[0, 1], [1, 1], [1, 0], [0, 0]];
    doc.faces.push({ id, material, corners: ring.map((vertex, i) => ({
      id: id + '/c' + i, vertex, uv: uv[i] ?? [.5, .5], attributes: { heat: uv[i]?.[0] ?? .5, tint: [i / ring.length, .3, .7] }
    })) });
  }
  return { doc, vertex, face };
}

function coupler(withGap = true) {
  const { doc, vertex, face } = assembly(withGap ? 'relay-coupler-gap' : 'relay-coupler-body');
  const ring = [[-.76, -.58], [.76, -.58], [1.03, -.32], [1.03, .32], [.76, .58], [-.76, .58], [-1.03, .32], [-1.03, -.32]];
  const profiles = [['back', -1.23, .90, 1], ['heel', -.68, 1.04, 1], ['nose', .45, .73, 0], ['front', .98, .86, 0]];
  for (const [id, z, radius, root] of profiles) {
    ring.forEach(([x, y], i) => vertex(id + '/' + i, [x * radius, y * radius, z], root));
  }
  for (const [a, b, material] of [['back', 'heel', 'oxide'], ['heel', 'nose', 'joint'], ['nose', 'front', 'enamel']]) {
    if (withGap && a === 'heel') continue;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const swatch = i === 0 || i === 4 ? material : material + '-edge';
      const uv = i % 2 === 0 ? [[0, .90], [1, .90], [1, .08], [0, .08]] : [[.38, .75], [.82, .75], [.82, .1], [.38, .1]];
      face(a + '-' + b + '/' + i, swatch, [a + '/' + i, a + '/' + j, b + '/' + j, b + '/' + i], uv);
    }
  }
  const end = ring.map(([x, y]) => [(x + 1.03) / 2.06, (.58 - y) / 1.16]);
  face('back-plate', 'oxide', ring.map((_, i) => 'back/' + i).reverse(), end.slice().reverse());
  face('front-plate', 'badge', ring.map((_, i) => 'front/' + i), end);
  return doc;
}

function panel() {
  const { doc, vertex, face } = assembly('inspection-port');
  const width = 4, height = 2;
  const loop = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2],
    [3, 2], [2, 2], [1, 2], [0, 2], [0, 1]];
  for (const [layer, sx, sy, depth] of [['inner', .92, .53, .22], ['edge', 1.30, .86, .22], ['rear', 1.30, .86, -.16]]) {
    loop.forEach(([x, y], i) => vertex(layer + '/' + i, [sx * (2 * x / width - 1), sy * (2 * y / height - 1), depth], x / width));
  }
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    face('frame/' + i, i % 3 === 0 ? 'oxide' : 'enamel', ['edge/' + i, 'edge/' + j, 'inner/' + j, 'inner/' + i]);
    face('wall/' + i, 'enamel-edge', ['edge/' + j, 'edge/' + i, 'rear/' + i, 'rear/' + j]);
  }
  return doc;
}

function edgeSelection(api, doc, condition) {
  return api.select(doc, { domain: 'edges', ids: doc.edges.filter(edge => condition(edge.vertices, edge)).map(edge => edge.id) });
}

function rim(api, doc, prefix) {
  return edgeSelection(api, doc, ends => ends.every(id => id.startsWith(prefix + '/')));
}

function request(api, doc, id, operation, pins) {
  return { id, revision: api.revision(doc), operation, ...(pins && { pins }) };
}

module.exports = { coupler, panel, edgeSelection, rim, request };
