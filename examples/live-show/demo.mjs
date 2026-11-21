import {
  createLiveAudioRouter, createMidiBeatClock, createMidiTimecode, timecodeAt, sampleLinkClock,
  createProjectionMapper, patchDmx, connectShowBridge
} from '../../show-control.mjs';
import { makeLoop, makeLtcLoop, paintSignal } from './signals.mjs';

const el = id => document.getElementById(id);
const source = document.createElement('canvas');
source.width = 920; source.height = 504;
const tickClock = createMidiBeatClock(), midiClock = createMidiBeatClock(), mtc = createMidiTimecode();
const showStart = performance.now() / 1000;
let lastTick = -1, cue = 0, blackout = false, lastFrame, lastMeter, bridge, bridgeState = {}, armed = false;
let audio, router, pulse, tone, externalAudio, musicStream, stopMusicStream, ltc, ltcGeneration = 0, incomingCode;
const url = globalThis.INK_SHOW_LTC_WORKLET ?? new URL('../../src/show/ltc-worklet.mjs', import.meta.url);
const shaderNamespace = 'http://www.w3.org/2000/svg';
let popup, projector, mapper, selection = 0, projectionDrag;
const mapped = el('mapped'), guides = el('guides');
const original = [
  { id: 'left', source: 'signal', corners: [[.058,.15],[.56,.07],[.56,.87],[.094,.92]],
    crop: [0,0,.56,1], edges: [0,0,.23,0] },
  { id: 'right', source: 'signal', corners: [[.443,.092],[.942,.153],[.918,.917],[.443,.885]],
    crop: [.443,0,1,1], edges: [.23,0,0,0] }
];
let surfaces = structuredClone(original);

const fixtures = Array.from({ length: 3 }, (_, i) => ({
  id: ['Wash A', 'Wash B', 'Backlight'][i], address: i * 4 + 1, channels: ['dimmer','red','green','blue']
}));
const lampColors = [
  [[.34,.47,1],[.22,.95,.9],[.7,.37,1]],
  [[1,.34,.18],[1,.66,.22],[.97,.25,.48]],
  [[.7,.34,1],[1,.45,.76],[.24,.78,.91]]
];
const fixed = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const getFps = () => {
  const value = el('fps').value;
  return value === '29.97' ? 30000 / 1001 : value === '23.976' ? 24000 / 1001 : Number(value);
};

function selectCue(value) {
  if (!Number.isInteger(value) || value < 0 || value >= lampColors.length) return;
  cue = value;
  for (const button of document.querySelectorAll('.cue')) button.setAttribute('aria-pressed', Number(button.dataset.cue) === cue);
}
const preview = fixtures.map(({ id }) => {
  const card = document.createElement('div'), lamp = document.createElement('span'), label = document.createElement('output');
  card.className = 'fixture';
  label.textContent = id;
  card.append(lamp, label);
  el('fixtures').append(card);
  return [lamp, label];
});
for (const button of document.querySelectorAll('.cue')) button.onclick = () => selectCue(Number(button.dataset.cue));
el('blackout').onclick = () => {
  blackout = !blackout; el('blackout').setAttribute('aria-pressed', blackout);
  stageFrame(lastFrame?.phase ?? 0, lastFrame?.low ?? 0);
};

try { mapper = createProjectionMapper(mapped, surfaces); }
catch (error) { el('map-status').textContent = error.message; el('project').disabled = true; }
guides.setAttribute('preserveAspectRatio', 'none');
function drawGuides() {
  guides.replaceChildren();
  if (!el('guide-toggle').checked || !mapper) return;
  const svg = (name, fields) => {
    const item = document.createElementNS(shaderNamespace, name);
    for (const [key, value] of Object.entries(fields)) item.setAttribute(key, value);
    guides.append(item);
    return item;
  };
  surfaces.forEach((surface, index) => {
    svg('polygon', { points: surface.corners.map(([x,y]) => [x * 920, y * 504].join(',')).join(' ') });
    if (index === selection) surface.corners.forEach(([x,y], corner) => {
      const item = svg('circle', { cx: x * 920, cy: y * 504, r: 8, 'data-corner': corner,
        'data-active': projectionDrag?.corner === corner, tabindex: 0, role: 'button',
        'aria-label': ['Top left','Top right','Bottom right','Bottom left'][corner] + ' corner. Use arrow keys to move.' });
      item.onkeydown = event => {
        const delta = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }[event.key];
        if (!delta) return;
        event.preventDefault();
        if (moveCorner(corner, [x + delta[0] * .006, y + delta[1] * .006]))
          guides.querySelector('[data-corner="' + corner + '"]')?.focus();
      };
    });
  });
}
function applySurfaces(next) {
  if (!mapper || !Array.isArray(next) || next.length !== 2 || next.some(surface => surface.source !== 'signal'))
    throw new TypeError('This patch needs two surfaces using the signal source');
  mapper.setSurfaces(next);
  projector?.setSurfaces(next);
  surfaces = next;
  drawGuides();
}
function moveCorner(corner, position) {
  const next = structuredClone(surfaces);
  next[selection].corners[corner] = position.map(value => clamp(value, 0, 1));
  try {
    applySurfaces(next);
    el('map-status').textContent = 'Projection corners updated.';
    return true;
  } catch (error) {
    el('map-status').textContent = error.message;
    return false;
  }
}
guides.onpointerdown = event => {
  if (event.target.dataset.corner === undefined) return;
  projectionDrag = { corner: Number(event.target.dataset.corner), pointer: event.pointerId };
  guides.setPointerCapture(event.pointerId);
};
guides.onpointermove = event => {
  if (projectionDrag?.pointer !== event.pointerId) return;
  const box = guides.getBoundingClientRect();
  moveCorner(projectionDrag.corner, [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]);
};
for (const key of ['onpointerup', 'onpointercancel', 'onlostpointercapture']) guides[key] = () => { projectionDrag = undefined; drawGuides(); };
el('surface').onchange = event => {
  selection = Number(event.target.value);
  el('blend').value = surfaces[selection].edges[selection === 0 ? 2 : 0];
  drawGuides();
};
el('blend').oninput = event => {
  const next = structuredClone(surfaces);
  next[selection].edges[selection === 0 ? 2 : 0] = Number(event.target.value);
  applySurfaces(next);
};
el('guide-toggle').onchange = drawGuides;
el('reset-map').onclick = () => {
  applySurfaces(structuredClone(original));
  el('blend').value = .23;
  el('map-status').textContent = 'Default mapping restored.';
};
el('save-map').onclick = () => {
  const blob = new Blob([JSON.stringify({ format: 'ink-studio/projection', surfaces }, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = href; link.download = 'ink-projection.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};
el('load-map').onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 32000) throw new Error('Projection map exceeds the size limit');
    const data = JSON.parse(await file.text());
    if (data.format !== 'ink-studio/projection') throw new Error('Expected an Ink projection map');
    applySurfaces(data.surfaces);
    el('surface').dispatchEvent(new Event('change'));
    el('map-status').textContent = 'Loaded ' + file.name;
  } catch (error) { el('map-status').textContent = error.message; }
  finally { event.target.value = ''; }
};
el('project').onclick = () => {
  if (popup && !popup.closed) { popup.focus(); return; }
  popup = window.open('', 'ink-projector', 'popup,width=920,height=504');
  if (!popup) { el('map-status').textContent = 'Allow the pop-up to open a projector feed.'; return; }
  const doc = popup.document, canvas = doc.createElement('canvas');
  doc.title = 'Ink Studio Projector';
  doc.body.style.cssText = 'margin:0;background:black;overflow:hidden';
  canvas.style.cssText = 'width:100vw;height:100vh;display:block';
  canvas.title = 'Double-click for full screen';
  canvas.ondblclick = () => void canvas.requestFullscreen().catch(() => {});
  doc.body.append(canvas);
  try {
    projector = createProjectionMapper(canvas, surfaces);
    const fit = () => {
      if (popup.closed) return;
      const limit = canvas.getContext('webgl2').getParameter(canvas.getContext('webgl2').MAX_VIEWPORT_DIMS);
      canvas.width = Math.min(limit[0], Math.max(1, Math.round(popup.innerWidth * popup.devicePixelRatio)));
      canvas.height = Math.min(limit[1], Math.max(1, Math.round(popup.innerHeight * popup.devicePixelRatio)));
    };
    fit();
    popup.addEventListener('resize', fit);
    popup.addEventListener('pagehide', () => { projector?.dispose(); projector = undefined; });
    el('map-status').textContent = 'Move the projector window to the display and double-click for full screen.';
  } catch (error) { popup.close(); el('map-status').textContent = error.message; }
};
window.addEventListener('pagehide', () => { if (popup && !popup.closed) popup.close(); });
drawGuides();

function clip(id, buffer, start = audio.currentTime) {
  const node = audio.createBufferSource();
  node.buffer = buffer; node.loop = true;
  const detach = router.attach(id, node);
  node.onended = detach;
  node.start(start);
  return node;
}
async function audioReady() {
  if (!audio) {
    audio = new AudioContext();
    router = createLiveAudioRouter(audio);
    for (const id of ['pulse','tone','file','mic']) {
      router.addBus(id);
      router.send(id, 'main');
    }
    router.setGain('pulse', Number(el('pulse-gain').value));
    router.setGain('tone', Number(el('tone-gain').value));
    router.setPan('pulse', -.15); router.setPan('tone', .15);
  }
  await audio.resume();
  el('audio-status').textContent = 'Live mix · ' + (el('monitor').checked ? 'monitor on' : 'monitor muted');
}
function audioError(error) { el('audio-status').textContent = error.message; }
el('play').onclick = async () => {
  try {
    await audioReady();
    if (pulse) {
      pulse.stop(); tone.stop(); pulse = tone = null;
      el('play').textContent = 'Start audio demo';
    } else {
      const first = makeLoop(audio, 'pulse'), second = makeLoop(audio, 'tone'), at = audio.currentTime + .045;
      pulse = clip('pulse', first, at); tone = clip('tone', second, at);
      el('play').textContent = 'Stop audio demo';
    }
  } catch (error) { audioError(error); }
};
for (const id of ['pulse','tone']) el(id + '-gain').oninput = event => router?.setGain(id, Number(event.target.value));
el('monitor').onchange = async event => {
  try { await audioReady(); router.setMonitor(Number(event.target.checked)); }
  catch (error) { audioError(error); }
};
el('audio-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('Demo accepts audio files up to 64 MiB');
    await audioReady();
    const buffer = await audio.decodeAudioData(await file.arrayBuffer());
    externalAudio?.stop();
    externalAudio = clip('file', buffer);
    el('stop-file').hidden = false;
    el('audio-status').textContent = 'Looping ' + file.name;
  } catch (error) { audioError(error); }
  finally { event.target.value = ''; }
};
el('stop-file').onclick = () => {
  externalAudio?.stop();
  externalAudio = null;
  el('stop-file').hidden = true;
  el('audio-status').textContent = 'Audio file stopped';
};
el('mic').onclick = async () => {
  try {
    if (musicStream) stopMusicStream();
    else {
      await audioReady();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const detach = router.attach('mic', audio.createMediaStreamSource(stream));
      musicStream = stream;
      const track = stream.getAudioTracks()[0];
      stopMusicStream = () => {
        if (musicStream !== stream) return;
        musicStream = null;
        detach();
        stream.getTracks().forEach(item => item.stop());
        el('mic').textContent = 'Add microphone';
      };
      track.addEventListener('ended', stopMusicStream, { once: true });
      el('mic').textContent = 'Stop microphone';
    }
  } catch (error) { audioError(error); }
};

let midiAccess, selectedMidi, workletModule;
function bindMidi() {
  if (selectedMidi) selectedMidi.onmidimessage = null;
  selectedMidi = midiAccess?.inputs.get(el('midi-input').value);
  if (selectedMidi) selectedMidi.onmidimessage = ({ data, timeStamp }) => {
    const at = timeStamp / 1000;
    midiClock.push(data, at);
    const code = mtc.push(data);
    if (code) incomingCode = { ...code, at };
  };
}
function midiList() {
  const select = el('midi-input'), current = select.value;
  select.replaceChildren(...Array.from(midiAccess.inputs.values(), input => new Option(input.name ?? input.id, input.id)));
  if (midiAccess.inputs.has(current)) select.value = current;
  select.disabled = !select.options.length;
  bindMidi();
}
el('midi-input').onchange = bindMidi;
el('midi-connect').onclick = async () => {
  try {
    if (!navigator.requestMIDIAccess) throw new Error('Use a browser with Web MIDI support.');
    try { midiAccess = await navigator.requestMIDIAccess({ sysex: true }); }
    catch { midiAccess = await navigator.requestMIDIAccess(); }
    midiAccess.onstatechange = midiList;
    midiList();
    el('clock-source').value = 'midi';
    await configureClock();
  } catch (error) { el('clock-status').textContent = error.message; }
};
async function configureClock() {
  const next = ++ltcGeneration, kind = el('clock-source').value;
  if (ltc) { ltc.stop(); ltc = null; }
  incomingCode = null;
  if (kind !== 'ltc' && kind !== 'ltc-demo') return;
  try {
    await audioReady();
    workletModule ??= audio.audioWorklet.addModule(url);
    await workletModule;
    if (next !== ltcGeneration) return;
    const fps = getFps(), input = kind === 'ltc' ? await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }) : null;
    if (next !== ltcGeneration) { input?.getTracks().forEach(track => track.stop()); return; }
    const node = new AudioWorkletNode(audio, 'ink-ltc', { processorOptions: { fps }, numberOfOutputs: 0 });
    const origin = input ? audio.createMediaStreamSource(input) : audio.createBufferSource();
    origin.connect(node);
    node.port.onmessage = ({ data }) => { if (next === ltcGeneration) incomingCode = { ...data, at: performance.now() / 1000 }; };
    if (!input) { origin.buffer = makeLtcLoop(audio, fps); origin.loop = true; origin.start(); }
    ltc = { stop() { if (input) input.getTracks().forEach(track => track.stop()); else origin.stop(); origin.disconnect(); node.port.close(); } };
  } catch (error) {
    if (next === ltcGeneration) {
      el('clock-source').value = 'demo';
      el('audio-status').textContent = 'LTC input: ' + error.message;
    }
    workletModule = null;
  }
}
el('clock-source').onchange = configureClock;
el('fps').onchange = configureClock;

let lastOsc;
if (location.protocol !== 'file:') {
  void connectShowBridge().then(connection => {
    bridge = connection;
    el('arm').disabled = !connection.capabilities.dmx;
    el('stage-status').textContent = 'Bridge connected · OSC input ' + connection.capabilities.oscInput;
    let pending = false;
    setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        bridgeState = await bridge.read(AbortSignal.timeout(700));
        const message = bridgeState.osc;
        if (message && message.sentAt !== lastOsc) {
          lastOsc = message.sentAt;
          if (message.address === '/ink/cue') selectCue(message.args[0]);
          if (message.address === '/ink/master' && Number.isFinite(message.args[0]))
            el('master').value = clamp(message.args[0], 0, 1);
        }
      } catch { bridgeState = {}; }
      finally { pending = false; }
    }, 75);
  }).catch(() => {});
}
function armLabel() {
  el('arm').textContent = armed ? 'Disarm hardware' : 'Arm hardware';
  el('stage-mode').textContent = armed ? bridge.capabilities.dmx.toUpperCase() + ' · armed' : 'Simulation';
}
el('arm').onclick = async () => {
  if (!bridge?.capabilities.dmx) return;
  el('arm').disabled = true;
  try {
    if (armed) {
      armed = false;
      await bridge.disarm();
    } else {
      await bridge.arm();
      armed = true;
    }
  } catch (error) { el('stage-status').textContent = error.message; }
  finally { armLabel(); el('arm').disabled = false; }
};

let lastSend = 0, sending = false;
function stageFrame(phase, low, now = performance.now()) {
  const master = blackout ? 0 : Number(el('master').value);
  const levels = Object.fromEntries(fixtures.map((fixture, i) => {
    const [red, green, blue] = lampColors[cue][i];
    const pulse = .42 + .48 * ((1 - phase + i / 3) % 1) ** 2 + .10 * low;
    return [fixture.id, { dimmer: master * pulse, red, green, blue }];
  }));
  const channels = patchDmx(fixtures, levels);
  preview.forEach(([lamp, label], i) => {
    const offset = i * 4, dimmer = channels[offset] / 255;
    const rgb = Array.from(channels.slice(offset + 1, offset + 4), n => Math.round(n * dimmer));
    lamp.style.background = 'rgb(' + rgb.join(' ') + ')';
    lamp.style.boxShadow = '0 0 1.25rem rgb(' + rgb.join(' ') + ' / .65)';
    label.textContent = fixtures[i].id + ' · ' + channels[offset];
  });
  if (armed && !sending && now - lastSend >= 70) {
    sending = true; lastSend = now;
    void bridge.dmx(channels).catch(error => {
      armed = false; armLabel();
      el('stage-status').textContent = error.message;
    }).finally(() => { sending = false; });
  }
}
function wave() {
  const canvas = el('wave'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const signal = router?.waveform('main');
  ctx.clearRect(0, 0, w, h); ctx.beginPath();
  ctx.strokeStyle = signal ? '#faca88' : '#736079';
  for (let x = 0; x < w; x++) {
    const y = h * (.5 - .46 * (signal?.[Math.floor(x * signal.length / w)] ?? 0));
    if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
function update(nowMs) {
  const now = nowMs / 1000, t = Math.max(0, now - showStart);
  if (lastTick < 0) tickClock.push([0xfa], showStart);
  const tick = Math.floor(t * 48);
  if (tick - lastTick > 240) lastTick = tick - 240;
  while (lastTick < tick) tickClock.push([0xf8], showStart + (++lastTick) / 48);
  const demo = tickClock.sample(now), selected = el('clock-source').value;
  let beat = demo, code = null, label = 'Simulated MIDI ticks and frame count.';
  switch (selected) {
    case 'midi':
      beat = midiClock.sample(now);
      code = incomingCode;
      label = selectedMidi ? (beat.locked ? 'MIDI Clock locked' : 'Waiting for MIDI Clock') : 'Connect and select a MIDI input.';
      break;
    case 'ltc':
    case 'ltc-demo':
      code = incomingCode;
      label = code && now - code.at < .4 ? 'Locked to decoded LTC audio.' : 'Waiting for LTC audio.';
      break;
    case 'link':
      beat = sampleLinkClock(bridgeState.link) ?? { beat: 0, phase: 0 };
      label = beat.locked ? 'Ableton Link · ' + beat.peers + ' peers · ' + (beat.playing ? 'playing' : 'stopped') : 'Waiting for the Ableton Link companion.';
      break;
    case 'art':
      code = bridgeState.timecode;
      label = code && Date.now() - code.sentAt < 500 ? 'ArtTimeCode received over UDP.' : 'Waiting for ArtTimeCode.';
      break;
    default:
      code = timecodeAt(Math.floor(t * 30) + 108000, { fps: 30 });
  }
  const meter = router?.read('main'), low = meter?.bands.low ?? 0, phase = beat.phase ?? 0;
  if (el('clock-status').textContent !== label) el('clock-status').textContent = label;
  el('timecode').textContent = code?.label ?? '––:––:––:––';
  el('bpm').textContent = fixed(beat.bpm) + ' BPM';
  for (const [i, item] of Array.from(el('beats').children).entries()) item.classList.toggle('active', i === ((Math.floor(beat.beat) % 4 + 4) % 4));
  if (!lastMeter || nowMs - lastMeter > 45) {
    lastMeter = nowMs;
    el('rms').textContent = fixed(meter?.rms > 0 ? 20 * Math.log10(meter.rms) : null) + ' dBFS';
    for (const id of ['pulse','tone']) el(id + '-meter').value = clamp(router?.read(id).peak ?? 0, 0, 1);
    wave();
    stageFrame(phase, low, nowMs);
  }
  lastFrame = { phase, low };
  const clockTime = code && selected !== 'demo' ? code.time : beat.beat / 2;
  paintSignal(source, clockTime, phase, low, cue);
  mapper?.render({ signal: source });
  if (popup && !popup.closed) projector?.render({ signal: source });
  requestAnimationFrame(update);
}
requestAnimationFrame(update);
