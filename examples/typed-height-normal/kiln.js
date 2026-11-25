/* A hand-laid ceramic plaque with a relief moth and alternating slip glazes. */
const kilnWidth = 152, kilnHeight = 106, kilnLight = 226;
const kilnFrame = { normal: [0, .32, Math.sqrt(1 - .32 ** 2)], tangent: [1, 0, 0] };
const kilnDefaults = {
  blend: { softness: .7, bias: -.05 }, combine: { method: 'rnm', amount: .68 },
  rotation: { degrees: 0 }, normal: { strength: .84, method: 'scharr' },
  detail: { strength: .57, method: 'scharr' }
};
const kilnClamp = x => Math.max(0, Math.min(1, x));
const kilnSmooth = t => { t = kilnClamp(t); return t * t * (3 - 2 * t); };

function kilnSources() {
  const width = kilnWidth, height = kilnHeight, count = width * height;
  const stone = new Uint8Array(count * 3), brass = new Uint8Array(count * 3);
  const bed = new Float64Array(count), raised = new Float64Array(count);
  const grain = new Float64Array(count), footprint = new Float64Array(count);
  const color = {
    void: [24, 22, 29], clay: [115, 63, 54], bronze: [152, 96, 57], copper: [181, 110, 69],
    ochre: [203, 141, 77], rim: [221, 165, 100], chip: [202, 134, 79],
    dark: [41, 55, 67], wet: [47, 74, 83], glaze: [55, 89, 95], pale: [103, 147, 137],
    line: [78, 119, 119], grid: [42, 66, 77], smoke: [85, 75, 72],
    red: [178, 84, 62], orange: [212, 134, 73], gold: [230, 168, 88], flower: [225, 193, 123]
  };
  function wing(x, y, cx, cy, rx, ry, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), dx = x - cx, dy = y - cy;
    const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
    return { distance: 1 - Math.hypot(u, v), u, v };
  }
  const moon = x => Math.hypot(x[0], x[1]);
  for (let py = 0, p = 0; py < height; py++) for (let px = 0; px < width; px++, p++) {
    const x = px + .5 - width / 2, y = py + .5 - height / 2;
    const ax = Math.abs(x), ay = Math.abs(y);
    const salt = (Math.imul(px + 5, 1257) ^ Math.imul(py + 17, 13597)) >>> 0;
    const scuff = (salt % 49) < 3, ash = (salt % 127) === 4;
    const frame = Math.max(ax - 69, ay - 46, (ax + ay - 107) * .7);
    const edge = -frame, radius = Math.hypot(x, y + 1), octagon = Math.max(ax, ay, (ax + ay) * .71);
    const rim = kilnSmooth((edge + 2) / 3);
    const wall = Math.max(0, Math.min(1, (edge - 3) / 5));
    let level = rim * (2.6 + 1.15 * Math.sin(Math.PI * wall));
    let pigment = edge < 0 ? 'void' : edge < 2 ? 'clay' : edge < 5 ? (scuff ? 'rim' : 'bronze') : 'glaze';
    if (edge >= 5) {
      pigment = radius > 35 ? 'wet' : 'glaze';
      if ((px + 2 * py) % 13 === 0 || scuff) pigment = radius > 35 ? 'grid' : 'wet';
      if (ash) pigment = 'smoke';
      if (edge > 7 && edge < 8.6) { pigment = 'dark'; level -= .35; }
      if (edge < 10 && ((ax + ay) % 13) > 9) pigment = 'line';
      if (octagon > 32 && octagon < 35) { pigment = scuff ? 'rim' : 'bronze'; level += .55; }
      if (octagon > 35 && octagon < 36) pigment = 'dark';
      if (radius > 39 && radius < 40 && ax < 42) { pigment = 'line'; level -= .14; }
      const corner = moon([ax - 57, ay - 34]);
      if (corner < 4.5) { level += 1.1 * kilnSmooth(1 - corner / 5); pigment = corner < 2.6 ? 'ochre' : 'bronze'; }
      if (corner > 5.5 && corner < 6.5) pigment = 'line';
      const moonX = (x + 8) % 16 - (x < -8 ? -8 : 8);
      if (ay > 38.7 && ay < 40.2 && Math.abs(moonX) < 3.8) pigment = 'line';
    }

    const top = wing(ax, y, 15.4, -7.8, 19.3, 8.5, -.42);
    const lower = wing(ax, y, 10.8, 9.7, 12.4, 6.45, .40);
    const wingShape = Math.max(top.distance, lower.distance);
    const body = 1 - Math.hypot(x / 3.4, (y + 1.5) / 15);
    const tip = 1 - Math.hypot(x / 4, (y + 15.5) / 3.5);
    const firstAntenna = ax > 1.5 && ax < 8 && Math.abs(y + 18.5 + .58 * ax - .04 * ax * ax) < 1.2;
    const star = Math.min(1 - (ax * 1.5 + Math.abs(y + 26)) / 4.4,
      1 - (ax + Math.abs(y + 26) * 1.6) / 4.6);
    const inlay = Math.max(wingShape, body, tip, star, firstAntenna ? .2 : -1);
    const land = Math.max(top.distance, lower.distance, body);
    const feather = kilnSmooth((inlay + .075) * 10);
    const curved = kilnSmooth(Math.max(0, land) * 1.5);
    const scallop = Math.sin((top.u + .4 * top.v) * 18) * .28;
    let metal = 'ochre';
    if (top.distance >= lower.distance && top.distance >= body) {
      metal = top.v < -.35 ? 'orange' : top.u > .26 && top.v > -.04 ? 'red' : 'gold';
      if (top.distance < .12) metal = 'copper';
      if (top.distance > .18 && Math.abs(top.u + .54 * top.v + .15) < .08) metal = 'rim';
      if (top.distance > .25 && Math.hypot((top.u - .43) * 1.4, top.v + .08) < .22) metal = 'flower';
    } else if (lower.distance >= body) {
      metal = lower.distance < .15 ? 'copper' : lower.v > -.08 ? 'orange' : 'ochre';
      if (lower.distance > .23 && Math.abs(lower.u - lower.v * .44) < .14) metal = 'rim';
    } else if (body > .1) metal = (py % 4) < 2 ? 'gold' : 'bronze';
    if (star > 0 || tip > body) metal = 'flower';
    if (scuff && feather > .7) metal = metal === 'gold' ? 'rim' : 'ochre';
    const detail = Math.sin(x * .79 + y * 1.07 + Math.sin(y * .29) * .62) * .33;
    const scratch = Math.max(0, Math.cos(x * 1.47 - y * .72)) ** 16;
    stone.set(color[pigment], p * 3);
    brass.set(color[metal], p * 3);
    bed[p] = level;
    raised[p] = level - .63 + 4.1 * curved + feather * (.8 + scallop);
    footprint[p] = feather;
    grain[p] = edge > 2 ? detail * (.35 + feather * .65) - scratch * .11 + (scuff ? -.16 : 0) : 0;
  }
  const grid = (data, channels = 1) => ({ width, height, channels, data });
  return { stone: grid(stone, 3), brass: grid(brass, 3), bed: grid(bed), raised: grid(raised),
    grain: grid(grain), footprint: grid(footprint) };
}

function kilnGraph({ etched = false, lightMaps = false } = {}) {
  const link = (node, port = 'value') => ({ node, port });
  const input = input => ({ input });
  const op = (op, inputs) => ({ op, inputs });
  const maps = { stone: { intent: 'color', precision: 'unorm8' }, brass: { intent: 'color', precision: 'unorm8' },
    bed: { intent: 'height', units: 'art-px' }, raised: { intent: 'height', units: 'art-px' },
    grain: { intent: 'height', units: 'art-px' }, footprint: { intent: 'mask' } };
  const graph = { format: 'ink-studio/graph-project', version: 1, inputs: {}, nodes: {}, outputs: {},
    outputUsages: {}, exports: {} };
  for (const [name, descriptor] of Object.entries(maps)) {
    graph.inputs[name] = 'raster';
    graph.nodes[name] = op('image.declare', { source: input(name), descriptor });
  }
  for (const [name, value] of Object.entries(kilnDefaults)) graph.inputs[name] = { type: 'record', default: value };
  const nodes = {
    fused: op('image.heightBlend', { base: link('bed'), layer: link('raised'), mask: link('footprint'), options: input('blend') }),
    clay: op('image.blend', { background: link('stone'), foreground: link('brass'), mask: link('fused','weight') }),
    relief: op('image.heightToNormal', { source: link('fused'), options: input('normal') }),
    grainNormal: op('image.heightToNormal', { source: link('grain'), options: input('detail') }),
    spun: op('image.normalRotate', { source: link('grainNormal'), options: input('rotation') }),
    ...(etched && { engraved: op('image.normalInvert', { source: link('spun'), options: { axes: 'xy' } }) }),
    stacked: op('image.normalCombine', { base: link('relief'), detail: link(etched ? 'engraved' : 'spun'), options: input('combine') }),
    clean: op('image.normalNormalize', { source: link('stacked') }),
    gl: op('image.normalOrientation', { source: link('clean'), options: { orientation: 'opengl', precision: 'unorm16' } }),
    direct: op('image.normalOrientation', { source: link('clean'), options: { orientation: 'directx', precision: 'unorm16' } }),
    world: op('image.normalSpace', { source: link('clean'), options: { to: 'world', frame: kilnFrame } }),
    tangent: op('image.normalSpace', { source: link('world'), options: { to: 'tangent', frame: kilnFrame } }),
    original: op('image.toDisplay', { source: link('clay') })
  };
  Object.assign(graph.nodes, nodes);
  graph.outputs = { clay: link('original'), relief: link('fused'), weight: link('fused','weight'),
    gl: link('gl'), direct: link('direct'), world: link('world'), tangent: link('tangent') };
  if (lightMaps) {
    const descriptions = [['gl','OpenGL tangent normals'],['direct','DirectX tangent normals']];
    descriptions.forEach(([output, label], order) => {
      graph.outputUsages[output] = { usage: 'normal', label, order, source: { output }, format: { format: 'png', bitDepth: 16 } };
    });
    graph.outputUsages.relief = { usage: 'height', label: 'Fused ceramic height', order: 2, source: { output: 'relief' },
      format: { format: 'json' } };
    graph.exports.weight = { output: 'weight', format: 'json' };
  }
  return graph;
}

function kilnPreview({ clay, relief, tangent }, degrees) {
  const { width, height, data: paint } = clay;
  const normals = tangent.raster.data, heightMap = relief.raster.data;
  const a = degrees * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
  const z = .61, mag = Math.hypot(1, z), light = [dx / mag, -dy / mag, z / mag];
  const half = [light[0], light[1], light[2] + 1], halfLength = Math.hypot(...half);
  const { prepare } = typeof ColorSpace === 'undefined' ? require('../..').load().ColorSpace : ColorSpace;
  const encode = prepare('srgb-linear', 'srgb'), decode = prepare('srgb', 'srgb-linear');
  const data = new Uint8Array(width * height * 4), rgb = [0, 0, 0], lit = [0, 0, 0];
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
    const nx = normals[3 * p], ny = normals[3 * p + 1], nz = normals[3 * p + 2];
    let shadow = 0;
    for (let s = 1; s <= 10; s++) {
      const u = Math.round(x + dx * s), v = Math.round(y + dy * s);
      if (u < 0 || u >= width || v < 0 || v >= height) break;
      shadow = Math.max(shadow, kilnClamp((heightMap[v * width + u] - heightMap[p] - s * z - .15) * 1.75));
    }
    const diffuse = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    const bands = Math.round(diffuse * 11) / 11;
    const specular = Math.max(0, (nx * half[0] + ny * half[1] + nz * half[2]) / halfLength) ** 27;
    const direct = .84 * (1 - .88 * shadow) * bands;
    const amber = Math.max(0, (paint[p * 3] - paint[p * 3 + 1]) / 120);
    const sheen = (1 - shadow) * (amber * .15 + .035) * Math.round(specular * 12) / 12;
    for (let c = 0; c < 3; c++) rgb[c] = paint[p * 3 + c] / 255;
    decode(rgb, lit);
    lit[0] = kilnClamp(lit[0] * (.35 + direct * 1.38) + sheen);
    lit[1] = kilnClamp(lit[1] * (.47 + direct * 1.07) + sheen * .61);
    lit[2] = kilnClamp(lit[2] * (.62 + direct * .83) + sheen * .31);
    encode(lit, rgb);
    for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(rgb[c] * 255);
    data[p * 4 + 3] = 255;
  }
  return { width, height, channels: 4, data };
}

if (typeof module !== 'undefined') module.exports = { kilnSources, kilnGraph, kilnPreview, kilnLight, kilnDefaults };
