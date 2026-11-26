/* Engraved signal tile with a stepped arch, wave register and hammered brass. */
const width = 208, height = 144;
const clamp = n => Math.min(1, Math.max(0, n));
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const color = n => [n >> 16, n >> 8 & 255, n & 255];
const night = color(0x1c2c3e), ink = color(0x314f60), blue = color(0x51908f);
const ox = color(0x754540), brass = color(0xc48356), gold = color(0xf1c78b), pale = color(0xf9e2ab);
const sky = color(0x987d83);
const stars = [[38, 42], [65, 54], [50, 76], [143, 48], [167, 37], [173, 70], [154, 85]];
const rivets = [[17, 16], [191, 16], [17, 128], [191, 128]];

function sample(x, y) {
  const dx = Math.abs(x - 104), edge = Math.min(x, 208 - x, y, 144 - y);
  const micro = Math.cos(.83 * x + .134 * y) * Math.sin(.65 * y + .372 * x);
  const patina = Math.sin(.122 * y + .015 * x) * Math.cos(.063 * x) * .14;
  const cut = (distance, feather = 1.5) => clamp((distance + feather * .5) / feather);
  const groove = y - 108 + .97 * Math.sin(x * .115);
  const arc = Math.hypot(dx, Math.min(y - 58, 0));
  const shoulder = cut(42.5 - arc) * cut(101.7 - y);
  const inset = cut(31.5 - arc) * cut(102.7 - y);
  const tier = cut(36.3 - arc) * cut(102 - y);
  const halo = Math.hypot(x - 104, y - 64);
  let pigment = mix(night, ink, clamp(.69 + patina + Math.sin(x * .12 + y * .07) * .10));
  let z = -.17 + .03 * micro;
  if (edge < 12.5) {
    const metal = cut(edge - 1) * cut(11.9 - edge);
    const bevel = cut(edge - 2) * cut(10.6 - edge);
    const bead = cut(.94 - Math.abs(edge - 6), .75);
    pigment = mix(ox, mix(brass, gold, bead * .82), metal);
    z += bevel * .53 + bead * .20;
  } else {
    const field = clamp(.53 + patina + (66 - y) * .002);
    pigment = mix(pigment, mix(blue, sky, field), inset * .86);
    z -= inset * .20;
    const facing = clamp(.33 + (84 - y) * .012 + .09 * micro);
    pigment = mix(pigment, mix(brass, gold, facing), shoulder * (1 - tier));
    z += shoulder * (1 - tier) * .79;
    pigment = mix(pigment, ox, (tier - inset) * .94);
    z += (tier - inset) * .23;
    for (const [i, lane] of [0, 5.2, 10.3, 15.6].entries()) {
      const wave = cut(.80 - Math.abs(groove - lane), .95) * Number(dx < 79 - 2 * i);
      pigment = mix(pigment, i % 2 ? blue : brass, wave * .78);
      z += wave * (i % 2 ? -.13 : .13);
    }
    const bars = Math.max(0, 1 - Math.abs(Math.sin((x - 103.7) * .25)) * 4.8);
    const iron = cut(20 - dx) * cut(y - 75) * cut(98 - y) * bars;
    pigment = mix(pigment, ox, iron);
    z += .18 * iron;
    const disc = cut(14.25 - halo);
    const bevel = clamp((14 - halo) / 2.8);
    pigment = mix(pigment, mix(brass, pale, clamp(.38 + (63 - y) * .045)), disc);
    z += (.15 + .70 * bevel) * disc;
    for (const [u, v] of stars) {
      const star = cut(1.9 - Math.abs(x - u) - .80 * Math.abs(y - v));
      pigment = mix(pigment, gold, star);
      z += star * .10;
    }
  }
  for (const [u, v] of rivets) {
    const d = Math.hypot(x - u, y - v), cap = cut(3.5 - d);
    if (!cap) continue;
    const slot = cut(.42 - Math.abs(y - v + (x - u) * .32), .46);
    pigment = mix(pigment, mix(gold, ox, slot * .94), cap);
    z += cap * (.49 - slot * .29);
  }
  // Neighboring tiles expose an intentional mismatch unless the seam treatment closes it.
  z += .27 * clamp((x - 197) / 11) - .11 * clamp((9 - x) / 9);
  return { color: pigment.map(n => Math.round(Math.max(0, Math.min(255, n + micro * 2.3)))), z };
}

function tile() {
  const pigment = new Uint8Array(width * height * 4), heights = new Float32Array(width * height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
    const row = sample(x + .5, y + .5);
    pigment.set([...row.color, 255], p * 4);
    heights[p] = row.z;
  }
  return { width, height, pigment, heights };
}
module.exports = tile;
