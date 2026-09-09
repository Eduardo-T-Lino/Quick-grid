import { createHash } from 'node:crypto';
import {
  BASELINE_MANIFEST,
  SIMULATION_FINGERPRINT_SHA256,
  stableSerialize
} from '../../src/ml/lineage/baselineManifest.js';

export const INVENTORY_SCHEMA_VERSION = 1;
export const ACCEPTED_GAME_BUILDS = Object.freeze(['0.2.0-ml2', '0.3.0-ml2']);
export const LINEAGE_ELIGIBILITY = Object.freeze({
  COMPATIBLE: 'COMPATIBLE',
  REJECT: 'REJECT',
  INFRASTRUCTURE_ONLY: 'INFRASTRUCTURE_ONLY',
  VALIDATION_ONLY: 'VALIDATION_ONLY'
});
export const QUALITY_ELIGIBILITY = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
  CANDIDATE: 'CANDIDATE',
  REJECT: 'REJECT',
  REVIEW: 'REVIEW'
});

export const KNOWN_SESSIONS = Object.freeze({
  'ad759118-4386-481f-9d34-f3d496eb1854': Object.freeze({
    group: 'HUMAN_VALIDATED', driverTypes: ['PLAYER'], kind: 'HUMAN', gameBuildVersion: '0.2.0-ml2'
  }),
  '014398f2-d1ce-4c40-8bcb-3a65a1008065': Object.freeze({
    group: 'BENCHMARK_H_INFRASTRUCTURE', driverTypes: ['PLAYER'], kind: 'AUTOMATIC'
  }),
  '6bf94581-f632-4bd4-bbb1-50378db12f3f': Object.freeze({
    group: 'BENCHMARK_H_INFRASTRUCTURE', driverTypes: ['PLAYER'], kind: 'AUTOMATIC'
  }),
  '7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03': Object.freeze({
    group: 'BENCHMARK_H_INFRASTRUCTURE', driverTypes: ['PLAYER'], kind: 'AUTOMATIC'
  }),
  '5d639195-4ebe-48ed-ada3-fb80a5ec128d': Object.freeze({
    group: 'TOKEN_REFRESH_I_INFRASTRUCTURE', driverTypes: ['PLAYER'], kind: 'AUTOMATIC'
  }),
  'd2d44255-6487-4210-9daa-2e19f2df5ff3': Object.freeze({
    group: 'LINEAGE_SMOKE_J_INFRASTRUCTURE', driverTypes: ['PLAYER'], kind: 'AUTOMATIC'
  })
});

export const NUMERIC_PATHS = Object.freeze([
  'driverAction.steering', 'driverAction.throttle', 'driverAction.brake',
  'carState.speed', 'carState.crossTrackError', 'carState.headingError',
  'carState.slipAngle', 'carState.yawRate', 'trackState.distanceToLeftEdge',
  'trackState.distanceToRightEdge', 'trackState.currentCurvature'
]);

const BASELINE = BASELINE_MANIFEST.lineage;
const CREDENTIAL_KEY = /(password|passwd|secret|token|credential|authorization|cookie|database[_-]?url|connectionstring|private[_-]?key)/i;

function finite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value, places = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(places));
}

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function distribution(values, percentiles = [1, 5, 50, 95, 99]) {
  const clean = values.map(finite).filter(value => value !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / clean.length;
  const result = {
    count: clean.length,
    min: round(clean[0]),
    max: round(clean.at(-1)),
    mean: round(mean),
    std: round(Math.sqrt(variance))
  };
  for (const p of percentiles) result[`p${String(p).padStart(2, '0')}`] = round(percentile(clean, p));
  return result;
}

function countEpisodes(flags) {
  let samples = 0, episodes = 0, longest = 0, current = 0;
  for (const flag of flags) {
    if (flag) {
      samples++;
      current++;
      if (current === 1) episodes++;
      longest = Math.max(longest, current);
    } else current = 0;
  }
  return { sampleCount: samples, episodeCount: episodes, longestEpisodeSamples: longest };
}

function numericInvalidCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? 0 : 1;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, child) => sum + numericInvalidCount(child), 0);
}

function sampleIdentity(sample) {
  const metadata = sample?.metadata || {};
  return stableSerialize([metadata.sessionId ?? null, metadata.sampleIndex ?? null, metadata.timestamp ?? null]);
}

function analyzeLaps(samples, relationalLaps = []) {
  const byLap = new Map();
  for (const sample of samples) {
    const lapNumber = finite(sample?.metadata?.lapNumber);
    if (lapNumber === null) continue;
    if (!byLap.has(lapNumber)) byLap.set(lapNumber, []);
    byLap.get(lapNumber).push(sample);
  }
  const rowsByNumber = new Map(relationalLaps.map(row => [finite(row.lap_number ?? row.lapNumber), row]));
  const lapNumbers = [...new Set([...byLap.keys(), ...rowsByNumber.keys()].filter(value => value !== null))].sort((a, b) => a - b);
  return lapNumbers.map(lapNumber => {
    const lapSamples = byLap.get(lapNumber) || [];
    const row = rowsByNumber.get(lapNumber) || {};
    const timestamps = lapSamples.map(s => finite(s?.metadata?.timestamp)).filter(v => v !== null);
    const speeds = lapSamples.map(s => finite(s?.carState?.speed)).filter(v => v !== null);
    const offTrackCount = lapSamples.length
      ? lapSamples.filter(s => s?.eventState?.offTrack === true).length
      : finite(row.off_track_count ?? row.offTrackCount);
    const collisionCount = lapSamples.length
      ? lapSamples.filter(s => s?.eventState?.collision === true).length
      : finite(row.collision_count ?? row.collisionCount);
    const spinCount = lapSamples.length
      ? lapSamples.filter(s => s?.eventState?.spin === true).length
      : finite(row.spin_count ?? row.spinCount);
    return {
      lapNumber,
      sampleCount: lapSamples.length || finite(row.sample_count ?? row.sampleCount),
      lapTime: finite(row.lap_time ?? row.lapTime) ?? (timestamps.length > 1 ? round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000) : null),
      validLap: typeof (row.valid_lap ?? row.validLap) === 'boolean'
        ? (row.valid_lap ?? row.validLap)
        : (lapSamples.length ? offTrackCount === 0 && collisionCount === 0 && spinCount === 0 : null),
      offTrackCount,
      collisionCount,
      spinCount,
      averageSpeed: finite(row.average_speed ?? row.averageSpeed) ?? (speeds.length ? round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null),
      maxSpeed: finite(row.max_speed ?? row.maxSpeed) ?? (speeds.length ? round(Math.max(...speeds)) : null)
    };
  });
}

export function analyzeSamples(samples, { batchSequences = [], relationalLaps = [] } = {}) {
  const validObjects = samples.filter(sample => sample && typeof sample === 'object' && !Array.isArray(sample));
  const timestamps = validObjects.map(sample => finite(sample?.metadata?.timestamp));
  const indices = validObjects.map(sample => finite(sample?.metadata?.sampleIndex));
  const timestampDeltas = [];
  let timestampMonotonicityViolations = 0, sampleIndexMonotonicityViolations = 0, sampleIndexGaps = 0;
  for (let i = 1; i < validObjects.length; i++) {
    if (timestamps[i] !== null && timestamps[i - 1] !== null) {
      const delta = timestamps[i] - timestamps[i - 1];
      timestampDeltas.push(delta);
      if (delta <= 0) timestampMonotonicityViolations++;
    }
    if (indices[i] !== null && indices[i - 1] !== null) {
      if (indices[i] <= indices[i - 1]) sampleIndexMonotonicityViolations++;
      if (indices[i] > indices[i - 1] + 1) sampleIndexGaps += indices[i] - indices[i - 1] - 1;
    }
  }
  const identities = new Set();
  let duplicateSamples = 0;
  for (const sample of validObjects) {
    const identity = sampleIdentity(sample);
    if (identities.has(identity)) duplicateSamples++;
    identities.add(identity);
  }
  const sortedBatchSequences = batchSequences.map(finite).filter(value => value !== null).sort((a, b) => a - b);
  let batchGaps = 0;
  for (let i = 1; i < sortedBatchSequences.length; i++) {
    if (sortedBatchSequences[i] > sortedBatchSequences[i - 1] + 1)
      batchGaps += sortedBatchSequences[i] - sortedBatchSequences[i - 1] - 1;
  }
  const invalidNumeric = validObjects.reduce((sum, sample) => sum + numericInvalidCount(sample), 0);
  const trackProgressOutOfRange = validObjects.filter(sample => {
    const value = finite(sample?.trackState?.trackProgress);
    return value === null || value < 0 || value > 1.0001;
  }).length;
  const driverActionOutOfRange = validObjects.filter(sample => {
    const steering = finite(sample?.driverAction?.steering);
    const throttle = finite(sample?.driverAction?.throttle);
    const brake = finite(sample?.driverAction?.brake);
    return steering === null || steering < -1.0001 || steering > 1.0001
      || throttle === null || throttle < -0.0001 || throttle > 1.0001
      || brake === null || brake < -0.0001 || brake > 1.0001;
  }).length;
  const flags = {
    offTrack: validObjects.map(sample => sample?.eventState?.offTrack === true),
    spin: validObjects.map(sample => sample?.eventState?.spin === true),
    collision: validObjects.map(sample => sample?.eventState?.collision === true)
  };
  const actionSaturation = validObjects.filter(sample => {
    const steering = finite(sample?.driverAction?.steering);
    const throttle = finite(sample?.driverAction?.throttle);
    const brake = finite(sample?.driverAction?.brake);
    return (steering !== null && Math.abs(steering) >= 0.95) || (throttle !== null && throttle >= 0.95)
      || (brake !== null && brake >= 0.95);
  }).length;
  const potentiallyCleanSamples = validObjects.filter(sample => {
    const events = sample?.eventState || {};
    return !events.offTrack && !events.spin && !events.collision && numericInvalidCount(sample) === 0;
  }).length;
  const deltas = timestampDeltas.filter(value => Number.isFinite(value));
  const action = Object.fromEntries(['steering', 'throttle', 'brake'].map(key => [key,
    distribution(validObjects.map(sample => sample?.driverAction?.[key]))]));
  const steeringValues = validObjects.map(sample => finite(sample?.driverAction?.steering)).filter(v => v !== null);
  const throttleValues = validObjects.map(sample => finite(sample?.driverAction?.throttle)).filter(v => v !== null);
  const brakeValues = validObjects.map(sample => finite(sample?.driverAction?.brake)).filter(v => v !== null);
  if (action.steering) {
    action.steering.saturationNegativePercent = round(100 * steeringValues.filter(v => v <= -0.95).length / steeringValues.length);
    action.steering.saturationPositivePercent = round(100 * steeringValues.filter(v => v >= 0.95).length / steeringValues.length);
  }
  if (action.throttle) {
    action.throttle.zeroPercent = round(100 * throttleValues.filter(v => v === 0).length / throttleValues.length);
    action.throttle.atLeast095Percent = round(100 * throttleValues.filter(v => v >= 0.95).length / throttleValues.length);
  }
  if (action.brake) {
    action.brake.zeroPercent = round(100 * brakeValues.filter(v => v === 0).length / brakeValues.length);
    action.brake.positivePercent = round(100 * brakeValues.filter(v => v > 0).length / brakeValues.length);
    action.brake.atLeast095Percent = round(100 * brakeValues.filter(v => v >= 0.95).length / brakeValues.length);
  }
  const state = {};
  for (const path of NUMERIC_PATHS.filter(path => !path.startsWith('driverAction.')))
    state[path.split('.').at(-1)] = distribution(validObjects.map(sample => getPath(sample, path)));
  const laps = analyzeLaps(validObjects, relationalLaps);
  const finiteTimestamps = timestamps.filter(value => value !== null);
  const eventCounts = Object.fromEntries(Object.entries(flags).map(([key, values]) => [key, countEpisodes(values)]));
  return {
    samplesMeasured: validObjects.length,
    durationSeconds: finiteTimestamps.length > 1 ? round((Math.max(...finiteTimestamps) - Math.min(...finiteTimestamps)) / 1000) : null,
    temporalIntegrity: {
      timestampMonotonicityViolations,
      sampleIndexMonotonicityViolations,
      duplicateSamples,
      batchGaps,
      sampleIndexGaps,
      timestampGaps: {
        above150ms: deltas.filter(value => value > 150).length,
        above250ms: deltas.filter(value => value > 250).length,
        above500ms: deltas.filter(value => value > 500).length,
        above1s: deltas.filter(value => value > 1000).length
      },
      deltaTimestampMs: distribution(deltas, [50, 95, 99])
    },
    structuralIntegrity: {
      invalidNumeric,
      trackProgressOutOfRange,
      driverActionOutOfRange
    },
    events: eventCounts,
    laps: {
      count: laps.length,
      valid: laps.filter(lap => lap.validLap === true).length,
      invalid: laps.filter(lap => lap.validLap === false).length,
      unknownValidity: laps.filter(lap => lap.validLap === null).length,
      items: laps
    },
    actions: action,
    state,
    problemRegions: {
      OFF_TRACK: eventCounts.offTrack.sampleCount,
      SPIN: eventCounts.spin.sampleCount,
      COLLISION: eventCounts.collision.sampleCount,
      TEMPORAL_GAP: deltas.filter(value => value > 150).length,
      INVALID_NUMERIC: invalidNumeric,
      ACTION_SATURATION: actionSaturation
    },
    potentiallyCleanSamples
  };
}

function reason(code, detail = null) {
  return detail === null ? code : `${code}:${detail}`;
}

export function classifyLineage(session) {
  const known = KNOWN_SESSIONS[session.sessionId];
  const reasons = [];
  const structural = session.qualitySignals?.structuralIntegrity;
  if (session.preMl15 === true) reasons.push('PRE_ML1_5_GEOMETRY');
  if (session.schemaVersion !== BASELINE.schemaVersion) reasons.push(reason('SCHEMA_INCOMPATIBLE', session.schemaVersion ?? 'UNKNOWN'));
  if (session.trackGeometryVersion !== BASELINE.trackGeometryVersion)
    reasons.push(reason('GEOMETRY_INCOMPATIBLE', session.trackGeometryVersion ?? 'UNKNOWN'));
  if (session.physicsVersion !== BASELINE.physicsVersion)
    reasons.push(reason('PHYSICS_INCOMPATIBLE', session.physicsVersion ?? 'UNKNOWN'));
  if (session.featureManifestVersion !== BASELINE.featureManifestVersion)
    reasons.push(reason('FEATURE_MANIFEST_INCOMPATIBLE', session.featureManifestVersion ?? 'UNKNOWN'));
  if (!ACCEPTED_GAME_BUILDS.includes(session.gameBuildVersion))
    reasons.push(reason('GAME_BUILD_UNKNOWN', session.gameBuildVersion ?? 'UNKNOWN'));
  if (session.payloadCorrupt === true) reasons.push('PAYLOAD_CORRUPT');
  if (session.sampleCausalityCompatible === false) reasons.push('SAMPLE_NONCAUSAL_OR_INCOMPATIBLE');
  if (structural && structural.invalidNumeric > 0) reasons.push('INVALID_NUMERIC_PAYLOAD');
  const missingLineage = ['schemaVersion', 'gameBuildVersion', 'trackGeometryVersion', 'physicsVersion', 'featureManifestVersion']
    .some(key => session[key] === null || session[key] === undefined);
  if (missingLineage) reasons.push('LINEAGE_UNDETERMINED');
  const mandatoryReject = reasons.some(item => /^(PRE_ML1_5|SCHEMA_INCOMPATIBLE|GEOMETRY_INCOMPATIBLE|PHYSICS_INCOMPATIBLE|FEATURE_MANIFEST_INCOMPATIBLE|GAME_BUILD_UNKNOWN|PAYLOAD_CORRUPT|SAMPLE_NONCAUSAL|INVALID_NUMERIC|LINEAGE_UNDETERMINED)/.test(item));
  if (mandatoryReject) return { lineageEligibility: LINEAGE_ELIGIBILITY.REJECT, lineageReasons: [...new Set(reasons)].sort() };

  if (session.simulationFingerprint && session.simulationFingerprint !== SIMULATION_FINGERPRINT_SHA256) {
    reasons.push(reason('SIMULATION_FINGERPRINT_MISMATCH_BASELINE_DIFFERENT', session.simulationFingerprint));
    return { lineageEligibility: LINEAGE_ELIGIBILITY.VALIDATION_ONLY, lineageReasons: reasons.sort() };
  }
  reasons.push(session.simulationFingerprint === SIMULATION_FINGERPRINT_SHA256
    ? 'SIMULATION_FINGERPRINT_MATCH' : 'SIMULATION_FINGERPRINT_NOT_RECORDED_PRE_FREEZE_OR_UNKNOWN');
  reasons.push('LINEAGE_FIELDS_COMPATIBLE');
  if (known?.group?.includes('INFRASTRUCTURE'))
    return { lineageEligibility: LINEAGE_ELIGIBILITY.INFRASTRUCTURE_ONLY, lineageReasons: reasons.sort() };
  if (session.collectionKind === 'AUTOMATIC')
    return { lineageEligibility: LINEAGE_ELIGIBILITY.VALIDATION_ONLY, lineageReasons: reasons.sort() };
  return { lineageEligibility: LINEAGE_ELIGIBILITY.COMPATIBLE, lineageReasons: reasons.sort() };
}

export function classifyQuality(session, lineageEligibility) {
  if (lineageEligibility === LINEAGE_ELIGIBILITY.REJECT) return QUALITY_ELIGIBILITY.REJECT;
  if (lineageEligibility === LINEAGE_ELIGIBILITY.INFRASTRUCTURE_ONLY
    || lineageEligibility === LINEAGE_ELIGIBILITY.VALIDATION_ONLY) return QUALITY_ELIGIBILITY.NOT_EVALUATED;
  if (session.sessionId === 'ad759118-4386-481f-9d34-f3d496eb1854') return QUALITY_ELIGIBILITY.REVIEW;
  if (!session.qualitySignals || session.qualitySignals.samplesMeasured === 0) return QUALITY_ELIGIBILITY.REVIEW;
  const integrity = session.qualitySignals.structuralIntegrity;
  if (integrity.invalidNumeric || integrity.trackProgressOutOfRange || integrity.driverActionOutOfRange)
    return QUALITY_ELIGIBILITY.REJECT;
  return QUALITY_ELIGIBILITY.CANDIDATE;
}

export function completeSession(input) {
  const known = KNOWN_SESSIONS[input.sessionId];
  const session = {
    source: input.source ?? 'UNKNOWN',
    sessionId: input.sessionId ?? null,
    localCollectionSessionId: input.localCollectionSessionId ?? null,
    knownGroup: known?.group ?? input.knownGroup ?? null,
    collectionKind: known?.kind ?? input.collectionKind ?? 'UNKNOWN',
    schemaVersion: finite(input.schemaVersion),
    gameBuildVersion: input.gameBuildVersion ?? known?.gameBuildVersion ?? null,
    physicsVersion: input.physicsVersion ?? null,
    trackGeometryVersion: input.trackGeometryVersion ?? null,
    featureManifestVersion: input.featureManifestVersion ?? null,
    simulationFingerprint: input.simulationFingerprint ?? null,
    fingerprintStatus: input.simulationFingerprint == null ? 'NOT_AVAILABLE'
      : input.simulationFingerprint === SIMULATION_FINGERPRINT_SHA256 ? 'MATCH' : 'MISMATCH_BASELINE_DIFFERENT',
    trackId: finite(input.trackId) ?? input.trackId ?? null,
    sampleRateHz: finite(input.sampleRateHz),
    scope: input.scope ?? null,
    status: input.status ?? null,
    driverTypes: [...new Set(input.driverTypes ?? known?.driverTypes ?? [])].sort(),
    batchCount: finite(input.batchCount),
    sampleCount: finite(input.sampleCount),
    lapCount: finite(input.lapCount),
    durationSeconds: finite(input.durationSeconds) ?? input.qualitySignals?.durationSeconds ?? null,
    createdAt: input.createdAt ?? null,
    finishedAt: input.finishedAt ?? null,
    rawPayloadAvailable: input.rawPayloadAvailable === true,
    evidence: [...new Set(input.evidence ?? [])].sort(),
    qualitySignals: input.qualitySignals ?? null,
    finalTrainingDataset: false,
    ...(input.preMl15 === true ? { preMl15: true } : {}),
    ...(input.payloadCorrupt === true ? { payloadCorrupt: true } : {}),
    ...(input.sampleCausalityCompatible === false ? { sampleCausalityCompatible: false } : {})
  };
  Object.assign(session, classifyLineage(session));
  session.qualityEligibility = classifyQuality(session, session.lineageEligibility);
  return session;
}

function mergeValue(current, incoming) {
  if (incoming === null || incoming === undefined) return current;
  return current === null || current === undefined || current === 'UNKNOWN' || current === 'DOCUMENTED'
    ? incoming : current;
}

export function mergeSessions(items) {
  const merged = new Map();
  for (const item of items) {
    const key = item.sessionId || item.localCollectionSessionId;
    if (!key) continue;
    if (!merged.has(key)) { merged.set(key, { ...item }); continue; }
    const current = merged.get(key);
    for (const [field, value] of Object.entries(item)) {
      if (['evidence', 'driverTypes'].includes(field)) current[field] = [...new Set([...(current[field] || []), ...(value || [])])].sort();
      else if (field === 'qualitySignals') {
        if ((value?.samplesMeasured ?? 0) > (current[field]?.samplesMeasured ?? 0)) current[field] = value;
      }
      else if (field === 'source') current[field] = [...new Set(String(current[field]).split('+').concat(String(value).split('+')))].sort().join('+');
      else if (field === 'rawPayloadAvailable' || field === 'payloadCorrupt') current[field] = Boolean(current[field] || value);
      else current[field] = mergeValue(current[field], value);
    }
  }
  return [...merged.values()].map(completeSession).sort((a, b) =>
    `${a.sessionId ?? ''}/${a.source}`.localeCompare(`${b.sessionId ?? ''}/${b.source}`, 'en'));
}

function aggregateBy(sessions, field) {
  const result = {};
  for (const session of sessions) {
    const key = session[field] == null ? 'UNKNOWN' : String(session[field]);
    if (!result[key]) result[key] = { sessions: 0, batches: 0, samples: 0, durationSeconds: 0 };
    result[key].sessions++;
    result[key].batches += session.batchCount ?? 0;
    result[key].samples += session.sampleCount ?? 0;
    result[key].durationSeconds += session.durationSeconds ?? 0;
    result[key].durationSeconds = round(result[key].durationSeconds);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function buildInventory({ sessions, sourceStatus }) {
  const completed = mergeSessions(sessions);
  const canonicalInventory = {
    inventorySchemaVersion: INVENTORY_SCHEMA_VERSION,
    baseline: {
      ...BASELINE,
      sampleRateHz: BASELINE_MANIFEST.rates.sampleRateHz,
      simulationHz: BASELINE_MANIFEST.rates.simulationHz,
      simulationFingerprint: SIMULATION_FINGERPRINT_SHA256
    },
    sourceStatus: [...sourceStatus].sort((a, b) => a.source.localeCompare(b.source, 'en')),
    sessions: completed,
    summary: {
      sessionCount: completed.length,
      batchCount: completed.reduce((sum, session) => sum + (session.batchCount ?? 0), 0),
      sampleCount: completed.reduce((sum, session) => sum + (session.sampleCount ?? 0), 0),
      durationSeconds: round(completed.reduce((sum, session) => sum + (session.durationSeconds ?? 0), 0)),
      hours: round(completed.reduce((sum, session) => sum + (session.durationSeconds ?? 0), 0) / 3600),
      byGameBuildVersion: aggregateBy(completed, 'gameBuildVersion'),
      byTrackId: aggregateBy(completed, 'trackId'),
      byCollectionKind: aggregateBy(completed, 'collectionKind'),
      byLineageEligibility: aggregateBy(completed, 'lineageEligibility'),
      byQualityEligibility: aggregateBy(completed, 'qualityEligibility')
    }
  };
  assertNoCredentials(canonicalInventory);
  return {
    canonicalInventory,
    canonicalSha256: createHash('sha256').update(stableSerialize(canonicalInventory)).digest('hex')
  };
}

export function assertNoCredentials(value, path = '') {
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) throw new Error(`CREDENTIAL_FIELD_FORBIDDEN:${path}${key}`);
    assertNoCredentials(child, `${path}${key}.`);
  }
  return true;
}

export function canonicalJson(inventory) {
  assertNoCredentials(inventory);
  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  }
  return `${JSON.stringify(sortKeys(inventory), null, 2)}\n`;
}
