import { createRenderer } from '../../webgl.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view'), select = $('scene'), status = $('status');
const step = 1 / 60;

function open() {
  const kit = { KIT, makeBuilder, makeSculpt, courses, lilies, PixelLook, SpriteSurface, RenderStages, InkVeil };
  const scenes = rebirthGallery(kit);
  const query = new URLSearchParams(location.search);
  const entry = scenes.find(({ file }) => file === (location.hash.slice(1) || 'garden')) ?? scenes[0];
  const { scene, from, view } = entry;
  const canopy = query.get('canopy');
  const controls = canopy ? { canopy } : undefined;
  for (const { file, scene } of scenes) select.add(new Option(scene.name, file));
  select.value = entry.file;
  select.onchange = () => {
    location.hash = select.value;
    location.reload();
  };

  status.value = 'Building ' + scene.name + '…';
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const built = scene.build(scene.seed, { controls });
      built.id = scene.id;
      const world = scene.animate?.(built, scene.seed) ?? built;
      start(world, kit, entry, from, view);
    } catch (error) {
      status.value = error.message;
      canvas.dataset.error = error.message;
    }
  }, 0));
}

function start(world, kit, entry, from, view) {
  const home = { ...world.cam, ...view, dist: world.cam.dist / (view.zoom ?? 1) };
  const camera = { ...home }, keys = new Set();
  const control = world.rebirthInput;
  const renderer = createRenderer(canvas, { toolkit: kit });
  let time = 0, lag = 0, previous, paused = false, drag, report;

  function advance() {
    if (control) {
      const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
      const sin = Math.sin(camera.yaw), cos = Math.cos(camera.yaw);
      Object.assign(control, { move: x * cos + z * sin, mz: z * cos - x * sin, run: keys.has('ShiftLeft') });
    }
    time += step;
    world.anim?.update(step, time);
  }

  while (time + step / 2 < from) advance();
  if (control) {
    $('follow-control').hidden = false;
    $('controls').textContent += ' Focus the picture and use W A S D to walk. Hold left Shift to run.';
    canvas.addEventListener('keydown', event => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'].includes(event.code)) {
        keys.add(event.code);
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', event => keys.delete(event.code));
    canvas.addEventListener('blur', () => keys.clear());
  }

  $('play').disabled = $('reset').disabled = false;
  $('play').onclick = () => {
    paused = !paused;
    $('play').textContent = paused ? 'Play' : 'Pause';
  };
  $('reset').onclick = () => Object.assign(camera, home);
  canvas.onpointerdown = event => {
    drag = [event.clientX, event.clientY, camera.yaw, camera.pitch];
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!drag) return;
    camera.yaw = drag[2] - (event.clientX - drag[0]) * .007;
    camera.pitch = Math.max(-.18, Math.min(1.4, drag[3] + (event.clientY - drag[1]) * .007));
  };
  canvas.onlostpointercapture = () => { drag = undefined; };
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    camera.dist = Math.max(home.dist * .25, Math.min(home.dist * 3, camera.dist * Math.exp(event.deltaY * .002)));
  }, { passive: false });

  function draw(now) {
    if (previous !== undefined && !paused) lag += Math.min(.10, (now - previous) / 1000);
    previous = now;
    while (lag >= step) {
      advance();
      lag -= step;
    }
    const follow = control && $('follow').checked;
    try {
      renderer.render(world, {
        width: 240, height: 150, time, colored: false, dither: world.dither, damp: false, stepAnimation: false,
        camera: { ...camera, ...(follow && { target: world.dynamic.focus }) },
        ...(!report && { onCompatibility: value => { report = value; } })
      });
      if (!canvas.dataset.scene) {
        canvas.dataset.scene = entry.file;
        status.value = report.issues.map(issue => issue.code).join(' · ');
      }
      requestAnimationFrame(draw);
    } catch (error) {
      canvas.dataset.error = error.message;
      status.value = error.message;
      renderer.dispose();
    }
  }
  requestAnimationFrame(draw);
}

try { open(); }
catch (error) {
  status.value = error.message;
  canvas.dataset.error = error.message;
}
