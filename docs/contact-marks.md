# Directional contact marks

`KIT.contactMarks` places hand-drawn pixel effects at contact points. A
direct stamp opens along the surface normal. A glancing stamp follows the
tangential motion and breaks into a longer trail. Horizontal and diagonal
cels are drawn separately at both sizes. Ink selects one of eight screen
directions from the camera and uses whole-pixel quarter turns.

```js
const marks = K.contactMarks.create({
  directAt: .7, speedReference: 6, largeAt: .67, lift: .02
});
const impact = {
  point: [1, 1.25, .4], normal: [1, 0, 0],
  velocity: [-9, -.3, 0]
};
const mark = marks.track([{ ...impact, time: 1.2 }]);

// World-depth cards for the headless renderer.
const spriteAtlases = mark.placements();

// Or add this camera-aware screen overlay to look.composite.layers.
const overlay = mark.layer({ resolution: [272, 158] });
```

The overlay works in the CPU and WebGL compositors. It draws over the
world image. Use the headless atlas cards when a foreground object should
cover the mark. Cards retain their authored pixel sizes when the camera
moves. Both paths use the presentation clock (`interfaceTime`), so the pose
can hold as the flash and sparks play through. Keep the overlay resolution
at the desired native art grid and its filter at nearest.

## Contact and clip options

- `point` and `normal` are world XYZ. Use an outward normal and an incoming
  `velocity`. Ink compares the inward component of the unit velocity against
  `directAt`. A contact without velocity defaults to a direct mark.
- An optional `heading` supplies the preferred travel direction. Ink
  projects it into the contact plane. When a direct normal projects to
  almost a point, this tangent also gives the mark a fallback direction.
- Set `kind` to `direct` or `glancing` to select a family explicitly. Size uses
  normalized `strength` when supplied, then `speed` or the velocity's length
  relative to `speedReference`. Set `size` to `small` or `large` to choose
  explicitly. Both controls default to `auto`.
- `lift` moves the card out along the normal in world units. `time` starts
  the mark in seconds. A `period` can repeat it. The period must cover the
  full clip. Each track accepts up to 128 contacts.

Open **Library clips** in the [Pixel Stamp Workshop](../examples/pixel-stamp-editor.html)
to edit each cel. For example, use `K.pixelStamps.clip('contact-glancing-large-ne')`.
Pass custom clips to `create({ clips: { 'contact-glancing-large-ne': edited } })`.
Each size and family pair shares an odd square canvas, palette, center pivot,
and frame holds between its `east` and `ne` clips. Recolor the library cels with
`swatches` using `ash`, `ember`, `heat`, `edge` and `core`.

## Connect an animation or material contact

```js
const clip = K.anim.clip({
  duration: 3.2,
  cues: [K.anim.cue('hammer-hold', 'freeze', 1.2, { duration: .12 })],
  events: [{ name: 'contact-mark', time: 1.2, data: impact }]
});
const marksForClip = marks.fromClip(clip, { period: 3.2 });
```

`fromClip` reads named source markers and maps them through the clip's
holds and slowdowns. `fromEvents` accepts events already timed on the
presentation clock. Use its optional `name` to subscribe to another marker
name. Material contact records with a point and normal can go straight
into `track` once the host adds presentation time. Use measured `heading`
and `strength`, and add velocity or set `kind` when the source supplies only
a scalar speed. [Material contact records](contact-effects.md) · [Animation events](animation-events.md)

## Examples

[Foundry Bell and Rivet Rail](../examples/contact-mark-studies.js) use named
clip events. The hammer holds at a direct strike while the crescent opens.
The rail study has a long diagonal skid and a second, smaller scrape.

```sh
node cli/ink-studio.js clip examples/contact-mark-studies.js --w 272 --h 158 --px 1 \
  --from 0 --to 3.2 --fps 25 --out foundry-bell.png
node cli/ink-studio.js clip examples/contact-mark-studies.js --params '{"study":"rail"}' \
  --w 272 --h 158 --px 1 --from 0 --to 3.2 --fps 25 --out rivet-rail.png
```
