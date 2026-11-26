'use strict';

const Plan = require('../../cli/splat-attribute-plan.js');
const Exchange = require('../../cli/splat-exchange.js');
const sh0 = .28209479177387814;
const rgb = hex => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];

function fixture(kit) {
  const { M, procedural: { attributes: A } } = kit, rows = [];
  function add(id, object, material, point, scale, color, rotation = M.id(), directional = false) {
    rows.push({ id, object, material, point, scale, color, rotation, directional });
  }
  for (let z = -9; z <= 9; z++) for (let x = -14; x <= 14; x++) {
    const color = (Math.abs(z) === 9 || Math.abs(x) === 14) ? 0x759ba0 : 0x536971;
    const ground = M.rot([1, 0, 0], -Math.PI / 2);
    add('ground-' + (x + 14) + '-' + (z + 9), 'base', 'ceramic', [x * .14, -.72, z * .14],
      [.098, .098, .015], color, ground);
  }
  for (let i = 0; i < 15; i++) {
    add('post-' + i, 'vane', 'frame', [0, -.59 + i * .15, 0], [.073, .104, .065], 0xead7ad,
      M.rot([0,1,0], .15));
  }
  for (const side of [-1, 1]) for (let a = 0; a < 17; a++) {
    const y = -.36 + a * .111, t = a / 16, span = .19 + .85 * Math.sin(Math.PI * t) ** .85;
    for (let j = 1; j <= Math.ceil(span / .101); j++) {
      const x = side * j * .099, z = .12 * Math.cos(j * .23) + side * .12 * Math.sin(t * Math.PI);
      const color = j * .099 > span - .09 ? (side < 0 ? 0xf6cb82 : 0xaee9ce) :
        (side < 0 ? (a === 7 || a === 8 ? 0xf2ac63 : 0xd9714e) : (a === 7 || a === 8 ? 0x86cbb7 : 0x35a5a1));
      add((side < 0 ? 'west-' : 'east-') + a + '-' + j, 'vane', side < 0 ? 'bronze' : 'enamel',
        [x, y + Math.abs(x) * .16, z], [.077, .083, .024], color, M.rot([0,1,0], side * .18), true);
    }
  }
  const debris = [[-1.39,.76,.19], [1.45,.22,.29], [-1.15,-.30,1.03], [1.53,-.11,.88]];
  debris.forEach((point, i) => add('stray-' + i, 'vane', 'stray', point, [.072,.056,.036], 0xf3ad74));
  add('finial', 'vane', 'marker', [0,1.70,0], [.123,.119,.104], 0xf6c477);
  const count = rows.length, data = new Float32Array(count * 16), dc = new Float32Array(count * 3);
  const sh = new Float32Array(count * 72), normals = new Float32Array(count * 3), albedo = new Uint32Array(count);
  const objectIds = new Uint32Array(count), materialIds = new Uint32Array(count);
  const objects = [null, 'base', 'vane'], materials = [null, 'ceramic', 'frame', 'bronze', 'enamel', 'stray', 'marker'];
  const pos = [];
  for (const [i, row] of rows.entries()) {
    const q = i * 16, C = M.mul(M.mul(row.rotation, [row.scale[0]**2,0,0,0,row.scale[1]**2,0,0,0,row.scale[2]**2]), M.tr(row.rotation));
    data.set(row.point, q);
    data[q + 3] = 1;
    [4,5,6,8,9,10].forEach((k, j) => { data[q + k] = C[[0,1,2,4,5,8][j]]; });
    data[q + 7] = rgb(row.color).reduce((value, v, k) => value | v << (8*k), 0);
    dc.set(rgb(row.color).map(n => (n / 255 - .5) / sh0), i * 3);
    normals.set(M.app(row.rotation, [0,0,1]), i * 3);
    if (row.directional) sh.set([.12,.04,-.08, -.08,.065,.11, .02,-.10,.12], i * 72);
    if (row.directional) sh.set([.032,-.024,.048], i * 72 + 45);
    if (row.object === 'base') albedo[i] = row.color + 1;
    objectIds[i] = objects.indexOf(row.object);
    materialIds[i] = materials.indexOf(row.material);
    pos.push(Array.from(data.subarray(q, q+3)));
  }
  const world = { count, data, gaussianCloud: true, seed: 63, detail: 14, radius: 4, bg: [20,32,42],
    pal: [0x14202a, 0x526970, 0xa4c7bc, 0xf8d3a2], palName: 'Tide Vane',
    fog: { c: 0, start: 1, max: 0 }, outline: { c: 0, edge: 0 }, dither: 0,
    cam: { target: [0,.32,0], yaw: .52, pitch: .43, dist: 8.8, ortho: true },
    gaussianHarmonics: { count, dc, sh, degree: 4, up: 'y', colorMode: 'rgb' },
    splatIds: rows.map(row => row.id), materialAlbedo: albedo,
    renderMetadata: { objectIds, objects, materialIds, materials, normals } };
  const custom = A.asset('splat', rows.map((row, i) => ({ id: row.id, point: pos[i],
    attributes: { zone: row.material, protected: row.id === 'finial' || row.id === 'post-0' } })), { zone: { type: 'label' }, protected: { type: 'label' } });
  const source = Exchange.serialize(world, Plan.attributes(Plan.catalog(world, kit), kit, custom));
  const knots = [];
  for (const x of [-.66, 0, .66]) for (const [y, weight] of [[-.51,0],[.02,.17],[.57,.51],[1.09,.88],[1.60,1]]) knots.push({
    id: 'handle-' + knots.length, point: [x,y,.06], attributes: { curl: weight }
  });
  const donor = A.asset('point', knots, { curl: { type: 'number' } });
  const definition = { format: 'ink-studio/splat-attribute-plan', version: 1, target: { object: 'vane' },
    selections: [
      { id: 'pinned', where: [{ channel: 'protected', equals: true }] },
      { id: 'sail', where: [{ channel: 'variance', max: .027 }, { channel: 'zone', exists: true }], exclude: ['finial', 'post-0'] }
    ],
    outliers: [{ radius: .195, minNeighbors: 2, protect: 'pinned' }],
    transfers: [{ id: 'curl', selection: 'sail', source: 'cage-weights.json', channel: 'curl', radius: .84, neighbors: 4 }],
    groups: [{ id: 'wind', selection: 'sail', weight: 'curl', pivot: [0,-.60,0], modifiers: [
      { type: 'bend', axis: [0,1,0], side: [.79,0,-.61], length: 2.5, angle: 61 },
      { type: 'taper', axis: [0,1,0], length: 2.5, amount: -.10 }
    ] }],
    rowEdits: [{ id: 'finial', orientation: [0, Math.sin(.21), 0, Math.cos(.21)] }] };
  const liveSun = { direction: [-.72, .82, .53], ambient: .36, intensity: .88, shadows: true, mapSize: 256, bias: .016, filter: 1 };
  const views = [{ id: 'front', w: 218, h: 184, camera: world.cam, liveSun },
    { id: 'reverse', w: 218, h: 184, camera: { ...world.cam, yaw: -.76, pitch: .56 }, liveSun }];
  return { source, donor, definition, views };
}
module.exports = { fixture };
