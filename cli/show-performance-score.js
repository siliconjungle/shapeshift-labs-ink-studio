const { showRate } = require('./show-beat-diagnostics.js');
const { openPerformanceScore } = require('./music-live.js');
const { createHash } = require('node:crypto');

async function open(recipe, route, kit, rate) {
  const [n, d] = showRate(kit.KIT.procedural.takeTime, rate);
  const score = await openPerformanceScore(recipe, route, kit);
  const hz = BigInt(score.sampleRate);
  return {
    sampleRate: score.sampleRate, files: score.files, close: score.close,
    async advance(frame, receive) {
      const stop = Number((BigInt(frame) * hz * d + n - 1n) / n);
      for (;;) {
        const start = performance.now(), block = await score.pull(stop);
        if (!block) break;
        const ms = performance.now() - start;
        const { performance: trace, samples } = block;
        const sha256 = createHash('sha256').update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)).digest('hex');
        const typicalFrame = sample => Number(BigInt(sample) * n / (hz * d));
        receive({ ...trace, sampleRate: score.sampleRate, ms, sha256,
          fromFrame: typicalFrame(trace.firstSample), toFrame: typicalFrame(trace.endSample - 1) + 1 }, typicalFrame);
      }
    }
  };
}

module.exports = { open };
