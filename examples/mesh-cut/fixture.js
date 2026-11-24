/* The same topology feeds the browser authoring view and native render demo. */
const InkMeshCutExample = (() => {
  function housing() {
    const vertices = [], faces = [], count = 12;
    const key = (layer, band, slot) => [layer, band, slot % count].join('/');
    for (const layer of ['front', 'rear']) for (const band of ['outer', 'bore']) for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count;
      const radius = band === 'outer' ? 1.28 : .67;
      vertices.push({ id: key(layer, band, i), position: [radius * Math.cos(angle), radius * Math.sin(angle), layer === 'front' ? .37 : -.37],
        weights: { mount: layer === 'front' ? 1 : 0, shell: layer === 'front' ? 0 : 1 } });
    }
    function face(id, material, ring) {
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      faces.push({ id, material, corners: ring.map((vertex, i) => ({ id: id + '/' + i, vertex, uv: uv[i],
        attributes: { coat: i / 3 } })) });
    }
    for (let i = 0; i < count; i++) {
      const j = i + 1, fo = k => key('front', 'outer', k), fi = k => key('front', 'bore', k);
      const ro = k => key('rear', 'outer', k), ri = k => key('rear', 'bore', k);
      face('front/' + i, i % 3 === 0 ? 'brass' : 'enamel', [fo(i), fo(j), fi(j), fi(i)]);
      face('rear/' + i, 'shell', [ro(j), ro(i), ri(i), ri(j)]);
      face('outer/' + i, 'shell', [fo(j), fo(i), ro(i), ro(j)]);
      face('bore/' + i, 'lining', [fi(i), fi(j), ri(j), ri(i)]);
    }
    return { id: 'hollow-housing', vertices, faces };
  }

  function plaque() {
    const outline = [[-1.30, -.70], [1.3, -.70], [1.3, .72], [.84, .72], [.84, .49], [.36, .49], [.36, .72], [-1.30, .72]];
    const vertices = outline.map(([x, y], i) => ({ id: 'plaque/' + i, position: [x, y, 0] }));
    return { id: 'service-plaque', vertices, faces: [{ id: 'painted-front', material: 'marking',
      corners: vertices.map(({ id, position: [x, y] }, i) => ({ id: 'painted-front/' + i, vertex: id,
        uv: [(x + 1.3) / 2.6, (.72 - y) / 1.42], attributes: { coat: (x + 1.3) / 2.6 } })) }] };
  }

  const colors = { brass: '#be8557', enamel: '#368784', shell: '#34535f', lining: '#213742', cut: '#edb273', marking: '#478e86' };
  const projection = { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0] };
  const path = [[-.67, -.92], [-.38, -.22], [.29, .22], [.63, .94]];
  return { housing, plaque, colors, projection, path };
})();
if (typeof module !== 'undefined') module.exports = InkMeshCutExample;
