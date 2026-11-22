# World views and intervention permissions

Use one access policy to project a committed simulation tick for different audiences. `sim view` exports a typed `worldFrame`. `sim live` can serve the same views as snapshots and live updates for a patch, remote viewer, or projector.

| View kind | Published state and events |
| --- | --- |
| `world` | Trusted `--queries` samples, the native seed and branch, and the latest committed event envelopes with their subjects and causes. |
| `faction` | Public projections plus the named faction's last sensor observations and the details disclosed to its knowledge holder. Set `perception` to an authored perception system ID. Faction knowledge is included when enabled in the world. Set `knowledge: false` on the view to omit it. |
| `spectator` | Public projections only. The view starts with no samples or events until the policy publishes them. |

`visibility` identifies the view on the frame. Faction and spectator frames use the shared world ID and tick. They use `public` for the branch and zero for the seed. Faction contacts expose dated observations, and faction fact records carry disclosed values. Raw sensor counters, knowledge provenance, and undisclosed detail names stay in the authoritative view.

## Author a policy

A version 1 `ink-studio/world-access` document names its `views` and optional `public`, `interventions`, and `principals` sections. The host selects the policy. Each public query uses the same format as a world graph probe and needs an explicit `select` address. The result contains the selected value or a bare `missing` status.

Public event rules are keyed by committed event kind. An optional `system` and `where` condition narrow the match. `as` can give the effect its presentation name. The optional `fields` map copies only named JSON Pointers on the committed envelope into the new payload. Public effects have their own tick-local IDs and omit native subjects, causes, story, and stage.

```json
{
  "format": "ink-studio/world-access",
  "version": 1,
  "views": {
    "authority": { "kind": "world" },
    "west": { "kind": "faction", "faction": "west", "perception": "intel" },
    "audience": { "kind": "spectator" }
  },
  "public": {
    "queries": {
      "lanterns": { "field": "world/account", "args": { "account": "stock/in-use" }, "select": "/balance" }
    },
    "events": {
      "dispatch-ready": { "as": "signal-ready", "fields": { "color": "/payload/signal" } }
    }
  }
}
```

```sh
ink-studio sim view examples/world-access/harbor.world.json \
  --policy examples/world-access/harbor.access.json --view west --ticks 1 --out west.json
```

With no `--ticks`, a world exports tick zero, a checkpoint exports its saved tick, and a recording exports its final tick. Use `--queries` for additional authoritative samples. Local operators choose a view explicitly. A live subscriber receives only the view bound to its credential.

## Serve scoped snapshots and receive interventions

```sh
ink-studio sim live examples/world-access/harbor.world.json \
  --policy examples/world-access/harbor.access.json --ticks 12 --step-ms 750 --record harbor.run.json
```

Declare named principals with a `view`. Each can also list its `interventions` grants. The service emits one bearer token per principal in the operator's `live-ready.principals` object. Give a subscriber its own token and the service URL. Use that token with the usual `GET /snapshot`, `GET /live?after=…`, or a patch show's `liveWorld` input. Each view has its own cursor stream. `GET /permissions` returns the recipient's view, intervention IDs, and whether submissions are open. With no policy, `sim live` still issues a single read-only world credential.

An intervention declares a fixed native `action` and `args`. The following principals and intervention would join the policy example above.

```json
{
  "principals": {
    "operator": { "view": "authority" },
    "west-guide": { "view": "west", "interventions": ["release-lantern"] },
    "projector": { "view": "audience" }
  },
  "interventions": {
    "release-lantern": {
      "action": "world/story-choose",
      "args": {
        "document": "harbor-watch", "story": "dispatch", "stage": "plan",
        "visit": 1, "branch": "release", "reason": "watch-authorized"
      }
    }
  }
}
```

Send `POST /intervene` with the bearer token and an `application/json` body such as `{"id":"release-lantern","request":"choice-17","after":{...}}`. Put the applied cursor from that view in `after`. Each intervention can set `maxLag` from 0 to 120 committed ticks. It defaults to 0. The host chooses the next tick, and the normal command scheduler checks the action. Native story checks still govern stage, visit, deadlines, and branch eligibility at execution.

HTTP 202 returns a `scheduled` receipt with the native command ID and target tick. Retrying the same request ID for the same intervention returns that receipt without queuing a second command. An ungranted request gets 403. A busy step, stale cursor, mismatched stream, or read-only recording gets 409. The native scheduler can reject a granted request with 422.

`--record` saves a native run with submission evidence. The authoritative committed event stream can link its outcome to the scheduled command ID. Projected spectator events carry an independent ID and the published fields. Verify the recording with `sim verify`.

```sh
node examples/world-access/demo.cjs ./studio/out/world-access
```

The harbor demo saves four views of the same tick, denied and accepted requests, a native run and verification report, and the frames seen by a spectator patch. [Live snapshot protocol](simulation-output-adapters.md#join-a-running-world) · [Faction perception](faction-perception.md)
