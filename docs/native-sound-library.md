# Native sound library

These packs play recordings released under CC0 or dedicated to the public domain through Ink's native sampler,
instrument graphs and mixer. The WAVs ship with the repository. Each export
includes its own WAVs, source credits, editable example performances and a
macro rack.

| Pack | Play it | Included rack |
| --- | --- | --- |
| **Breath & Reed** | Recorded diatonic harmonica over MIDI 57–79, with soft and normal velocity zones and an explicit `vib` articulation. Each sampled root and articulation has a recorded key-up. `breathing-reed` keeps those takes and adds an airflow model with breath, pressure and contact controls. `expressive-reed` moves from air to pitched tone with pressure and adds three recorded legato joins. | Porcelain Room |
| **Struck & Scraped Metal** | Two brake-drum alternate strikes per velocity range, plus recorded cymbal, gong and bell-tree scrapes. `tuned-metal` excites a pitched modal resonator from the recorded hammer attack. Contact position changes the balance of modes. Damping changes how quickly the body stops ringing. `expressive-plate` blends soft and hard cymbal-bell takes with a playable direct/room balance. | Pocket Repeater |
| **Drums & Bass** | Acoustic kick, snare, rim and hats, and electric bass over MIDI 26–44. Use `pick` for the picked bass. The Yard Kit includes the four drum pads, velocity crossfades and hat choking. | Steel Bus |

## Export and play

```sh
ink-studio music production sound-library
ink-studio music production sound-pack breath-and-reed --out reed
ink-studio music production render reed/phrases/reed-modelled.json --out reed-print
ink-studio music production sound-pack drums-and-bass --out rhythm
ink-studio music production play-kit rhythm/kit.json rhythm/kit-performance.json --out yard-print
```

The main `pack.json` includes named native production patches and asset paths
relative to the manifest. An example recipe can be used directly through
`music production render` or adapted into a larger score. The same patches and
assets can feed a music edit session. For headless JavaScript, use
`require('@shapeshift-labs/ink-studio').loadSoundPack(id)` to get decoded
`assets`, `patches`, `rack`, `credits` and the drum `kit` where available.
Use `rack.json` with [Ink's rack commands](audio-racks.md).

The selected recordings were trimmed, gain-staged and converted to 32 kHz. The expressive plate retains the paired stereo
microphones. The pitch map retains selected recorded roots. The reed uses
phase-aligned crossfades for sustain and separate source recordings on note-off.
See the per-file lineage in the exported manifest. The recordings were made by
[Versilian Studios](https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e)
and [Andrea Biasior for FreePats](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html).
The exposed example phrases are editable Ink scores.
[Expressive sampling](music-expressive-sampling.md) covers the additional
recordings, controls, and listening comparisons.

## Hear the packs

```sh
node examples/native-sound-library/demo.cjs output/night-shift
```

Open `output/night-shift/index.html`. The matched reed and metal comparisons
use the same note events for each pair. The rack comparisons also use matched
levels. The title cue uses all three packs and comes with its editable score
and relative audio paths.
