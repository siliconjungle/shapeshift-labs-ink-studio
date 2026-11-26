(() => {
  const { graph, graphImages: I } = KIT.procedural;
  const status = document.getElementById('status');
  try {
    const runtime = graph.create(relayGraph);
    const entry = name => document.getElementById(name);
    const canvas = entry('surface'), context = canvas.getContext('2d');
    const { enamelGain, glazeSettings, stampSettings } = relayGraph.inputs;
    const modes = document.querySelectorAll('[data-view]'), pigments = document.querySelectorAll('[data-pigment]');
    const labels = { lit: 'Lit material', baseColor: 'Pigment', height: 'Height · millimeters',
      normal: 'Tangent normals', roughness: 'Roughness' };
    let pigment = 'jade', mode = 'lit', frame = 0, dirty = true, material;
    const palette = Object.fromEntries([...pigments].map(({dataset}) =>
      [dataset.pigment, LanternRelay.pigment(I, enamelGain.default, dataset.pigment)]));
    const matte = I.uniform(.79, 1, 1, { intent: 'data' });
    function draw() {
      frame = 0;
      const x = Number(entry('stamp-x').value), angle = Number(entry('stamp-turn').value);
      if (dirty) {
        const enamelEdits = {};
        if (pigment !== 'jade') enamelEdits.baseColor = palette[pigment];
        if (entry('finish').value === 'matte') enamelEdits.roughness = matte;
        const glaze = { ...glazeSettings.default, height: entry('dominance').checked ? glazeSettings.default.height : null };
        const mark = { ...stampSettings.default, opacity: Number(entry('stamp').checked),
          transform: { ...stampSettings.default.transform, offset: [x / 100, .15], rotation: angle } };
        material = runtime.evaluate({ enamelEdits, glazeSettings: glaze, stampSettings: mark }).outputs.material;
        dirty = false;
      }
      const { width, height, pixels } = LanternRelay.render(material, mode, Number(entry('light').value));
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      entry('x-value').value = x + '%';
      entry('turn-value').value = angle + '°';
      status.textContent = labels[mode] + ' · ' + (entry('dominance').checked ? 'Raised brass protected' : 'Height dominance off');
    }
    function request(recompute) {
      dirty ||= recompute;
      if (!frame) frame = requestAnimationFrame(draw);
    }
    function press(buttons, selected) {
      for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
    }
    for (const button of modes) button.addEventListener('click', () => {
      mode = button.dataset.view;
      press(modes, button);
      request(false);
    });
    for (const button of pigments) button.addEventListener('click', () => {
      pigment = button.dataset.pigment;
      press(pigments, button);
      request(true);
    });
    for (const id of ['finish', 'dominance', 'stamp', 'stamp-x', 'stamp-turn'])
      entry(id).addEventListener('input', () => request(true));
    entry('light').addEventListener('input', () => request(false));
    draw();
  } catch (error) {
    status.textContent = error.message;
    throw error;
  }
})();
