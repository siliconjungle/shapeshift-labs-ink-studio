const FrameComposite = require('../src/frame-composite.js');
const { cube, selection, layer } = require('../src/render-graph.js');

function runGraph(plan, frame, world, time, text, camera, resolve) {
  const { w, h, passes } = frame;
  const outputs = new Map([['scene', FrameComposite.pixels(frame).data]]);
  const selectors = new Map();
  function selected(select) {
    if (!select) return null;
    const key = JSON.stringify(select);
    if (!selectors.has(key)) selectors.set(key, selection(world, select));
    return selectors.get(key);
  }
  const owner = passes?.splatId;
  const ownerIndex = owner && (passes.w !== w || passes.h !== h) ?
    (x, y) => Math.floor(y * passes.h / h) * passes.w + Math.floor(x * passes.w / w) :
    (_x, _y, p) => p;
  const color = new Float64Array(4), rgb = [0, 0, 0], graded = [0, 0, 0];
  for (const [index, node] of plan.passes.entries()) {
    const input = outputs.get(node.input);
    const maskPass = node.type === 'mask';
    let output;
    if (!node.enabled) output = maskPass ? new Uint8Array(w * h) : input;
    else {
      const rows = selected(node.select), mask = outputs.get(node.mask), source = outputs.get(node.source);
      const table = node.type === 'grade' && cube(node);
      const raster = node.layer && layer(node, w, h, world, time, text, camera, resolve);
      output = maskPass ? new Uint8Array(w * h) : input.slice();
      const { rect, feather, opacity } = node;
      const line = node.line ?? (node.axis === 'x' ? w : h) * .5;
      const isReflection = node.type === 'reflection';
      const theta = node.type === 'distortion' ? 2 * Math.PI * ((node.phase + time * node.rate) % 1) : 0;
      for (let y = .5, p = 0; y < h; y++) for (let x = .5; x < w; x++, p++) {
        let weight = (mask ? mask[p] / 255 : 1) * (rows ? rows[owner?.[ownerIndex(x, y, p)] ?? 0] / 255 || 0 : 1);
        if (maskPass) {
          if (rect) {
            const edge = Math.min(x - rect[0], y - rect[1], rect[0] + rect[2] - x, rect[1] + rect[3] - y);
            weight *= feather ? Math.max(0, Math.min(1, edge / feather)) : Number(edge >= 0);
          }
          output[p] = Math.round((node.invert ? 1 - weight : weight) * opacity * 255);
          continue;
        }
        weight *= opacity;
        if (!weight) continue;
        const q = p * 4;
        if (table) {
          const alpha = input[q + 3];
          if (!alpha) continue;
          for (let c = 0; c < 3; c++) rgb[c] = input[q + c] / alpha;
          table.sample(rgb, graded);
          for (let c = 0; c < 3; c++)
            output[q + c] = Math.round(input[q + c] * (1 - weight) + graded[c] * alpha * weight);
        } else if (node.type === 'composite') {
          if (node.layer && !raster) continue;
          if (raster) FrameComposite.sample(raster, x * raster.w / w, y * raster.h / h, color);
          else for (let c = 0; c < 4; c++) color[c] = source[q + c];
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
    }
    outputs.set(node.id, output);
    for (const dependency of node.dependencies)
      if (plan.lastUse.get(dependency) === index) outputs.delete(dependency);
  }
  return FrameComposite.straight(outputs.get(plan.output), w, h, frame.alpha);
}
module.exports = runGraph;
