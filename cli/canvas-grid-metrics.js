function sampleLine(image, { axis, start, length }, area) {
  const along = axis === 'x' ? 0 : 1, across = 1 - along;
  // Inset the ends of the line so a fractional canvas origin cannot sample the gutter.
  const first = Math.floor(area.origin[along] + (start[along] + .5) * area.scale[along]);
  const last = Math.floor(area.origin[along] + (start[along] + length - .5) * area.scale[along]);
  const cross = Math.floor(area.origin[across] + (start[across] + .5) * area.scale[across]);
  const colors = [];
  for (let i = first; i <= last; i++) {
    const [x, y] = along === 0 ? [i, cross] : [cross, i];
    if (x < 0 || x >= image.w || y < 0 || y >= image.h)
      throw new RangeError('A pixel-grid probe is outside the captured image');
    const offset = (y * image.w + x) * 3;
    colors.push(image.rgb.subarray(offset, offset + 3));
  }
  return { first, cross, colors };
}

function colorDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function spans(line, swatches, tolerance) {
  const runs = [];
  let mixed = 0;
  for (let i = 0; i < line.colors.length; i++) {
    const distances = swatches.map(color => colorDistance(color, line.colors[i]));
    const slot = distances[0] <= distances[1] ? 0 : 1;
    if (distances[slot] > tolerance) mixed++;
    const tail = runs.at(-1);
    if (tail?.slot === slot) tail.width++;
    else runs.push({ slot, start: line.first + i, width: 1 });
  }
  return { runs, mixed };
}

function measure(native, screenshot, area, probe) {
  const source = sampleLine(native, probe, { origin: [0, 0], scale: [1, 1] });
  const swatches = [source.colors[0], source.colors.find(rgb => colorDistance(rgb, source.colors[0]) > 0)];
  const label = 'Native probe "' + probe.id + '"';
  if (!swatches[1] || colorDistance(...swatches) < 64)
    throw new Error(label + ' needs two distinct, high-contrast colors');
  const reference = spans(source, swatches, 0);
  const expectedRuns = probe.kind === 'ruler' ? probe.length : 2;
  if (reference.mixed || reference.runs.length !== expectedRuns)
    throw new Error(label + ' needs ' + (probe.kind === 'ruler' ? 'alternating one-pixel cells' : 'one hard edge'));
  const display = sampleLine(screenshot, probe, area);
  const { runs, mixed } = spans(display, swatches, 6);
  const flags = [];
  const intact = runs.length === expectedRuns && runs[0].slot === 0;
  const location = { axis: probe.axis, line: display.cross };
  if (probe.kind === 'ruler') {
    if (!intact) flags.push('ruler-cells-lost-or-split');
    if (mixed) flags.push('ruler-mixed-colors');
    // The first and last runs are deliberately inset. Interior runs are complete.
    const cells = intact ? runs.slice(1, -1).map(({ start, width }) => ({ start, width })) : [];
    const widths = [...new Set(cells.map(cell => cell.width))].sort((a, b) => a - b);
    if (widths.length > 1) flags.push('uneven-cell-widths');
    return { ...location, cells, widths, mixed, displayedCells: runs.length, flags };
  }
  if (!intact) flags.push('edge-lost-or-split');
  if (mixed) flags.push('edge-mixed-colors');
  return { ...location, native: reference.runs[1].start, device: intact ? runs[1].start : null, mixed, flags };
}

function trackEdge(sample, state, scale) {
  if (sample.device === null) {
    state.previous = null;
    return;
  }
  const current = { native: sample.native, device: sample.device };
  state.origin ??= current;
  const previous = state.previous;
  state.previous = current;
  if (!previous) return;
  sample.nativeStep = current.native - previous.native;
  sample.deviceStep = current.device - previous.device;
  if (sample.nativeStep === 0) {
    if (sample.deviceStep !== 0) sample.flags.push('edge-moves-on-native-hold');
    return;
  }

  state.advances++;
  if (Math.sign(sample.nativeStep) !== Math.sign(sample.deviceStep)) sample.flags.push('edge-stalls-or-reverses');
  const strides = state.strides[sample.nativeStep] ??= {};
  strides[sample.deviceStep] = (strides[sample.deviceStep] ?? 0) + 1;
  if (Object.keys(strides).length > 1) sample.flags.push('uneven-edge-stride');
  const expectedOffset = (current.native - state.origin.native) * scale;
  sample.drift = current.device - state.origin.device - expectedOffset;
  if (Math.abs(sample.drift) > 1.001) sample.flags.push('edge-drifts');
}

module.exports = { measure, trackEdge };
