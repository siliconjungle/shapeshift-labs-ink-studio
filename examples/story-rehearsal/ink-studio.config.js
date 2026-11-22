/* Rehearsal fixture that stalls one graph stage long enough to miss two cues. */
const gate = new Int32Array(new SharedArrayBuffer(4));

module.exports = { graphOperations: {
  'rehearsal.grade': {
    inputs: { source: 'raster', camera: 'raster', stall: 'boolean' }, outputs: { value: 'raster' }, time: true,
    run({ source, camera, stall }, { time }) {
      if (stall && Math.round(time * 10) === 2) Atomics.wait(gate, 0, 0, 555);
      const data = Uint8Array.from(source.data);
      data[0] = camera.data[0];
      return { value: { ...source, data } };
    }
  }
} };
