# Animated pixel tiles

Use [tilemap placement and tile-pixel editing](pixel-art-authoring.md#place-tiles-and-edit-their-pixels)
to draw a layout of shared tile images in the Pixel Stamp Workshop.

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

## Reconnect the paths inside a tile

`K.pixelTiles.reconnect()` gives a tile more than one way to pair its
external sockets. The same four edges can connect north–east and south–west
in one variant, then north–west and east–south in another. A cue changes the
pairing and plays the authored cels across the selected cells.

```js
const board = K.pixelTiles.reconnect({
  width: 12, height: 8, size: 8,
  ...K.pixelTiles.pairedArcs(8, { wave: '#215bbf', spark: '#70d3fa' }),
  initial: ({ x, y }) => (x + y) % 2 ? 'a' : 'b',
  period: 5,
  cues: [
    { time: .3, duration: .52, next: { a: 'b', b: 'a' },
      wave: { from: [0, 4], speed: 8 } },
    { time: 3, duration: .4, next: { a: 'b', b: 'a' },
      wave: { direction: [-1, .4], speed: 10 } }
  ]
});
const frame = board.raster(time); // { w, h, rgba }
const route = board.trace(1, 2, 'N', time);
```

- Set `initial` to a variant ID, a row-major array of IDs, or an XY callback.
  Each entry in `variants` has a single indexed `cel` and `pairs`, such as
  `['NE', 'SW']`. A port may occur in just one pair. Adjacent cells must agree
  on their shared edge. Outer sockets can terminate at the grid boundary.
- Give each transition `from` and `to` variant IDs, an indexed `clip`, and
  optionally one `stages` entry per cel. `'from'` and `'to'` expose the
  corresponding route. `'open'` interrupts both connections and is the
  default. All cels keep the same exact two socket pixels on each used edge.
- A cue takes a destination `to` or a `next` map. IDs omitted from the map
  keep their current variant. A changed variant needs a matching authored
  transition. `sample(x, y, time)` reports the visible pairing and active
  stage. `trace` follows that pairing until reaching an edge, open arc,
  absent entry, or a loop.
- Library clips are separately drawn at **8×8 and 12×12** and editable in
  the [Pixel Stamp Workshop](../examples/pixel-stamp-editor.html). Start
  with `tile-reconnect-8-a-b` or `tile-reconnect-12-a-b`. Custom artwork can
  use any even size from 4 to 32. The [original wave study](https://x.com/tuukzs/status/2124292540463493219)
  shows the broken arcs that inspired the transition.

## Turn selected cells or glyphs

`K.pixelGrid.turn()` accepts any aligned RGBA8 tile sheet or glyph raster.
A cue turns selected artwork in place by signed quarter turns. It can turn
a cell containing one glyph or a larger cell containing an entire motif.
Input cells that are taller or wider are centered on a padded square so
their texels fit through the whole turn. The output is equally spaced,
including cells outside the selection.

```js
const turns = K.pixelGrid.turn({
  width: 16, height: 8, cell: [6, 8], // e.g. K.glyphGrid.paint().raster(frame)
  cues: [
    { rect: [2, 2, 8, 3], time: .5, duration: .55, turns: 1,
      wave: { direction: [1, 0], speed: 8 } },
    { cells: [[13, 1], [13, 4]], time: 1.2, duration: .4, turns: -1 }
  ]
});
return turns.raster(glyphRaster, time);
```

Each quarter turn steps between exact orientations at its midpoint.
Supply `between({ x, y, size, from, to, direction, progress, time })` to paint
an intermediate pose. Return a square `{ w, h, rgba }` authored relative to
orientation zero. Ink applies the starting orientation on the integer
grid. Return `null` to use the stepped pose for that cell. `from` and `to`
are clockwise quarter indices from 0 to 3. `progress` is within the current
quarter and `direction` is 1 or -1. Standard cels and arbitrary raster
art share the same path.

Both tools accept `rect` or explicit `cells` to select a subset. Omitting
both targets the whole grid. `wave.from` measures radial distance from
an XY point. `wave.direction` measures distance along a vector from the
first selected cell it reaches. Wave speed is in cells per second.
Cues on different cells can overlap. At the same cell, cues must finish
before the next starts. To define a seamless `period`, include the cues
that return each cell to its initial state by the end. Samples are seekable.

[Tide Seal and Glyph Relay](../examples/reconnecting-grids.js) show the
route changing on a limestone inlay and selected banks of glyphs turning
on a display.

```sh
node cli/ink-studio.js clip examples/reconnecting-grids.js --w 272 --h 166 --px 1 \
  --from 0 --to 6.4 --fps 15 --out tide-seal.png
node cli/ink-studio.js clip examples/reconnecting-grids.js --params '{"study":"glyphs"}' \
  --w 272 --h 166 --px 1 --from 0 --to 6.4 --fps 15 --out glyph-relay.png
```

[Rule boards](rule-board.md) use the same socket conventions and integer
turns to compile an editable arrangement of tiles and glyphs into a
runnable graph.
