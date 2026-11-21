# Animated pixel tiles

`KIT.pixelTiles` joins editable pixel-stamp cels along a grid and lets an
authored cue travel around bends, into caps, and through forks. A copper
trace can cool back to its idle art. Frost can keep the final cel at every
cell it reaches. Both use exact palette entries and one transparent raster.

```js
const route = K.pixelTiles.create({
  width: 8, height: 6, style: 'copper', forkHold: .08,
  paths: [
    [[0, 3], [4, 3], [4, 1], [7, 1]],
    [[4, 3], [4, 5], [6, 5]]
  ],
  cues: [{ at: [0, 3], time: .5, period: 4 }]
});

const layer = {
  resolution: [route.w, route.h], filter: 'nearest',
  source: ({ time }) => route.raster(time)
};
// Add layer to look.composite.layers, or use route.raster(time) on a sprite surface.
```

Coordinates are tile cells, with X right and Y down. Each path is a polyline
of horizontal and vertical segments. Long segments connect all intervening
cells. Paths that share a cell join there. Parallel or adjacent paths only
connect along a segment the artist draws. A shared four-way cell sends the
pulse in all connected directions.

## Draw the tile cels

The workshop's **Library clips** includes copper and frost caps, straights,
bends, forks and four-way crossings. Start with a library clip such as
`K.pixelStamps.clip('tile-frost-bend')`. You can also load it into the
[Pixel Stamp Workshop](../examples/pixel-stamp-editor.html) and save an edited
clip. The built-ins are 10×10 pixels.

Supply `clips: { ES: editedBend }` to replace the east-to-south bend. Letters
name the ports in `NESW` order. The standard shapes use `S`, `NS`, `ES`,
`ESW`, and `NESW` respectively. Ink rotates and, when needed, mirrors those
templates in whole pixels. Entry direction picks the oriented artwork when
the template matches that entry. For example, a straight gets a different
orientation when the pulse enters from below. A fork entered from a side
can use a separately authored cel. An exact port key takes precedence over
a transformed template and keeps its authored orientation.

- Each connected edge has exactly two opaque pixels in the middle. The
  rest of the edge stays transparent in every cel. Ink checks this when
  the layout is built.
- Frame 0 is idle. A pulse starts with frame 1, holds frame 2 at the crest,
  and releases its neighbors at the end of that frame. `forkHold` adds
  seconds to frame 2 on forks and crossings. The tail can keep playing while
  the next tile lights up. Use `after: 'hold'` to retain the last cel or the
  default `'idle'` to return to frame 0.
- A smaller or larger even `size` from 4 to 32 takes clips with matching
  dimensions. Use 4–32 cels. The two-pixel socket rule applies at every size.
- Set `swatches` to replace roles in the built-in art. Both styles offer
  `shadow`, `lit`, and `peak`. Copper adds `trace` and `warm`. Frost adds
  `ice` and `blue`. Custom clips use their own palettes. If they reference
  scene colors, pass `{ scenePalette, paletteRoles }` as the second argument
  to `create`.

Every cue has a start cell and a `time` in seconds, with an optional repeat
`period`. When a wave reaches a cell along multiple paths, the earliest
arrival for that cue wins. A wave does not circulate around a closed loop.
At a cell hit by more than one cue, the most recent arrival supplies the
cel. Frames can be rendered or scrubbed in any order. Use `route.cells` to
inspect the layout and `route.sample(x, y, time)` to read the current
frame, age, and entry side for one cell.

## Examples

[Copper Relay and Rime Window](../examples/tile-pulse-studies.js) use the same
tool. The falling glyphs charge a tray that sends a pulse through the copper
branches. In the window study, the ice keeps its final cels along the frame
and mullions after the bright edge has passed.

```sh
node cli/ink-studio.js clip examples/tile-pulse-studies.js --w 280 --h 174 --px 1 \
  --from 0 --to 6 --fps 25 --out copper-relay.png
node cli/ink-studio.js clip examples/tile-pulse-studies.js --params '{"study":"frost"}' \
  --w 280 --h 174 --px 1 --from 0 --to 8 --fps 25 --out rime-window.png
```
