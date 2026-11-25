/* Lossless PNG samples shared by the Node and browser paint paths. */
const PNGRaster = (() => {
  const signature = [137,80,78,71,13,10,26,10];
  function* decode(b, capturePalette, layoutOnly = false) {
    if (b.length < 33 || !signature.every((byte,i)=>b[i] === byte)) throw new Error('Not a PNG file');
    const view = new DataView(b.buffer,b.byteOffset,b.byteLength);
    let p = 8, w = 0, h = 0, bits, color, interlace, table, transparency, ink;
    const parts = [];
    while (p + 12 <= b.length) {
      const len = view.getUint32(p), type = String.fromCharCode(...b.subarray(p+4,p+8));
      if (p + 12 + len > b.length) throw new Error('Truncated PNG chunk');
      const d = b.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        if (len !== 13 || d[10] || d[11] || d[12] > 1) throw new Error('PNG must use standard filtering, compression and interlacing');
        w = view.getUint32(p+8);
        h = view.getUint32(p+12);
        bits = d[8];
        color = d[9];
        interlace = d[12];
      } else if (type === 'PLTE') table = d;
      else if (type === 'tRNS') transparency = d;
      else if (type === 'inKD' && capturePalette === 'paint') {
        if (ink) throw new Error('Duplicate Ink palette metadata');
        ink = d;
      } else if (type === 'IDAT') parts.push(d);
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const allowed = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
    if (!w || !h || w * h > 16777216 || !ch || !allowed.includes(bits))
      throw new Error('Unsupported PNG dimensions or colour format');
    const entries = table?.length / 3;
    if (color === 3 && (!Number.isInteger(entries) || entries < 1 || entries > 2 ** bits || transparency?.length > entries))
      throw new Error('Invalid indexed PNG palette');
    const paint = capturePalette === 'paint', sheet = capturePalette === 'sheet', tileset = capturePalette === 'tileset';
    const readIndices = color === 3 && (paint || sheet || tileset || capturePalette === 'indices');
    if (capturePalette === 'indices' && color !== 3) throw new Error('Indexed PNG asset needs a palette-indexed PNG');
    if (layoutOnly) return { w, h };
    if (paint && (w > 512 || h > 512 || bits > 8))
      throw new RangeError('Pixel art import needs a PNG up to 512 × 512 with 8-bit or smaller channels');
    if (sheet && bits > 8) throw new RangeError('Sprite sheets need 8-bit or smaller PNG channels');
    const slots = readIndices ? new Uint8Array(w * h) : null;
    const counts = capturePalette === true && color === 3 ? new Uint32Array(entries) : null;
    const out = counts || slots ? null : bits === 16 ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
    const sampleMask = (1 << bits) - 1, max = color === 3 ? 255 : sampleMask;
    const bpp = Math.ceil(ch * bits / 8);
    const passLayouts = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
    const passes = passLayouts.map(([x,y,dx,dy]) => ({
      x, y, dx, dy, width: Math.max(0, Math.ceil((w-x)/dx)), height: Math.max(0, Math.ceil((h-y)/dy))
    })).filter(pass => pass.width && pass.height);
    const scanlineSize = passes.reduce((n, {width,height}) => n + height * (1 + Math.ceil(width * ch * bits / 8)), 0);
    const raw = yield { parts,scanlineSize };
    if (raw.length !== scanlineSize) throw new Error('Invalid PNG scanline length');

    const transparent = i => transparency && transparency.length >= 2 * (i + 1) ? transparency[2*i]*256 + transparency[2*i+1] : -1;
    const tr = transparent(0), tg = transparent(1), tb = transparent(2);
    let cursor = 0;
    for (const pass of passes) {
      const {width,height,dx,dy} = pass, rowBytes = Math.ceil(width * ch * bits / 8);
      const row = new Uint8Array(rowBytes), prev = new Uint8Array(rowBytes);
      const sample = i => bits === 16 ? row[2 * i] * 256 + row[2 * i + 1]
        : bits === 8 ? row[i]
        : (row[(i * bits) >> 3] >> (8 - bits - (i * bits & 7))) & sampleMask;
      for (let y = 0; y < height; y++) {
        const filter = raw[cursor++];
        if (filter > 4) throw new Error('Invalid PNG filter');
        for (let i = 0; i < rowBytes; i++) {
          const x = raw[cursor++], a = i >= bpp ? row[i - bpp] : 0,
            u = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
          let v = x;
          if (filter === 1) v = x + a;
          else if (filter === 2) v = x + u;
          else if (filter === 3) v = x + ((a + u) >> 1);
          else if (filter === 4) {
            const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c);
          }
          row[i] = v & 255;
        }
        for (let x = 0; x < width; x++) {
          const dst = ((pass.y + y*dy)*w + pass.x + x*dx)*4, src = x*ch;
          if (color === 3) {
            const index = sample(src);
            if (index >= entries) throw new Error('PNG references a colour outside its palette');
            if (counts) counts[index]++;
            else if (slots) slots[dst / 4] = index;
            else {
              out[dst] = table[index*3]; out[dst+1] = table[index*3+1]; out[dst+2] = table[index*3+2];
              out[dst+3] = transparency?.[index] ?? 255;
            }
          } else if (color === 0 || color === 4) {
            const gray = sample(src);
            out[dst] = out[dst+1] = out[dst+2] = gray;
            out[dst+3] = color === 4 ? sample(src+1) : gray === tr ? 0 : max;
          } else {
            const r = sample(src), g = sample(src+1), bl = sample(src+2);
            out[dst] = r; out[dst+1] = g; out[dst+2] = bl;
            out[dst+3] = color === 6 ? sample(src+3) : r === tr && g === tg && bl === tb ? 0 : max;
          }
        }
        prev.set(row);
      }
    }
    if (slots) {
      const palette = Array.from({length:entries},(_,index)=>table[index*3]*65536 + table[index*3+1]*256 + table[index*3+2]);
      if (tileset) return {w,h,slots,palette,transparency};
      const dimensions = {width:w,height:h,channels:1};
      return {
        value: {...dimensions,data:slots},
        alpha: {...dimensions,data:Uint8Array.from(slots,index=>transparency?.[index] ?? 255)},
        palette,
        ...(paint && { transparency,ink })
      };
    }
    if (counts) return { w, h, bitDepth: bits, indexed: { table, transparency, counts } };
    return { w, h, data: out, max, ...(capturePalette && { bitDepth: bits }), ...(paint && { ink }) };
  }
  return Object.freeze({ decode });
})();
if (typeof module !== 'undefined') module.exports = PNGRaster;
else globalThis[Symbol.for('ink-studio.png-raster')] = PNGRaster;
