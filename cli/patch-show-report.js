const sampleLimit = 256;

function showReport(config, rehearse) {
  const began = performance.now(), sources = new Map(), stages = new Map();
  const dropped = { schedule: 0, projector: 0, video: 0 }, samples = [], presets = [], sourceEvents = [];
  const video = { received: 0, repeated: 0, fallback: 0 };
  let rendered = 0, displayed = 0, assertionFailures = 0, frame = 0, unlogged = 0;
  const elapsed = () => performance.now() - began;
  function append(list, item) {
    if (list.length < sampleLimit) list.push(item);
    else unlogged++;
  }
  return {
    frame(index) { frame = index; },
    rendered(ok) { rendered++; if (!ok) assertionFailures++; },
    displayed(skipped) { displayed++; dropped.projector += skipped; },
    source(name, state, detail) {
      const prior = sources.get(name);
      if (prior?.state === state && prior.detail === detail) return;
      const outages = (prior?.outages ?? 0) + Number(state === 'offline' && prior?.state !== 'offline');
      sources.set(name, { state, detail, outages });
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
      }
    },
    schedule(first, next) {
      if (first >= next) return;
      dropped.schedule += next - first;
      append(samples, { type: 'drop', from: first, to: next - 1 });
    },
    video(state, skipped = 0) {
      video[state]++;
      dropped.video += skipped;
    },
    preset(change) { append(presets, { frame, ...change }); },
    finish(reason, error) {
      const slow = [...stages.values()].some(value => value.slowFrames > 0);
      const offline = [...sources.values()].some(value => value.outages > 0);
      return { format: 'ink-studio/patch-show-report', version: 1, event: 'show-report', mode: rehearse ? 'rehearsal' : 'show',
        reason, passed: reason === 'completed' && !slow && !offline && !assertionFailures && !Object.values(dropped).some(Boolean),
        fps: config.fps, frameBudgetMs: 1000 / config.fps, slowMs: config.slowMs, elapsedMs: elapsed(),
        rendered, displayed, dropped, video, assertionFailures, sources: Object.fromEntries(sources),
        stages: Object.fromEntries([...stages].map(([name, { totalMs, ...entry }]) => [name, { ...entry, meanMs: totalMs / entry.samples }])),
        sourceEvents, presets, samples, unlogged, ...(error && { error: error.message }) };
    }
  };
}

module.exports = { showReport };
