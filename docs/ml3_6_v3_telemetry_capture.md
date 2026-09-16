# ML3.6 — V3 Telemetry Capture and Collection Readiness

Status: **`V3_CAPTURE_READINESS = READY_FOR_CONTROLLED_COLLECTION`**.

ML3.6 implements an opt-in, local-only Schema V3 capture path. It collects no real session in this phase, does not change the dataset registry from `CONTRACT_FROZEN_NO_DATA`, does not create a dataset or split, and does not train a model.

## Capture architecture

Schema V2 remains unchanged. `TelemetryCollectorV3` is a separate collector that reuses the proven V2 fixed-rate scheduler and future-curvature helper, but writes to a V3-only session and validator. The browser API is deliberately opt-in:

```text
startMLTelemetryV3()  -> local in-memory PLAYER_ONLY session
stopMLTelemetryV3()   -> stop without uploader interaction
exportMLTelemetryV3() -> sanitized local JSONL download
```

The game loop updates both collectors after `Car.update()` within the same fixed 60 Hz physics tick. V3 is disabled by default and never starts automatically. Race end, timeout and return-to-menu stop an active V3 session; pause time is excluded from its 10 Hz scheduler.

## Exact causal capture points

Every sample is one atomic `State(t) -> Action(t)` pair:

1. At the beginning of `Car.update()`, a pending manual shift request consumes the pre-shift gear/RPM snapshot recorded by the keyboard edge handler.
2. RPM/automatic transmission and track-contact state are resolved. Automatic shifts are runtime state transitions and never human targets.
3. `car.mlObservation` and `car.mlObservationV3` snapshot all observations before driver action effects, boost update, tyre/rear-slip dynamics, wake allowance update and physical integration.
4. Human steering, throttle and brake are resolved. `boostRequested` and the buffered manual `gearShiftRequest` are recorded with them before their effects.
5. Gameplay physics continues unchanged: brake/engine smoothing, `updateBoost`, tyre/rear-slip/wake dynamics and integration run after the snapshot/action capture.
6. The V3 collector consumes that same-tick snapshot/action pair. Future curvature 5/10/20 m is derived from the pre-physics `pathIndex`, as in V2.

Collisions are processed after `Car.update()`. Their effects therefore appear in the next observation, never retroactively in the current sample.

## Runtime-to-V3 mapping

| V3 group | Runtime source at t | Fields |
| --- | --- | --- |
| `carState` | `mlObservation` before physics | speed, forward/lateral velocity, yaw rate, slip angle, steering angle, cross-track and heading error |
| `trackState` | current path/contact snapshot plus collector geometry lookup | edge distances, current/future curvature, progress, surface, slope |
| `powertrainState` | persistent `Car` state entering action effects | gear, RPM, engine acceleration, brake pressure, automatic-transmission flag |
| `boostState` | persistent boost state before `updateBoost` | active, charge, cooldown, needs-release latch, carry |
| `dynamicsState` | persistent tyre/RWD state before current dynamics | rear slip, tyre temperature, tyre wear |
| `aeroState` | wake state entering current physics | wake intensity, wake speed allowance |
| `environmentState` | authoritative game state | dry/wet track condition |
| `driverAction` | resolved input in the same tick before effects | steering, throttle, brake, boost request, manual gear-shift request |
| `eventState` | state already known at t | off-track, collision, spin, recovery |

The canonical observation vector contains exactly 33 fields in `V3_OBSERVATION_FEATURES`; the target vector contains exactly five fields in this frozen order: steering, throttle, brake, boost request and gear-shift request.

## Boost intent versus effect

`driverAction.boostRequested` records whether the human requested boost in the current tick. It remains true even when the request is blocked by surface, braking, throttle, direction, race phase, charge or release latch. `boostState.active`, charge, cooldown, latch and carry are captured before `updateBoost`, so the effective outcome of a new request first appears in the next tick's observation.

The deterministic harness covers allowed boost, blocked boost and release-latch/cooldown transitions without changing boost physics.

## Manual shift intent versus gear state

The local keyboard edge handler records `-1` or `+1` and the pre-shift gear/RPM immediately before calling the existing `shiftDown()` or `shiftUp()`. `Car.update()` consumes that one-tick buffer for the V3 sample. Thus the request is the current target while the observation remains the pre-effect powertrain state. The next tick observes the changed gear with target `0`.

Automatic transmission changes are not converted into labels: `gearShiftRequest` remains `0`, and `powertrainState.automaticTransmission` identifies the regime. Online control behavior is unchanged; V3 collection is local-only in ML3.6.

## Session, validation and export

Each V3 session freezes:

- Schema `3`, feature/action manifest `3.0.0` and contract `ML3.5-1`;
- generation `runtime-0.6.3-ml2-schema3-g1`;
- V3 fingerprint `7745d5d3641ca5f63ac3a38eed0af4e86c5509ea5f6964271759e3652ca94040`;
- `10 Hz`, `PLAYER_ONLY`, monotonically increasing `sampleIndex`;
- the complete ML3.5 lineage metadata on every sample.

The V3 validator rejects missing, extra, out-of-range or mixed-lineage fields. Bots are excluded. The in-memory ring buffer and JSONL export contain no display name, account identity, database URL or credential.

## Remote ingest and readiness

Remote Schema V3 ingest is intentionally unavailable: **`V3_REMOTE_INGEST_NOT_READY`**. Any V3 start request containing an upload/remote option fails explicitly. The V3 collector never begins, queues or ends a V2 uploader session. Backend validation and storage remain unchanged.

`READY_FOR_CONTROLLED_COLLECTION` is limited to local controlled capture readiness. The deterministic harness proves:

- all 33 observations and all five targets are emitted in canonical order;
- State(t)/Action(t) timing for boost and manual shift;
- automatic shifts remain target zero;
- 10 Hz sampling and contiguous indices;
- V3 validation, PLAYER-only filtering and sanitized local export;
- no database dependency and no V3 remote upload;
- continued Schema V2 capture and validation.

No human V3 session was collected, persisted or committed during ML3.6. The durable registry therefore correctly remains `CONTRACT_FROZEN_NO_DATA`.

Recommended next phase: **ML3.7 — Controlled V3 Pilot Collection and Durable Storage Qualification**. That phase must formally define remote/durable storage before promoting the generation or treating data as available.
