const ref = (node, port = 'value') => ({ node, port });
const input = input => ({ input });
const node = (op, inputs, type) => ({ op, inputs, ...(type && { type }) });
const controls = {
  yaw: { label: 'Orbit', min: -180, max: 180, step: 1, default: -37, unit: '°' },
  pitch: { label: 'Tilt', min: 3, max: 89, step: 1, default: 51, unit: '°' },
  cut: { label: 'Crescent cut', min: .34, max: .51, step: .005, default: .43 },
  rivets: { label: 'Fasteners per side', min: 1, max: 5, step: 1, default: 3 }
};
const ports = keys => Object.fromEntries(keys.map(key => [key, { type: 'number', default: controls[key].default }]));
const swatches = {
  iron: '#555478', rim: '#c08457', enamel: '#285c67', inlay: '#62c9b4',
  gold: '#edbd65', cut: '#b1614c', gem: '#f18178', silver: '#c6c5dd'
};
const rgb = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);

function lock() {
  const nodes = {};
  function add(name, op, inputs, type) {
    nodes[name] = node(op, inputs, type);
    return ref(name);
  }
  const shape = (name, kind, dimensions) => add(name, 'sdf.primitive', { kind, ...dimensions });
  const paint = (name, source, materialId, objectId = name) => add(name, 'sdf.attributes', {
    source, materialId, objectId, color: rgb(swatches[materialId])
  });
  const combine = (name, a, b, operation = 'union') => add(name, 'sdf.boolean', { a, b, operation });
  const disc = (name, radius, length, y, x = 0, z = 0) => shape(name, 'cylinder', { radius, length, center: [x, y, z] });
  const ring = (name, major, minor, y) => shape(name, 'torus', { major, minor, center: [0, y, 0] });

  const back = paint('ironBack', disc('backPlate', .91, .155, -.30), 'iron');
  const wall = paint('ironWall', disc('sideWall', 1.015, .24, -.148), 'iron');
  const rim = paint('castRim', ring('rimBead', .955, .093, -.035), 'rim');
  const enamel = paint('firedEnamel', disc('dialFace', .886, .118, -.015), 'enamel');
  const fineRing = paint('turquoiseInlay', ring('inlayBead', .739, .018, .047), 'inlay');
  const gold = paint('waxingMoon', disc('moonBlank', .505, .137, .102, -.114, .018), 'gold');
  const cutter = paint('copperEdge', disc('moonDie', input('cut'), .42, .15, .092, -.123), 'cut');
  const moon = combine('crescent', gold, cutter, 'subtract');

  const lozenge = (name, half, z) => shape(name, 'box', { half, round: .012,
    center: [.263, .102, z], rotation: [0, Math.PI / 4, 0] });
  const jewel = paint('roseJewel', lozenge('jewelCore', [.095, .098, .095], -.092), 'gem');
  const jewelMount = paint('jewelMount', lozenge('jewelSeat', [.134, .047, .134], -.092), 'gold');
  const rivet = paint('steelFastener', shape('rivetCap', 'sphere', { radius: .063, center: [0, 0, .827] }), 'silver');
  const lowCap = add('lowDome', 'sdf.transform', { source: rivet, position: [0, .062, 0], scale: [1, .58, 1] });
  const count = add('fastenerCount', 'fn.vector', { x: input('rivets'), y: 1, z: 1 }, 'vec3');
  const row = add('fastenerRow', 'sdf.repeat', { source: lowCap, count, spacing: [.149, 1, 1], idPrefix: 'fastener' });
  const rows = add('oppositeRow', 'sdf.symmetry', { source: row, axis: 'z' });
  const body = [wall, rim, enamel, fineRing, moon, jewelMount, jewel, rows]
    .reduce((a, b, i) => combine('assembly' + i, a, b), back);
  const field = add('bakeDomain', 'sdf.bound', { source: body, min: [-1.10, -.39, -1.10], max: [1.10, .235, 1.10] });
  return { result: 'field', inputs: ports(['cut', 'rivets']), nodes, outputs: { result: field } };
}

function graph() {
  const width = 144, height = 108, scatterWidth = 112, scatterHeight = 96, count = 23;
  const field = ref('lock', 'result');
  const nodes = {
    lock: node('Moonlock', { cut: input('cut'), rivets: input('rivets') }),
    yawRadians: node('fn.math', { operation: 'multiply', a: input('yaw'), b: Math.PI / 180 }, 'number'),
    pitchRadians: node('fn.math', { operation: 'multiply', a: input('pitch'), b: Math.PI / 180 }, 'number'),
    camera: node('data.record', { target: [0, -.06, 0], dist: 3.12, fov: .64, projection: 'orthographic',
      yaw: ref('yawRadians'), pitch: ref('pitchRadians') }),
    render: node('sdf.render', { source: field, camera: ref('camera'),
      lights: [{ kind: 'sun', id: 'key', settings: { direction: [-.58, 1, .34], ambient: .30, intensity: .94 } }],
      options: { width, height, steps: 82, shades: 12, transparent: true } }),
    bounds: node('sdf.bounds', { source: field }),
    parts: node('data.record', { lock: field }),
    library: node('data.collect', { source: ref('parts'), keys: ['lock'] }),
    scatter: node('image.shapeSplatter', { width: scatterWidth, height: scatterHeight, columns: 3, rows: 3,
      volumes: ref('library'), options: { scale: [.277,.277,.277], jitter: .21, rotationJitter: [0, 48, 0], seed: 39,
        steps: 42, epsilon: .00025 } }),
    tile: node('image.toDisplay', { source: ref('scatter', 'pigment') }),
    stack: node('sdf.slices', { source: field, options: { width: 72, height: 72, count, axis: 'y' } })
  };
  return {
    format: 'ink-studio/graph-project', version: 1, inputs: ports(Object.keys(controls)), groups: { Moonlock: lock() }, nodes,
    outputs: {
      orbit: ref('render'), frame: ref('render', 'frame'), bounds: ref('bounds'), tile: ref('tile'), relief: ref('scatter'),
      scatterMaterials: ref('scatter', 'materialId'), scatterLayout: ref('scatter', 'layout'),
      slices: ref('stack'), sliceMaterials: ref('stack', 'materialId'), sliceLayout: ref('stack', 'layout')
    },
    exports: { orbit: { output: 'orbit', format: 'png' }, tile: { output: 'tile', format: 'png' } }
  };
}
module.exports = { graph, controls, swatches };
