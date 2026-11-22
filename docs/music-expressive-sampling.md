# Expressive sampling

`expressive-reed` in Breath & Reed uses a shaped airflow source and a
looped harmonica sustain. Lean in with pressure to bring the pitched
recording forward. Use aftertouch, the live desk's Pressure slider or
a per-note `play.curves.pressure` lane. G4→C5, C5→E5 and G4→C4 use
recorded legato joins that crossfade into the destination sustain.
Overlap the keys in the live desk. For an authored score, the patch also
joins notes with a gap of up to 38 ms and places the transition's pickup
before the written destination note. Other intervals play a fresh attack.

`expressive-plate` in Struck & Scraped Metal blends soft and hard
cymbal-bell recordings as strike velocity increases. It cycles through two
alternate performances, keeping the mid and stereo room microphones on
the same alternate and playback clock. Use `play.room`, a
`play.curves.room` lane, CC91 or the live desk's Room slider to move from
the direct mid mic to the room pair. The balance can move during the
decay of a single strike.

## Listen and edit

```sh
npm run build -- node
node examples/music-production/expressive-sampling.cjs output/sill-lights
```

Open `output/sill-lights/index.html` for matched phrases, isolated strike
and mic studies, and an eight-bar cue. Each WAV comes with an editable
production recipe. From the same folder, open the take desk with
`ink-studio music session play live-session.json live-loop.json`.

The ascending joins are from [Amalialloren's CC0 harmonica glissando](https://commons.wikimedia.org/wiki/File:Glissando_ascendent_de_l%27harm%C3%B2nica.wav).
The descending join is from [mastermesh's public-domain harmonica recording](https://commons.wikimedia.org/wiki/File:Harmonica.ogg).
The paired ride-bell takes are from [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums/tree/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc),
performed by Austin McMahon and released under CC0 by Versilian Studios
and Karoryfer Samples. The export's `pack.json` lists source files,
crop ranges and licenses.
