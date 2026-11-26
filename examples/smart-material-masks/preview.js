/* Shade one cast-iron sample from the delivered world normal, position and masks. */
const LockNine = (() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  const get = image => {
    const divisor = image.descriptor.precision === 'unorm8' ? 255 : image.descriptor.precision === 'unorm16' ? 65535 : 1;
    return i => image.raster.data[i] / divisor;
  };
  const noise = (a, b) => {
    let n = Math.imul(a + 423, 0x9e3779b) ^ Math.imul(b + 145, 0x85ebca6b);
    n = Math.imul(n ^ n >>> 13, 0xcb1ab31f);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };

  function render(outputs, state) {
    const { width, height } = outputs.coverageMap.raster;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const coverage = get(outputs.coverageMap), normal = get(outputs.normalMap), position = get(outputs.positionMap);
    const printed = get(outputs.removeMap), occlusion = get(outputs.aoMap);
    const names = ['edgeWear', 'dirt', 'dust', 'rust', 'leaks', 'waterline'];
    const masks = Object.fromEntries(names.map(name => [name, get(outputs[name])]));
    const single = state.view === 'surface' ? null : get(outputs[state.recipe + state.view]);
    const tint = [102, 190, 177], iron = [23, 73, 78], oxide = [182, 77, 37], residue = [180, 189, 140];
    const sourceZ = p => position(p * 3 + 2);
    const at = (x, y) => Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
    const key = [-.46, .58, .672];
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const o = p * 4, cover = coverage(p);
      if (!cover) continue;
      pixels[o + 3] = Math.round(cover * 255);
      if (single) {
        const amount = single(p);
        for (let c = 0; c < 3; c++) pixels[o + c] = lerp([11, 19, 21][c], tint[c], Math.sqrt(amount));
        continue;
      }
      const i = p * 3, nx = normal(i), ny = normal(i + 1), nz = normal(i + 2);
      const light = Math.max(0, nx * key[0] + ny * key[1] + nz * key[2]);
      const specular = clamp(nx * -.255 + ny * .315 + nz * .914) ** 23;
      const heightHere = sourceZ(p);
      let block = 0;
      for (let step = 1; step <= 5; step++) {
        const b = at(Math.round(x + key[0] * step), Math.round(y - key[1] * step));
        if (coverage(b)) block = Math.max(block, sourceZ(b) - heightHere - .016 * step);
      }
      const grain = noise(x, y), broadGrain = noise(x >> 2, y >> 2);
      const surfaceLight = .46 + .65 * Math.round(light * 10) / 10 * clamp(1 - block * 8) + .15 * specular;
      const ambient = .48 + .52 * occlusion(p);
      const exposed = state.bare ? 0 : masks.edgeWear(p) * .62;
      const dirt = state.bare ? 0 : masks.dirt(p), dust = state.bare ? 0 : masks.dust(p);
      const rust = state.bare ? 0 : masks.rust(p), leak = state.bare ? 0 : masks.leaks(p);
      const tide = state.bare ? 0 : masks.waterline(p);
      const yWorld = position(i + 1);
      const legend = printed(p) * clamp((heightHere - .036) * 9.3);
      const submerged = state.bare ? 0 : clamp((state.level - yWorld) * 9) * (.31 + .17 * broadGrain);
      for (let c = 0; c < 3; c++) {
        let color = iron[c] + grain * 10 + broadGrain * 5 + Math.cos(x * .045 + y * .026) * 5;
        color = lerp(color, [193, 177, 112][c], legend * .94);
        color = lerp(color, [169, 181, 158][c], exposed);
        color = lerp(color, [39, 38, 29][c], dirt * .42);
        color = lerp(color, residue[c], dust * (.21 + .15 * grain));
        color = lerp(color, oxide[c] + grain * 24 - broadGrain * 27, rust * .91);
        color = lerp(color, [42, 38, 23][c], leak * .47);
        color = lerp(color, [22, 45, 41][c], submerged);
        color = lerp(color, [148, 153, 103][c], tide * (.60 + .16 * grain));
        pixels[o + c] = color * surfaceLight * ambient + [20, 18, 14][c] * specular;
      }
    }
    return new ImageData(pixels, width, height);
  }

  return { render };
})();
