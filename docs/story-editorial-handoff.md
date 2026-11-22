# Editable story picture and audio

Export a verified native recording as a picture cut, Broadcast Wave stems, cue markers, dialogue and performed instrument parts. The handoff uses one exact picture, simulation and audio clock. Ink's editable projects and the interchange files travel with the media.

```sh
ink-studio story handoff gate.run.json gate.handoff.json --out edit
ink-studio timeline edit/timeline.json
ink-studio music editorial inspect edit/dialogue-edit.json
ink-studio beat 'ink:beat:lantern-cut/main/28.0' edit/cues.json edit/edit.otio
```

Open `edit.otio` in an OpenTimelineIO editor. It contains picture cuts, aligned audio stems, beat markers, and disabled alternate lanes for individual dialogue clips. Use the dialogue lanes to edit separate reads against picture. Import `picture.mov`, the WAV stems, and `notes.mid` together at local zero in a DAW. For an absolute placement, use the picture frame and each WAV's Broadcast Wave time reference in `handoff.json`. The optional instrument WAVs print source parts for replacement or reference. The mixed music stem already includes their session master.

The package contains these Ink editing sources.

| File | Contents |
| --- | --- |
| `timeline.json` | Editable local marker times with original beat IDs and source timecodes. |
| `audio-edit.json` | An Ink audio editorial session with one full-window clip per used stem. |
| `dialogue-edit.json` | Individual dialogue takes and source handles on an editable audio timeline. |
| `dialogue.json` and `captions.vtt` | Editable lines and subtitles. Original line timing stays in the JSON when a crop trims a line. |
| `ink/instruments.json` | Original music session, takes and comp choices with its referenced WAV assets. |
| `parts.json` and `notes.mid` | Cropped performed notes with exact sample addresses, plus the Standard MIDI File on the placed tempo map. |
| `picture.json` | Each numbered PNG with its absolute frame, simulation tick and half-open audio sample window. |

## Author a handoff

Paths are relative to the plan. Supply a standard [scene soundtrack](scene-audio.md) and a native recording or story run bundle. Use `picture.fromFrame` and exclusive `picture.toFrame` to select a window. The default covers complete picture frames in the recording. `fps` defaults to the recording's take rate, or 24. The soundtrack supplies the audio rate. Numbered PNGs are always included. A default H.264 MOV uses FFmpeg, which can be selected with `--ffmpeg EXECUTABLE`. Set `picture.video: false` to use the PNG sequence as the OTIO picture reference. Optional `picture.effects` names a projected [visual effects sheet](event-visual-effects.md).

```json
{
  "format": "ink-studio/story-editorial-plan",
  "version": 1,
  "id": "lantern-cut",
  "title": "The Lantern Gate",
  "soundtrack": "gate.soundtrack.json",
  "picture": { "fromFrame": 11, "toFrame": 102, "width": 256, "height": 160 },
  "dialogue": {
    "plan": "gate.performance.json",
    "assets": { "lower": "lower", "clear": "clear" }
  },
  "instruments": { "session": "gate.music.json", "at": 0.08 }
}
```

`dialogue.plan` is a version 1 [actor performance plan](actor-performance.md). Its dialogue rules generate text and editable caption timing from the recording. `dialogue.assets` maps a dialogue rule ID to a soundtrack asset ID. Each mapped voice enters the printed dialogue stem and becomes a separate editable clip. Supply named playback assets for spoken dialogue. The handoff runs the soundtrack through its configured scene post mix and defaults to the standard role stems.

`instruments.session` is a [music edit session](music-edit-session.md) recipe. Its `at` is a time in the original recording, with zero as the default. Ink prints its current comp into the music stem and exports its performed parts. Notes crossing the picture in-point are sliced at the start of the edit. Exact note and expression sample addresses are in `parts.json`. The MIDI file uses the existing 960-PPQ handoff and carries cue markers on its conductor track.

The `markers` plan can classify additional [story timeline](story-scene-timeline.md) events. The handoff includes committed soundtrack cues with the story markers, and preserves their original source addresses in `cues.json`. `cues.csv` carries local and absolute sample positions for editorial tools.

A cropped edit starts its media at local zero, with the absolute frame and sample origins retained. `picture.startFrame` in the Ink audio editorial projects carries the fractional-frame sample phase. At a fractional frame rate, the number of samples in a crop is the difference of its two absolute sample boundaries.

## Run the demos

```sh
node scripts/build.js node
node examples/story-editorial/demo.cjs /tmp/lantern-gate-handoff
```

The wide cut shows a skiff arriving, a spoken order, the gate closing, and a second spoken line. The tighter cut starts during the first take and an instrument note. The same recording and asset sources generate both handoffs. The demo uses FFmpeg and either the bundled example voice WAVs or local macOS speech synthesis when generating those WAVs in a source checkout.

[OpenTimelineIO serialized schema](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-serialized-schema.html) · [DAW handoff](clap-instruments-and-handoff.md#hand-the-edit-to-a-daw) · [Take clock](take-clock.md)
