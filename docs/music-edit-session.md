# Music edit sessions

Hear alternate score performances and audio takes in a common mix. Loop a
passage, switch lanes at score addresses, and keep chosen ranges in an
editable recipe. Use [producer revisions](music-producer.md),
[audio editorial](audio-editorial.md), and [sample motifs](sample-motif.md)
as sources. Use [DAW handoff](clap-instruments-and-handoff.md#hand-the-edit-to-a-daw)
to export the active comp, routing, automation, and aligned prints.
Use [session experiments](music-session-experiments.md) to compare combinations
of sound, phrase, and cue decisions through the same desk.

## Assemble a session

The CLI recipe has `session` and an optional top-level `assets` table
mapping names to relative WAV paths. The session contains the following:

| Field | Purpose |
| --- | --- |
| `format`, `version` | `"ink-studio/music-edit-session"`, `1` |
| `id`, `sampleRate` | Session name and stereo output clock, 8–96 kHz |
| `production` | The ordinary production, with its existing arrangement, patch, and track IDs |
| `takes` | Named production revisions. The original score is always `reference`. |
| `audio` | Additional named lanes with `{take, takes}` to specify each lane's default and alternatives |
| `comp` | Selected source ranges, with `{lane, take, from, to, fadeSamples?}` |
| `pins` | A lane table mapping to `"all"` (protect the source lane) or, for score lanes, `"pitch"` (protect the written pitch sequence per voice within each selection) |
| `mixer` | Native mixer desk with `output`, `strips`, and optional `processors`, `taps`, `tail`, and `peakPolicy` |
| `automation` | Named fader, pan, send-level, or insert parameter lanes with named control points |

Each production track and added audio lane has its own strip. A separate
`score-room` strip receives the production's room contribution. The desk
uses the production tempo map, and its source clips come from the session
lanes. Add sends, groups, inserts, sidechains, and returns just as in the
[mixer](audio-mixer.md). For example, a fader automation lane is
`{"target":{"strip":"lead","parameter":"fader"},"unit":"beats","points":[{"id":"near","at":16,"value":0.85}]}`.
A send target uses `{strip,send,parameter:"level"}`. An insert target uses
`{processor,parameter}` with an automatable parameter on that processor.

An audio take can use a WAV `{asset, at?, fromSample?, toSample?}`, an
editorial project `{editorial, track?, at?}`, or a saved sample audition
`{motif:{source,score,plan,role}, at?}`. A sample-motif take plays the isolated
role, with its original score-window start as the default placement. The other
takes default to sample zero. All placement and range addresses use the
mixer's musical, second, or sample syntax. Bars are zero-indexed.

## Loop, switch, keep

Render this preview to play bars 7–10 twice, switching the lead to its
`breathy` take at the start of bar 9 on the second pass.

```json
{
  "from": {"bar": 6},
  "to": {"bar": 10},
  "passes": 2,
  "switches": [
    {"pass": 1, "at": {"bar": 8}, "lane": "lead", "take": "breathy", "fadeSamples": 240}
  ]
}
```

The preview prerolls from cue start and outputs only the requested loop
passes. The desk processes one continuous timeline and keeps its state across
switches and wraps. Score-addressed automation follows each pass. Insert
parameters that specify a one-time trigger or source buffer position
continue to refer to the unrolled mixer timeline. Switches persist into
subsequent passes and use a one-sided entrance fade if specified.

Keep the second half with an addressed edit:

```json
[
  {"op":"comp","lane":"lead","take":"breathy","from":{"bar":8},"to":{"bar":10},"fadeSamples":240}
]
```

Ranges are half-open. A keep edit replaces overlapping choices in the target
range and retains their remaining portions. Saved fades blend with the
default take at both edges. Score comps select *performed audio* before the
desk, so timing, recorded attacks, and note releases are heard from their
own take. The take's notes, patch, and native revision remain editable.
An `all` pin guards the source material before the desk so the mixer can
still balance it. A `pitch` pin permits changes to gate, timing, dynamics,
and articulation while preserving pitches. Production pins still apply.

```sh
ink-studio music session inspect cue.json --out addresses.json
ink-studio music session preview cue.json review.json --out listen
ink-studio music session edit cue.json keep.json --out kept.json
ink-studio music session render kept.json --out print
```

Inspection lists take and audio clip IDs, automation point IDs, and performed
notes. Address an editable note clip with
`{op:"note",take,lane,clip,voice,note,set:{beat,duration,velocity,play}}`.
Other edits are `{op:"pin",lane,mode}`, where `null` releases an ordinary
session pin, `{op:"score-take",take,revision}`, `{op:"audio-take",lane,take,source}`,
`{op:"automation",lane,point,at?,value?}`, and
`{op:"editorial",lane,take,edits:[...]}` using native editorial clip commands.

## Keep the audition warm

`ink-studio music session stream cue.json` uses one JSON request and response
per line. For example:

```jsonl
{"op":"preview","out":"first","preview":{"from":{"bar":6},"to":{"bar":10}}}
{"op":"edit","changes":[{"op":"comp","lane":"lead","take":"breathy","from":{"bar":8},"to":{"bar":10}}]}
{"op":"preview","out":"second","preview":{"from":{"bar":6},"to":{"bar":10}}}
{"op":"save","out":"kept.json"}
```

Previews, renders, and handoff use the saved comp and desk. A warm editor
reuses bounded audio blocks and checkpoints for score filtering, patch echo,
room, and supported desk effects, including tempo delay and keyed dynamics.
A note edit changes the blocks it touches and the history downstream of them.
`report.blocks` shows how many samples the desk processed, the checkpoint
it resumed from, and the number of output blocks it reused. `warmupSamples`
is the sample address of the first audible frame, even on a cache hit.

A single-pass preview without switches uses the same signal as the matching
slice of the full print. The default normalization uses the full print's
peak, so a cold preview can require processing all the way through the
cue. Use a gain-staged desk with `peakPolicy: "error"` to audition quickly
and validate full scale when you print. Active block processors, external
instruments, and processors without checkpoint support use the continuous
renderer and its PCM and processing limits. A terminal true-peak limiter on
a unity master can use the block cache upstream and process the complete
master as a continuous stage. The report identifies which path ran.

Use `context` to include audio around the requested loop. The loop includes
the padded range and the report includes the original focus in sample
positions. Add a named mixer tap to solo it or subtract it from the mix at
the same playback gain. Tap subtraction leaves routing and processor state
in place.

```jsonl
{"op":"preview","out":"air-solo","preview":{"from":{"bar":8},"to":{"bar":10},"context":{"beforeSamples":24000,"afterSamples":12000},"monitor":{"mode":"solo","tap":"air"}}}
{"op":"compare","out":"before-after","preview":{"from":{"bar":7},"to":{"bar":10}}}
```

A stream's `compare` uses the last session before a successful edit. It
writes aligned `before.wav`, `after.wav`, and `difference.wav` at a shared
mix gain. If the signed difference needs extra headroom to fit the WAV,
the report records that playback gain. To compare two saved sessions, use
`ink-studio music session compare current.json comparison.json --out clips`
with `{"before":"previous.json","preview":{"from":{"bar":7},"to":{"bar":10}}}`.
The two recipes must reference the same named audio assets.

The JavaScript entry point is
`KIT.procedural.mediaGraph.musicSession.create(assets)`. It returns
`inspect(session)`, `edit(session, edits)`,
`render(session, preview?)`, and `compare(before, after, preview)`. Use `music.inspectEditSession`,
`music.editSession`, and `music.renderEditSession` in a graph.

## Play and edit a live loop

```sh
ink-studio music session play cue.json live.json --out kept.json
```

Open the loopback URL printed by the command. The settings file is optional.
It accepts `{from?,to?,at?,preroll?,gain?,fadeSamples?}`. The loop defaults to
the whole cue, with preroll from cue start if it starts later. `gain` is
linear monitoring gain and defaults to unity. The default switch fade is
12 ms. Keep a range at the selected lane's take or copy a written note to the
reference. The player prepares edits in the background and installs them at
the next unrendered sample once ready. Save writes the specified recipe with relative asset paths. Without
`--out`, Save downloads a recipe with paths to the original local WAVs.

Switches apply at the next unrendered sample. The browser buffers roughly
a tenth of a second and displays the playing loop position. The playhead stays
in the loop during the switch. A loop edit only moves it if the new range
excludes its current position. Switching a lane back to **Saved edit** plays
its reference and any kept ranges.

The live renderer runs one continuous mixer, including per-patch tape echo,
production room, and causal zero-latency desk inserts. Score automation wraps
with the loop, and tempo delay runs on the continuous render clock. The live
player uses a fixed monitor gain and indicates clipping. Native takes are
read in blocks as the playhead advances. Use the offline
preview or print for active block-only and latency-compensated inserts or
mastering peak policies. Reopen the player after changing the clock, routing,
or mixer automation.

`editor.open(session, settings?)` is the device-independent transport.
`pull(frameCount, {taps:true})` supplies interleaved stereo PCM and named taps.
Each chunk includes the starting and ending score and transport frame
addresses. Call `state()`, `switchTake({lane,take,fadeSamples?})`,
`setLoop({from,to})`, `setMonitor({mode,tap} | null)`,
`keep({lane,take?,from?,to?,fadeSamples?})`, and
`edit(changes)` between pulls. A switch with `take:null` restores the saved
edit. `keep` defaults to the auditioned take and current loop. Read
`inspect()` for note addresses and `document()` for the saved composition.
Copy individual written notes by address:

```json
{"op":"keep-notes","lane":"lead","take":"breathy","notes":[{"clip":"bridge","voice":"top","note":"pickup"}]}
```

Use `into` to copy into a named take. It defaults to `reference`. Note edits
honor pins and retain the written clip and voice addresses.

Agents can control the open browser session through its loopback API. Read
`GET /session` for the current state and the session key, then send JSON with
the `X-Ink-Session` header. `POST /command` takes an `op` of `state`,
`inspect`, `switch`, `loop`, `monitor` (with `selection`), `keep`,
`edit` (with `changes`), or `save`.
The browser usually owns the audio listener. A headless player can instead
use `POST /audio` with `{frames,client}`. Its response is little-endian
interleaved float32 stereo with the chunk address in `X-Ink-Transport`.

## Capture and comp phrase performances

A phrase take stores continuous control traces on the score clock. One
gesture can drive several sound parameters at once. For example, increasing
`effort` can open the amplitude and breath while reducing damping. Each
driver has addressed knots with values from zero to one. Knot positions,
phrase bounds, and comp sections are absolute beats. Ink interpolates
between their times on the score clock, including over note boundaries.

```json
[
  {
    "op": "record-phrase",
    "lane": "reed",
    "take": "lean",
    "phrase": {
      "id": "call",
      "from": 4,
      "to": 12,
      "drivers": {
        "effort": [
          {"id": "gather", "beat": 4, "value": 0.23},
          {"id": "lean-in", "beat": 6, "value": 0.91},
          {"id": "let-go", "beat": 12, "value": 0.09}
        ]
      },
      "mapping": {
        "pressure": {"base": 0.1, "from": {"effort": 0.88}},
        "breath": {"base": 0.15, "from": {"effort": 0.65}},
        "pitchCents": {"base": -34, "from": {"effort": 55}}
      },
      "notes": [
        {"clip": "line", "voice": "lead", "note": "answer", "delay": 0.022, "gate": 1.35}
      ]
    }
  }
]
```

A phrase can map pressure, breath, damping, contact, cutoff, roughness,
pitch, gain, and amplitude. Pressure, breath, damping, contact, cutoff
and roughness override those controls when present. Pitch bends and dB
offsets add to per-note curves. Amplitudes multiply. Set the phrase bounds
before the earliest performed attack and after its release. A note that starts within the phrase
continues to read the same controls during its release. Optional addressed
note edits allow delay in seconds, gate and accent multipliers, and
articulation. The written notes are still the session's notes. Use a
native instrument for continuous phrase control.

```sh
ink-studio music session edit cue.json capture.json --out takes.json
ink-studio music session audition-phrase takes.json listen.json --out review
```

Use a listening request such as
`{"lane":"reed","phrase":"call","takes":["lean","carry"]}`. Optional
`from` and `to` select the preview context with normal mixer addresses.
The alternatives use one desk and share a playback gain. Set
`reference: false` to hear only the requested takes.

```json
[
  {
    "op": "comp-phrase",
    "lane": "reed",
    "phrase": "call",
    "take": "kept",
    "sections": [
      {"take": "lean", "from": 4, "to": 9.25},
      {"take": "carry", "from": 9.25, "to": 12, "blend": 0.16}
    ]
  }
]
```

The source takes share the same score, instrument and mapping. Ink
copies each selected slice onto editable driver lanes in one new
performance. A blend ramps the controls from the outgoing value into the
incoming take. The attack picks its delay, accent and articulation at the
written onset. The gate comes from the take at the written note end.
A held note can cross the splice with its oscillator and room still
running. The source takes and the comp have independent editable knots.
The comp is selected on the track by default. Set `activate: false` to
store it as an alternate take.

Use `record-phrase`, `phrase-point`, and `comp-phrase` with the regular
editor, graph edit node, or session stream. For an individual knot,
use `{op:"phrase-point",lane,take,phrase,driver,point,set:{value}}`.
Set a `beat` to move it, give a new point both fields to insert it, or use
`set:null` to remove it. Inspect shows the original and combined controls
under each lane's `performances`. Listen through
`editor.auditionPhrase(session, settings)` or `music.auditionPhraseTakes`.

Run `node examples/music-production/phrase-performance.cjs output` for
the Split Reed played three ways and a comp that carries the held note
through a bass pickup. [Gesture mapping research](https://nime.org/proc/nime2002_hunt/) · [Ableton comping](https://www.ableton.com/en/manual/comping/)
