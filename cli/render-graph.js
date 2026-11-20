const FrameComposite = require('../src/frame-composite.js');
const { cube, selection, layer, history, feedbackMotion, volumeCoverage } = require('../src/render-graph.js');

function runGraph(plan, frame, world, time, text, camera, resolve, options) {
  const { w, h, passes } = frame;
  const openHistory = plan.historyPasses.length && (options.renderHistory ?? history()).begin(plan, {
    source: options.renderHistoryKey ?? world, w, h, time, camera, reset: options.resetRenderHistory
  });
  if (!openHistory) options.renderHistory?.clear();
  const outputs = new Map([['scene', FrameComposite.pixels(frame).data]]);
  const selectors = new Map();
  function selected(select) {
    if (!select) return null;
    const key = JSON.stringify(select);
    if (!selectors.has(key)) selectors.set(key, selection(world, select));
    return selectors.get(key);
  }
  const owner = passes?.splatId, depth = passes?.depth;
  const nativeIndex = (owner || depth) && (passes.w !== w || passes.h !== h) ?
    (x, y) => Math.floor(y * passes.h / h) * passes.w + Math.floor(x * passes.w / w) :
    (_x, _y, p) => p;
  const color = new Float64Array(4), previousColor = new Float64Array(4), rgb = [0, 0, 0], graded = [0, 0, 0];
  for (const [index, node] of plan.passes.entries()) {
    const input = outputs.get(node.input);
    const maskPass = node.type === 'mask';
    let output;
    if (!node.enabled) output = maskPass ? new Uint8Array(w * h) : input;
    else {
      const rows = selected(node.select), mask = outputs.get(node.mask), source = outputs.get(node.source);
      const table = node.type === 'grade' && cube(node);
      const feedback = node.type === 'feedback';
      const memory = node.type === 'history' || feedback ? openHistory(node) : null;
      const held = memory && (memory.capture ? new Uint8Array(input.length) : memory.value);
      const raster = node.layer && (!feedback || memory.capture) && layer(node, w, h, world, time, text, camera, resolve);
      const oldSignal = feedback && memory.capture && memory.decay > 0 &&
        { data: memory.value, w, h, filter: node.filter };
      const motion = oldSignal && feedbackMotion(node, time, memory.elapsed, w, h);
      output = maskPass ? new Uint8Array(w * h) : input.slice();
      const { rect, feather, opacity } = node;
      const line = node.line ?? (node.axis === 'x' ? w : h) * .5;
      const isReflection = node.type === 'reflection';
      const theta = node.type === 'distortion' ? 2 * Math.PI * ((node.phase + time * node.rate) % 1) : 0;
      for (let y = .5, p = 0; y < h; y++) for (let x = .5; x < w; x++, p++) {
        const native = nativeIndex(x, y, p);
        const chosen = rows ? rows[owner?.[native] ?? 0] !== 0 : true;
        let weight = chosen ? (mask ? mask[p] / 255 : 1) : 0;
        const q = p * 4;
        if (maskPass) {
          if (node.volume && weight) {
            const z = depth?.[native];
            const u = (native % passes.w + .5) / passes.w, v = (Math.floor(native / passes.w) + .5) / passes.h;
            weight *= volumeCoverage(node.volume, camera, u, v, z);
          }
          if (rect) {
            const edge = Math.min(x - rect[0], y - rect[1], rect[0] + rect[2] - x, rect[1] + rect[3] - y);
            weight *= feather ? Math.max(0, Math.min(1, edge / feather)) : Number(edge >= 0);
          }
          output[p] = Math.round((node.invert ? 1 - weight : weight) * opacity * 255);
          continue;
        }
        if (feedback) {
          if (memory.capture) {
            previousColor.fill(0);
            if (motion) {
              const { pivot, blockSize, transform: [cos, sin], offset, wave, theta, frequency } = motion;
              const u = x - pivot[0], v = y - pivot[1];
              const qx = blockSize ? (Math.floor(x / blockSize) + .5) * blockSize : x;
              const qy = blockSize ? (Math.floor(y / blockSize) + .5) * blockSize : y;
              const sx = pivot[0] + cos * u + sin * v - offset[0] - wave[0] * Math.sin(qy * frequency + theta);
              const sy = pivot[1] - sin * u + cos * v - offset[1] - wave[1] * Math.sin(qx * frequency + theta);
              if (sx >= 0 && sy >= 0 && sx < w && sy < h) FrameComposite.sample(oldSignal, sx, sy, previousColor);
            }
            color.fill(0);
            let amount = weight * node.gain;
            if (amount > 0) {
              if (node.layer) {
                if (raster) FrameComposite.samplePlaced(raster, x, y, color);
                amount *= raster?.opacity ?? 0;
              } else for (let c = 0; c < 4; c++) color[c] = source[q + c];
              if (node.threshold && color[3] > 0) {
                const [lo, hi] = node.threshold;
                const intensity = Math.max(color[0], color[1], color[2]) / color[3];
                amount *= Math.min(1, Math.max(0, (intensity - lo) / (hi - lo)));
              }
            }
            const remain = memory.decay * (1 - color[3] * amount / 255);
            for (let c = 0; c < 4; c++)
              held[q + c] = Math.min(255, Math.round(color[c] * amount + Math.floor(previousColor[c] * remain + 1e-5)));
          }
          if (held[q + 3] && opacity) {
            for (let c = 0; c < 4; c++) color[c] = held[q + c];
            FrameComposite.blend(output, q, color, opacity, node.blend === 'add');
          }
          continue;
        }
        if (memory) {
          if (memory.capture) {
            const previous = memory.value, hasSample = previous?.[q + 3] > 0;
            const keep = node.mode === 'hold' && hasSample;
            const old = node.mode === 'persistence' && hasSample ? memory.decay : 0;
            const remain = old * (1 - input[q + 3] * weight / 255);
            for (let c = 0; c < 4; c++) held[q + c] = keep ? previous[q + c] :
              Math.min(255, Math.round(input[q + c] * weight + Math.floor((previous?.[q + c] ?? 0) * remain + 1e-5)));
          }
          if (chosen && held[q + 3]) {
            for (let c = 0; c < 4; c++) color[c] = held[q + c];
            FrameComposite.blend(output, q, color, opacity, false);
          }
          continue;
        }
        weight *= opacity;
        if (!weight) continue;
        if (table) {
          const alpha = input[q + 3];
          if (!alpha) continue;
          for (let c = 0; c < 3; c++) rgb[c] = input[q + c] / alpha;
          table.sample(rgb, graded);
          for (let c = 0; c < 3; c++)
            output[q + c] = Math.round(input[q + c] * (1 - weight) + graded[c] * alpha * weight);
        } else if (node.type === 'composite') {
          if (node.layer && !raster) continue;
          if (raster) {
            if (!FrameComposite.samplePlaced(raster, x, y, color)) continue;
          } else for (let c = 0; c < 4; c++) color[c] = source[q + c];
          FrameComposite.blend(output, q, color, weight * (raster?.opacity ?? 1), (raster?.blend ?? node.blend) === 'add');
        } else {
          let X = x, Y = y;
          if (isReflection) {
            if (node.axis === 'x') X = line * 2 - x;
            else Y = line * 2 - y;
          } else {
            const frequency = 2 * Math.PI / node.period;
            X += node.offset[0] + node.amplitude[0] * Math.sin(y * frequency + theta);
            Y += node.offset[1] + node.amplitude[1] * Math.sin(x * frequency + theta);
          }
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const at = (Math.floor(Y) * w + Math.floor(X)) * 4;
          for (let c = 0; c < 4; c++) output[q + c] = Math.round(input[q + c] * (1 - weight) + source[at + c] * weight);
        }
      }
      if (memory?.capture) memory.save(held);
    }
    outputs.set(node.id, output);
    for (const dependency of node.dependencies)
      if (plan.lastUse.get(dependency) === index) outputs.delete(dependency);
  }
  return FrameComposite.straight(outputs.get(plan.output), w, h, frame.alpha);
}
module.exports = runGraph;
