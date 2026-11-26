// Report graph execution and the sample storage visible at typed port boundaries.
const view = value => ArrayBuffer.isView(value) && typeof value.length === 'number';

function buffers(value, depth = 0) {
  let candidates;
  if (value?.format === 'ink-studio/graph-image') candidates = [value.raster.data];
  else if (value?.format === 'ink-studio/material-channels')
    candidates = Object.values(value.channels).flatMap(({ raster }) => buffers(raster));
  else if (value?.w && value?.h && value.rgb)
    candidates = [value.rgb, value.alpha, ...Object.values(value.passes ?? {}),
      ...Object.values(value.renderGraphPasses ?? {}).map(raster => raster.data)];
  else if (value && typeof value === 'object') candidates = [value.data, value.samples, value.pos ?? value.positions,
    value.tri ?? value.indices, value.uvs, value.normals, value.velocities];
  else candidates = [];
  const samples = candidates.filter(view);
  const proto = value && typeof value === 'object' && Object.getPrototypeOf(value);
  if (value && !samples.length && depth < 2 && (proto === Object.prototype || proto === null || Array.isArray(value))) {
    const entries = Object.values(value);
    if (entries.length <= 64) for (const item of entries) samples.push(...buffers(item, depth + 1));
  }
  return [...new Set(samples)];
}

function sampleBytes(views) {
  return views.reduce((total, data) => total + data.byteLength, 0);
}

function receipt(frame, statuses, describe) {
  const stages = new Map(Object.keys(statuses).map(node => [node, frame.stage(node)]));
  let outputViewBytes = 0, linkedViewBytes = 0, sharedLinkedViewBytes = 0;
  const stores = new Set();
  const nodes = Array.from(stages, ([node, stage]) => {
    const prefix = node.slice(0, node.lastIndexOf('/') + 1);
    const absolute = row => row.node ? { ...row, node: prefix + row.node } : row;
    const inputs = Object.fromEntries(Object.entries(stage.inputs).map(([port, { value, ...entry }]) => {
      const link = absolute(entry), views = buffers(value), bytes = sampleBytes(views);
      const source = stages.get(link.node)?.outputs[link.port];
      const from = new Set(buffers(source).map(data => data.buffer));
      const sharedBytes = sampleBytes(views.filter(data => from.has(data.buffer)));
      if (link.kind === 'node') {
        linkedViewBytes += bytes;
        sharedLinkedViewBytes += sharedBytes;
      }
      return [port, { ...link, bytes, ...(link.kind === 'node' && { sharedBytes }) }];
    }));
    const outputs = Object.fromEntries(Object.entries(stage.outputTypes).map(([port, type]) => {
      const value = stage.outputs[port], views = buffers(value), bytes = sampleBytes(views);
      for (const data of views) stores.add(data.buffer);
      outputViewBytes += bytes;
      return [port, { type, bytes, ...(bytes && { value: describe(value) }) }];
    }));
    const { computeMs, invalidated } = stage.receipt;
    return { node, op: stage.op, status: statuses[node], computeMs, invalidated: invalidated.map(absolute), inputs, outputs };
  });
  return { nodes, samples: { outputViewBytes, uniqueBackingBytes: sampleBytes(Array.from(stores)),
    backingBuffers: stores.size, linkedViewBytes, sharedLinkedViewBytes } };
}

module.exports = { receipt };
