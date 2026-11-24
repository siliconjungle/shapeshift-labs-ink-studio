(() => {
  const api = PixelLighting;
  const base = lanternCrossing();
  const flat = {
    ...base,
    assets: Object.fromEntries(Object.entries(base.assets).map(([id, asset]) => {
      const normalMap = Array.from({ length:asset.width * asset.height * 3 }, (_, i) => i % 3 === 2 ? 255 : 128);
      return [id, { ...asset, normalMap }];
    }))
  };
  const byId = id => document.getElementById(id);
  const canvas = document.querySelector('canvas'), view = document.querySelector('.view');
  const marker = document.querySelector('.marker'), report = byId('comparison'), backend = byId('backend');
  const sweep = byId('sweep'), shadows = byId('shadows'), normals = byId('normals');
  const gl = canvas.getContext('webgl2', { antialias:false, preserveDrawingBuffer:true });
  const cpu = gl ? null : canvas.getContext('2d');
  const pass = gl && createPixelLightingPass(gl, api);
  const packed = [api.prepare(flat), api.prepare(base)];
  const { width:w, height:h } = base;
  let lamp = base.lights[0].at.slice(), request = null, start = 0;
  for (const color of base.ramps[1]) {
    const swatch = document.createElement('i');
    swatch.style.backgroundColor = color;
    document.querySelector('.palette').append(swatch);
  }
  if (!pass) {
    backend.textContent = 'Headless renderer';
    byId('compare').disabled = true;
  }

  function options() {
    return { shadows:shadows.checked, lights:[{ ...base.lights[0], at:lamp.slice() }, base.lights[1]] };
  }

  function draw() {
    const scene = packed[Number(normals.checked)], lighting = options();
    if (pass) {
      const frame = pass.draw(scene, lighting);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, frame.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    } else {
      const frame = api.render(scene, lighting);
      cpu.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), w, h), 0, 0);
    }
    marker.style.left = lamp[0] / w * 100 + '%';
    marker.style.top = lamp[1] / h * 100 + '%';
    report.value = '';
  }

  function stop() {
    if (request !== null) cancelAnimationFrame(request);
    request = null;
    sweep.setAttribute('aria-pressed','false');
    sweep.textContent = 'Sweep lamp';
  }

  function cycle(now) {
    const t = (now - start) / 1000;
    lamp[0] = 64 - 38 * Math.cos(t * .85);
    lamp[1] = 38 + 23 * Math.sin(t * .85 - .15);
    draw();
    request = requestAnimationFrame(cycle);
  }

  function move(x, y) {
    stop();
    lamp[0] = Math.max(.5, Math.min(w - .5, Math.floor(x) + .5));
    lamp[1] = Math.max(.5, Math.min(h - .5, Math.floor(y) + .5));
    draw();
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    move((event.clientX - rect.left) * w / rect.width, (event.clientY - rect.top) * h / rect.height);
  }

  view.addEventListener('pointerdown', event => {
    view.setPointerCapture(event.pointerId);
    pointer(event);
  });
  view.addEventListener('pointermove', event => {
    if (view.hasPointerCapture(event.pointerId)) pointer(event);
  });
  view.addEventListener('keydown', event => {
    const axis = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[event.key];
    if (!axis) return;
    event.preventDefault();
    const step = event.shiftKey ? 6 : 1;
    move(lamp[0] + axis[0]*step, lamp[1] + axis[1]*step);
  });
  shadows.addEventListener('change', draw);
  normals.addEventListener('change', draw);
  sweep.addEventListener('click', () => {
    if (request !== null) return stop();
    start = performance.now();
    sweep.setAttribute('aria-pressed','true');
    sweep.textContent = 'Pause lamp';
    request = requestAnimationFrame(cycle);
  });
  byId('reset').addEventListener('click', () => {
    stop();
    lamp = base.lights[0].at.slice();
    shadows.checked = normals.checked = true;
    draw();
  });
  byId('compare').addEventListener('click', () => {
    stop();
    const input = packed[Number(normals.checked)], settings = options();
    const expected = api.render(input, settings).rgba, gpu = pass.draw(input, settings);
    const bytes = new Uint8Array(w*h*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    let different = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = (y*w+x)*4, b = ((h-1-y)*w+x)*4;
      if (bytes[a] !== expected[b] || bytes[a+1] !== expected[b+1] ||
          bytes[a+2] !== expected[b+2] || bytes[a+3] !== expected[b+3]) different++;
    }
    report.value = different ? different + ' pixels differ' : (w*h).toLocaleString('en-US') + ' pixels match';
  });
  byId('save').addEventListener('click', () => {
    const json = JSON.stringify({ ...(normals.checked ? base : flat), ...options() });
    const url = URL.createObjectURL(new Blob([json], { type:'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lantern-crossing.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  draw();
})();
