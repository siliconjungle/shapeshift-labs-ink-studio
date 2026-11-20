# Remappable viewer input

`createViewerInput(surface, options)` from `webgl.mjs` maps browser
devices to the same actions as the
[device-neutral binding compiler](procedural.md#input-actions).
Pass `toolkit` (the toolkit exports or `KIT`), `contexts` (a table of
named action bindings), and optionally the initial `context`.
Bindings accept physical controls or records with `input`, `modifiers`,
`deadZone`, and `scale`.

Use the standalone adapter for a scene or embed. A DOM canvas passed to
`createRenderer` also accepts an optional `input` options object and
exposes the adapter on `renderer.input`. Call `poll()` from the host's
update loop. The renderer disposes its adapter with its other resources.
Worker-side canvases can receive action snapshots from an adapter on the
main thread.

## Devices and focus

| Device | Physical controls |
| --- | --- |
| Keyboard | `key:` followed by the physical `KeyboardEvent.code`. Chords use exact Alt, Control, Meta, and Shift modifiers. |
| Standard gamepad | `pad:South`, `East`, `West`, `North`, `LeftBumper`, `RightBumper`, `LeftTrigger`, `RightTrigger`, `Back`, `Start`, `LeftStick`, `RightStick`, `DPadUp`, `DPadDown`, `DPadLeft`, `DPadRight`, and `Home` with the same prefix. Axes are `pad:LeftX`, `LeftY`, `RightX`, and `RightY`. Other mappings and extra channels use zero-based `pad:ButtonN` and `pad:AxisN`. |
| Mouse | `mouse:Left`, `Middle`, `Right`, `Back`, and `Forward`. |
| Pen and touch | `pen:Tip`, `Barrel`, and `Eraser`. Each touch contact shares `touch:Contact`. |
| Motion | `mouse:DragX`, `mouse:DragY` and the same channels for `pen:` and `touch:`. Wheel axes are `wheel:X` and `wheel:Y`. |

Only the focused surface receives actions. Tab keeps its browser behavior
and editable descendants retain their own input. The adapter adds a tab
stop to a surface when needed and focuses it on pointer down by default.
Set `tabStop` or `focusOnPointer` to false to own those behaviors.
`focus()` requests focus without scrolling and `setEnabled(false)` suspends
input. Focus loss, hidden documents, and disabling clear held controls and
cancel captured pointers. On focus gain, held gamepad controls must return
to neutral before activation. Use CSS `touch-action` on a surface that
consumes touch gestures.

## Action snapshots and remapping

- `poll()` returns `context`, `focused`, signed action `values`, and
  `pressed` and `released` action lists. The strongest absolute binding
  wins. A short press and release can both appear in one snapshot.
- Wheel and drag displacement accumulate until the next poll. Set
  `motionScale` to the number of CSS pixels for a full-scale impulse
  (96 by default). Impulses appear in `values` for that poll.
- `onAction` receives `press`, `change`, `release`, keyboard `repeat`,
  and motion `pulse` notifications. `onPointer` receives captured
  `start`, `move`, `end`, and `cancel` gestures with the initiating
  action and CSS-pixel position and delta. `onFocus` reports focus changes.
- `setBindings(context, action, bindings)` changes one action and
  `setProfile(contexts, context)` replaces a profile. Invalid updates
  leave the active bindings intact. `profile()` returns a JSON-safe copy
  of the normalized bindings. Use `setContext(name)` to switch contexts.
- `dispose()` releases captures, listeners, and adapter-owned tab settings.

The [comparison viewer](comparison-views.md) uses the adapter for
camera orbit and divider movement. Pass `input.canvas` or
`input.divider` to configure either adapter, or false to disable it.
The [linked viewer](linked-views.md) can opt in per canvas by supplying
`input.chart`, `input.map`, or `input.scene` along with the toolkit.
Both mounted viewers expose their configured adapters on `input`.
