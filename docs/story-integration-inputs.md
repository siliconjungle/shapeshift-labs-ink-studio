# Read-only story integrations

Render graphs use committed world frames, events, and published queries to drive
picture and sound. `sim.world` samples a private simulation or recording.
`sim.liveWorld` consumes snapshots and live updates. A projector receives
rendered frames and can use its existing presentation controls for presets.
A graph output, a watched event, or a projector control cannot submit a
world command through the built-in show runner.

## Enable a recorded operator input

Run a live world with a [world access policy](world-access.md) that grants the
patch operator a named intervention. Set the show’s `liveWorld` input and
credential to the operator’s scoped stream. Record the native run with
`sim live --record` when you need to verify committed outcomes afterward.

The built-in show runner opens the operator path only when both flags are set.

```sh
ink-studio patch show show.json \
  --intervention-input - --record-interventions desk.ndjson \
  --report live.report.json
```

Enter one JSON object per line on stdin once the show is projecting. A local
controller can send the same lines. Use the file input below if video already
uses stdin. Each proposal names a host-authored grant
and a request ID.

```json
{"id":"release-lantern","request":"desk-release"}
```

Ink attaches the live cursor from the last rendered frame and flushes the
proposal to the journal before sending it. Use a fresh journal filename for
each show. The world service checks the credential, intervention grant, and
observed cursor. The service owns the native action, arguments, and execution
tick. The patch waits for the committed update before it can present the
outcome. A scheduled receipt is an acknowledgment that the native command was
queued. Look in the world recording for its committed result.

## Rehearse or submit an authored input track

Supply an `ink-studio/input-recording` document to `--intervention-input`.
It may contain up to 4,096 `world-intervention` pulses with `id` and
`request` values. Initial held values and other channels are rejected.
Pulse times are seconds on the show clock. A due pulse is considered on the
first rendered frame at or after its authored time.

```json
{
  "format": "ink-studio/input-recording",
  "version": 1,
  "events": [
    {
      "time": 0.2,
      "channel": "world-intervention",
      "kind": "pulse",
      "value": { "id": "release-lantern", "request": "desk-release" }
    }
  ]
}
```

With `--rehearse`, the same input is recorded with a `preview` outcome without
sending a request. Run with the explicit flags outside rehearsal to submit the
pulses against the currently connected world.

## Inspect proposals and receipts

The NDJSON journal starts with a versioned header. Each `proposal` row carries
a typed input pulse, the show frame, and the applied cursor. Its `outcome` row
uses the same index. An accepted request has a `scheduled` receipt with the
native command ID and target tick. Rejections record the HTTP status, including
403 for an ungranted intervention, 409 for a stale cursor or closed stream,
and 422 for a native scheduler rejection.

Local outcomes include `no-cursor`, `frame-failed`, and `busy` when the show
already has eight submissions in flight. The runner sends each proposal once.
For an unconfirmed receipt, explicitly repeat the same request ID to recover a
previously accepted receipt without queuing a duplicate. The show report
summarizes outcomes, and authored inputs beyond the last rendered frame are
counted as `not-reached`.

To reuse captured pulses as a typed input track, extract the `input` records.

```sh
jq -s '{format:"ink-studio/input-recording",version:1,events:[.[]|select(.kind=="proposal")|.input]}' \
  desk.ndjson > desk.input.json
ink-studio sim verify harbor.run.json
```

## Run the demo

```sh
node scripts/build.js node
node examples/read-only-story-integrations/demo.cjs ./harbor-demo
```

The harbor demo generates a read-only projection, a recorded rehearsal, and
an interactive show. The interactive operator repeats a lantern request and
receives the same receipt. The native run contains one command, and a second
spectator projector follows the committed amber signal.

[World access and permissions](world-access.md) · [Event actions](event-actions.md) · [Typed data inputs](typed-data-inputs.md)
