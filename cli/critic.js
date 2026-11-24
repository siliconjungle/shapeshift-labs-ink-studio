'use strict';

const { lint,lintMap,backgroundMask,colOf } = require('../src/pixel-craft.js');

// the share of pixels that change and change back over three frames (A, B, A), of those that are not background in all three
function flicker(frames, o = {}) {
  if (frames.length < 3) return 0;
  const { w, h } = frames[0],
    N = w * h;
  let flick = 0,
    count = 0;
  const masks = frames.map(f => backgroundMask(f, o.bg));
  for (let k = 0; k + 2 < frames.length; k++) {
    const a = frames[k].rgb,
      b = frames[k + 1].rgb,
      c = frames[k + 2].rgb;
    for (let i = 0; i < N; i++) {
      if (masks[k][i] || masks[k + 1][i] || masks[k + 2][i]) continue;
      count++;
      const ca = colOf(a, i),
        cb = colOf(b, i),
        cc = colOf(c, i);
      if (ca !== cb && ca === cc) flick++;
    }
  }
  return count ? flick / count : 0;
}

// an animated GIF of pictures of one size, at most 256 colours across them; delay in hundredths of a second
function gif(frames, delay = 8) {
  const { w, h } = frames[0],
    pal = new Map(),
    cols = [];
  for (const f of frames)
    for (let i = 0; i < w * h; i++) {
      const c = colOf(f.rgb, i);
      if (!pal.has(c)) {
        if (cols.length >= 256) {
          // (too many: the nearest of those there are)
          let best = 0,
            bd = 1e9;
          for (let k = 0; k < cols.length; k++) {
            const d =
              (((cols[k] >> 16) & 255) - ((c >> 16) & 255)) ** 2 +
              (((cols[k] >> 8) & 255) - ((c >> 8) & 255)) ** 2 +
              ((cols[k] & 255) - (c & 255)) ** 2;
            if (d < bd) ((bd = d), (best = k));
          }
          pal.set(c, best);
        } else {
          pal.set(c, cols.length);
          cols.push(c);
        }
      }
    }
  let bits = 1;
  while (1 << bits < Math.max(2, cols.length)) bits++;
  const size = 1 << bits,
    out = [];
  const put = (...b) => out.push(...b),
    u16 = v => put(v & 255, (v >> 8) & 255);
  put(...Buffer.from('GIF89a'));
  u16(w);
  u16(h);
  put(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let k = 0; k < size; k++) {
    const c = cols[k] || 0;
    put((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  put(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0); // (loop for ever)
  for (const f of frames) {
    put(0x21, 0xf9, 4, 0, delay & 255, (delay >> 8) & 255, 0, 0);
    put(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    put(0);
    // LZW, codes from min + 1 bits growing to 12, a clear when the table fills
    const min = Math.max(2, bits),
      clear = 1 << min,
      eoi = clear + 1,
      bytes = [];
    let cur = 0,
      nb = 0,
      width = min + 1,
      next = eoi + 1,
      dict = new Map();
    const emit = code => {
      cur |= code << nb;
      nb += width;
      while (nb >= 8) {
        bytes.push(cur & 255);
        cur >>>= 8;
        nb -= 8;
      }
    };
    emit(clear);
    let prefix = pal.get(colOf(f.rgb, 0));
    for (let i = 1; i < w * h; i++) {
      const k = pal.get(colOf(f.rgb, i)),
        key = prefix * 4096 + k;
      if (dict.has(key)) {
        prefix = dict.get(key);
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > 1 << width && width < 12) width++;
      } else {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        width = min + 1;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (nb > 0) bytes.push(cur & 255);
    put(min);
    for (let k = 0; k < bytes.length; k += 255) {
      const chunk = bytes.slice(k, k + 255);
      put(chunk.length, ...chunk);
    }
    put(0);
  }
  put(0x3b);
  return Buffer.from(out);
}

/* the review's shots: the diorama's own view, from its four sides, from above, from low down, and at three zooms; each
   [label, yaw offset, pitch (null: its own), zoom] */
const SHOTS = [
  ['home', 0, null, 1],
  ['side 2', Math.PI / 2, null, 1],
  ['side 3', Math.PI, null, 1],
  ['side 4', (3 * Math.PI) / 2, null, 1],
  ['top', 0, 1.3, 1],
  ['low', 0, 0.14, 1],
  ['far', 0, null, 0.55],
  ['near', 0, null, 1.7],
  ['close', 0, null, 2.8]
];

// the medians of the pixel-art references at their own pixel size (study/native: nine of them)
const REFERENCE = {
  orphans: 0.015,
  doubles: 0.032,
  jaggies: 0.13,
  banding: 0.024,
  pillow: 0,
  noise: 0.177,
  colours: 48
};

module.exports = { lint, lintMap, flicker, gif, backgroundMask, SHOTS, REFERENCE };
