# Pixel-art craft and tooling research

A pixel-first workflow treats silhouettes, color clusters and individual
pixel positions as authored data. A 3D projection or paint-over can supply
reference, proportions and occlusion. The output drawing still needs its own
decisions about which pixels describe a shape.

## Research method

Broad discovery and technique review have different evidence. Lospec listed
586 tutorials when checked on November 24, 2026. Saint11's short tutorials,
Slynyrd's numbered Pixelblog catalogue, and Bilibili creators' public outlines
broaden the topic coverage. These sources overlap. A listing, a chapter in a
course, a rehost and a tutorial studied in detail are different units.
[Lospec tutorials](https://lospec.com/pixel-art-tutorials) · [Saint11 tutorials](https://saint11.art/blog/pixel-art-tutorials/) · [Slynyrd’s catalogue](https://www.slynyrd.com/pixelblog-catalogue) · [像素熊老师’s tutorial series](https://www.bilibili.com/video/BV1Ry4y1E7EJ)

A separate discovery run screened 1,970 distinct titles from 3,526 public
search rows on Sepia Search. Eleven titles survived the first heuristic.
Even that small result contained irrelevant titles on inspection. This
search establishes the size and noise of a discovery pass. The tutorial
evidence comes from creator catalogues and individual lessons below.
[PeerTube search API](https://docs.joinpeertube.org/api-rest-reference/api/video.html#search-videos)

The technique map draws on the linked artist-authored lessons. For each
technique it identifies an authoring primitive or inspection task that can be
tested on a small original drawing. Different styles use different budgets.
Every review needs a specific art grid, role palette, and set of approved
exceptions. [Cure’s pixel-art tutorial](https://pixeljoint.com/forum/forum_posts.asp?TID=11299) · [Derek Yu’s workflow](https://derekyu.com/makegames/pixelart.html)

## Technique map

| Technique | Tooling and acceptance evidence | State |
| --- | --- | --- |
| Native canvas | Fix the drawing dimensions before building assets. Export exact palette slots and integer-scale the preview. Compare at 1× as well as enlarged. | Added |
| Silhouette blocking | Start with one readable mass at native size. Keep silhouette and lighting on named layers so a revision to shading stays clipped. | Added |
| Negative space | Draw openings and the gaps between parts explicitly. Lock a gap and verify it survives further passes. | Added |
| Cluster sketching | Draw large connected masses for light and shadow, then refine boundaries. Preview each construction layer and compare major areas at native size. | Layered drawing added. Layer isolation still needed. |
| Pixel placement | Inspect exact grid coordinates, swatches and owners. Store precise reversible edits in their own layer. | Added |
| Diagonal runs | Draw straight inclines as repeated runs and use deliberate length changes for curves. Inspect the run sequence and propose edits for uneven steps. | Authoring added. Segment analysis still needed. |
| Doubled corners | Flag accidental L-shapes at one-pixel stroke joints. Keep branches and intentionally thick endpoints. | Local review added. Stroke-aware classification still needed. |
| Lone pixels | Offer connected shape edits for noise and protect sparse detail when it carries the design. | Review and protection added |
| Palette roles | Author named swatches. Allow distinct materials to share neutral and shadow swatches where they help unify the image. Check for unintended near-duplicate colors. | Exact roles added. Role-family analysis still needed. |
| Value separation | Review shapes in grayscale and measure contrast along the focal silhouette. Use large value groups before spending more colors. | Ink has subject contrast checks. Add a native design preview and local feedback. |
| Hue shifting | Define light and shadow ramps under a shared light. Preview skin, metal and cloth together to see where their ramps should share tones. | Ink has palette ramps and charts. Add multi-asset role checks. |
| Form shadow | Build one connected shadow mass with a clear orientation. Compare against the approved silhouette and a simple lit plane or volume. | Clipped layers added. A light-group sketch pass still needed. |
| Cast shadow | Give cast shadows separate shapes and reference the occluder. Keep the anchor consistent while inspecting contact and separation in motion. | Painted cutouts exist. Add an editable native shadow drawing lane. |
| Material highlights | Draw a small sharp glint for glossy material and a broader mass for dull material. Use reusable cels when a light or pose changes. | Native highlight cels exist. Add a shared authoring and comparison command. |
| Selective outline | Choose line color, length and omission where it supports the form. Check outside edges against light, dark and moving backgrounds. | Ink has scoped line rules and indexed masks. Add backdrop contact sheets and layer suggestions. |
| Manual AA | Put a limited intermediate color at chosen contour transitions. Compare line weight and shape before and after on the actual background. | Exact edits added. Edge-specific previews still needed. |
| Banding | Flag parallel single-pixel ribbons that weaken a shape. Compare the contour and change the cluster rather than blurring both bands. | Local review added. Multi-color boundary tracking still needed. |
| Pillow shading | Look for shadow on every side of a volume. Compare the major light and shadow masses against a declared light direction. | Ink has raster lint and light fitting. Add labeled evidence per form. |
| Dither transitions | Draw an explicit mask and a named swatch pair. Match the pattern’s orientation and density to the surface, with quiet regions left solid. | Engine dither controls exist. Add mask authoring and contrast feedback per swatch pair. |
| Texture hierarchy | Use grouped marks with a scale and direction that describe the material. Keep quiet areas and check detail density relative to the focal point. | Rest-space materials and stable detail exist. Add cluster-scale reports and previews. |
| Atmospheric depth | Group depth planes by value, contrast, hue and texture density. Compare the scene with its background against the whole frame. | Ink has palette fields and atmosphere controls. Add a native value-blocking view. |
| Projection | Keep directions consistent across architectural features. Check repeated edges against the same native step pattern. | Drawing runs added. Add an art-grid perspective and 2:1 isometric guide. |
| Tile joins | Draw compatible edges then preview large runs with quiet, dense and accent variants. Flag unexpected seams and repeated high-contrast landmarks. | Ink has tiles and reconnecting cels. Add adjacency sheets and repeat metrics. |
| Subpixel motion | Animate when pixels and clusters move or change roles. Review a hold, a short move and a turnaround with palette and motion evidence. | Ink tracks cluster coherence. Add tabular, native-cel fixes. |
| Pose silhouettes | Draw readable key poses and track contact, separation and spacing. Use holds and purpose-drawn breakdowns for fast gestures. | Ink has pose and motion review. Add native silhouettes to the same capture. |
| Small-size redraws | Save an approved drawing for each meaningful size or angle. Keep the important gaps, head shape and accents when the representation changes. | Stamp placement and view atlases exist. Add an exact-grid approval and redraw workflow. |
| Scene assembly | Start background, foreground and focal art as independent native planes. Inspect occlusion and matching pixel density at their joins. | Named-object capture, stamp reuse, and selection reprojection across bound views. Multi-object captures still needed. |

The shape and lighting rows use the artist's examples on cluster construction,
directional shadows, hue, value and hand-placed intermediate pixels.
[Saint11 on clusters](https://saint11.art/pixel_art_articles/article2/) · [shading](https://saint11.art/pixel_art_articles/article4/) · [anti-aliasing](https://saint11.art/pixel_art_articles/article5/) · [color](https://saint11.art/pixel_art_articles/article6/)

The environment rows use texture grouping, tile reuse, parallax and directional
water motion as separate authoring problems. The indexed tile structure is
also documented by Aseprite. [Slynyrd on texture](https://raymond-schlitter.squarespace.com/blog/2018/2/15/pixelblog-2-texture) · [top-down tiles](https://www.slynyrd.com/blog/2019/8/27/pixelblog-20-top-down-tiles) · [water in motion](https://www.slynyrd.com/blog/2018/10/12/pixelblog-10-water-in-motion) · [Aseprite tilemaps](https://aseprite.org/docs/tilemap/)

## Next integration

1. **Expand named-object capture to complete shot layers.** Capture the
   mesh or SDF silhouette, visible material IDs and a native swatch grid.
   Accept replacements for whole shade clusters and contours. Store locks
   on subject silhouettes, holes and important details. Reuse the same
   authoring operations on sprites and fixed-angle backgrounds.
2. **Keep corrections attached through motion.** Extend Ink's existing shot
   corrections and surface coordinates where this requires mesh UV, SDF rest
   space or strand stations. Give artists a per-view cel when a rotated
   drawing needs to change shape. Review disocclusions, cuts and view handoffs.
3. **Test the workflow on paintings.** Use artist-approved original shapes,
   palette roles, and motion. Compare an agent's direct render to its revised
   result at 1× and in motion. Keep named exceptions in the fixtures so that
   lowering a lint count cannot remove the drawing's strongest accents.

The first implementation is the [native authoring command](pixel-art-authoring.md).
It reuses the existing stamp renderer and the existing critic, with exact
coordinates and an edit contract. Mature render-side equivalents include
[material color clusters](pixel-look.md#material-color-clusters),
[cluster motion and shot corrections](cluster-coherence.md) and
[protected native details](protected-pixels.md).
