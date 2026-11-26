/* A small texture-space light rig for the paint demo. */
const TideglassPreview = (() => {
  const clamp = v => Math.max(0, Math.min(1, v));
  const tone = v => Math.round(255 * Math.pow(clamp(v), 1 / 2.2));
  function render(outputs, mode = 'material', yaw = -42, zoom = 1) {
    const { color, height, emission, normal, roughness, velocity } = outputs;
    const { width: w, height: h, data: base } = color.raster;
    const heightData = height.raster.data, n = normal.raster.data, e = emission.raster.data, q = roughness.raster.data;
    const flow = velocity.raster.data, angle = yaw * Math.PI / 180, lx = Math.cos(angle) * .63, ly = -Math.sin(angle) * .63;
    const lz = Math.sqrt(1 - lx * lx - ly * ly), half = Math.hypot(lx, ly, lz + 1);
    const width = w / 4, rows = h / 4, step = 4 / zoom, x0 = (w - width * step) / 2, y0 = (h - rows * step) / 2;
    const data = new Uint8Array(width * rows * 4);
    for (let y = 0, at = 0; y < rows; y++) for (let x = 0; x < width; x++, at += 4) {
      const sx = Math.min(w - 1, Math.floor(x0 + (x + .5) * step)), sy = Math.min(h - 1, Math.floor(y0 + (y + .5) * step));
      const p = sy * w + sx, a = base[p * 4 + 3], i = p * 3;
      if (a <= 0) continue;
      data[at + 3] = Math.round(a * 255);
      if (mode === 'height') {
        const f = clamp(heightData[p] / .65);
        data[at] = tone(.018 + f * .70); data[at + 1] = tone(.016 + f * .55); data[at + 2] = tone(.035 + f * .75);
      } else if (mode === 'emission') {
        for (let c = 0; c < 3; c++) data[at + c] = tone(1 - Math.exp(-Math.max(0, e[i + c]) * .92));
      } else if (mode === 'roughness') {
        const f = clamp(q[p]);
        data[at] = tone(f * .66); data[at + 1] = tone(f * .76); data[at + 2] = tone(f * .88);
      } else if (mode === 'flow') {
        const u = flow[p * 2], v = flow[p * 2 + 1], f = clamp(Math.hypot(u, v));
        data[at] = tone(.017 + f * (.29 + .26 * u)); data[at + 1] = tone(.035 + f * (.57 - .26 * v));
        data[at + 2] = tone(.069 + f * (.68 + .19 * v));
      } else {
        const diffuse = Math.max(0, n[i] * lx + n[i + 1] * ly + n[i + 2] * lz);
        const facing = Math.max(0, (n[i] * lx + n[i + 1] * ly + n[i + 2] * (lz + 1)) / half);
        const specular = .059 * Math.pow(facing, 5 + 29 * (1 - q[p])) + .16 * Math.pow(facing, 22) * (1 - q[p]);
        const shade = Math.round(diffuse * 11) / 11;
        const gain = .29 + shade * .81;
        for (let c = 0; c < 3; c++) {
          const source = base[p * 4 + c] * gain, light = .46 * Math.max(0, e[i + c]);
          const glow = e[(Math.max(0, sy - 6) * w + sx) * 3 + c] + e[(Math.min(h - 1, sy + 6) * w + sx) * 3 + c] +
            e[(sy * w + Math.max(0, sx - 6)) * 3 + c] + e[(sy * w + Math.min(w - 1, sx + 6)) * 3 + c];
          const lit = source + Math.max(0, (1 - Math.exp(-light))) * ([.86, .92, 1][c]) + glow * .026 +
            specular * ([1, .83, .62][c]);
          data[at + c] = tone(lit);
        }
      }
    }
    return { width, height: rows, data, crop: [x0 / w, y0 / h, width * step / w, rows * step / h] };
  }
  return Object.freeze({ render });
})();
if (typeof module !== 'undefined') module.exports = TideglassPreview;
