module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'terrain-trails',
  name: 'Salt Survey',
  seed: 29,
  build(seed, { controls: { trails = true } = {} } = {}) {
    const w = 256, h = 144;
    const rgba = new Uint8Array(w * h * 4), materials = new Uint8Array(w * h);
    const silt = 1, reeds = 2, water = 3;
    function pixel(data, x, y, color) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      data[i] = color >> 16;
      data[i + 1] = color >> 8 & 255;
      data[i + 2] = color & 255;
      data[i + 3] = 255;
    }
    function fill(data, x, y, width, height, color) {
      for (let v = y; v < y + height; v++)
        for (let u = x; u < x + width; u++) pixel(data, u, v, color);
    }
    function basin(x, y) {
      return Math.hypot((x - 193 + 5 * Math.sin(y * .11)) / 35, (y - 75) / 48) +
        .022 * Math.sin(x * .3 + y * .23);
    }
    function verge(x, y) {
      return Math.hypot((x - 118) / 38, (y - 76 + 4 * Math.sin(x * .13)) / 32) +
        .105 * Math.sin(y * .36 + x * .31) + .045 * Math.sin(x * .83 - y * .38);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const lake = basin(x, y), grass = verge(x, y), grain = K.hash(seed, x, y);
      const erosion = Math.sin(x * .095 + y * .071) + .32 * Math.sin(x * .24 - y * .34);
      let material = silt, color = erosion > .56 ? 0xc2896f : erosion < -.68 ? 0xb67c67 : 0xbe836a;
      if (grain < .018) color = 0xddae89;
      if (grain > .98) color = 0xa86759;
      if (grass < 1.1 && lake >= 1.03) {
        color = grass > 1 ? 0x7e6856 : grain < .26 ? 0x6c6945 : 0x5b6141;
        if (grass <= 1) material = reeds;
      }
      if (lake < 1.11) {
        color = lake > 1.085 ? 0xdbaf8b : lake > 1.04 ? 0x986956 : 0x514f4a;
        material = silt;
        if (lake < 1) {
          const band = lake + .12 * erosion;
          color = band > .83 ? 0x508988 : band > .58 ? 0x3d797e : 0x326d78;
          if (lake > .955) color = 0x79a897;
          material = water;
        }
      }
      pixel(rgba, x, y, color);
      materials[y * w + x] = material;
    }

    for (let y = 9; y < h; y += 3) for (let x = 5; x < w; x += 4) {
      const u = x + Math.floor(K.hash(seed + 7, x, y) * 5), v = y + Math.floor(K.hash(seed + 8, x, y) * 3);
      const grain = K.hash(seed + 9, x, y), material = materials[v * w + u];
      if (material === reeds && grain > .12) {
        const blade = 2 + Math.floor(grain * 4);
        for (let j = 0; j < blade; j++) {
          const dx = j > 2 ? 1 : 0, yy = v - j;
          if (materials[yy * w + u + dx] !== reeds) continue;
          pixel(rgba, u + dx, yy, j === 0 ? 0x3c493a : j === blade - 1 ? 0xb5a66d : 0x8d925b);
          if (j < 2 && materials[yy * w + u - 1] === reeds) pixel(rgba, u - 1, yy, 0x757e4e);
        }
      } else if (material === water && grain > .86) {
        const color = grain > .97 ? 0x6ba69d : 0x4a8a8d;
        for (let j = 0; j < 2 + Math.floor(grain * 4); j++)
          if (materials[v * w + u + j] === water) pixel(rgba, u + j, v, color);
      } else if (material === silt && grain > .91 && basin(u, v) > 1.12 && verge(u, v) > 1.12) {
        fill(rgba, u, v, 2, 1, 0xe0ad86);
        pixel(rgba, u + 1, v + 1, 0xae6d5c);
      }
    }

    for (const [x, y, wide] of [[19, 33, 7], [29, 37, 5], [54, 24, 4], [44, 123, 8], [68, 116, 5],
      [102, 27, 8], [114, 24, 4], [136, 122, 5], [159, 123, 4], [234, 31, 8], [244, 34, 5], [232, 113, 6]]) {
      fill(rgba, x - 1, y + 3, wide + 4, 2, 0xa56d5b);
      fill(rgba, x, y, wide, 4, 0x7e5d58);
      fill(rgba, x + 1, y - 1, wide - 2, 2, 0xe0b090);
      fill(rgba, x + 1, y + 1, wide - 1, 1, 0xc79178);
    }

    const keys = [[0, 19, 99], [1.4, 55, 90], [2.45, 84, 77], [4.25, 138, 78],
      [5.2, 165, 84], [6.55, 198, 72], [7.65, 225, 66], [8.55, 247, 74]];
    function walk(time) {
      for (let i = 1; i < keys.length; i++) {
        const [start, x, y] = keys[i - 1], [end, u, v] = keys[i];
        if (time <= end) {
          const f = Math.max(0, (time - start) / (end - start));
          return [K.mix(x, u, f), K.mix(y, v, f)];
        }
      }
      return keys.at(-1).slice(1);
    }
    const contacts = Array.from({ length: 38 }, (_, i) => {
      const time = .18 + i * .218, [x, y] = walk(time);
      const at = [x - 2, y + (i % 2 ? 2 : -2)];
      const wet = materials[Math.floor(at[1]) * w + Math.floor(at[0])] === water;
      return { at, time, strength: i % 2 ? .87 : 1, channels: wet ? ['ripple'] : ['print', 'press'] };
    });
    const field = K.terrainTrails.create({ width: w, height: h, contacts: trails ? contacts : [],
      print: { radius: 3.7, decay: .22 }, press: { radius: 13, decay: 1.5 },
      ripple: { duration: 1.22, speed: 17, width: 1.9 } });
    const terrain = field.paint({
      raster: { w, h, rgba }, materials,
      reactions: {
        [silt]: { kind: 'print', bands: [[.15, '#b77d67'], [.34, '#9f685b'], [.65, '#885950']] },
        [reeds]: { kind: 'press', shift: [-5, -5] },
        [water]: { kind: 'ripple', bands: [[.17, '#4d9196'], [.34, '#75b7ad'], [.58, '#b1d7b9']] }
      }
    });

    const coat = [
      '.....oo......', '....oyyo.....', '...oyYyoo....', '...oyYyBBo...', '...oyyyCCBo..',
      '..oooyyCBBo..', '.oddoooooo...', '.oddorrrdo...', '.odoorRrro...', '..ooorrRroo..',
      '....orrrrdo..', '....odddoo...'
    ];
    const palette = {
      o: 0x39323e, y: 0xf5b554, Y: 0xffda81, B: 0x447781, C: 0xa3dfca,
      d: 0x77555c, r: 0xb66550, R: 0xe28d60
    };
    const surveyor = {
      resolution: [w, h], filter: 'nearest',
      source({ sceneTime, time }) {
        time = Math.max(0, sceneTime ?? time);
        const [x, y] = walk(time).map(Math.round), frame = Math.floor(time / .109) % 4;
        const bob = frame % 2, active = time <= keys.at(-1)[0];
        const uv = new Uint8Array(w * h * 4), left = x - 6, top = y - 15 - (active ? bob : 0);
        if (materials[y * w + x] !== water) {
          fill(uv, x - 7, y, 13, 2, 0x7c5c51);
          fill(uv, x - 5, y + 2, 9, 1, 0x936b56);
        }
        const spread = !active ? 1 : [2, 1, 0, 1][frame];
        fill(uv, x - 2 - spread, top + 11, 3, 4, palette.o);
        fill(uv, x + spread, top + 11, 3, 4, palette.o);
        for (const u of [x - 2 - spread, x + spread]) {
          fill(uv, u, top + 11, 2, 2, 0x63606c);
          fill(uv, u, top + 14, 4, 1, palette.o);
        }
        coat.forEach((row, v) => [...row].forEach((slot, u) => {
          if (slot !== '.') pixel(uv, left + u, top + v, palette[slot]);
        }));
        return { w, h, rgba: uv };
      }
    };
    return makeBuilder(seed, [0xbe836a]).finish({
      look: { composite: { world: { resolution: [w, h] }, layers: [terrain.layer(), surveyor] } }
    });
  }
});
