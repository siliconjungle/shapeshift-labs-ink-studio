const { collect, cueAnchor } = require('./show-beat-diagnostics.js');
const { kinds:audioKinds } = require('./show-audio-diagnostics.js');

const sampleLimit = 256;

function showReport(config, rehearse) {
  const began = performance.now(), sources = new Map(), stages = new Map();
  const dropped = { schedule: 0, projector: 0, video: 0 }, samples = [], presets = [], sourceEvents = [];
  const cueLinks = new Map(config.cues.map(({ frame, preset, beatId, clockCue }) => {
    const tick = clockCue?.anchor?.event?.tick;
    return [frame, { ...(beatId && { beatId }), preset, scheduledFrame: frame, status: 'not-reached',
      ...(tick !== undefined && { tick }), ...(clockCue?.clip && { clip: clockCue.clip }),
      ...(clockCue?.id && { cue: clockCue.id }) }];
  }));
  const diagnostics = collect(config, cueLinks), outages = new Map();
  const graphLinks=[], outcomes={};
  let inputMode;
  const video = { received: 0, repeated: 0, fallback: 0 };
  let rendered = 0, displayed = 0, assertionFailures = 0, frame = 0, endFrame = 0, unlogged = 0;
  const elapsed = () => performance.now() - began;
  function append(list, item) {
    if (list.length < sampleLimit) list.push(item);
    else unlogged++;
  }
  function closeOutage(name, toFrame) {
    const outage = outages.get(name);
    if (!outage) return;
    const { fromFrame, detail } = outage;
    diagnostics.issue('source-offline', { source: name, ...(detail && { detail }) }, fromFrame, Math.max(toFrame, fromFrame + 1));
    outages.delete(name);
  }
  return {
    frame(index) { frame = index; endFrame = Math.max(endFrame, index + 1); },
    rendered(ok) { rendered++; if (!ok) assertionFailures++; },
    displayed(skipped, missed) {
      displayed++;
      dropped.projector += skipped;
      if (!skipped) return;
      for (const { fromFrame, toFrame } of missed?.ranges ?? [])
        diagnostics.issue('dropped-frame', { channel: 'projector', count: toFrame - fromFrame }, fromFrame, toFrame);
      const unknown = missed?.unknown ?? skipped;
      if (unknown) diagnostics.issue('dropped-frame', { channel: 'projector', count: unknown });
    },
    source(name, state, detail) {
      const prior = sources.get(name);
      if (prior?.state === state && prior.detail === detail) return;
      const lost = state === 'offline' && prior?.state !== 'offline';
      if (lost) outages.set(name, { fromFrame: frame, detail });
      if (prior?.state === 'offline' && state !== 'offline') closeOutage(name, frame);
      sources.set(name, { state, detail, outages: (prior?.outages ?? 0) + Number(lost) });
      append(sourceEvents, { name, state, detail, frame, elapsedMs: elapsed() });
    },
    stage(name, ms) {
      let entry = stages.get(name);
      if (!entry) stages.set(name, entry = { samples: 0, totalMs: 0, maxMs: 0, slowFrames: 0 });
      entry.samples++;
      entry.totalMs += ms;
      if (ms > entry.maxMs) { entry.maxMs = ms; entry.peakFrame = frame; }
      if (ms > config.slowMs) {
        entry.slowFrames++;
        append(samples, { type: 'slow', stage: name, frame, ms });
        diagnostics.issue('slow-stage', { stage: name, ms, limitMs: config.slowMs }, frame, frame + 1);
      }
    },
    schedule(first, next) {
      if (first >= next) return;
      endFrame = Math.max(endFrame, next);
      dropped.schedule += next - first;
      diagnostics.issue('dropped-frame', { channel: 'schedule', count: next - first }, first, next);
      append(samples, { type: 'drop', from: first, to: next - 1 });
    },
    video(state, skipped = 0, placement) {
      video[state]++;
      dropped.video += skipped;
      if (skipped) diagnostics.issue('dropped-frame', {
        channel: 'video', count: skipped, timing: placement ? 'clip-frames' : 'detected'
      }, placement?.fromFrame ?? frame, placement?.toFrame ?? frame + 1);
    },
    preset(change) { append(presets, { frame, ...change }); },
    cueLink(scheduledFrame,status) {
      const link=cueLinks.get(scheduledFrame);
      if(link)Object.assign(link,{frame,status});
    },
    graphLink(output, link) {
      append(graphLinks, { ...link, output, frame, status: 'observed' });
      diagnostics.observe(frame, output, link);
    },
    interventionMode(mode) { inputMode = mode; },
    intervention(status, count = 1) { outcomes[status] = (outcomes[status] ?? 0) + count; },
    finish(reason, error) {
      const slow = [...stages.values()].some(value => value.slowFrames > 0);
      const offline = [...sources.values()].some(value => value.outages > 0);
      for (const name of outages.keys()) closeOutage(name, endFrame);
      for (const cue of cueLinks.values()) {
        if (cue.status === 'selected') cue.status = 'render-failed';
        const status = cue.status === 'applied' && cue.frame > cue.scheduledFrame ? 'late' : cue.status;
        if (status === 'applied') continue;
        const { scheduledFrame, preset, frame: playedFrame } = cue;
        diagnostics.issue('missed-cue', { status, preset, scheduledFrame,
          ...(playedFrame !== undefined && { [status === 'late' ? 'playedFrame' : 'resolvedFrame']: playedFrame }),
          ...(cue.cue && { cue: cue.cue }), ...(cue.clip && { clip: cue.clip })
        }, scheduledFrame, scheduledFrame + 1, cue.beatId && cueAnchor(cue));
      }
      const audio=config.audioDiagnostics;
      let audioDiagnostics, audioFailed=false;
      if (audio?.files.length) {
        const counts=Object.fromEntries(audioKinds.map(kind=>[kind,audio.omitted[kind] ?? 0]));
        for (const {kind,detail,fromFrame,toFrame,direct} of audio.findings) {
          counts[kind]++;
          diagnostics.issue(kind,detail,fromFrame,toFrame,direct);
        }
        audioFailed=Object.values(counts).some(Boolean);
        audioDiagnostics={counts,omitted:audio.omitted};
      }
      const storyDiagnostics = diagnostics.finish();
      const beatLinks = [...cueLinks.values()].filter(cue => cue.beatId).concat(graphLinks);
      return { format: 'ink-studio/patch-show-report', version: 1, event: 'show-report', mode: rehearse ? 'rehearsal' : 'show',
        reason, passed: reason === 'completed' && !slow && !offline && !assertionFailures && !Object.values(dropped).some(Boolean) &&
          (!rehearse || !diagnostics.missedCues && !audioFailed),
        fps: config.fps, frameBudgetMs: 1000 / config.fps, slowMs: config.slowMs, elapsedMs: elapsed(),
        rendered, displayed, dropped, video, assertionFailures, sources: Object.fromEntries(sources),
        stages: Object.fromEntries([...stages].map(([name, { totalMs, ...entry }]) => [name, { ...entry, meanMs: totalMs / entry.samples }])),
        ...(config.assetBindings?.length && { assetBindings: config.assetBindings }),
        ...(beatLinks.length&&{beatLinks}),
        ...(storyDiagnostics && { storyDiagnostics }),
        ...(audioDiagnostics && { audioDiagnostics }),
        ...(inputMode && { interventions: { mode: inputMode, outcomes } }),
        sourceEvents, presets, samples, unlogged, ...(error && { error: error.message }) };
    }
  };
}

module.exports = { showReport };
