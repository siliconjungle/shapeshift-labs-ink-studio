# Dance drop studies

Ink ships three editable dance arrangements, with native instruments and a desk for each.

```sh
ink-studio music production drop-studies --out drops
ink-studio music production drop-studies dubstep --out dubstep-study
ink-studio music session render drops/rave/session.json --out new-print
```

Pass `dnb`, `dubstep` or `rave` to export a single study. Each folder has a 48 kHz stereo WAV, session, and mix report. Patches and scores live inside the session JSON. Reusable synth patches are also exported under `instruments/`. Keep the shared `samples/` directory next to the study folders when moving them.

## Stairwell · drum & bass · 174 BPM

A chopped [acoustic break recorded by EatMe](https://archive.org/details/108_bpm_breakbeat_to_use) carries the performance. The new kick and snare sit in front of it, with a detuned Reese over a mono sub. A kick-keyed low shelf controls overlap in the sub and Reese. The short synthetic bell cue marks the start and return.

The audition report orders five prints across beats 8–24. The tight kick and crack snare are the reference. The next two prints swap the kick, and the last two swap the snare. Each candidate lists its input trim and playback gain. All five render the same break, Reese, notes and mixer routing. The key detector follows the drum heard in each take. The WAVs share a playback loudness target so the comparison reflects envelope and tone.

`kick-bass-adjustment.json` records the written, trigger and estimated audible gaps. Ink measures the onset of the isolated kick and sub voices before the mixer. The same trigger edit moves the Reese with the sub. `kick-bass-late.wav` and `kick-bass-aligned.wav` play the same cue with the original and revised pocket at matched loudness.

```sh
ink-studio music groove inspect drops/dnb/session.json drops/dnb/kick-bass-focus.json
ink-studio music session render drops/dnb/auditions/tight-wood.json --out wood-snare-take
```

## Underbite · dubstep · 142 BPM

A bright FM vowel opens the call. A lower, ragged filter growl answers. The bass phrases alternate, with real gaps after the replies and a longer break before the second drop. A separate mono sub follows each phrase.

Both patches use editable note expression from Ink’s [modular instruments](music-instrument-graphs.md). Change a note’s `play` value or its curves in `session.production.tracks.vowel` and `session.production.tracks.growl`. The same patches accept expression in [session performance captures](music-edit-session.md#record-straight-into-take-lanes).

| Control | Response |
| --- | --- |
| `breath` | Moves the formants on the call and opens the resonant filter and FM edge on the reply. |
| `contact` | Sweeps the rhythmic pulse from two to six cycles per beat at the study tempo. |
| `pressure` | Sets the depth of the pulse. Leave it low for a sustained vowel. |
| `pitchCents` curve | Shapes scoops and releases. |

The LFO base is `142 / 60` Hz in both patches. Set it to the new BPM divided by 60 when changing the whole session tempo.

## Arc Lamp · rave · 150 BPM

A seven-oscillator supersaw plays the whole hook over four-on-the-floor kick and offbeat bass. A quiet octave inside the lead lane lifts selected notes in the second pass. The shared oscillator anchors the stereo lead in mono. Short room and filtered tempo delay carry the note tails.

## Underbite gesture takes

```sh
ink-studio music production drop-gestures --out underbite-takes
ink-studio music session inspect underbite-takes/kept-session.json
ink-studio music session audition-phrase underbite-takes/kept-session.json underbite-takes/performances-settings.json --out new-audition
```

The study replays three authored controller passes into Ink’s loop-capture
format on the session sample clock. The captures add note delays, gates
and accents to the written call. Breath moves the vowel filter, pitch
bend shapes the scoops, and contact and pressure control the pulse. The
written pitches, kit, sub and growl response carry through every pass.

| Pass | Playing |
| --- | --- |
| Bloom | Slower openings and longer notes while the first call establishes the hook |
| Bite | A clipped gate, hard accents and a quicker pulse |
| Coil | Bends that curl up, then fall into the answer |

The comp takes Bloom up to beat 7.82, Bite to 12.40 and Coil through the rest
of the first drop. The second splice happens inside a held call. The
oscillator stays running as the controller traces blend over 0.17 beats.
The comp retains the attack's timing and accent and picks up the incoming
take's gate.

- `reference-and-comp.wav` plays the original then the comp, level matched.
- `performances.wav` plays the original, each capture, then the comp.
- `sounds.wav` puts the comp through the original patch, Hollow and Folded
  Brass. All three patch files are under `instruments/`. Sound choice
  is independent from the gesture comp.
- `kept-session.json` holds the active comp, original capture takes and
  alternate sound takes on the same clock. `capture-events.json` retains the
  raw controller points. `record.json`, `comp.json` and `sound-swaps.json`
  replay the edits in order from `reference-session.json`.
- `timing.json` holds the groove inspector's note, trigger and estimated
  attack addresses for the original and comp.
