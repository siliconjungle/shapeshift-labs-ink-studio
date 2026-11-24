# Production audio benchmark

```sh
node examples/production-benchmark/run.cjs output
```

Open `output/index.html` in a browser for the shared listening review.
The runner, scene renders, and playable world use Ink, Node, and browser
APIs. Running the benchmark adds no package, speech engine, encoder,
network, or server dependency. Native PNG frames are synchronized to
WAV playback in the scene review. The picture source runs at six
frames per second. The editorial cut and its sync addresses use twelve
frames per second.

Pass `cue`, `scene`, or `world` after the output directory to rerender a
single production, then pass `review` to refresh the review with its
current reports. The sources under each piece's `recordings` directory
travel with the editable recipes. The recorded metals are from the
[Versilian Community Sample Library](../examples/music-production/samples/CREDITS.md).
The scene ships two synthetic scratch reads captured to mono WAV at
32 kHz. Other material is rendered from the authored sources.

| Piece | Previous print and revision | Listening question |
| --- | --- | --- |
| The Water Keeps Its Name | Two complete 90-second edit sessions. The same four reed pitches return 60 seconds after the opening call. The revised arrangement changes the approach and the answer. | Which call do you recognize when it comes back? |
| The Water Above | The original picture and mix, plus two treatments under the same late recut. The switch and warning move with the source frames. The revision carries the room across both cuts and gives the warning a dialogue-keyed opening. | Is the line clear, and does the room feel continuous? |
| The Relay Chamber | A previous and revised soundtrack rendered against the same three native recordings. A live player drives the same world transitions from actual button inputs. The recordings cover early arrival, reversing course, and a long dwell. | Which reveal sounds connected to the route you just heard? |

The [briefs](../examples/production-benchmark/briefs.json) include
what to listen for in each source reference. A/B controls switch
at the same playback position. The listening form downloads a JSON
record with a choice or tie, the original A/B mapping, and a reason for
each answered question. Human listening judgments are separate from
the render checks. [Preference study](https://arxiv.org/abs/2506.19085)

The reports include the cue's measured note addresses, the recut's
sample shifts, and the world's section and cue history. Each comparison
ranges from the same start through the same end in both prints. Its
integrated loudness is matched with a true-peak ceiling. The world page
compares five-second excerpts from the replayed native soundtracks.
Its live browser player schedules section assets and cues from the same
adaptive score intents. The native full-route prints remain the
reference for offline mix verification.

For a smaller picture-led workflow, change the canopy material in
[Inkwell Rebirth’s Garden](../examples/inkwell-rebirth/README.md). The same scene
source drives the live view and the headless clip.

## Edit or replay a production

```sh
ink-studio music session render output/cue/revised.session.json --out cue-print
ink-studio music editorial render output/scene/revised.editorial.json --out scene-edit --stems
ink-studio music mix render output/scene/revised.mix.json --out scene-mix
ink-studio story audio output/world/reversal.run.json output/world/revised.soundtrack.json --out reversal
```

The scene mixer recipe refers to the included stems. After editing
the editorial session, render its stems and update the mixer asset paths
to use the revised stems. The original cut, source picture capture,
revised editorial session, and the reconform report are preserved for
comparison. For a new world route, edit a route's `*.world.json` inputs,
record it using `ink-studio sim run`, then print it with either soundtrack
recipe. Open `output/world/play.html` to drive the world interactively.
