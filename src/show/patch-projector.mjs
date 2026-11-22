import { createProjectionMapper } from './projection.mjs';

const canvas = document.querySelector('#picture');
const present = document.querySelector('#present');
const status = document.querySelector('#status');

function renderer(surfaces) {
  const source = surfaces.length ? document.createElement('canvas') : canvas;
  const context = source.getContext('2d');
  const mapper = surfaces.length ? createProjectionMapper(canvas, surfaces) : null;
  let hasPicture = false;
  function project() {
    if (!mapper || !hasPicture) return;
    const density = window.devicePixelRatio;
    const w = Math.min(4096, Math.max(1, Math.round(canvas.clientWidth * density)));
    const h = Math.min(4096, Math.max(1, Math.round(canvas.clientHeight * density)));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    mapper.render({ picture: source });
  }
  if (mapper) window.addEventListener('resize', project);
  return (pixels, width, height) => {
    if (source.width !== width || source.height !== height) { source.width = width; source.height = height; }
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    hasPicture = true;
    project();
  };
}

async function connectMidi(config, attached, headers) {
  let sending = false, statusEvent, messageEvent, input;
  async function send(event) {
    if (event.event === 'message') messageEvent = event;
    else statusEvent = { ...event, detail: event.detail.slice(0, 255) };
    if (sending) return;
    sending = true;
    try {
      await attached;
      while (statusEvent || messageEvent) {
        const next = statusEvent ?? messageEvent;
        if (statusEvent) statusEvent = undefined;
        else messageEvent = undefined;
        await fetch('/midi', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(next), signal: AbortSignal.timeout(2000) });
      }
    } catch { /* The projector may have stopped. */ }
    finally { sending = false; }
  }
  try {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI unavailable');
    const access = await navigator.requestMIDIAccess();
    function sync() {
      const selected = [...access.inputs.values()].find(port => port.state === 'connected' &&
        (config.input === undefined || config.input === port.name));
      if (selected !== input && input) input.onmidimessage = null;
      input = selected;
      if (input) input.onmidimessage = ({ data }) => {
        const type = data[0] & 0xf0;
        if ((data[0] & 15) + 1 !== config.channel || !(type === 0xc0 || type === 0x90 && data[2] > 0)) return;
        void send({ event: 'message', data: [...data] });
      };
      void send(input ? { event: 'online', detail: input.name || 'MIDI input' } : { event: 'offline', detail: 'MIDI input disconnected' });
    }
    access.addEventListener('statechange', sync);
    sync();
  } catch (error) { void send({ event: 'offline', detail: error.message || 'MIDI access failed' }); }
}

async function open() {
  const session = await fetch('/session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': crypto.randomUUID() };
  const draw = renderer(session.surfaces);
  let sequence = 0, snapshot = true, started = false, attach;
  const attached = new Promise(resolve => { attach = resolve; });
  async function pump() {
    let response;
    try { response = await fetch(snapshot ? '/snapshot' : '/frame?after=' + sequence,
      { headers, signal: AbortSignal.timeout(2000) }); }
    catch { snapshot = true; setTimeout(pump, 800); return; }
    if (response.status === 409) {
      snapshot = true;
      status.textContent = 'Another projector window is connected.';
      setTimeout(pump, 600);
      return;
    }
    if (!response.ok) { status.textContent = 'Projector connection ended.'; return; }
    attach();
    status.textContent = '';
    if (response.headers.has('x-ink-ended')) return;
    if (response.status === 200) {
      let pixels;
      try { pixels = await response.arrayBuffer(); }
      catch { snapshot = true; setTimeout(pump, 800); return; }
      try {
        draw(pixels, Number(response.headers.get('x-ink-width')), Number(response.headers.get('x-ink-height')));
        sequence = Number(response.headers.get('x-ink-serial'));
        snapshot = false;
      } catch { status.textContent = 'The projector could not draw the frame.'; return; }
    }
    requestAnimationFrame(pump);
  }
  function start() {
    if (started) return;
    started = true;
    void pump();
  }
  if (!session.wait) start();
  present.textContent = session.wait ? 'Start in full screen' : 'Enter full screen';
  present.hidden = false;
  present.addEventListener('click', () => {
    present.hidden = true;
    void document.documentElement.requestFullscreen().catch(() => {});
    start();
    if (session.midi) void connectMidi(session.midi, attached, headers);
  }, { once: true });
  canvas.addEventListener('dblclick', () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {}); });
}

open().catch(error => { status.textContent = error.message || 'Could not open the projector.'; });
