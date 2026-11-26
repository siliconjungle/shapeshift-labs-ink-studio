/* Render a lit swatch and its component maps on the same native grid. */
const LanternRelay = (() => {
  const colors = { jade: [.032, .245, .218], ember: [.44, .065, .029], cobalt: [.034, .154, .43] };
  const clamp = n => Math.min(1, Math.max(0, n));
  const tone = n => Math.round(255 * (n < .00313 ? 12.92 * clamp(n) : 1.055 * clamp(n) ** (1 / 2.4) - .055));
  function pigment(I, gain, choice) {
    const { width, height, data } = gain.raster, values = new Float32Array(data.length * 3);
    for (let p = 0; p < data.length; p++) for (let c = 0; c < 3; c++)
      values[p * 3 + c] = colors[choice][c] * data[p];
    return I.declare({ width, height, channels: 3, data: values },
      { intent: 'color', colorSpace: 'srgb-linear', sampling: 'linear' });
  }

  function render(material, mode = 'lit', angle = 133) {
    const maps = Object.fromEntries(Object.entries(material.channels).map(([name, row]) => [name, row.raster.raster.data]));
    const { width, height } = material.channels.baseColor.raster.raster;
    const { baseColor, normal, roughness, metalness, ao, opacity, height: relief } = maps;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const azimuth = angle * Math.PI / 180;
    const lx = Math.cos(azimuth) * .74, ly = Math.sin(azimuth) * .74, lz = Math.sqrt(1 - .74 ** 2);
    const hz = lz + 1, hnorm = Math.hypot(lx, ly, hz);
    const at = (x, y) => Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      if (!opacity[p]) continue;
      const i = p * 3, o = p * 4;
      const nx = normal[i], ny = normal[i + 1], nz = normal[i + 2], q = roughness[p], m = metalness[p];
      pixels[o + 3] = Math.round(255 * opacity[p]);
      if (mode === 'height') {
        const value = clamp(relief[p] / 1.26);
        pixels[o] = tone(.022 + value * .76);
        pixels[o + 1] = tone(.026 + value * .73);
        pixels[o + 2] = tone(.04 + value * .69);
      } else if (mode === 'normal') {
        pixels[o] = (nx * .5 + .5) * 255;
        pixels[o + 1] = (ny * .5 + .5) * 255;
        pixels[o + 2] = (nz * .5 + .5) * 255;
      } else if (mode === 'roughness') {
        pixels[o] = tone(q * .92);
        pixels[o + 1] = tone(q * .92);
        pixels[o + 2] = tone(q * .92);
      } else if (mode === 'baseColor') {
        for (let c = 0; c < 3; c++) pixels[o + c] = tone(baseColor[i + c]);
      } else {
        let shadow = 0;
        for (let step = 1; step <= 5; step++) {
          const ahead = at(Math.round(x + lx * step), Math.round(y - ly * step));
          shadow = Math.max(shadow, relief[ahead] - relief[p] - step * .105);
        }
        const ndl = clamp(nx * lx + ny * ly + nz * lz);
        const half = clamp((nx * lx + ny * ly + nz * hz) / hnorm);
        const band = Math.round(ndl * 9) / 9;
        const blocked = clamp(1 - shadow * 1.7);
        const yRim = y / height;
        const sheet = clamp(.79 + .38 * Math.cos((x - 49) * .034 + (y - 33) * .04));
        const specular = half ** (7 + 72 * (1 - q) ** 2) * (.34 + .62 * (1 - q));
        const ambient = .16 + .11 * ao[p], diffuse = ambient + (.55 + .18 * sheet) * band * blocked;
        for (let c = 0; c < 3; c++) {
          const warm = [1, .91, .76][c], cool = [.72, .88, 1][c];
          const pigment = baseColor[i + c];
          const highlight = ((.48 + pigment * .34) * m + .78 * (1 - m)) * specular * warm * blocked;
          const reflection = (m * .15 * sheet + (1 - yRim) * .04) * cool;
          const brightness = pigment * (diffuse * (warm + .19) + reflection) + highlight + reflection * .072;
          pixels[o + c] = tone(brightness);
        }
      }
    }
    return { width, height, pixels };
  }

  return { pigment, render };
})();
if (typeof module !== 'undefined') module.exports = LanternRelay;
