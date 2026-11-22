# Clip jam

Play an arrangement into existence on the live desk. Each native score
track has its own clip slots. Choose **Beat** or **Bar** to quantize a
launch to the next available boundary. **Stop clip** leaves one track
empty, and **Stop all clips** clears the grid on one shared boundary.
Return effects can decay across the gap.

```sh
ink-studio music session jam source.json bank.json --out arrangement.json
ink-studio music session play arrangement.json
```

Open the printed loopback URL and use **Start pass**. The desk records
from the start of the pass. You can pause and resume on the same clock.
The pass ends on the next bar when you click **Finish at bar**, or at
the bank's bar limit. **Save arrangement** writes a regular session with
editable note clips and sample-addressed automation. Omit `--out` to
download the session recipe in the browser.

## Build a clip bank

The source is a [music edit session](music-edit-session.md) with the patches,
tempo map, and mixer routing you want to play. The jam creates a fresh
arrangement and uses the source's initial harmony. A bank has an optional
`id`, `bars` (1–32, up to 256 beats), `quantize` (`"beat"` or `"bar"`),
and an `initial` table mapping track IDs to clip slot IDs. Leave a track
out of `initial` to start it stopped. Set `clips` to a table of track IDs
with arrays of up to 16 slots each. Omit the bank or its `clips` table to
use the source's placed note clips as slots.

A slot uses the ordinary [note clip format](music-voice-leading.md).
The clip's `length` is its cycle length, and each note's beat is relative
to the clip. The launch sets a new origin for the cycle. When it is
replaced or stopped, the captured clip's `length` marks the actual played
span and `loopBeats` retains the single editable cycle. Separate launches
get their own clip IDs.

**Mute** records a strip input move. It cuts the feed to the strip and
its sends while the clip's phase continues behind the mute. The send
sliders record moves on existing mixer routes. Tracks without sends get
a room send. The jam carries over the desk routing and uses a shared room
return for any production room sends. Launches, mute moves and send rides
become new clip placements and automation lanes in the saved arrangement.

## Demo

```sh
npm run build -- node
node examples/music-production/clip-jam.cjs output/after-the-bell
node cli/ink-studio.js music session jam output/after-the-bell/source.json output/after-the-bell/bank.json --out output/after-the-bell/new-pass.json
```

Open `output/after-the-bell/index.html` to hear the captured twelve bars
and see the clip changes, the empty fifth bar, the bass mute and the lead
echo automation. The demo includes the source, bank, captured session and
the WAVs referenced by its sampled drums.
