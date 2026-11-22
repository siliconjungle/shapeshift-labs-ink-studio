# Interactive cutaways and clipping

Set `cutaway` on a WebGL frame or in the Node renderer options. Issue another frame with a new definition to translate a plane, move a depth window, or change a region mask. The controls operate on the baked scene's current pose, and can be changed independently of the camera and geometry.

Author a default under `finish.look.cutaway` in a diorama or `visual.look.cutaway` in a simulation world. Pass `cutaway: false` on a frame to bypass its authored cut. The CLI accepts `--cutaway file.json` and `--cutaway off`.

| Setting | Meaning |
| --- | --- |
| `planes` | Up to eight world-space half-spaces. Each takes a nonzero XYZ `normal`, an XYZ `point` or scalar `offset`, and `keep: "positive"` (default) or `"negative"`. An offset measures signed world distance along the normalized normal. |
| `depth` | A `[near, far]` interval along the camera's forward axis in world units, measured from the nominal eye. Use `null` for either open end. Orthographic camera setback is accounted for. |
| `regions.include` and `regions.exclude` | A union of included volumes, with the excluded volumes removed. Omit inclusion to start with all space. Each region is a `{ type: "box", min, max }` or `{ type: "sphere", center, radius }`. Use at most eight regions across both lists. |
| `edge` | Optional `color` in six-digit hex, `width` in world units, and `strength` in `[0, 1]`. The tint fades into the retained side of the section. |

Planes, depth, and regions work together by intersection. The renderer evaluates the cut on each fragment, including splats whose centers lie across the boundary. This exposes the geometry behind the cut, with section ink following the visible edge of the authored material.

Native splats and cutout surfaces participate in clipping. Analytic water, atmospheric media, and screen-space drawing layers use their own settings. The section traces existing geometry into the interior of the scene.

Pass the same frame to WebGL `renderer.pick(world, ray, frame)` to pick the remaining splats. `createSplatPicker(world)` also accepts a `cutaway` on each ray. For a camera-relative interval in a headless ray, supply `camera: { eye, back, setback }` where `back` points out of the camera and `setback` defaults to zero. Without a camera, a headless pick measures the interval along the ray.

Draft a section plane from a sightline blocked by foreground geometry in a recorded scene. [Story camera suggestions](story-camera-suggestions.md)

`KIT.cutaway.prepare(definition)` validates and normalizes a reusable definition for scripted callers.
