# Custom splat footprints

Give individual native splats or sculpt materials square, wedge, star, cross, chipped, polygonal or painted silhouettes. The renderer projects the original covariance, then maps a cached signed-distance tile through it. SDF sculpting, native splats, animated bones and existing colour tools remain the underlying scene representation.

The [Mark Foundry](../examples/splat-footprints.html) compares eight large single splats and a 32K-splat diorama. Draw a silhouette in the editor, cut holes in it, adjust its transform, or compare the original Gaussian rendering. Build `dist/ink-studio.browser.js` with `require('.').bundle()` and serve the repository over HTTP to run the source demo.

## Sculpt materials

```js
const stone = {
  r: [1, 2, 3, 4],
  footprint: { shape: 'chip', seed: 39, rotation: .1, stretch: [1.2, .8], softness: .025 }
};
S.box([0, 0, 0], [1, 1, 1], stone, { res: .1 });
S.ball([0, 2, 0], [.7, .7, .7], {
  r: [5, 6, 7], footprint: { shape: 'star', tips: 5, innerRadius: .43 }
});
S.bake();
const world = B.finish();
```

`footprint` can be a shape name, settings object or `false` to retain Gaussian coverage. It also works on a material's `top` override and through `materialAt`. Builders expose `describeFootprint(first, end, definition)` for directly authored splat ranges.

| Shape | Additional settings |
| --- | --- |
| `circle` | Filled circular silhouette before the covariance transform |
| `square` | Four straight edges |
| `wedge` | Triangle pointing along +X |
| `star` | `tips`: integer 3–12; `innerRadius`: .12–.85; defaults 5 and .43 |
| `cross` | `width`: arm half-width .1–.85; default .32 |
| `chip` | `seed`: unsigned 32-bit integer; deterministic seven-sided irregular chip |
| `polygon` | `vertices`: 3–64 `[x,y]` vertices in the normalized square `[-1,1]²`; concavities use even/odd filling |
| `mask` | `mask: {width,height,alpha}`; 2–128 texels per axis; packed top-down alpha bytes |

All profiles accept `rotation` (radians, −2π through 2π), `stretch: [x,y]` (each .1–4), and `softness` (0–.5). Defaults are 0, `[1,1]` and .08. Positive rotation is counterclockwise in the projected mark plane, whose +Y points up. Masks map their full raster onto the normalized square; alpha ≥128 is inside. Transparent holes and an entirely empty mask are supported. Softness adds a signed-distance feather around the silhouette.

A unit footprint fits the original Gaussian's half-density radius. Stretch transforms the footprint independently of the splat's geometry. A symmetric covariance square root supplies a continuous projected basis, avoiding sudden axis flips when covariance eigenvalues become equal. These are individual projected marks; they do not impose a shared tile grid on a scene.

## Existing worlds and animation

```js
const F = K.splatFootprints;
const slot = F.assign(world, selectedRows, {
  shape: 'square', stretch: [.3, 3], softness: .05
});
F.assign(world, 'all', 'chip');
F.assign(world, selectedRows, false); // restore Gaussian coverage on these rows

// Fast transform-only animation; reuse the silhouette tile and row slots.
F.setTransform(world, slot, { rotation: Math.sin(time), stretch: [1.5, 1] });

// Replace the selected profile, e.g. after painting a new mask.
F.update(world, slot, { shape: 'mask', mask: { width:16, height:16, alpha } });
```

Each world supports up to 64 distinct profiles. Slots are one-based; zero means Gaussian. `assign` validates the whole selection before replacing the layout. `update` replaces an existing slot, keeping repeated editor edits within the profile budget. `setTransform` keeps both the packed row table and silhouette atlas for transform-only animation; the GPU updates just the small profile parameter table. Clear all rows to remove the optional layout entirely.

Profiles and layout containers are immutable. Use these methods to edit them. Typed buffers returned by low-level inspection are read-only by convention; mutating them directly bypasses renderer caching.

`world.splatFootprints` stores a versioned profile table and `Uint16Array` row slots. It travels with builder output, provenance subsets/joins, native instance flattening, bake caches and afterimage snapshots. Added unassigned particle rows retain Gaussian coverage. Density thinning and native LOD protect custom marks from being merged into larger representatives. Bone animation continues to carry their native covariance.

## Rendering, depth and picking

CPU and WebGL colour, owner/index and depth passes use the same silhouette field. Empty areas write no coverage or ownership. Quad and ray-index bounds include rotated/stretched support, so long marks and star tips survive outside the original three-sigma bounds. Custom silhouettes supply their own feathered coverage, taking precedence over Gaussian coverage modes and material `edgeHardness`. Density/opacity and existing optical modulation still apply.

```js
renderer.render(world, { splatFootprints: false }); // compare original marks
renderer.render(world, { splatFootprints: true });
const hit = renderer.pick(world, ray, frame);       // includes current footprint and camera
const report = renderer.describeFrame(world, frame).footprints;
```

The same boolean override works in the software renderer and as `world.look.splatFootprints`. Footprints remain active with `raw:true`; raw affects colour processing. `renderer.pick` supplies the current projection and pixel variance automatically. Direct `K.procedural.contributions` queries without a camera interpret the mark in the query ray's orthogonal plane; provide `footprintView` with `view`, `width`, `height`, `tangent`, `ortho`, `clipNear`, optional `variance` and `snap` for render-space sampling. Physical SDF geometry remains the source for sculpted lighting and baked shadows.

Surface textures and sprite billboards remain independent of splat footprints. They render alongside the shaped marks and obey the same scene depth test. The Foundry checkerboard is a real atlas surface behind the marks, showing transparency through mask holes.

## Budgets and tools

The implementation has no runtime dependencies. Each distinct silhouette is baked once into a 128×128 signed-distance tile. Up to eight tiles share an atlas row; at 64 profiles the atlas is 1024×1024 `R32F` (4 MiB). The per-row table uses 16 bytes per splat and profile parameters occupy 2 KiB. Each shaped fragment uses four nearest texel reads for explicit bilinear interpolation; default splats bypass silhouette sampling. No extra splats or per-frame GPU readbacks are generated. Quad extents retain the renderer's 2048-pixel per-axis cap.

Atlas and row uploads happen on layout/shape edits. Transform-only edits retain these resources. Shared geometry caching is bounded to 128 silhouette fields. `K.splatFootprints.plan(world)` exposes atlas dimensions, prepared styles, packed rows and byte counts. `prepare`, `field`, `distance`, `coverage`, `transform`, `sample`, `layout`, `subset`, `join` and `glsl` are available for custom hosts. The package loader also exposes `SplatFootprints` directly. Custom low-level splat-pipeline hosts can supply `footprintGLSL: K.splatFootprints.glsl` and enable its `footprints` feature; the canvas renderer handles bindings itself.

```sh
node cli/ink-studio.js splat-footprints star --rotation .2 --stretch 1.5,1 \
  --softness .04 --point .4,.2 --preview star.png --out profile.json
node cli/ink-studio.js splat-footprints custom-mask.json --preview mask.png
node cli/ink-studio.js render my-scene.js --splat-footprints off --out original.png
```

The inspection command accepts built-in names or full JSON profiles, reports signed distance/coverage and support, and optionally renders a preview. `--w` and `--h` set a preview size from 16–2048 per axis. The same native render option works for stills and clips.
