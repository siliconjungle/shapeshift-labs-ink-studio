/* Painted enamel charts and a machined signal housing for the linked preview. */
const clamp = n => Math.max(0, Math.min(1, n));
const lerp = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const rgb = hex => [hex >> 16, (hex >> 8) & 255, hex & 255];
const size = 160;
const palettes = {
  harbour: [0x183042, 0x215466, 0x519291, 0xba7545, 0xf6cd8b, 0xfbe4ad].map(rgb),
  bearing: [0x1b3338, 0x32655c, 0x78a288, 0xa65a37, 0xe2aa6b, 0xf4d395].map(rgb)
};
const stars = [[41, 27], [61, 44], [124, 54], [31, 75], [102, 40], [58, 62]];

function enamel(name) {
  const main = name === 'harbour', [shadow, ground, wave, copper, brass, cream] = palettes[name];
  const pigment = new Uint8Array(size * size * 4), relief = new Float32Array(size * size), roughness = new Uint8Array(size * size);
  for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p++) {
    const u = x + .5, v = y + .5, ox = u - 80, oy = v - 80;
    const edge = Math.min(u, v, 160 - u, 160 - v);
    const grain = Math.sin(u * 1.123 + v * 1.15) * Math.cos(v * 1.53 - u * .86);
    const brushed = grain * 1.1 + .7 * Math.sin(v * .33 + u * .52);
    const band = Math.sin(u * .072 + v * .019) * .22 + Math.sin(v * .12 - u * .064) * .14 + (1 - v / 160) * .12;
    let color = lerp(shadow, ground, clamp(.61 + band));
    let h = brushed * .002, r = .34;
    const rail = (threshold, width) => Math.abs(edge - threshold) <= width;
    if (edge < 8) {
      color = rail(4, .65) ? brass : rail(5.4, .42) ? copper : shadow;
      h += rail(4, .65) ? .08 : 0;
    } else if (main) {
      const sun = Math.hypot(u - 110, v - 57);
      if (sun < 24) { color = lerp(copper, brass, clamp((80 - v) / 44)); h += .065; }
      if (v > 93) {
        const slope = (i) => 99 + 10 * i + 4.2 * Math.sin(u * .072 + i * .78);
        for (let i = 0; i < 6; i++) if (Math.abs(v - slope(i)) < .9) { color = lerp(ground, wave, .76); h -= .028; }
      }
      const house = (v >= 61 && v < 112 && Math.abs(u - (66 + .13 * (v - 61))) < 4 + .025 * (v - 61)) ||
        (v >= 52 && v < 61 && Math.abs(u - 66) < 6.6) || (v >= 47 && v < 52 && Math.abs(u - 66) < v - 44);
      if (house) {
        color = (v % 15 < 4 && v > 67) ? copper : cream;
        if (v > 53 && v <= 58 && Math.abs(u - 66) < 3.3) color = brass;
        h += .115; r = .48;
      }
      if (stars.some(([a, b], i) => Math.abs(u - a) + Math.abs(v - b) < (i % 3 ? 1.65 : 2.55))) {
        color = cream; h += .065;
      }
    } else {
      const range = Math.hypot(ox, oy), angle = Math.atan2(oy, ox);
      const contour = Math.abs(range - 49) < .65 || Math.abs(range - 53) < .52 || Math.abs(range - 66) < .52;
      const tick = Math.abs(Math.sin(angle * 24)) * range < .65 && range >= 54 && range <= 65;
      if (contour || tick) { color = lerp(ground, brass, contour ? .95 : .52); h += .026; }
      const tip = Math.max(0, 1 - Math.abs(Math.sin(2 * angle)) * 3.15);
      const point = range < 14 + 42 * tip;
      if (point) {
        color = Math.sin(angle * 4) > 0 ? copper : cream;
        h += .12;
      }
      if (range < 10 && range > 6) { color = brass; h += .11; }
      if (range < 5) { color = shadow; h -= .033; }
      r = range < 52 ? .4 : .30;
    }
    pigment.set([...color.map(n => Math.round(Math.min(255, Math.max(0, n + brushed)))), 255], 4 * p);
    relief[p] = h; roughness[p] = Math.round(255 * clamp(r + grain * .016));
  }
  return { size, pigment, relief, roughness };
}

function bronze() {
  const pigment = new Uint8Array(size * size * 4), relief = new Float32Array(size * size), roughness = new Uint8Array(size * size);
  for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p++) {
    const striation = .42 + .16 * Math.sin(y * .23 + .38 * Math.cos(x * .044)) + .16 * Math.cos(y * 1.9 + x * .02);
    const stain = .5 + .5 * Math.sin(x * .044 - y * .055) * Math.cos(x * .093 + y * .07);
    const color = lerp(lerp([84, 52, 38], [214, 157, 89], striation), [48, 101, 88], Math.max(0, (stain - .66)) * .83);
    pigment.set([...color.map(Math.round), 255], p * 4);
    relief[p] = .007 * Math.sin(y * 1.9 + x * .05);
    roughness[p] = Math.round(255 * (.23 + .26 * stain));
  }
  return { size, pigment, relief, roughness };
}

function housing({ tiled = true } = {}) {
  const vertices = [], faces = [];
  const corner = (x, y, z) => {
    const id = 'point-' + vertices.length;
    vertices.push({ id, position: [x, y, z] });
    return id;
  };
  function polygon(points, material, coordinates) {
    const id = 'panel-' + faces.length;
    faces.push({ id, material, corners: points.map((vertex, i) => ({ id: id + '-' + i, vertex, uv: coordinates[i] })) });
  }
  function slab(x, y, w, h, z, thick, bevel = .07, panel = false) {
    const ring = (hw, hh, radius, depth) =>
      [[-hw + radius, -hh], [hw - radius, -hh], [hw, -hh + radius], [hw, hh - radius],
        [hw - radius, hh], [-hw + radius, hh], [-hw, hh - radius], [-hw, -hh + radius]]
        .map(([a, b]) => corner(x + a, y + b, depth));
    const front = ring(w - bevel, h - bevel, bevel * .66, z);
    const side = ring(w, h, bevel * 1.55, z - bevel * .55);
    const back = ring(w, h, bevel * 1.55, z - thick);
    const st = [[0, 1], [1, 1], [1, 0], [0, 0]];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      polygon([side[i], side[j], front[j], front[i]], 'Bronze', st);
      polygon([back[i], back[j], side[j], side[i]], 'Bronze', st);
    }
    const width = panel && tiled ? 2 : 1;
    const chart = points => points.map(id => {
      const [px, py] = vertices[+id.slice(6)].position;
      return [width * clamp((px - x + w - bevel) / (2 * (w - bevel))), clamp((h - bevel - py + y) / (2 * (h - bevel)))];
    });
    polygon(front, panel ? 'Enamel' : 'Bronze', chart(front));
    // Use the same front reference extent for both sides of the housing, with clamped back UVs.
    polygon(back.slice().reverse(), 'Bronze', chart(back.slice().reverse()).map(uv => uv.map(clamp)));
  }
  slab(0, 0, 1.55, .95, .15, .34, .095);
  slab(0, .02, 1.39, .81, .224, .111, .038, true);
  for (const x of [-1.18, 1.18]) slab(x, -.96, .24, .10, .036, .31, .028);
  return { format: 'ink-studio/mesh-topology', version: 1, id: 'relay-housing', vertices, faces };
}
function obj(document) {
  const vertex = new Map(document.vertices.map((row, i) => [row.id, i + 1]));
  const lines = document.vertices.map(({ position }) => 'v ' + position.join(' '));
  let vt = 0;
  for (const { material, corners } of document.faces) {
    lines.push('usemtl ' + material);
    for (const { uv: [u, v] } of corners) lines.push('vt ' + u + ' ' + (1 - v));
    lines.push('f ' + corners.map(row => vertex.get(row.vertex) + '/' + ++vt).join(' '));
  }
  return lines.join('\n') + '\n';
}

module.exports = { enamel, bronze, housing, obj };
