# GPU finite curves

The WebGL 2 renderer draws authored [curve splats](curve-splats.md) as analytic finite spans by default. Use the same `KIT.curveSplats.draw` call and world in the headless and canvas renderers. Shape, taper, timing windows, and cap planes share the headless preparation. The fragment shader evaluates each pixel ray and sorts the resulting hits by local depth.

Hard curves support round and elliptical capsules and flattened bands. Overlapping intervals on the same hard strand share coverage. Separate passes through the pixel retain their own depth and opacity. Compact Beta curves integrate a bounded kernel, and Gaussian curves integrate the corresponding soft kernel. The renderer supports rounded, blunt, tapered, and fading ends for the three sections.

Opaque hits participate in the shared owner and depth attachments. Meshes, cutout surfaces, opaque splats, and depth-only proxies can occlude curve fragments. Portal and mirror views rebuild their own spans and clip them to their entry plane. Analytic fog and water use the local curve depth.

The first GPU pass evaluates one sample per art pixel. Headless-only treatments include subpixel edge filtering, projected minimum width, dash shading, and authored curve lighting and shadows. Finite spans sort against each other and the shared opaque depth. Ordinary translucent splats still use their existing scene pass. Use `curveMode: 'splats'` for the carrier preview.

## Match the headless reference

```sh
node scripts/build.js node
node cli/ink-studio.js finite-curve-review --hardware --orbit --out out/finite-curve-review
```

The [switchboard scene](../examples/finite-curves-webgl.js) compares three camera angles against the headless renderer. Each angle includes GPU, headless, carrier, and difference PNGs. The JSON report records visible spans, tile references, and RGB byte differences. `--orbit` adds a GPU-rendered image sequence.

The optional `curveFrame` callback reports `segments`, `tileReferences`, and `peakTile` for each analytic view. The GPU bins spans into 8 × 8 tiles and keeps the nearest 64 independent contributions per pixel. The preparation budget is 1,024 candidate spans per tile and four million tile references per view. Previews that exceed the tile budget can use a lower-density source or the carrier mode.
