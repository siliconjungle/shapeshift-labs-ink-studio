# Stock performance instruments

The instrument library ships three editable instruments with original, seeded
audio material. The two pitched instruments are native [modular patches](music-instrument-graphs.md).
Rivet Box uses the [sample kit](sample-kits.md) and can be played from
[pad patterns](pad-patterns.md), edited performance events, or score events
routed by MIDI note.

```sh
ink-studio music production instrument-library
ink-studio music production instrument-pack cinder-flute --out flute
ink-studio music production instrument-pack copperline-bass --out bass
ink-studio music production instrument-pack rivet-box --out rivet
```

Each export contains `instrument.json` and its WAVs. An optional settings JSON
sets `sampleRate` and `seed`. The defaults are 32000 Hz and seed zero. The same
settings reproduce the takes. The manifests contain an editable patch or kit
and a table of relative asset paths. For a pitched production, put the
manifest's `patch` in `production.patches` and add its assets to the recipe.

In JavaScript use `KIT.music.production.instrumentLibrary` and
`KIT.music.production.loadInstrumentPack(name, options?)`. A pack supplies
`patches`, `kit`, the named PCM `assets` and a playing `guide`. Directed graphs
use `music.instrumentLibrary` and `music.loadInstrumentPack`. Send a pack's kit
and assets to `music.renderSampleKit`. The same assets and named patches can
feed `music.renderProduction` or a live edit session.

For recorded reed, metal, drums and bass with a portable WAV bank and stock mix racks, see the [native sound library](native-sound-library.md).

## Cinder Flute

A pitched tube resonator and a sine reed sit beside filtered air noise. A
tongued strike has its own transient takes. Key-up plays a separate exhale.
Breath drives the airflow and tone together, pressure adds reed harmonics
and contact changes how the noise excites the tube.

Play a quiet attack at velocity 0.43 or lower to get the longer, airier
`whisper`. Repeating the same note nearby triggers `tongue`, with rotating
attacks. Nearby changes within seven semitones use a directional onset and
pitch glide. End into a gap to hear the `exhale`. The recommended range is
MIDI 55–89. All four note-expression lanes are editable.

## Rivet Box

| Pad | MIDI | Playing |
| --- | --- | --- |
| Anvil | 36 | Soft heel and harder layered hammer. Play `muted` for a dry low strike. |
| Latch | 38 | Cap-to-clank dynamics. Use `ghost` for brush contact or `flam` for two offset strikes. |
| Spring | 42 | Brush-to-spring dynamics. Use `drag` for a short friction pickup and hit. |
| Plate | 49 | Felt-to-bar velocity crossfade, explicit `felt` and `rim` hits, and a hand `damp`. |
| Scrape | 54 | Gated sheet friction with a crossfaded sustain and a hand-off take at note-off. |

The plate and scrape share a choke group, so grabbing the plate also stops
the scrape. Play the scrape with a positive duration or `until` address.
The pad engine keeps independent take rotation for each active layer.
The return can continue ringing after a grab.

```json
{
  "options":{"sampleRate":32000,"map":{"tempo":108},"duration":4},
  "events":[
    {"id":"felt","pad":"plate","time":{"beat":0},"velocity":0.24},
    {"id":"bar","pad":"plate","time":{"beat":2},"velocity":0.85},
    {"id":"grab","pad":"plate","articulation":"damp","time":{"beat":2.5},"velocity":0.46},
    {"id":"drag","pad":"scrape","time":{"beat":3},"until":{"beat":5},"velocity":0.73}
  ]
}
```

```sh
ink-studio music production play-kit rivet/instrument.json hits.json --out take
```

The command prints an aligned mix, pad and return stems, and a report showing
the chosen takes, velocity weights, releases and chokes.

## Copperline Bass

A low string fundamental, short pickup harmonics and a position-sensitive
modal bank share the same note pitch. Pressure and contact move the sound
between fingerboard and bridge. Damping shortens the ring. Touch, rake,
fret movement and lift are different original sample banks.

At velocity 0.40 or lower the attack uses a quieter finger sample and a
darker pickup response. Repeated stronger notes rake. A gap under the
connection threshold selects directional slides for intervals up to nine
semitones. Choose `mute` for a palm-stopped note, or `ghost` for a short fret
tick. Leave room at the end for the fret lift. The recommended range is
MIDI 28–67. For independent hands or counterlines, write separate clip voices.

The string patch uses modal synthesis with pluck and damping controls.
The performer controls have a precedent in [Jaffe and Smith's plucked-string research](https://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf).
