/* Radiance RGBE input, compact linear panorama transport, and diffuse irradiance. */
const HDREnvironment = (() => {
  const maxFileBytes = 48 * 1024 * 1024;
  const maxExtent = 8192, wireWidth = 1024;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const bounded = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const extent = (w, h, max = maxExtent) => Number.isSafeInteger(w) && Number.isSafeInteger(h) &&
    w >= 4 && h >= 2 && w <= max && h <= max && w * h <= 2 ** 23;
  const clamp = n => Math.min(16777216, Math.max(0, n));
  const powers = Float64Array.from({ length: 256 }, (_, n) => n ? 2 ** (n - 136) : 0);

  function readRadiance(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > maxFileBytes) throw new RangeError('HDRI needs a bounded Radiance file');
    let offset = 0, primaries;
    function line() {
      const end = bytes.indexOf(10, offset);
      if (end < 0 || end - offset > 4096 || end > 65536) throw new TypeError('Invalid Radiance HDR header');
      const value = new TextDecoder().decode(bytes.subarray(offset, end)).trim();
      offset = end + 1;
      return value;
    }
    if (!['#?RADIANCE', '#?RGBE'].includes(line())) throw new TypeError('Expected a Radiance RGBE file');
    let format;
    for (let row = line(); row; row = line()) {
      if (row.startsWith('FORMAT=')) format = row.slice(7);
      if (row.startsWith('PRIMARIES=')) {
        primaries = row.slice(10).trim().split(/\s+/).map(Number);
        if (primaries.length !== 8 || !primaries.every(Number.isFinite)) throw new TypeError('Invalid Radiance RGB primaries');
      }
    }
    if (format !== '32-bit_rle_rgbe') throw new TypeError('Radiance HDRI needs RGBE encoding');
    const order = /^([+-])([XY]) ([0-9]+) ([+-])([XY]) ([0-9]+)$/.exec(line().replace(/\s+/g, ' '));
    if (!order || order[2] === order[5]) throw new TypeError('Invalid Radiance HDR dimensions or orientation');
    const [, first, axis, count, second, other, columns] = order;
    const rows = Number(count), span = Number(columns), width = axis === 'X' ? rows : span, height = axis === 'Y' ? rows : span;
    if (!extent(width, height)) throw new RangeError('Radiance HDRI exceeds the panorama size budget');
    const pixels = new Uint8Array(width * height * 4), stripe = new Uint8Array(span * 4);
    function take() {
      if (offset >= bytes.length) throw new RangeError('Truncated Radiance HDR image');
      return bytes[offset++];
    }
    function unpack() {
      const probe = [take(), take(), take(), take()];
      if (span >= 8 && span < 32768 && probe[0] === 2 && probe[1] === 2 && !(probe[2] & 128)) {
        if (probe[2] * 256 + probe[3] !== span) throw new RangeError('Radiance scanline width does not match its header');
        for (let c = 0; c < 4; c++) {
          for (let x = 0; x < span;) {
            const command = take(), repeat = command > 128, run = repeat ? command - 128 : command;
            if (!run || run > span - x) throw new RangeError('Invalid Radiance scanline run');
            const value = repeat ? take() : 0;
            for (let i = 0; i < run; i++, x++) stripe[x * 4 + c] = repeat ? value : take();
          }
        }
        return;
      }
      let previous, shift = 0;
      for (let x = 0, pixel = probe; x < span;) {
        const isRun = pixel[0] === 1 && pixel[1] === 1 && pixel[2] === 1;
        const run = isRun ? pixel[3] * 2 ** shift : 1;
        if (isRun && (!previous || shift > 24 || run > span - x)) throw new RangeError('Invalid legacy Radiance pixel run');
        if (isRun) shift += 8;
        else { previous = pixel; shift = 0; }
        for (let i = 0; i < run; i++, x++) stripe.set(previous, x * 4);
        if (x < span) pixel = [take(), take(), take(), take()];
      }
    }
    const coordinate = (axis, sign, at, n) => (axis === 'X' ? sign === '+' : sign === '-') ? at : n - 1 - at;
    for (let row = 0; row < rows; row++) {
      unpack();
      const a = coordinate(axis, first, row, rows);
      for (let col = 0; col < span; col++) {
        const b = coordinate(other, second, col, span);
        const [x, y] = axis === 'X' ? [a, b] : [b, a];
        pixels.set(stripe.subarray(col * 4, col * 4 + 4), (y * width + x) * 4);
      }
    }
    if (offset !== bytes.length) throw new RangeError('Unexpected bytes after the Radiance panorama');
    return { width, height, pixels, ...(primaries && { primaries }) };
  }

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = ([a,b,c], [x,y,z]) => [b*z - c*y, c*x - a*z, a*y - b*x];
  function colorTransform(chroma) {
    if (!chroma) return rgb => rgb;
    const srgb = [.64,.33,.30,.60,.15,.06,.3127,.329];
    if (chroma.every((n, i) => Math.abs(n - srgb[i]) < 1e-5)) return rgb => rgb;
    const xy = (x,y) => {
      if (!bounded(x, 0, 1) || !bounded(y, 1e-6, 1) || x + y > 1.001)
        throw new RangeError('HDRI needs representable RGB chromaticities');
      return [x / y, 1, (1 - x - y) / y];
    };
    const [a,b,c,w] = Array.from({ length: 4 }, (_, i) => xy(...chroma.slice(i*2,i*2+2)));
    const cofactors = [cross(b,c), cross(c,a), cross(a,b)];
    const det = dot(a, cofactors[0]);
    if (Math.abs(det) < 1e-8) throw new RangeError('HDRI RGB primaries are singular');
    const xyz = [a,b,c].map((column,i) => {
      const white = dot(w, cofactors[i]) / det;
      return column.map(n => n * white);
    });
    const rgbFromXYZ = [[3.24096994,-1.53738318,-.49861076],[-.96924364,1.87596750,.04155506],
      [.05563008,-.20397696,1.05697151]];
    const matrix = rgbFromXYZ.map(row => xyz.map(col => dot(row,col)));
    return rgb => matrix.map(row => dot(row,rgb));
  }

  function panorama(width, height) {
    if (!extent(width, height) || width !== height * 2)
      throw new RangeError('Lighting rooms require a 2:1 latitude-longitude HDR panorama');
  }
  function decode(pixels, at, out) {
    const gain = powers[pixels[at + 3]];
    for (let c = 0; c < 3; c++) out[c] = pixels[at + c] * gain;
  }

  function encode(out, at, rgb) {
    const peak = Math.max(...rgb);
    if (peak < 1e-20) return;
    const exp = Math.floor(Math.log2(peak)) + 1, scale = 2 ** (8 - exp);
    for (let c = 0; c < 3; c++) out[at+c] = Math.min(255, Math.floor(rgb[c] * scale));
    out[at + 3] = exp + 128;
  }

  function pack(width, height, read, primaries) {
    panorama(width,height);
    const w = Math.min(width, wireWidth), h = w / 2, sums = new Float64Array(w * h * 4);
    const transform = colorTransform(primaries), color = [0,0,0];
    for (let y = 0; y < height; y++) {
      const weight = Math.cos(y * Math.PI / height) - Math.cos((y + 1) * Math.PI / height);
      const row = Math.floor(y * h / height) * w;
      for (let x = 0; x < width; x++) {
        read(y * width + x, color);
        if (!color.every(Number.isFinite)) throw new RangeError('HDRI pixels must be finite');
        const rgb = transform(color), p = (row + Math.floor(x * w / width)) * 4;
        for (let c = 0; c < 3; c++) sums[p+c] += weight * clamp(rgb[c]);
        sums[p+3] += weight;
      }
    }
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < pixels.length; i += 4)
      encode(pixels, i, [sums[i],sums[i+1],sums[i+2]].map(n => n / sums[i+3]));
    return { width: w, height: h, pixels };
  }

  const radiance = bytes => {
    const { width, height, pixels, primaries } = readRadiance(bytes);
    panorama(width, height);
    if (!primaries && width <= wireWidth && !pixels.some((n,i) => i%4===3 && n>153)) return { width,height,pixels };
    return pack(width, height, (i, out) => decode(pixels, i * 4, out), primaries);
  };

  const toBase64 = value => {
    if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64');
    let result = '';
    for (let i = 0; i < value.length; i += 8192) result += String.fromCharCode(...value.subarray(i,i+8192));
    return btoa(result);
  };
  const fromBase64 = value => typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(value, 'base64')) :
    Uint8Array.from(atob(value), c => c.charCodeAt(0));

  function embedded(name, image) {
    return { name, width: image.width, height: image.height, encoding: 'rgbe', data: toBase64(image.pixels) };
  }

  function unembed(row) {
    if (!record(row) || !['name','width','height','encoding','data'].every(key => Object.hasOwn(row,key)) ||
        Object.keys(row).length !== 5 || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 140 ||
        row.encoding !== 'rgbe' || !extent(row.width,row.height,wireWidth) || row.width !== row.height*2 ||
        typeof row.data !== 'string' || row.data.length !== 4 * Math.ceil(row.width * row.height * 4 / 3))
      throw new TypeError('Invalid embedded room HDR panorama');
    const pixels = fromBase64(row.data);
    if (pixels.length !== row.width * row.height * 4 || toBase64(pixels) !== row.data ||
        pixels.some((n,i) => i%4===3 && n>153))
      throw new RangeError('Invalid RGBE data in the room panorama');
    return { width: row.width, height: row.height, pixels };
  }

  const direction = (u,v) => {
    const phi = (u-.5) * 2 * Math.PI, theta = v * Math.PI;
    return [Math.sin(phi)*Math.sin(theta), Math.cos(theta), Math.cos(phi)*Math.sin(theta)];
  };
  const harmonics = ([x,y,z]) => [.2820947918,.4886025119*x,.4886025119*y,.4886025119*z,
    1.0925484306*x*y,1.0925484306*y*z,.3153915653*(3*z*z-1),1.0925484306*x*z,.5462742153*(x*x-y*y)];

  function diffuse({ width, height, pixels }) {
    const irradiance = new Float64Array(27), color = [0,0,0];
    for (let y = 0; y < height; y++) {
      const weight = 2 * Math.PI / width * (Math.cos(y*Math.PI/height) - Math.cos((y+1)*Math.PI/height));
      for (let x = 0; x < width; x++) {
        decode(pixels,(y*width+x)*4,color);
        const basis = harmonics(direction((x+.5)/width,(y+.5)/height));
        for(let i=0;i<9;i++) for(let c=0;c<3;c++) irradiance[3*i+c] += basis[i]*color[c]*weight;
      }
    }
    for (let i = 1; i < 9; i++) for (let c=0;c<3;c++) irradiance[3*i+c] *= i < 4 ? 2/3 : 1/4;
    return Float32Array.from(irradiance);
  }

  function neutral(preset) {
    const width = 256, height = 128, pixels = new Uint8Array(width*height*4);
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      const [a,b,c] = direction((x+.5)/width,(y+.5)/height);
      let value = .62;
      if (preset === 'neutral-softbox') {
        const key = a < -.26 && b > .36 && b < .92 && c > .22;
        const fill = a > .56 && b > -.08 && b < .61 && c > -.38;
        const rim = b > .21 && b < .54 && c < -.73 && a > -.23;
        value = .22 + .13 * Math.max(0,b) + 5.6*Number(key) + 2.3*Number(fill) + 3.5*Number(rim);
      }
      if (preset === 'neutral-raking') {
        const strip = a < -.74 && b > .02 && b < .63 && c > .25 && c < .51;
        value = .17 + .11 * Math.max(0,b) + 10*Number(strip);
      }
      encode(pixels,(y*width+x)*4,[value,value,value]);
    }
    return { width, height, pixels };
  }

  return Object.freeze({ maxFileBytes, readRadiance, radiance, pack, embedded, unembed, neutral, diffuse });
})();
if (typeof module !== 'undefined') module.exports = HDREnvironment;
