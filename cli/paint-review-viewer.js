(() => {
  const $ = id => document.getElementById(id);
  const { scene, subject, width, height, time, rig, views } = paintReview;
  const modes = {
    neutral: ['Neutral pigment', 'Registered base color under uniform light.'],
    lit: ['Directional light', 'The same pigment with the raised surface and finish under the moving key.'],
    relief: ['Relief', 'A monochrome rake across the sampled shading normals.'],
    roughness: ['Roughness', 'Dark pixels are smoother. Blank areas have no captured roughness.'],
    highlights: ['Highlights', 'Direct specular response from the same key and visible samples.'],
    authored: ['Authored shot', 'The scene rendered with its authored lights and look.']
  };
  const label = text => text.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, s => s.toUpperCase());
  const baseline = Math.max(0, views.findIndex(view => view.range === 1));
  $('title').textContent = scene ? label(String(scene)) : 'Paint lighting review';
  $('target').textContent = (subject ? 'Subject ' + subject.object + (subject.part ? ' / ' + subject.part : '') : 'Full scene') +
    ' · pose ' + time + ' s';
  $('native').textContent = width + ' × ' + height + ' native pixels';
  const light = $('light');
  light.min = 0;
  light.max = rig.keys.length - 1;
  light.step = 1;
  light.value = Math.max(0, Math.floor(rig.keys.length / 2) - 1);
  const panels = ['left','right'].map((id, index) => {
    const panel = $(id), mode = panel.querySelector('[data-mode]'), range = panel.querySelector('[data-range]');
    for (const [value,[title]] of Object.entries(modes)) mode.add(new Option(title, value));
    for (const [i, view] of views.entries()) {
      const prefix = view.range < 1 ? 'Close' : view.range > 1 ? 'Wide' : 'Reference';
      range.add(new Option(prefix + ' · ' + view.range + '×', i));
    }
    mode.value = index ? 'lit' : 'neutral';
    range.value = baseline;
    mode.addEventListener('change', redraw);
    range.addEventListener('change', redraw);
    return { mode, range, img:panel.querySelector('img'), title:panel.querySelector('h2'),
      description:panel.querySelector('[data-description]'), evidence:panel.querySelector('[data-evidence]') };
  });
  function redraw() {
    const key = Number(light.value), angle = rig.keys[key].azimuth;
    const value = Number(angle.toFixed(1));
    $('angle').value = (value > 0 ? '+' : '') + value + '°';
    light.setAttribute('aria-valuetext', value + ' degrees');
    for (const { mode, range, img, title, description, evidence } of panels) {
      const { coverage, registration, files } = views[Number(range.value)];
      const channel = mode.value, [name, help] = modes[channel];
      const image = files[channel] ?? files.keys[key][channel];
      if (img.getAttribute('src') !== image) img.src = image;
      img.alt = name + ' at ' + range.selectedOptions[0].textContent;
      title.textContent = name;
      description.textContent = help;
      const count = ['roughness','highlights'].includes(channel) ? registration.roughness :
        channel === 'relief' ? coverage.relightable : coverage.visible;
      evidence.textContent = count ? count.toLocaleString() + ' samples' : 'No samples';
    }
  }
  let timer, direction = 1;
  light.addEventListener('input', redraw);
  $('play').addEventListener('click', () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    } else timer = setInterval(() => {
      const at = Number(light.value);
      if (at + direction < 0 || at + direction > Number(light.max)) direction *= -1;
      light.value = at + direction;
      redraw();
    }, 230);
    $('play').setAttribute('aria-pressed', String(Boolean(timer)));
    $('play').textContent = timer ? 'Pause sweep' : 'Play sweep';
  });
  redraw();
})();
