// The CLI supplies the browser bundle and a URL to Ink's normal WebGL entry point.
export function mountGridFixture(createRenderer) {
  const canvas = document.querySelector('canvas');
  const { width, height } = canvas;
  const toolkit = { KIT, PixelLook, makeBuilder, makeSculpt, SpriteSurface, ContributionRules, RenderStages };
  const renderer = createRenderer(canvas, { toolkit, contextAttributes: { preserveDrawingBuffer: true } });
  const gl = canvas.getContext('webgl2');
  const builder = makeBuilder(23, [0x192433, 0xd58b59, 0xf0cf8a, 0x496a80, 0x8bb9ac]);
  const normal = [0, 0, 1];
  for (const [x, y, z, r, swatch] of [
    [-.85, -.30, 0, .72, 3], [-.85, -.28, .15, .48, 4], [-.77, -.23, .30, .22, 3],
    [.75, -.32, 0, .68, 1], [.75, -.27, .15, .45, 2], [.81, -.18, .30, .17, 1]
  ]) builder.disc(x, y, z, normal, r, .035, builder.P[swatch], 3);
  const dist = 4, fov = Math.PI / 4;
  const world = builder.finish({ cam: { target: [0, 0, 0], dist, yaw: 0, pitch: 0, fov }, dither: 0 });
  const dark = [31, 53, 78], light = [247, 207, 119];
  const rgba = new Uint8Array(width * height * 4), rgb = new Uint8Array(width * height * 3);

  function fill(x, y, w, h, color) {
    gl.scissor(x, height - y - h, w, h);
    gl.clearColor(color[0] / 255, color[1] / 255, color[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  return {
    canvas,
    probes: [
      { id: 'horizontal ruler', kind: 'ruler', axis: 'x', start: [12, 5], length: 72 },
      { id: 'vertical ruler', kind: 'ruler', axis: 'y', start: [5, 10], length: 41 },
      { id: 'leading edge', kind: 'edge', axis: 'x', start: [12, 57], length: 32 },
      { id: 'trailing edge', kind: 'edge', axis: 'x', start: [44, 57], length: 40 }
    ],
    draw({ pan }) {
      const pixel = 2 * dist * Math.tan(fov / 2) / height;
      renderer.render(world, { width, height, ortho: true, target: [-pan * pixel, 0, 0], changedRows: [] });
      // These calibration marks occupy reserved rows/columns in the same canvas.
      // The moving bar follows the camera's native displacement, with hard pixel edges.
      const shift = Math.round(pan);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.SCISSOR_TEST);
      for (let x = 0; x < 72; x++) fill(12 + x, 2, 1, 7, x % 2 ? light : dark);
      for (let y = 0; y < 41; y++) fill(2, 10 + y, 7, 1, y % 2 ? light : dark);
      fill(10, 53, 76, 9, dark);
      fill(27 + shift, 53, 23, 9, light);
      gl.disable(gl.SCISSOR_TEST);

      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error('Native canvas readback failed (' + error + ')');
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const source = ((height - 1 - y) * width + x) * 4, destination = (y * width + x) * 3;
          rgb.set(rgba.subarray(source, source + 3), destination);
        }
      }
      return rgb;
    }
  };
}
