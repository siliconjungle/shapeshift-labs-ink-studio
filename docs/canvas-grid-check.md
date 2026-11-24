# Canvas pixel-grid checks

Run the browser delivery check from an Ink checkout or package with Chrome or Chromium installed.

```sh
ink-studio canvas-grid-check --out studio/out/canvas-grid-check
```

The default check renders a 96×64 Ink WebGL scene in a responsive canvas at three CSS viewport widths and three device pixel ratios, including 1.25. Each case advances the camera by half a native pixel per frame through 15 samples. On the same canvas, alternating one-pixel rulers measure horizontal and vertical cell size, and two hard edges follow the camera on the native grid.

The check reads the drawn native pixels and independently captures the page through the browser compositor. `report.json` lists each flag's first frame and probe, device-pixel ruler spans, and the native and displayed positions and strides of moving edges. Each case saves a ruler screenshot and its paired native PNG. Cases with an edge flag also save the first flagged frame and its predecessor when available. Positions in the report are zero-based. Device positions are in full screenshot coordinates.

- **Uneven cell widths** means complete cells on a ruler occupy different numbers of device pixels. Missing, split, and blended cells have their own flags.
- **Uneven edge stride** means equal native moves produce different device-pixel steps. The report also flags motion on a native hold, a stall or reversal, and accumulated drift greater than one device pixel.
- **Pan not observed** means an edge produced no measurable native advances across successive captured samples. Use enough pan travel to cross several native cells.

Set `--fail-on-flags` to exit with status 2 after writing the report if any case flags. A browser or input failure exits with status 1. Set `--chrome /path/to/chrome` or `INK_TEST_CHROME` to choose a browser. The default uses Chrome's software WebGL path. Use `--hardware` to check the local GPU path.

## Review a project canvas

Pass a local JSON plan to set the viewport cases and pan samples. Omit `page` to use the built-in scene. The `page` path is relative to the plan file.

```json
{
  "page": "pixel-check.html",
  "cases": [
    { "width": 416, "height": 380, "dpr": 1 },
    { "width": 443, "height": 380, "dpr": 1.25 },
    { "width": 640, "height": 520, "dpr": 1.5 }
  ],
  "frames": 15,
  "pixelsPerFrame": 0.5
}
```

Use a local HTML fixture that mounts your project's actual canvas and CSS. After mounting, expose a `globalThis.inkCanvasGrid` object with these fields.

- `canvas` is the connected `HTMLCanvasElement`. Keep it fully visible and axis-aligned, with padding and borders on its container. Set its native dimensions at startup for each viewport and hold them during the pan.
- `draw({ frame, pan })` renders the requested frame into that canvas and returns its opaque RGB readback as top-down bytes in a `Uint8Array` or `Uint8ClampedArray`. `frame` starts at zero. `pan` is the requested displacement in native pixels from the initial camera position. The function may return a promise. Hold the rendered frame for capture until the next call.
- `probes` is a fixed array of scan lines. Each entry has an `id`, `kind` (`ruler` or `edge`), `axis` (`x` or `y`), `start` as native `[x,y]`, and `length` in native pixels. Include at least one alternating one-pixel ruler and one moving hard edge. Each line should contain only two high-contrast, opaque colors in the native frame. Give moving edges room to travel in their scan lines.

For example, this fixture checks one ruler and one edge on an existing picture canvas.

```js
globalThis.inkCanvasGrid = {
  canvas: picture,
  probes: [
    { id: 'ruler', kind: 'ruler', axis: 'x', start: [8, 3], length: 24 },
    { id: 'door', kind: 'edge', axis: 'x', start: [8, 24], length: 48 }
  ],
  async draw({ pan }) {
    await renderPicture(picture, { pan });
    return readNativeRGB(picture);
  }
};
```

Run it with `ink-studio canvas-grid-check plan.json --out studio/out/project-grid`. The report covers the chosen Chromium build and emulated viewport cases.
