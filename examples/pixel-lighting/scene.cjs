'use strict';

function lanternCrossing() {
  const width = 128, height = 80, tileSize = 8;
  const ramps = [
    ['#15172e', '#252649', '#39365d', '#565078', '#85749c'],
    ['#10283c', '#154155', '#236272', '#328d8b', '#81cbb2'],
    ['#232139', '#36304c', '#554363', '#796082', '#ae97a9'],
    ['#3a243f', '#6e3b4b', '#ac5a52', '#df8d5b', '#ffd591'],
    ['#271e3d', '#492e5e', '#754782', '#af72a7', '#f3aecb'],
    ['#163449', '#275b71', '#43878a', '#75b8a3', '#d6f1c9'],
    ['#59484e', '#8a6859', '#b68b60', '#edbc72', '#fff2bd'],
    ['#101526', '#1a243b', '#28364d', '#3c4f63', '#685f76']
  ];
  function paint(w, h, sample, map = 'heightMap') {
    const slots = [], values = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [slot, value] = sample(x, y) ?? [null, 0];
      slots.push(slot);
      if (map === 'normalMap') values.push(...(value || [128, 128, 255]));
      else values.push(value);
    }
    return { width:w, height:h, slots, [map]:values };
  }
  const tile = sample => paint(tileSize, tileSize, sample);
  const assets = {
    channel: tile((x, y) => [
      (y === 1 && x < 3) || (y === 5 && x >= 4 && x < 7) ? 1 : (y === 2 || y === 6 ? 0 : 7), 0
    ]),
    stone: tile((x, y) => {
      if (x === 7 || y === 7) return [7, 0];
      if (x === 0 || y === 0) return [2, .28];
      if ((x === 4 && y === 3) || (x === 5 && y === 5)) return [2, .56];
      return [0, .64];
    }),
    deck: tile((x, y) => {
      if (x === 7 || y === 7) return [7, .1];
      if ((x === 1 || x === 5) && (y === 1 || y === 5)) return [5, .68];
      if (x === 0 || y === 0) return [1, .48];
      return [1, .9];
    }),
    edge: tile((x, y) => {
      if (y === 1 || y === 5) return [2, .5];
      if (y === 3 && x > 0 && x < 7) return [x % 3 ? 3 : 6, 1];
      return [7, .1];
    }),
    pylon: paint(15, 25, (x, y) => {
      const d = Math.abs(x - 7);
      if (y < 2) return d <= 3 ? [6, 14] : null;
      if (y < 5) return d <= 5 ? [d === 5 ? 7 : 3, 13] : null;
      if (y < 10) return d <= 6 ? [d === 6 ? 7 : d <= 2 && y < 9 ? 6 : 3, 11] : null;
      if (y < 21) {
        if (d <= 1 && y < 18 && y > 11) return null;
        return d <= 4 ? [d === 4 || y === 20 ? 7 : d === 3 ? 2 : 4, 9 - (y - 10) * .35] : null;
      }
      return d <= (y === 24 ? 7 : 6) ? [y === 24 || d > 5 ? 7 : 2, 2] : null;
    }),
    relay: paint(19, 19, (x, y) => {
      const dx = x - 9, dy = y - 9, d = Math.hypot(dx, dy);
      if (d > 9.1 || Math.abs(dx) === 9 && Math.abs(dy) > 1) return null;
      const slot = d >= 8.1 ? 7 : d >= 6.6 ? 5 : d >= 4.2 ? 1 : d >= 2.9 ? 4 : 6;
      const axis = v => Math.round(128 + v * 13);
      return [slot, [axis(dx), axis(-dy), Math.round(245 - d * 7)]];
    }, 'normalMap'),
    rail: paint(32, 11, (x, y) => {
      const post = x < 3 || x > 28 || x === 14 || x === 15;
      if (y === 0 && post) return [6, 8.5];
      if (y === 1 || y === 2 || y === 6) return [y === 1 ? 5 : 1, y === 6 ? 5 : 7.5];
      if (post) return [y === 10 ? 2 : 3, 7 - y * .5];
      return null;
    }),
    seam: paint(24, 3, (x, y) => y === 1 && x % 6 < 4 ? [5, .1] : null)
  };
  const tiles = [];
  for (let y = 0; y < height / tileSize; y++) for (let x = 0; x < width / tileSize; x++) {
    const asset = y <= 1 || y >= 8 ? (x % 7 === 0 ? 'stone' : 'channel') :
      y === 2 || y === 7 ? 'edge' : x <= 2 || x >= 13 ? 'stone' : 'deck';
    tiles.push({ asset, at:[x,y] });
  }
  return {
    format:'ink-studio/pixel-lighting', version:1, width, height, tileSize, ramps, assets, tiles,
    sprites:[
      { asset:'seam', at:[3,29], elevation:.7, castsShadow:false },
      { asset:'seam', at:[103,51], elevation:.7, castsShadow:false },
      { asset:'rail', at:[12,20], elevation:1.5 },
      { asset:'rail', at:[84,49], elevation:1.5 },
      { asset:'pylon', at:[43,21], elevation:1, shadowHeight:1 },
      { asset:'pylon', at:[72,34], elevation:1, shadowHeight:1 },
      { asset:'relay', at:[55,43], elevation:2, shadowHeight:3 }
    ],
    ambient:.13,
    lights:[
      { at:[26.5,34.5,19], radius:86, strength:1.35 },
      { at:[112.5,41.5,13], radius:53, strength:.82 }
    ]
  };
}

module.exports = lanternCrossing;
