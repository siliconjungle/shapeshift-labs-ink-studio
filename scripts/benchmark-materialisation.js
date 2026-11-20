#!/usr/bin/env node
// CPU simulation cost at a fixed 60 Hz; this does not measure displayed/GPU fps.
const { performance } = require('node:perf_hooks'),
  kit = require('..').load();
const demo = require('../examples/typography.js')(kit),
  quick = process.argv.includes('--quick');
const summary = values => {
  values.sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1)
  };
};
function phase(frames) {
  const samples = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    demo.control.take();
    demo.control.input({ yaw: 0.001 });
    demo.update(1 / 60);
    samples.push(performance.now() - start);
  }
  return summary(samples);
}
phase(60);
demo.materialise();
phase(60);
const scatter = phase(quick ? 60 : 180);
demo.materialise();
const gather = phase(120),
  home = phase(60);
console.log(
  JSON.stringify(
    {
      units: 'CPU milliseconds per 60 Hz update (no rendering)',
      splats: demo.world.count,
      fragments: demo.title.ids.length,
      scatter,
      gather,
      home,
      remaining: demo.matter.stats
    },
    null,
    2
  )
);
