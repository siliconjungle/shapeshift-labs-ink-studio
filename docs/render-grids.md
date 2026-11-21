# Tessellated render grids

Resolve a live SDF/splat scene into connected hexagons, alternating equilateral triangles or isometric diamonds. These are tessellating **screen cells**, with a single representative scene colour per cell, rather than masks stamped onto separate splats. Geometry, rigging, lighting, reflection and transparency continue through the native renderer.

Open [Prism Harbour](../examples/render-grid.html) to compare all three modes with the same animated scene and free camera. Build the browser SDK first:

```sh
node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/ink-studio.browser.js',require('.').bundle())"
```

Serve this repository over HTTP and open `examples/render-grid.html`. The standalone demo supplied with the feature also runs directly from disk.

## Authoring

```js
const grid = K.renderGrid.prepare({
  mode: 'hex',              // 'hex' | 'triangle' | 'diamond'
  size: 9,                  // horizontal width of an unrotated cell, in output pixels
  origin: [0, 0],           // fixed canvas anchor, in output pixels from the top left
  angle: 0,                 // radians; -2π through 2π
  aspect: 1,                // vertical stretch; .25 through 4
  gap: 0,                   // inset as a fraction of each cell's inradius; 0 through .5
  gapColor: [8, 28, 41],     // RGB bytes for seams
  maxPixels: 8388608         // explicit output/work budget, default supports 3840 × 2160
});
world.look.renderGrid = grid;
// Or override per frame, including disabling an authored mode:
renderer.render(world, { renderGrid: grid });
renderer.render(world, { renderGrid: false });
```

Definitions may be plain JSON, a mode string or immutable prepared plans. Prepare a plan once and reuse it during animation; mutation of an original definition does not alter an existing plan. A plain definition supplied on subsequent frames is revalidated. Unknown settings, nonfinite values and excessive budgets are rejected.

At `aspect:1`, hexagons are regular, triangles are equilateral and diamonds have a 2:1 horizontal-to-vertical ratio. Rotating the grid rotates the lattice and its cells together. Default zero seams cover the whole image. Cells at the frame boundary sample the nearest valid source texel when their centre falls outside the frame.

This is a screen representation: cell addresses stay fixed during camera movement, while the scene content changes through them. It does not attach a hexagonal texture to an object's local surface. Large cells deliberately simplify silhouettes and can omit details thinner than a cell. Reduce `size` for fine print or distant objects. Centre sampling retains existing palette colours; it does not average colours across object boundaries.

## Render placement and budgets

The ordering is native scene → mixed-resolution composition → render graph → tessellated grid → target inspection overlays. Thus lit splats, textured surfaces, reflections, water and graph effects share the representation, while inspection labels remain crisp. Reflection captures are not independently tessellated. `raw` bypasses palette processing but still honours an explicitly enabled grid.

The WebGL stage adds one fullscreen pass and one RGBA8 render target, with at most one source texture read per output pixel. It generates no extra splats, performs no GPU readback and maintains no frame history. Disabling the stage bypasses it. Its target and program are retained and reused until renderer disposal; the framebuffer resizes with the output. The disabled renderer does not allocate these resources until first use.

`K.renderGrid.dimensions(plan, width, height)` reports pixels, added colour-target bytes and texture reads per pixel. It rejects frames over `maxPixels` before rendering. Dimensions are bounded to 16,384 per axis and the configurable pixel limit is at most 67,108,864. Hardware texture and viewport limits also apply.

Depth/owner diagnostic passes and ray picking describe the original geometry. To inspect what a displayed tile represents, map the pointer through `cellAt` and query the original scene at that centre; do not assume the unmodified pointer describes the sampled tile. Render-graph depth/object masks run before tessellation.

## Cells and tools

```js
const cell = K.renderGrid.cellAt(grid, pointerX, pointerY);
// { id, address: [i,j,half], center: [x,y], edge, vertices: [[x,y], ...] }
const cells = K.renderGrid.cells(grid, [0, 0, 200, 160], { maxCells: 4096 });
```

Addresses support negative indices. The third address component selects the two triangle orientations; it is zero in the other grids. IDs and polygon geometry are independent of viewport extent. `edge` is zero at a boundary and one at the cell centre. Polygon vertices describe the full cell, without the optional seam inset. Enumeration returns full cells whose bounding boxes intersect the requested rectangle, including boundary candidates. It is bounded by candidate work, not just output length, and throws rather than returning incomplete tilings.

`RenderGrid` is also available from `require('@shapeshift-labs/ink-studio').load().RenderGrid`. `K.renderGrid.apply({w,h,rgb,alpha?}, settings)` applies the same representation to packed RGB bytes, with optional alpha bytes. Source arrays are not mutated. Alpha is sampled with colour; seam pixels are opaque. `K.renderGrid.glsl` exposes the locator for custom WebGL hosts. `renderer.describeFrame` includes enabled representation settings and resource costs.

```sh
# Apply to an existing scene; the same flags work for clips.
node cli/ink-studio.js render examples/stipple.json --render-grid hex --grid-size 10 --out hex.png
node cli/ink-studio.js render examples/stipple.json --render-grid triangle --grid-size 15 --out trixels.png
node cli/ink-studio.js render examples/stipple.json --render-grid diamond --grid-size 14 --grid-aspect 1 --out diamonds.png

# Angles are radians. --render-grid off disables an authored mode.
node cli/ink-studio.js render-grid triangle --size 14 --point 80,60 --bounds 60,40,40,40 --out cells.json
```

The inspection command accepts `hex`, `triangle`, `diamond` or a settings JSON file. `--w`, `--h`, `--point`, `--bounds` and `--max-cells` control its report. Render flags are `--render-grid`, `--grid-size`, `--grid-angle`, `--grid-aspect`, `--grid-gap` and `--grid-origin`.

The artistic reference is [Marmoset Hexels](https://marmoset.co/hexels/). The implementation is independent and has no runtime dependencies.
