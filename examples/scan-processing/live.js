(() => {
  const types = { unorm8: Uint8Array, unorm16: Uint16Array, float32: Float32Array, float64: Float64Array };
  function unpack(map) {
    const bytes = Uint8Array.from(atob(map.bytes), c => c.charCodeAt(0));
    return { ...map, data: new types[map.precision](bytes.buffer) };
  }
  const stages = Object.fromEntries(Object.entries(scan.stages).map(([name, maps]) =>
    [name, Object.fromEntries(Object.entries(maps).map(([channel, map]) => [channel, unpack(map)]))]));
  const damage = unpack(scan.repairedMask);
  const labels = { captured: 'Capture', aligned: 'Registered', delit: 'De-lit', repaired: 'Repaired', value: 'Tiled' };
  const title = { lit: 'Relit material', baseColor: 'Pigment', height: 'Height', normal: 'Normals',
    roughness: 'Roughness', repairs: 'Repair mask' };
  const notes = {
    captured: 'Simulated source capture. Each map was sampled on its own scanner grid.',
    aligned: 'All maps share one UV grid. Capture lighting and marked defects are still visible.',
    delit: 'Measured irradiance has been removed in linear light.',
    repaired: 'Each marked texel was replaced from one donor shared by every map.',
    value: 'One crop and one seam blend keep the four material maps registered.'
  };
  const byId = label => document.getElementById(label);
  const tabs = [...document.querySelectorAll('[data-stage]')], modes = [...document.querySelectorAll('[data-map]')];
  const canvas = byId('preview'), ctx = canvas.getContext('2d');
  let stage = 'value', mode = 'lit', frame = 0;
  const unit = n => Math.max(0, Math.min(1, n));
  const display = n => n <= .0031308 ? 12.92 * unit(n) : 1.055 * unit(n) ** (1 / 2.4) - .055;
  const byte = n => Math.round(255 * display(n));
  const sample = (map, i) => map.data[i] / (map.precision === 'unorm8' ? 255 : map.precision === 'unorm16' ? 65535 : 1);
  const press = (buttons, button) => {
    for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
  };
  function draw() {
    frame = 0;
    const maps = stages[stage];
    const source = mode === 'repairs' ? damage : maps[mode === 'lit' ? 'baseColor' : mode];
    const { width: w, height: h } = source, repeats = byId('repeat').checked && mode !== 'repairs' ? 2 : 1;
    const image = new ImageData(w * repeats, h * repeats), out = image.data;
    const angle = Number(byId('light').value) * Math.PI / 180;
    const lx = .61 * Math.cos(angle), ly = .61 * Math.sin(angle), lz = Math.sqrt(1 - .61 ** 2);
    const half = Math.hypot(lx, ly, lz + 1);
    const guides = byId('guides').checked && repeats === 2;
    for (let y = 0, i = 0; y < image.height; y++) for (let x = 0; x < image.width; x++, i += 4) {
      const p = y % h * w + x % w, at = p * source.channels;
      out[i + 3] = 255;
      if (guides && (x === w || y === h)) {
        out.set([235, 224, 154, 255], i);
      } else if (mode === 'lit' && stage !== 'captured') {
        const { normal, roughness } = maps;
        const nx = sample(normal, p * 3), ny = sample(normal, p * 3 + 1), nz = sample(normal, p * 3 + 2);
        const rough = sample(roughness, p);
        const diffuse = Math.round(Math.max(0, nx * lx + ny * ly + nz * lz) * 12) / 12;
        const specular = unit((nx * lx + ny * ly + nz * (lz + 1)) / half) ** (10 + (1 - rough) * 35);
        const glaze = .28 + .73 * diffuse;
        for (let c = 0; c < 3; c++) out[i + c] = byte(sample(source, at + c) * glaze +
          (.024 + .086 * (1 - rough)) * specular * [1, .92, .76][c]);
      } else if (mode === 'lit' || mode === 'baseColor') {
        for (let c = 0; c < 3; c++) out[i + c] = byte(sample(source, at + c));
      } else if (mode === 'normal') {
        for (let c = 0; c < 3; c++) out[i + c] = Math.round((sample(source, at + c) + 1) * 127.5);
      } else {
        const n = sample(source, p);
        const shade = mode === 'height' ? byte((n + .035) / .60) : mode === 'repairs' ? 30 + 210 * n : byte(n);
        for (let c = 0; c < 3; c++) out[i + c] = shade;
      }
    }
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    ctx.putImageData(image, 0, 0);
    byId('status').textContent = (mode === 'repairs' ? 'Repaired texels · ' + scan.report.repair.repaired :
      labels[stage] + ' · ' + (mode === 'lit' && stage === 'captured' ? 'Captured light' : title[mode])) +
      ' · ' + w + ' × ' + h + (repeats === 2 ? ' · 2 × 2 repeat' : '');
    byId('stage-note').textContent = notes[stage];
    byId('light').disabled = mode !== 'lit' || stage === 'captured';
    byId('light-value').textContent = byId('light').value + '°';
  }

  function request() { if (!frame) frame = requestAnimationFrame(draw); }
  for (const tab of tabs) tab.addEventListener('click', () => {
    stage = tab.dataset.stage;
    press(tabs, tab);
    if (mode === 'repairs') { mode = 'lit'; press(modes, modes[0]); }
    request();
  });
  for (const button of modes) button.addEventListener('click', () => {
    mode = button.dataset.map;
    press(modes, button);
    request();
  });
  for (const id of ['light', 'guides', 'repeat']) byId(id).addEventListener('input', request);
  const rmse = scan.error, fit = Math.max(...scan.report.alignment.map(row => row.maxPx));
  byId('fit').textContent = fit.toFixed(3) + ' px';
  byId('repair-count').textContent = String(scan.report.repair.repaired);
  byId('light-error').textContent = rmse.captured.toFixed(3) + ' → ' + rmse.corrected.toFixed(3);
  draw();
})();
