# Acoustic ambience zones

An `acoustic-ambience` world system turns rooms, doors, weather, and shelter
into a mix for looping PCM beds. Name each zone after the stem part it
drives. Wind, rain, wildlife, and machinery each keep their playhead as
the listener moves.

```json
{
  "kind": "acoustic-ambience",
  "config": {
    "listener": { "entity": "listener" },
    "hearing": "acoustics/audible",
    "zones": {
      "rain": {
        "from": [-1.7, 1, 0.36],
        "weather": { "field": "weather/rain", "range": [0, 20] },
        "cover": { "field": "weather/roof", "shelteredBands": [0.51, 0.23, 0.042] },
        "ramp": 0.32
      },
      "machinery": {
        "from": { "entity": "pump", "socket": "motor" },
        "gain": 0.95,
        "ramp": 0.3
      }
    }
  }
}
```

The `hearing` field defaults to `acoustics/audible`. Its
[acoustic layout](acoustic-queries.md) supplies room bounds, apertures, and
their live opening fractions. A zone's `from` is an XYZ point or an entity
or socket selector. Use `fromRoom` for a named exterior reservoir. Distance
and aperture losses apply to the three bands from the same acoustic path.
Attenuated paths remain audible at their estimated gains. Blocked paths and
missing endpoints give silence.

A zone can set a normalized `gain` and optional XYZ `bounds` with a
`feather` distance. The footprint is full inside the box and fades linearly
outside it. Omit the box for a bed that can be heard through any available
path. For example, use a footprint for a localized wildlife bed and leave
a machinery bed audible through nearby connected rooms.

`weather` samples at the source and scales the whole bed. `cover` samples
at the listener and blends each band toward `shelteredBands` as the cover
level rises. Either binding can set `at` to another point or entity and
`path` to read from a record field. Numeric and boolean samples map through
`range` to zero through one. Missing readings use the optional normalized
`default`, which defaults to zero. An omitted weather or cover binding
leaves that part of the mix neutral. `ramp` is in seconds and defaults to
0.12. The default emission threshold `epsilon` is 0.002 per band. Set it
to zero to publish every change.

## Play or replay the mix

Add matching parts to the score's [phase-aligned stem groups](music-live-adaptive.md#loop-phase-aligned-stems).
For a live host, read `ambience/mix` from its initial world query and pass
the zone bands as `ambienceGains` when opening the score. Dispatch the
committed `music-ambience` events as the world advances.

```js
const mix = run.query().probe('ambience/mix').value;
const ambienceGains = Object.fromEntries(
  Object.entries(mix.zones).map(([part, zone]) => [part, zone.bands])
);
const score = live.open(sources, timeline, { ...options, ambienceGains });
```

Ink applies the gains to low, mid, and high portions of the stem and ramps
new targets from their current values. The crossovers are 350 Hz and 2600 Hz.
The established layer fader still applies to the bed. Acoustic beds and
their room sends stay on the world side of a score-space fade.

For a portable replay, add `"ambience": "ambience"` to the adaptive score
capture settings, using your world system's name. The trace preserves the
initial bands and the subsequent changes.

```sh
ink-studio music rehearsal capture world.run.json capture.json --out world.trace.json
ink-studio music live replay score.json world.trace.json --out mix
```

Probe `ambience/mix` to inspect the position, rooms, weather, cover, footprint
weight, path status, and per-band gains. The live report records retargets
and the exact sample frames of their ramps.

## The Pump House

```sh
node examples/music-production/acoustic-ambience.cjs ./pump-house
```

In `pump-house/mix/score.wav`, the weather strengthens at 1.80 s, then an
awning softens it as the listener approaches the building. The front door
closes at 6.10 s. At 7.80 s, opening the gate brings the pump into the hall.
As the listener walks through it, the pump becomes direct. Both rooms, the
movement, and the weather fields are editable. See `positions.json` for the
mix at seven places along the walk.
