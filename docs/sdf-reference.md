# Offline path-traced SDF reference

For native stills and clips with route-specific ink and palettes through glass or glossy reflections, see [Ink through reflection and refraction](path-ink.md).

Use [traced lighting](hero-render.md#bake-traced-fill) to bake the reference transport into a native production render.

Trace a few native art frames directly from the finite sculpt fields. The review aligns the
native splat render and the offline reference using the same camera, shot time, and art grid.
Signed distance determines coverage, depth and geometric normals. Authored albedo, or the
last color in the material ramp, supplies base pigment without reading the baked dab colors.

```sh
node cli/ink-studio.js sdf-reference examples/sdf-reference/signal-conservatory.js \
  --out signal-review --t 0,1.4 --w 192 --h 128 --samples 64 --bounces 3 --raw
```

Open `index.html` to compare the two frames. Use **Swipe** to examine the same edge in
both renders. Every frame's images and measurements are also available as PNGs and
`review.json`.

- **Coverage** shows missing and excess splat coverage. Gray marks visible native
  foreground outside the retained fields.
- **Geometry** compares axial depth and the available surface normals. The depth
  tolerance scales with the native world-space pixel footprint.
- **Shading** shows display color differences where coverage, depth and normals agree.
  Look choices and reference exposure can contribute to the difference. Pass
  `--raw` to inspect the native render before finishing.
- **Splat spacing** measures the distance from traced points to the nearest compatible
  baked sample on the same sculpt primitive. At more than 1.35 art pixels, the map
  highlights sparse sampling. Pale violet means no suitably facing sample.
- **Reference noise** compares the two halves of the reference's sample budget.
  Raise `--samples` when the result still varies substantially. The counter for marches
  at the step cap can point to grazing surfaces or fields that need a larger `--steps`.
- **Indirect light** and **Transmission** isolate the radiance carried by those paths.
  A path can contribute to both images. The kiln, green glass and amber screen in the
  example make the two effects easy to locate.

The offline CPU renderer sphere-traces retained finite sculpts, including Boolean
cuts, and samples diffuse reflection over multiple surfaces. It uses the shot's
point and area lights, sun, and sky. Light arriving through an optical material is
attenuated along the interior path. Legacy glass refracts, and thin transmission
layers contribute colored backlighting and diffuse transmission. Visibility to an
analytic light uses straight shadow rays with transmission. The reference uses
base material parameters for thin layers, and the physical render is independent
of native palette quantization, post effects and surface look layers.

The command retains eligible fields while building the scene. In JavaScript,
`S.keepReferenceSdf = true` before `S.bake()` also retains them on the finished
world for tooling. Whole solids and moved or rigged rows are outside the static
field comparison, along with splat-only marks, meshes without a sculpt field,
and volumetric effects. Animated cameras and lights are sampled at each requested
shot time. Use [SDF assist](sdf-assist.md) when you want traced opaque coverage
in the native render with its baked splat colors.

The defaults are 32 camera samples per pixel, three indirect diffuse bounces,
160 field steps per ray, and a surface tolerance of .001 world units. Use
`--bounces 0` for direct-only diffuse lighting, `--steps` or `--epsilon` to
tune the field intersection, `--trace-seed` to vary samples, and
`--reference-exposure` to scale the linear reference before display conversion.
A run accepts up to 12 explicit times, an even sample count, and a combined
budget of six million primary samples. For a dense scene, start with one small
frame and raise the sample count for the final review.
