# Part proxies for imported Gaussian splats

Use a tapered stroke for an important filament or a triangle mesh for a crisp
opaque surface. The WebGL renderer uses its native geometry depth buffer to
draw the proxy with neighboring soft splats. Shared meshes can supply just a
silhouette, depth, or a lighting normal.

Start with a world from `gaussianSplatWorld` and `colorMode: 'rgb'` or
`'palette'`. Paint a selection with `createSplatMaskPainter`, then use that
tool's `mask` snapshot to bind a proxy. Positions and radii use the imported
world's fitted coordinates. The retained splat centers are in
`world.data.subarray(index * 16, index * 16 + 3)`.

```js
import { compileGaussianPartProxies } from './webgl.mjs';

const mask = painter.mask;
const samples = [rootSplat, bendSplat, tipSplat];
const points = samples.map(i => Array.from(world.data.subarray(i * 16, i * 16 + 3)));
world.gaussianPartProxies = compileGaussianPartProxies(world, [{
  mask,
  shape: { type: 'stroke', points, samples, radii: [.04, .024, .008], minPixels: 1 }
}]);

renderer.render(world, { gaussianColor: 'palette' });
renderer.render(world, { gaussianPartProxies: false }); // compare with the source cloud
```

Each mask may claim a row once. Compile a new plan after editing the mask or
geometry. Use up to eight parts per imported world.

| Mode | What the proxy contributes |
| --- | --- |
| `replace` (default) | The proxy owns coverage and depth. The GPU evaluates the source rows' live directional RGB and interpolates the colors along the stroke or across the mesh. The rest of the cloud uses its usual blending. |
| `silhouette` | Clips the selected splats against the proxy coverage, preserving their color and depth wherever they survive. |
| `depth` | Uses the proxy's depth where it intersects the selected splats. The color retains the source cloud's blend order. |
| `normals` | Lights the selected splat color from the proxy's mesh normals, using `light: { direction: [x, y, z], strength: .3 }`. Silhouette and depth still come from the splats. |

Meshes take `{ type: 'mesh', points, triangles, normals?, samples? }`.
`triangles` is a flat list of vertex indices. With no vertex normals the
renderer uses face normals. A replacement mesh can also use `light`. Strokes
take `{ type: 'stroke', points, radii, samples?, minPixels? }`. The default
minimum width keeps a stroke connected on the art grid. The natural taper takes
over where its projected radius is wider. Set the minimum to zero to let very
thin ends fade out as they shrink.

Each optional `samples` entry is an index in the same part mask. The first
selected splat supplies the color when samples are omitted. To use a fixed
color on a replacement, set its `color` to a packed RGB swatch. Palette mode
resolves the proxy and cloud together. Set fixed colors in the world's palette
to preserve them in indexed exports.

The live WebGL renderer and its turntable capture accept these plans. Picking
and the mask brush continue to address the source cloud. The retained source
IDs also stay available when toggling the proxy for comparison.

Run `npm run build -- development`, serve the repository over HTTP, and open
[Pelagic](../examples/gaussian-part-proxies/index.html) to compare the same cloud
with and without three tentacle proxies.
