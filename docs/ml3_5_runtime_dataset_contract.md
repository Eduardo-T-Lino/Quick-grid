# ML3.5 — Runtime Dataset Contract and Durable Registry

Status: **`ML3.5 = CONTRACT_FROZEN_NO_DATA`**.

This phase freezes a new causal telemetry and dataset-generation contract. It does not collect telemetry, create a dataset, split data, train a model or start ML4.

## Frozen identity

| Item | Value |
| --- | --- |
| Telemetry schema | `3` |
| Feature/action manifest | `3.0.0` |
| Runtime dataset contract | `ML3.5-1` |
| Dataset generation | `runtime-0.6.3-ml2-schema3-g1` |
| Generation version | `1.0.0` |
| Source runtime | `0.6.3-ml2` / physics `1.8.3-gt3-drift-coast` / geometry `1.5.0-centripetal` |
| Source runtime fingerprint | `53193ebb1921ecd3f56638054d0acf8fa31d1d7c7647f0e85349a32b96319173` |
| V3 simulation fingerprint | `7745d5d3641ca5f63ac3a38eed0af4e86c5509ea5f6964271759e3652ca94040` |
| Sampling rate | `10 Hz` |
| Registry status | `CONTRACT_FROZEN_NO_DATA` |

The fingerprint is the canonical SHA-256 of the source runtime lineage, rates, physics, inputs, geometry and the complete V3 field/order/encoding contract. It is separate from the source V2 runtime fingerprint.

## Runtime causal inspection

| Runtime signal | Source file | Causal role | V3 inclusion |
| --- | --- | --- | --- |
| Steering | `src/car.js` (`lastSteerInput`) | resolved human action consumed at t | target `driverAction.steering` |
| Throttle | `src/car.js` (`lastThrottleInput`) | resolved human action consumed at t | target `driverAction.throttle` |
| Brake/reverse | `src/car.js` (`lastBrakeInput`) | resolved human action consumed at t | target `driverAction.brake` |
| Boost request | `src/car.js` (`keys.Space` → `updateBoost`) | human intent before boost eligibility/effect | target `driverAction.boostRequested` |
| Manual shift | `src/controlBindings.js`, `src/car.js` (`shiftUp`/`shiftDown`) | discrete human intent changing gear | target `driverAction.gearShiftRequest` |
| Boost active/charge/cooldown/release latch | `src/boost.js`, `src/car.js` | pre-action effective/energy state | `boostState.*` observations |
| Boost coast carry | `src/car.js` (`boostCarry`) | persistent state controlling post-boost drag | observation `boostState.carry` |
| Gear/RPM/engine smoothing/brake pressure | `src/car.js` | persistent powertrain state changing response | `powertrainState.*` observations |
| RWD drift state | `src/car.js` (`rearSlip`) | persistent rear-axle slip changing yaw/grip | observation `dynamicsState.rearSlip` |
| Tyre temperature/wear | `src/car.js` | persistent state changing grip | `dynamicsState.*` observations |
| Wake intensity/speed allowance | `src/car.js` | current aero interaction and persistent allowance | `aeroState.*` observations |
| Wet/dry condition | `src/game.js`, `src/car.js` | environment state changing tyre grip | observation `environmentState.trackCondition` |

`tcActive`, `absActive` and `physicsState` are recomputed diagnostic/results in the current tick; `brakeTemp` does not feed current vehicle dynamics. They are not model observations. Absolute heading, waypoint index and deterministic target speed remain excluded for the existing V2 reasons.

## Causal sample contract

Each sample is an atomic `State(t) → Action(t)` pair:

- observations are snapshotted before applying action(t);
- steering/throttle/brake are captured after input resolution and before physics;
- `boostRequested` is captured before `updateBoost`; `boostState.active` and other boost observations are the state entering the tick, never the result of the current request;
- `gearShiftRequest` is `-1`, `0` or `1` and represents human intent only; future collector instrumentation must snapshot the pre-shift gear and buffer the request before applying it, while an automatic shift remains a state transition rather than a label;
- undeclared top-level/group fields, including future vehicle state or post-action outcomes, fail validation.

The machine-readable definition of every field is `V3_FIELD_SPECIFICATIONS` in `src/ml/lineage/runtimeDatasetContract.js`. Every entry freezes path, type, unit, range/domain, required status, capture timing, causal semantics and validation rule. Schema V2 remains in its original module and is not modified or treated as V3.

### Canonical target order

1. `driverAction.steering`
2. `driverAction.throttle`
3. `driverAction.brake`
4. `driverAction.boostRequested`
5. `driverAction.gearShiftRequest`

### Canonical observation order

The vector has **33** fields. Positions 1–16 preserve the valid V2 feature order. The 17 additions are:

1. `trackState.slope` — gravity input used by longitudinal physics;
2. `powertrainState.gear` — selects torque range;
3. `powertrainState.rpm` — controls automatic shifting;
4. `powertrainState.engineAcceleration` — persistent acceleration smoothing;
5. `powertrainState.brakePressure` — persistent brake smoothing;
6. `powertrainState.automaticTransmission` — determines shift-request applicability;
7. `boostState.active` — effective state entering t;
8. `boostState.charge` — available energy;
9. `boostState.cooldownSeconds` — recharge delay;
10. `boostState.needsRelease` — depletion/release latch;
11. `boostState.carry` — earned coast state;
12. `dynamicsState.rearSlip` — persistent RWD/drift state;
13. `dynamicsState.tyreTemperatureCelsius` — grip state;
14. `dynamicsState.tyreWear` — grip degradation state;
15. `aeroState.wakeIntensity` — drag/grip/acceleration input;
16. `aeroState.wakeSpeedAllowanceKmh` — persistent wake allowance;
17. `environmentState.trackCondition` — dry/wet grip regime.

Surface uses the frozen domain `TARMAC, KERB, RUNOFF, GRAVEL` under `surface-encoding-1.0.0`. Track condition uses `dry, wet` under `track-condition-encoding-1.0.0`. Booleans encode as 0/1 only when building a vector; raw samples retain boolean intent/state separation.

## Durable registry and storage gate

The versioned source of truth is:

```text
dataset-registry/
  registry.json
  runtime-0.6.3-ml2-schema3-g1/
    manifest.json
    checksums.sha256
    README.md
```

The generation manifest records zero sessions, zero rows, no artifacts and no storage object. Validators reject duplicate generation IDs, mutable version collisions, canonical hash mismatch, mixed lineage and promotion without a durable object URI, SHA-256 and positive byte size.

Raw telemetry and large datasets remain outside Git in durable access-controlled storage. Git always versions manifests and hashes; small sanitized derived artifacts may be versioned. `artifacts/` is cache-only, the database cannot be the sole derived-artifact copy, and clean-machine recovery is a future promotion gate. No provider or paid service is selected here.

## Compatibility and next gate

- `acceptedBaseline.js`, historical Schema V2 and ML3.0–ML3.4 remain unchanged.
- `0.2.0-ml2`, `0.3.0-ml2` and V3 runtime data cannot share a generation.
- No collector currently emits V3. Collection is prohibited until it can atomically capture all V3 state/action fields and pass the contract tests.

Recommended next phase: **ML3.6 — V3 Telemetry Capture and Collection Readiness**.
