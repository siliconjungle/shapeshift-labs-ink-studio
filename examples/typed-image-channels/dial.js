/* Native material planes and a shared graph for the Signal Dial demo. */
const dialWidth = 128, dialHeight = 80;
const dialSample = [71, 40];
const quarterCode = .25 / 65535;
const standardRoutes = [
  { source: 'occlusion', channel: 0 }, { source: 'roughness', channel: 0 },
  { source: 'metalness', channel: 0 }, 1
];

function dialPlates() {
  const make = () => ({ width: dialWidth, height: dialHeight, channels: 1,
    data: new Uint16Array(dialWidth * dialHeight) });
  const maps = { occlusion: make(), roughness: make(), metalness: make() };
  for (let y = 0, i = 0; y < dialHeight; y++) for (let x = 0; x < dialWidth; x++, i++) {
    const dx = x - 64, dy = y - 40, radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    const plate = Math.abs(dx) < 54 && Math.abs(dy) < 34 && Math.abs(dx) + Math.abs(dy) < 81;
    const lip = plate && (Math.abs(dx) >= 51 || Math.abs(dy) >= 31 || Math.abs(dx) + Math.abs(dy) >= 78);
    const tick = radius > 24 && radius < 28 && Math.abs(Math.sin(angle * 12)) < .26;
    const bolt = Math.hypot(Math.abs(dx) - 44, Math.abs(dy) - 24) < 4;
    const needle = radius < 22 && Math.abs(dy + .51 * dx) < 1.45 && dx > -6;
    const center = radius < 4;
    const band = radius > 29 && radius < 34;
    const enamel = radius <= 29 && !tick && !needle && !center;
    const grain = (Math.imul(x + 9, 12583) ^ Math.imul(y + 3, 6727)) & 63;
    let ao = plate ? .40 : .085, roughEnergy = plate ? .52 : .17, metal = 0;
    if (lip || band || bolt) {
      ao = dy < 0 ? .81 : .53;
      roughEnergy = .29;
      metal = .88;
    } else if (enamel) {
      ao = .85 - Math.floor(radius / 6) * .1;
      roughEnergy = dy < 3 ? .46 : .63;
      metal = .12;
    } else if (tick || needle || center) {
      ao = .88;
      roughEnergy = .29;
      metal = .74;
    }
    maps.occlusion.data[i] = Math.round(ao * 65535);
    maps.roughness.data[i] = Math.round(roughEnergy * 65535) + (plate ? grain : 0);
    maps.metalness.data[i] = Math.round(metal * 65535);
  }
  maps.roughness.data[dialSample[1] * dialWidth + dialSample[0]] = 30001;
  return maps;
}

function dialGraph() {
  const op = (op, inputs) => ({ op, inputs });
  const link = (node, port = 'value') => ({ node, port });
  const input = input => ({ input });
  const linear = { intent: 'color', layout: 'rgba', colorSpace: 'srgb-linear' };
  const graph = { format: 'ink-studio/graph-project', version: 1, inputs: {
    occlusion: 'raster', roughness: 'raster', metalness: 'raster', increment: { type: 'number', default: quarterCode },
    routes: { type: 'array', default: standardRoutes }, order: { type: 'array', default: ['r', 'g', 'b', 'a'] }
  }, nodes: {}, outputs: {} };
  for (const name of ['occlusion', 'roughness', 'metalness'])
    graph.nodes[name] = op('image.declare', { source: input(name), descriptor: { intent: 'data', precision: 'unorm16' } });
  Object.assign(graph.nodes, {
    adjust: op('image.channelMath', { a: link('roughness'), b: input('increment'), operation: 'add' }),
    sources: op('data.record', { occlusion: link('occlusion'), roughness: link('adjust'), metalness: link('metalness') }),
    packed: op('image.pack', { sources: link('sources'), routes: input('routes') }),
    shuffled: op('image.shuffle', { source: link('packed'), routes: input('order') }),
    straight: op('image.uniform', { width: 1, height: 1, value: [3.5, -.125, .5, .5], descriptor: linear }),
    associated: op('image.convert', { source: link('straight'), descriptor: { ...linear, alpha: 'premultiplied' } }),
    split: op('image.split', { source: link('associated'), channels: { red: 'r', alpha: 'alpha' } })
  });
  graph.outputs = { packed: link('packed'), shuffled: link('shuffled'), adjusted: link('adjust'),
    straight: link('straight'), associated: link('associated'), red: link('split', 'red'), alpha: link('split', 'alpha') };
  return graph;
}

if (typeof module !== 'undefined') module.exports = { dialPlates, dialGraph, dialSample, quarterCode };
