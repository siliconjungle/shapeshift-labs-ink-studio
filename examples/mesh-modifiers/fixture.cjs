'use strict';

function quad(id, coordinates, material = 'paint') {
  const vertices = coordinates.map((position, i) => ({ id: 'v' + i, position, weights: { root: 1 } }));
  const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
  return { id, vertices, faces: [{ id: 'panel', material, corners: vertices.map(({ id: vertex }, i) => ({
    id: 'c' + i, vertex, uv: uv[i], attributes: { coat: .7 }
  })) }] };
}

function fixture(api) {
  const cage = api.create(quad('worklight', [[-1.2, -.56, .05], [0, -.56, .05], [0, .56, .05], [-1.2, .56, .05]]));
  const target = api.create(quad('mount-guide', [[-2,-2,.14], [2,-2,.14], [2,2,.58], [-2,2,.58]], 'guide'));
  const stack = [
    { id: 'seat', kind: 'projection', target: 'mount', direction: [0,0,1], distance: 1, offset: .024, miss: 'error' },
    { id: 'symmetry', kind: 'mirror', normal: [1,0,0], flipU: true },
    { id: 'housing', kind: 'shell', thickness: .14, rim: { material: 'rim' }, interior: { material: 'liner' } }
  ];
  const context = { target: id => id === 'mount' ? target : undefined };
  const mirror = api.evaluateModifiers(cage, stack, { ...context, through: 'symmetry' }).document;
  const pos = new Map(mirror.vertices.map(row => [row.id, row.position[0]]));
  const edges = mirror.edges.filter(edge => edge.vertices.every(id => Math.abs(pos.get(id)) > 1.19)).map(row => row.id);
  stack.push(
    { id: 'trim', kind: 'bevel', edges, width: .045, segments: 2, material: 'trim' },
    { id: 'round', kind: 'subdivision', levels: 1 },
    { id: 'bank', kind: 'array', count: 2, step: [0,-1.52,-.10] }
  );
  return { cage, target, stack, context };
}

function materials() {
  const width = 36, height = 20, pixels = [];
  const rune = ['11101010111', '10001010100', '11001010110', '10001010100', '10000100111'];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const mark = rune[y - 7]?.[x - 10] === '1';
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    const light = y >= 14 && y <= 16 && x >= 9 && x < 27 && x % 5 !== 0;
    const color = mark || light && x > 19 ? [235, 193, 112] : light ? [104, 210, 166] : edge === 1 ?
      [82, 139, 127] : edge < 4 ? [44, 89, 86] : [25, 52, 60];
    pixels.push(...color, 255);
  }
  return [{ id: 'paint', color: 0xffffff, texture: { width, height, pixels } },
    { id: 'rim', color: 0x325963 }, { id: 'trim', color: 0xcc955d }, { id: 'liner', color: 0x2b414d },
    { id: 'guide', color: 0x4c676f }];
}

module.exports = { quad, fixture, materials };
