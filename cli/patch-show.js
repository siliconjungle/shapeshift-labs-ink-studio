const fs = require('node:fs');
const dgram = require('node:dgram');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay, setImmediate: yieldIO } = require('node:timers/promises');
const { readGraphProject } = require('./graph-project.js');
const { graphOutputs } = require('./graph-outputs.js');
const { patchNodes } = require('./patch-nodes.js');
const { createPatchGpu } = require('./patch-gpu.js');
const { videoFrames, audioSource } = require('./patch-media.js');
const { decodeOsc } = require('./show-protocols.js');
const { openProjector } = require('./patch-projector.js');
const { showReport } = require('./patch-show-report.js');
const { readShow, int } = require('./patch-show-config.js');
const { feed } = require('./live-world.js');
const InterventionInput = require('./patch-interventions.js');

function presetControl(config, project, report) {
  const worldInput = config.liveWorld && { [config.liveWorld.input]: null };
  const base = { ...config.inputs, ...worldInput };
  const values = new Map(Object.entries(config.presets).map(([name, preset]) => [name, { ...base, ...preset, ...worldInput }]));
  for (const inputs of values.values()) project.validate(inputs);
  project.validate(values.get(config.initial) ?? base);
  let active = config.initial, first = true, currentCue = 0, pending;
  return {
    select(preset, source) {
      if (!values.has(preset)) return false;
      pending = { preset, source };
      return true;
    },
    inputs(frame) {
      let change;
      while (config.cues[currentCue]?.frame <= frame) {
        const cue = config.cues[currentCue++];
        if(change)report.cueLink(change.scheduledFrame,'superseded');
        change = { preset: cue.preset, source: 'cue', scheduledFrame: cue.frame, ...(cue.clockCue&&{clockCue:cue.clockCue}),
          ...(cue.beatId&&{beatId:cue.beatId}) };
      }
      if(change)report.cueLink(change.scheduledFrame,pending?'superseded':'applied');
      change = pending ?? change ?? (first && active !== undefined ? { preset: active, source: 'initial' } : undefined);
      if (change) { active = change.preset; report.preset(change); }
      first = false;
      pending = undefined;
      return values.get(active) ?? base;
    }
  };
}

async function openOsc(config, control, report) {
  const socket = dgram.createSocket('udp4');
  let lastMessage, failure;
  socket.on('message', packet => {
    try {
      const { address, args } = decodeOsc(packet);
      if (address === config.address && args.length === 1 && control.select(args[0], 'osc')) {
        lastMessage = performance.now();
        failure = undefined;
        report.source('osc', 'online');
      }
    } catch { /* Unrelated UDP traffic has no effect on the show. */ }
  });
  try {
    socket.bind(config.port, config.host);
    await once(socket, 'listening');
  } catch (error) {
    try { socket.close(); } catch { /* The socket may have closed during bind. */ }
    report.source('osc', 'offline', error.message);
    return;
  }
  socket.on('error', error => { failure = error; report.source('osc', 'offline', error.message); });
  if (!lastMessage) report.source('osc', config.idleMs ? 'waiting' : 'online');
  return {
    port: socket.address().port,
    check(started) {
      if (config.idleMs && !failure && performance.now() - Math.max(started, lastMessage ?? 0) >= config.idleMs)
        report.source('osc', 'offline', 'No matching OSC preset messages within idleMs');
    },
    close() { return new Promise(resolve => socket.close(resolve)); }
  };
}

function midiControl(config, control, report) {
  let status = 'waiting', detail;
  return {
    reset() { status = 'waiting'; detail = undefined; },
    push(value) {
      if (['online', 'offline'].includes(value?.event) && typeof value.detail === 'string' && value.detail.length <= 255) {
        status = value.event;
        detail = value.detail;
        report.source('midi', status, detail);
        return;
      }
      const data = value?.data;
      if (value?.event !== 'message' || !Array.isArray(data) || ![2, 3].includes(data.length) ||
          !int(data[0], 128, 239) || !data.slice(1).every(byte => int(byte, 0, 127))) throw new TypeError('Invalid MIDI message');
      if (status !== 'online' || (data[0] & 15) + 1 !== config.channel) return;
      const type = data[0] & 0xf0;
      if (type === 0x90 && data.length === 3 && data[2] > 0) control.select(config.notes[data[1]], 'midi');
      if (type === 0xc0 && data.length === 2) control.select(config.programs[data[1]], 'midi');
    },
    check(connected, graceExpired) {
      if (!connected && (status === 'online' || graceExpired)) report.source('midi', 'offline', 'Projector MIDI client unavailable');
      else if (status === 'waiting' && graceExpired) report.source('midi', 'offline', 'MIDI input unavailable');
      else report.source('midi', status, detail);
    }
  };
}

function openVideo(input, options, fallback, timeout, report) {
  const opened = performance.now(), buffer = input === '-' ? null : [];
  const { signal } = options;
  let latest, arrived, ended, sequence = 0, used = 0, signalReady, unpause;
  const first = new Promise(resolve => { signalReady = resolve; });
  function resume() { unpause?.(); unpause = undefined; }
  report.source('video', 'waiting');
  signal.addEventListener('abort', resume, { once: true });
  const done = (async () => {
    try {
      for await (const value of videoFrames(input, options)) {
        arrived = performance.now();
        const item = { value, number: ++sequence };
        if (buffer) buffer.push(item);
        else latest = item;
        // Files use a bounded lookahead. Live stdin always keeps the most recent frame.
        if (!buffer || buffer.length === 4) signalReady();
        if (buffer?.length === 4) await new Promise(resolve => { unpause = resolve; });
        if (signal.aborted) break;
      }
      ended = 'Video source reached EOF';
    } catch (error) { ended = error.message; }
    finally { signalReady(); signal.removeEventListener('abort', resume); }
  })();
  return {
    done,
    async ready() {
      await Promise.race([first, delay(timeout, undefined, { signal: options.signal, ref: false })]);
      if (!sequence) report.source('video', 'offline', ended ?? 'Video frame timeout');
    },
    sample(index) {
      if (buffer) {
        while (buffer[0]?.number <= index + 1) latest = buffer.shift();
        if (buffer.length < 4) resume();
      }
      const { number = 0, value } = latest ?? {};
      if (number > used) {
        report.source('video', 'online');
        report.video('received', number - used - 1);
        used = number;
      } else {
        const issue = ended ?? (performance.now() - (arrived ?? opened) >= timeout ? 'Video frame timeout' : undefined);
        if (issue) report.source('video', 'offline', issue);
        report.video(value ? 'repeated' : 'fallback');
      }
      return value ?? fallback;
    }
  };
}

async function showSlot(first, start, period, signal) {
  const target = start + first * period;
  // Even when evaluation is behind the clock, let media, projector and control I/O run.
  await yieldIO(undefined, { signal });
  for (let remaining = target - performance.now(); remaining > 1; remaining = target - performance.now())
    await delay(Math.floor(remaining), undefined, { signal });
  signal.throwIfAborted();
  return Math.max(first, Math.floor((performance.now() - start) / period));
}

async function runShow(file, opt, settings, emit) {
  const config = await readShow(file, opt.rehearse, settings.kit), report = showReport(config, opt.rehearse);
  const { fps, frames, projector, video, audio, dimensions, liveWorld } = config, period = 1000 / fps;
  const output = opt.report && path.resolve(opt.report);
  const interventionInput = InterventionInput.settings(opt, liveWorld, output);
  if (video === '-' && interventionInput?.source === '-')
    throw new TypeError('Video and intervention input cannot both read stdin');
  const media = {}, gpu = createPatchGpu(path.dirname(config.patch), opt['gpu-module']);
  const operations = { ...settings.operations, ...patchNodes(settings.kit, media, gpu) };
  const project = readGraphProject(config.patch, { ...settings, operations });
  const plan = project.plan();
  if (!Object.hasOwn(plan.outputs, config.output)) throw new TypeError('Unknown projector output ' + config.output);
  if (liveWorld && plan.inputs[liveWorld.input]?.type !== 'liveSnapshot')
    throw new TypeError('Show liveWorld needs a liveSnapshot patch input');
  const watch = { picture: { output: config.output } }, control = presetControl(config, project, report);
  const live = liveWorld && feed(settings.kit.KIT.world, liveWorld, (state, reason) => report.source('world', state, reason));
  const protectedFiles = [...project.sourceFiles(), ...config.assetFiles, file, config.cueSource, video, audio,
    interventionInput?.source].filter(source =>
    source && !['-', 'video'].includes(source) && fs.existsSync(source));
  const writer = output && graphOutputs(protectedFiles);
  writer?.protect(fs.statSync(output, { throwIfNoEntry: false }));
  const abort = new AbortController(), { signal } = abort, raster = settings.kit.KIT.procedural.raster;
  let interrupted, projection, osc, capture, interventions, failure, attached = false;
  const midi = config.midi && midiControl(config.midi, control, report);
  const mediaOptions = { ...dimensions, rate: String(config.rate), executable: opt.ffmpeg, signal };
  const interrupt = code => { interrupted = code; abort.abort(new Error('Show interrupted')); };
  const onInt = () => interrupt(130), onTerm = () => interrupt(143);
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  function checkSources(start, done = false) {
    if (projection.failure) throw projection.failure;
    if (attached && !projection.connected) report.source('projector', 'offline', 'Projector stopped polling');
    midi?.check(projection.connected, done || performance.now() - start >= 2000);
    osc?.check(start);
  }
  try {
    if (interventionInput) {
      interventions = InterventionInput.open(settings.kit.KIT, interventionInput, liveWorld,
        { fps, rehearse: opt.rehearse, report });
      report.interventionMode(interventions.mode);
    }
    report.source('projector', 'waiting');
    if (midi) report.source('midi', 'waiting');
    projection = await openProjector(projector, config.midi, {
      afterFrame: skipped => report.displayed(skipped),
      afterAttach(replaced) { attached = true; if (replaced) midi?.reset(); report.source('projector', 'online'); },
      onMidi: value => midi.push(value)
    });
    if (config.osc) osc = await openOsc(config.osc, control, report);
    await emit({ event: 'show-ready', projector: projection.url, wait: projector.wait, fps, oscPort: osc?.port,
      ...(interventions && { interventions: interventions.mode }) });
    if (projector.wait) await projection.wait(signal);
    if (audio) {
      try {
        media.audio = await audioSource(audio, { ...mediaOptions, video, duration: frames / fps });
        report.source('audio', 'online');
      } catch (error) {
        signal.throwIfAborted();
        media.audio = { sampleRate: 48000, channels: 1, samples: new Float32Array(48000) };
        report.source('audio', 'offline', error.message);
      }
    }
    if (video) {
      capture = openVideo(video, mediaOptions, raster.canvas({ ...dimensions, color: [0, 0, 0, 255] }), config.videoTimeoutMs, report);
      await capture.ready();
    }
    if (live) {
      report.source('world', 'waiting');
      await live.warm();
    }
    const start = performance.now();
    for (let next = 0; next < frames;) {
      const index = Math.min(frames, await showSlot(next, start, period, signal));
      report.schedule(next, index);
      if (index === frames) break;
      report.frame(index);
      checkSources(start);
      if (capture) media.frame = capture.sample(index);
      const preset = control.inputs(index), inputs = live ? { ...preset, [liveWorld.input]: live.sample() } : preset;
      const before = performance.now();
      const result = await project.previewFrame(watch, { inputs, time: index / fps }, { profile: true, encodeArtifacts: false });
      for(const [output,value] of Object.entries(result.outputs))
        for(const link of settings.kit.KIT.world.inspectionLinks.references(value))report.graphLink(output,link);
      signal.throwIfAborted();
      const drawn = performance.now();
      report.stage('graph', drawn - before);
      for (const [node, ms] of Object.entries(result.report.timingsMs ?? {})) report.stage('node:' + node, ms);
      const picture = result.values.picture;
      if (picture?.colorSpace === 'srgb-linear' || !(picture?.width * picture?.height <= 1048576))
        throw new TypeError('Projector output needs a display raster up to 1,048,576 pixels');
      projection.publish(index, raster.rgba(picture));
      report.stage('output', performance.now() - drawn);
      report.rendered(result.report.passed);
      interventions?.observe(index, live.cursor(), result.report.passed);
      next = index + 1;
    }
    interventions?.stop();
    projection.end();
    if (projection.connected) await delay(Math.max(100, period), undefined, { signal });
    checkSources(start, true);
  } catch (error) { if (!interrupted) failure = error; }
  finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    abort.abort(new Error('Show ended'));
    try {
      const closed = await Promise.allSettled([capture?.done, projection?.close(), osc?.close(), live?.close(),
        interventions?.close()]);
      failure ??= closed.find(result => result.status === 'rejected')?.reason;
      project.clear();
    } catch (error) { failure ??= error; }
    finally { gpu.dispose(); }
    const summary = report.finish(interrupted ? 'interrupted' : failure ? 'failed' : 'completed', failure);
    if (writer) {
      if (interventions) graphOutputs([interventionInput.file]).protect(fs.statSync(output, { throwIfNoEntry: false }));
      writer.write(path.dirname(output), [{ file: path.basename(output), document: summary }]);
    }
    await emit(summary);
    process.exitCode = interrupted ?? (failure ? 1 : opt.rehearse && !summary.passed ? 2 : 0);
  }
}

module.exports = { runShow };
