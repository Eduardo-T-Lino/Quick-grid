import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  ELIGIBILITY_DECISION,
  evaluateLap,
  evaluateLineage,
  evaluateSample,
  evaluateSegment,
  evaluateSession,
  ML3_QUALITY_POLICY_VERSION,
  QUALITY_POLICY
} from './qualityPolicy.js';
import { stableSerialize } from '../../src/ml/lineage/acceptedBaseline.js';
import { validateTelemetrySample } from '../../src/ml/telemetry/telemetrySchema.js';
import { analyzeSamples } from './inventoryCore.js';

export const ML3_SEGMENT_FILTER_VERSION = 'ML3.2-1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SAMPLE_MASK = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED'
});

export const FILTER_REASON = Object.freeze({
  ACCEPTED_BY_ELIGIBLE_SEGMENT: 'ACCEPTED_BY_ELIGIBLE_SEGMENT',
  RAW_SAMPLE_EVIDENCE_MISSING: 'RAW_SAMPLE_EVIDENCE_MISSING',
  PARENT_LINEAGE_NOT_ELIGIBLE: 'PARENT_LINEAGE_NOT_ELIGIBLE',
  PARENT_SESSION_NOT_ELIGIBLE: 'PARENT_SESSION_NOT_ELIGIBLE',
  PARENT_LAP_BLOCKS_SEGMENTS: 'PARENT_LAP_BLOCKS_SEGMENTS',
  RAW_SAMPLE_INVENTORY_MISMATCH: 'RAW_SAMPLE_INVENTORY_MISMATCH',
  INVALID_SAMPLE: 'INVALID_SAMPLE',
  SAMPLE_SURFACE_DISALLOWED: 'SAMPLE_SURFACE_DISALLOWED',
  EVENT_OFF_TRACK: 'EVENT_OFF_TRACK',
  EVENT_SPIN: 'EVENT_SPIN',
  EVENT_COLLISION: 'EVENT_COLLISION',
  EVENT_RECOVERING: 'EVENT_RECOVERING',
  EVENT_WINDOW_OFF_TRACK: 'EVENT_WINDOW_OFF_TRACK',
  EVENT_WINDOW_SPIN: 'EVENT_WINDOW_SPIN',
  EVENT_WINDOW_COLLISION: 'EVENT_WINDOW_COLLISION',
  EVENT_WINDOW_RECOVERING: 'EVENT_WINDOW_RECOVERING',
  TEMPORAL_GAP_WINDOW: 'TEMPORAL_GAP_WINDOW',
  SAMPLE_INDEX_DISCONTINUITY: 'SAMPLE_INDEX_DISCONTINUITY',
  TIMESTAMP_DELTA_OUT_OF_RANGE: 'TIMESTAMP_DELTA_OUT_OF_RANGE',
  NO_ELIGIBLE_SEGMENT: 'NO_ELIGIBLE_SEGMENT'
});

const REASON_PRIORITY = Object.freeze([
  FILTER_REASON.PARENT_LINEAGE_NOT_ELIGIBLE,
  FILTER_REASON.PARENT_SESSION_NOT_ELIGIBLE,
  FILTER_REASON.PARENT_LAP_BLOCKS_SEGMENTS,
  FILTER_REASON.RAW_SAMPLE_INVENTORY_MISMATCH,
  FILTER_REASON.INVALID_SAMPLE,
  FILTER_REASON.SAMPLE_SURFACE_DISALLOWED,
  FILTER_REASON.EVENT_COLLISION,
  FILTER_REASON.EVENT_WINDOW_COLLISION,
  FILTER_REASON.EVENT_SPIN,
  FILTER_REASON.EVENT_WINDOW_SPIN,
  FILTER_REASON.EVENT_OFF_TRACK,
  FILTER_REASON.EVENT_WINDOW_OFF_TRACK,
  FILTER_REASON.EVENT_RECOVERING,
  FILTER_REASON.EVENT_WINDOW_RECOVERING,
  FILTER_REASON.TEMPORAL_GAP_WINDOW,
  FILTER_REASON.SAMPLE_INDEX_DISCONTINUITY,
  FILTER_REASON.TIMESTAMP_DELTA_OUT_OF_RANGE,
  FILTER_REASON.NO_ELIGIBLE_SEGMENT
]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function round(value) {
  return Number(value.toFixed(6));
}

function primaryReason(reasons) {
  return REASON_PRIORITY.find(reason => reasons.includes(reason)) ?? reasons[0] ?? FILTER_REASON.NO_ELIGIBLE_SEGMENT;
}

function addReasons(rows, reasons) {
  for (const row of rows) for (const reason of reasons) row.reasons.add(reason);
}

function sampleIdentity(row) {
  return {
    provenance: row.provenance,
    sessionId: row.sessionId,
    sampleSessionId: row.sampleSessionId,
    lapNumber: row.lapNumber,
    sampleIndex: row.sampleIndex
  };
}

function hasRequiredFields(sample) {
  return Boolean(sample && typeof sample === 'object'
    && sample.metadata && typeof sample.metadata === 'object'
    && sample.trackState && typeof sample.trackState === 'object'
    && sample.carState && typeof sample.carState === 'object'
    && sample.driverAction && typeof sample.driverAction === 'object'
    && sample.eventState && typeof sample.eventState === 'object'
    && typeof sample.eventState.offTrack === 'boolean'
    && typeof sample.eventState.spin === 'boolean'
    && typeof sample.eventState.collision === 'boolean'
    && typeof sample.eventState.isRecovering === 'boolean');
}

function actionInRange(sample) {
  const action = sample?.driverAction;
  return finite(action?.steering) && action.steering >= -1.0001 && action.steering <= 1.0001
    && finite(action?.throttle) && action.throttle >= -0.0001 && action.throttle <= 1.0001
    && finite(action?.brake) && action.brake >= -0.0001 && action.brake <= 1.0001;
}

function rawSampleEvidence(row, lineageStratum) {
  const sample = row.sample;
  const events = sample?.eventState ?? {};
  return {
    requiredFieldsPresent: hasRequiredFields(sample),
    numericFinite: validateTelemetrySample(sample),
    actionInRange: actionInRange(sample),
    causalV2: sample?.schemaVersion === QUALITY_POLICY.schemaVersion,
    eventFlagsClear: events.offTrack !== true && events.spin !== true && events.collision !== true
      && events.isRecovering !== true,
    eventWindowClear: ![...row.reasons].some(reason => reason.startsWith('EVENT_WINDOW_')),
    temporalWindowClear: !row.reasons.has(FILTER_REASON.TEMPORAL_GAP_WINDOW)
      && !row.reasons.has(FILTER_REASON.TIMESTAMP_DELTA_OUT_OF_RANGE),
    sameSession: row.sameSession,
    sameLap: Number.isInteger(row.lapNumber),
    sameLineageStratum: row.lineageStratum === lineageStratum,
    surface: sample?.trackState?.surface
  };
}

export function rawInventoryMismatches(session, samples) {
  const recorded = session.qualitySignals;
  if (!recorded) return [];
  const observed = analyzeSamples(samples, { sampleRateHz: session.sampleRateHz });
  const mismatches = [];
  const compare = (path, expected, actual) => {
    if (expected !== undefined && expected !== actual) mismatches.push(`RAW_INVENTORY_MISMATCH:${path}`);
  };
  compare('samplesMeasured', recorded.samplesMeasured, observed.samplesMeasured);
  for (const key of ['invalidNumeric', 'trackProgressOutOfRange', 'driverActionOutOfRange'])
    compare(`structuralIntegrity.${key}`, recorded.structuralIntegrity?.[key], observed.structuralIntegrity?.[key]);
  for (const key of ['timestampMonotonicityViolations', 'sampleIndexMonotonicityViolations',
    'duplicateSamples', 'sampleIndexGaps'])
    compare(`temporalIntegrity.${key}`, recorded.temporalIntegrity?.[key], observed.temporalIntegrity?.[key]);
  compare('temporalIntegrity.timestampGaps.above150ms',
    recorded.temporalIntegrity?.timestampGaps?.above150ms,
    observed.temporalIntegrity?.timestampGaps?.above150ms);
  for (const key of ['offTrack', 'spin', 'collision'])
    compare(`events.${key}.sampleCount`, recorded.events?.[key]?.sampleCount, observed.events?.[key]?.sampleCount);
  for (const key of ['TARMAC', 'KERB', 'RUNOFF', 'GRAVEL'])
    compare(`surfaces.${key}.count`, recorded.surfaces?.[key]?.count, observed.surfaces?.[key]?.count);
  for (const recordedLap of recorded.laps?.items ?? []) {
    const observedLap = observed.laps?.items?.find(item => item.lapNumber === recordedLap.lapNumber);
    for (const key of ['sampleCount', 'offTrackCount', 'spinCount', 'collisionCount'])
      compare(`laps.${recordedLap.lapNumber}.${key}`, recordedLap[key], observedLap?.[key]);
  }
  return sortedUnique(mismatches);
}

function deriveLapEvidence(rows) {
  const firstTimestamp = rows[0]?.timestamp;
  const lastTimestamp = rows.at(-1)?.timestamp;
  const count = key => rows.filter(row => row.sample?.eventState?.[key] === true).length;
  const offTrackCount = count('offTrack');
  const collisionCount = count('collision');
  const spinCount = count('spin');
  return {
    lapNumber: rows[0]?.lapNumber,
    sampleCount: rows.length,
    lapTime: finite(firstTimestamp) && finite(lastTimestamp) && lastTimestamp > firstTimestamp
      ? (lastTimestamp - firstTimestamp) / 1000 : null,
    validLap: offTrackCount === 0 && collisionCount === 0 && spinCount === 0,
    offTrackCount,
    collisionCount,
    spinCount
  };
}

function markEventWindows(rows) {
  const configurations = [
    ['offTrack', 'OFF_TRACK', FILTER_REASON.EVENT_OFF_TRACK, FILTER_REASON.EVENT_WINDOW_OFF_TRACK],
    ['spin', 'SPIN', FILTER_REASON.EVENT_SPIN, FILTER_REASON.EVENT_WINDOW_SPIN],
    ['collision', 'COLLISION', FILTER_REASON.EVENT_COLLISION, FILTER_REASON.EVENT_WINDOW_COLLISION],
    ['isRecovering', 'RECOVERING', FILTER_REASON.EVENT_RECOVERING, FILTER_REASON.EVENT_WINDOW_RECOVERING]
  ];
  for (const [field, policyKey, directReason, windowReason] of configurations) {
    const events = rows.filter(row => row.sample?.eventState?.[field] === true && finite(row.timestamp));
    const window = QUALITY_POLICY.eventExclusionWindowsMs[policyKey];
    for (const event of events) {
      event.reasons.add(directReason);
      for (const row of rows) {
        if (!finite(row.timestamp)) continue;
        const after = window.after === 'REST_OF_LAP' ? Number.POSITIVE_INFINITY : window.after;
        if (row.timestamp >= event.timestamp - window.before && row.timestamp <= event.timestamp + after)
          row.reasons.add(windowReason);
      }
    }
  }
}

function markTemporalBoundaries(rows) {
  const gapWindow = QUALITY_POLICY.eventExclusionWindowsMs.TEMPORAL_GAP;
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!Number.isInteger(previous.sampleIndex) || !Number.isInteger(current.sampleIndex)
      || current.sampleIndex !== previous.sampleIndex + 1) {
      previous.reasons.add(FILTER_REASON.SAMPLE_INDEX_DISCONTINUITY);
      current.reasons.add(FILTER_REASON.SAMPLE_INDEX_DISCONTINUITY);
    }
    if (!finite(previous.timestamp) || !finite(current.timestamp)) {
      previous.reasons.add(FILTER_REASON.INVALID_SAMPLE);
      current.reasons.add(FILTER_REASON.INVALID_SAMPLE);
      continue;
    }
    const delta = current.timestamp - previous.timestamp;
    if (delta < QUALITY_POLICY.adjacentDeltaMs.min || delta > QUALITY_POLICY.adjacentDeltaMs.max) {
      previous.reasons.add(FILTER_REASON.TIMESTAMP_DELTA_OUT_OF_RANGE);
      current.reasons.add(FILTER_REASON.TIMESTAMP_DELTA_OUT_OF_RANGE);
    }
    if (delta > QUALITY_POLICY.adjacentDeltaMs.max) {
      for (const row of rows) {
        if (!finite(row.timestamp)) continue;
        const beforeGap = row.timestamp >= previous.timestamp - gapWindow.before && row.timestamp <= previous.timestamp;
        const afterGap = row.timestamp >= current.timestamp && row.timestamp <= current.timestamp + gapWindow.after;
        if (beforeGap || afterGap) row.reasons.add(FILTER_REASON.TEMPORAL_GAP_WINDOW);
      }
    }
  }
}

function intervalize(masks) {
  const intervals = [];
  for (const item of masks) {
    const previous = intervals.at(-1);
    const contiguous = previous && previous.mask === item.mask
      && previous.sessionId === item.sessionId && previous.lapNumber === item.lapNumber
      && Number.isInteger(previous.endSampleIndex) && Number.isInteger(item.sampleIndex)
      && item.sampleIndex === previous.endSampleIndex + 1;
    if (!contiguous) {
      intervals.push({
        mask: item.mask,
        sessionId: item.sessionId,
        lapNumber: item.lapNumber,
        lineageStratum: item.lineageStratum,
        startSampleIndex: item.sampleIndex,
        endSampleIndex: item.sampleIndex,
        sampleCount: 1,
        primaryReasons: [item.primaryReason],
        reasonCodes: [...item.reasonCodes]
      });
      continue;
    }
    previous.endSampleIndex = item.sampleIndex;
    previous.sampleCount++;
    previous.primaryReasons = sortedUnique([...previous.primaryReasons, item.primaryReason]);
    previous.reasonCodes = sortedUnique([...previous.reasonCodes, ...item.reasonCodes]);
  }
  return intervals;
}

function summarizeMasks(masks, acceptedSegments, rejectedCandidateSegments) {
  const accepted = masks.filter(item => item.mask === SAMPLE_MASK.ACCEPTED).length;
  const rejected = masks.length - accepted;
  const reasonCounts = {};
  for (const item of masks) {
    if (item.mask !== SAMPLE_MASK.REJECTED) continue;
    reasonCounts[item.primaryReason] = (reasonCounts[item.primaryReason] ?? 0) + 1;
  }
  return {
    totalSamples: masks.length,
    accepted,
    rejected,
    coveragePercent: masks.length ? round(100 * accepted / masks.length) : 0,
    acceptedCandidateSegments: acceptedSegments.length,
    rejectedCandidateSegments,
    reasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b)))
  };
}

function finalizeRows(rows, acceptedRows, acceptedSegments, rejectedCandidateSegments) {
  const masks = rows.map(row => {
    const accepted = acceptedRows.has(row.ordinal);
    const reasonCodes = accepted
      ? [FILTER_REASON.ACCEPTED_BY_ELIGIBLE_SEGMENT]
      : sortedUnique(row.reasons.size ? [...row.reasons] : [FILTER_REASON.NO_ELIGIBLE_SEGMENT]);
    return {
      ...sampleIdentity(row),
      lineageStratum: row.lineageStratum,
      mask: accepted ? SAMPLE_MASK.ACCEPTED : SAMPLE_MASK.REJECTED,
      accepted,
      primaryReason: accepted ? FILTER_REASON.ACCEPTED_BY_ELIGIBLE_SEGMENT : primaryReason(reasonCodes),
      reasonCodes,
      finalTrainingEligible: false
    };
  });
  const intervals = intervalize(masks);
  return {
    masks,
    acceptedSegments,
    acceptedIntervals: intervals.filter(interval => interval.mask === SAMPLE_MASK.ACCEPTED),
    rejectedIntervals: intervals.filter(interval => interval.mask === SAMPLE_MASK.REJECTED),
    summary: summarizeMasks(masks, acceptedSegments, rejectedCandidateSegments)
  };
}

export function filterSessionSamples({ session = {}, samples = [] } = {}) {
  if (!Array.isArray(samples)) throw new Error('SAMPLES_ARRAY_REQUIRED');
  if (Number.isInteger(session.sampleCount) && session.sampleCount !== samples.length)
    throw new Error('RAW_SAMPLE_COUNT_MISMATCH');
  const lineageEvaluation = evaluateLineage(session);
  const sessionEvaluation = evaluateSession(session, lineageEvaluation);
  const observedSampleSessions = new Set(samples.map(sample => sample?.metadata?.sessionId));
  const expectedSessionIds = new Set([session.sessionId, session.localCollectionSessionId].filter(Boolean));
  const rawSessionLinked = observedSampleSessions.size === 1
    && expectedSessionIds.has([...observedSampleSessions][0]);
  const provenance = Object.freeze({
    source: session.source ?? null,
    collectionKind: session.collectionKind ?? null,
    localCollectionSessionId: session.localCollectionSessionId ?? null
  });
  const rows = samples.map((sample, ordinal) => ({
    ordinal,
    sample,
    provenance,
    sessionId: session.sessionId ?? null,
    sampleSessionId: sample?.metadata?.sessionId ?? null,
    lapNumber: sample?.metadata?.lapNumber ?? null,
    sampleIndex: sample?.metadata?.sampleIndex ?? null,
    timestamp: sample?.metadata?.timestamp ?? null,
    lineageStratum: lineageEvaluation.lineageStratum ?? null,
    sameSession: typeof sample?.metadata?.sessionId === 'string' && rawSessionLinked,
    reasons: new Set()
  }));
  for (const row of rows) {
    if (!hasRequiredFields(row.sample) || !validateTelemetrySample(row.sample))
      row.reasons.add(FILTER_REASON.INVALID_SAMPLE);
    if (!QUALITY_POLICY.allowedSurfaces.includes(row.sample?.trackState?.surface))
      row.reasons.add(FILTER_REASON.SAMPLE_SURFACE_DISALLOWED);
  }
  const inventoryMismatches = rawInventoryMismatches(session, samples);
  const acceptedRows = new Set();
  const acceptedSegments = [];
  let rejectedCandidateSegments = 0;

  if (lineageEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    addReasons(rows, [FILTER_REASON.PARENT_LINEAGE_NOT_ELIGIBLE, ...lineageEvaluation.reasons]);
    return {
      filterVersion: ML3_SEGMENT_FILTER_VERSION,
      qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
      lineageEvaluation,
      sessionEvaluation,
      rawSampleInventoryMismatchCount: inventoryMismatches.length,
      rawInventoryMismatches: inventoryMismatches,
      finalTrainingDataset: false,
      ...finalizeRows(rows, acceptedRows, acceptedSegments, rejectedCandidateSegments)
    };
  }
  if (sessionEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    addReasons(rows, [FILTER_REASON.PARENT_SESSION_NOT_ELIGIBLE, ...sessionEvaluation.reasons]);
    return {
      filterVersion: ML3_SEGMENT_FILTER_VERSION,
      qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
      lineageEvaluation,
      sessionEvaluation,
      rawSampleInventoryMismatchCount: inventoryMismatches.length,
      rawInventoryMismatches: inventoryMismatches,
      finalTrainingDataset: false,
      ...finalizeRows(rows, acceptedRows, acceptedSegments, rejectedCandidateSegments)
    };
  }
  if (inventoryMismatches.length) {
    addReasons(rows, [FILTER_REASON.RAW_SAMPLE_INVENTORY_MISMATCH, ...inventoryMismatches]);
    return {
      filterVersion: ML3_SEGMENT_FILTER_VERSION,
      qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
      lineageEvaluation,
      sessionEvaluation,
      rawSampleInventoryMismatchCount: inventoryMismatches.length,
      rawInventoryMismatches: inventoryMismatches,
      finalTrainingDataset: false,
      ...finalizeRows(rows, acceptedRows, acceptedSegments, rejectedCandidateSegments)
    };
  }

  const byLap = new Map();
  for (const row of rows) {
    if (!byLap.has(row.lapNumber)) byLap.set(row.lapNumber, []);
    byLap.get(row.lapNumber).push(row);
  }

  const configuredLaps = session.qualitySignals?.laps?.items ?? [];
  const lapEvaluations = [];
  for (const [lapNumber, lapRows] of [...byLap.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    const lapEvidence = configuredLaps.find(item => item.lapNumber === lapNumber) ?? deriveLapEvidence(lapRows);
    const lapEvaluation = evaluateLap(lapEvidence, sessionEvaluation);
    lapEvaluations.push(lapEvaluation);
    markEventWindows(lapRows);
    markTemporalBoundaries(lapRows);
    if (!lapEvaluation.allowsSegmentEvaluation) {
      addReasons(lapRows, [FILTER_REASON.PARENT_LAP_BLOCKS_SEGMENTS, ...lapEvaluation.reasons]);
      continue;
    }
    const windowSize = QUALITY_POLICY.segmentSamples;
    if (lapRows.length < windowSize) {
      addReasons(lapRows, [FILTER_REASON.NO_ELIGIBLE_SEGMENT]);
      continue;
    }
    const fullLapEvidence = lapEvidence.sampleCount === lapRows.length;
    for (let start = 0; start <= lapRows.length - windowSize; start++) {
      const windowRows = lapRows.slice(start, start + windowSize);
      const deltas = windowRows.slice(1).map((row, index) => row.timestamp - windowRows[index].timestamp);
      const sampleIndexesContiguous = windowRows.slice(1)
        .every((row, index) => Number.isInteger(row.sampleIndex)
          && row.sampleIndex === windowRows[index].sampleIndex + 1);
      const timestampsStrictlyIncreasing = deltas.every(delta => finite(delta) && delta > 0);
      const eventWindowContaminatedSamples = windowRows.filter(row =>
        [...row.reasons].some(reason => reason.startsWith('EVENT_WINDOW_'))).length;
      const invalidNumericSamples = windowRows.filter(row => !validateTelemetrySample(row.sample)).length;
      const invalidActionSamples = windowRows.filter(row => !actionInRange(row.sample)).length;
      const disallowedSurfaceSamples = windowRows.filter(row =>
        !QUALITY_POLICY.allowedSurfaces.includes(row.sample?.trackState?.surface)).length;
      const segmentEvaluation = evaluateSegment({
        sampleCount: windowRows.length,
        sampleRateHz: session.sampleRateHz,
        lineageStratum: lineageEvaluation.lineageStratum,
        sameSession: new Set(windowRows.map(row => row.sampleSessionId)).size === 1,
        sameLap: new Set(windowRows.map(row => row.lapNumber)).size === 1,
        sampleIndexesContiguous,
        timestampsStrictlyIncreasing,
        minDeltaMs: deltas.length && deltas.every(finite) ? Math.min(...deltas) : null,
        maxDeltaMs: deltas.length && deltas.every(finite) ? Math.max(...deltas) : null,
        temporalGapCount: deltas.filter(delta => finite(delta) && delta > QUALITY_POLICY.adjacentDeltaMs.max).length,
        boundaryContextComplete: fullLapEvidence,
        eventWindowContaminatedSamples,
        invalidNumericSamples,
        invalidActionSamples,
        disallowedSurfaceSamples
      }, { sessionEvaluation, lapEvaluation });
      if (segmentEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
        rejectedCandidateSegments++;
        addReasons(windowRows, segmentEvaluation.reasons);
        continue;
      }
      let sampleDecisionsEligible = true;
      for (const row of windowRows) {
        const sampleEvaluation = evaluateSample(rawSampleEvidence(row, lineageEvaluation.lineageStratum), segmentEvaluation);
        if (sampleEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
          sampleDecisionsEligible = false;
          addReasons([row], sampleEvaluation.reasons);
        }
      }
      if (!sampleDecisionsEligible) {
        rejectedCandidateSegments++;
        continue;
      }
      acceptedSegments.push({
        sessionId: session.sessionId ?? null,
        sampleSessionId: windowRows[0].sampleSessionId,
        lapNumber,
        lineageStratum: lineageEvaluation.lineageStratum,
        startSampleIndex: windowRows[0].sampleIndex,
        endSampleIndex: windowRows.at(-1).sampleIndex,
        sampleCount: windowSize,
        finalTrainingEligible: false
      });
      for (const row of windowRows) acceptedRows.add(row.ordinal);
    }
  }

  return {
    filterVersion: ML3_SEGMENT_FILTER_VERSION,
    qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
    lineageEvaluation,
    sessionEvaluation,
    rawSampleInventoryMismatchCount: inventoryMismatches.length,
    rawInventoryMismatches: inventoryMismatches,
    lapEvaluations,
    finalTrainingDataset: false,
    ...finalizeRows(rows, acceptedRows, acceptedSegments, rejectedCandidateSegments)
  };
}

export function summarizeInventorySessionWithoutRawSamples(session) {
  const lineageEvaluation = evaluateLineage(session);
  const sessionEvaluation = evaluateSession(session, lineageEvaluation);
  let reason = FILTER_REASON.RAW_SAMPLE_EVIDENCE_MISSING;
  if (lineageEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE)
    reason = FILTER_REASON.PARENT_LINEAGE_NOT_ELIGIBLE;
  else if (sessionEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE)
    reason = FILTER_REASON.PARENT_SESSION_NOT_ELIGIBLE;
  return {
    sessionId: session.sessionId ?? null,
    lineageStratum: lineageEvaluation.lineageStratum ?? null,
    lineageDecision: lineageEvaluation.decision,
    sessionDecision: sessionEvaluation.decision,
    totalSamples: Number.isInteger(session.sampleCount) && session.sampleCount > 0 ? session.sampleCount : 0,
    accepted: 0,
    rejected: Number.isInteger(session.sampleCount) && session.sampleCount > 0 ? session.sampleCount : 0,
    coveragePercent: 0,
    reason,
    maskMaterialized: false,
    maskUnavailableReason: FILTER_REASON.RAW_SAMPLE_EVIDENCE_MISSING,
    finalTrainingDataset: false
  };
}

export function selectFrozenInventorySessions(artifact, { sessionId = null } = {}) {
  const inventory = artifact?.canonicalInventory;
  if (!inventory || !Array.isArray(inventory.sessions)) throw new Error('CANONICAL_INVENTORY_REQUIRED');
  const computedHash = createHash('sha256').update(stableSerialize(inventory)).digest('hex');
  if (artifact.canonicalSha256 !== computedHash) throw new Error('INVENTORY_CANONICAL_HASH_INVALID');
  if (computedHash !== QUALITY_POLICY.acceptedInventoryCanonicalSha256)
    throw new Error('INVENTORY_NOT_ACCEPTED_BY_ML3_1');
  if (sessionId !== null && !UUID.test(sessionId)) throw new Error('SESSION_ID_INVALID');
  const selected = inventory.sessions
    .filter(session => sessionId === null || session.sessionId === sessionId)
    .sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));
  if (sessionId !== null && !selected.length) throw new Error('SESSION_NOT_FOUND');
  return { computedHash, selected };
}

export function filterInventoryArtifact(artifact, { sessionId = null, samplesBySession = {} } = {}) {
  const { computedHash, selected } = selectFrozenInventorySessions(artifact, { sessionId });
  const rawFor = id => samplesBySession instanceof Map ? samplesBySession.get(id) : samplesBySession?.[id];
  const sessions = selected.map(session => {
    const samples = rawFor(session.sessionId);
    return Array.isArray(samples)
      ? filterSessionSamples({ session, samples })
      : summarizeInventorySessionWithoutRawSamples(session);
  });
  const summary = sessions.reduce((result, session) => {
    result.totalSamples += session.summary?.totalSamples ?? session.totalSamples;
    result.accepted += session.summary?.accepted ?? session.accepted;
    result.rejected += session.summary?.rejected ?? session.rejected;
    const reasonCounts = session.summary?.reasonCounts ?? { [session.reason]: session.rejected };
    for (const [reason, count] of Object.entries(reasonCounts))
      result.reasonCounts[reason] = (result.reasonCounts[reason] ?? 0) + count;
    return result;
  }, { totalSamples: 0, accepted: 0, rejected: 0, reasonCounts: {} });
  summary.coveragePercent = summary.totalSamples ? round(100 * summary.accepted / summary.totalSamples) : 0;
  summary.reasonCounts = Object.fromEntries(Object.entries(summary.reasonCounts).sort(([a], [b]) => a.localeCompare(b)));
  summary.acceptedIntervals = sessions.reduce((count, session) => count + (session.acceptedIntervals?.length ?? 0), 0);
  summary.rejectedIntervals = sessions.reduce((count, session) => count + (session.rejectedIntervals?.length ?? 0), 0);
  summary.unmaterializedRejectionBlocks = sessions.filter(session => session.maskMaterialized === false).length;

  const byLineage = {};
  for (const session of sessions) {
    const key = session.lineageEvaluation?.lineageStratum ?? session.lineageStratum ?? 'UNRESOLVED';
    if (!byLineage[key]) byLineage[key] = { sessions: 0, totalSamples: 0, accepted: 0, rejected: 0 };
    byLineage[key].sessions++;
    byLineage[key].totalSamples += session.summary?.totalSamples ?? session.totalSamples;
    byLineage[key].accepted += session.summary?.accepted ?? session.accepted;
    byLineage[key].rejected += session.summary?.rejected ?? session.rejected;
  }
  for (const value of Object.values(byLineage))
    value.coveragePercent = value.totalSamples ? round(100 * value.accepted / value.totalSamples) : 0;

  const result = {
    filterVersion: ML3_SEGMENT_FILTER_VERSION,
    qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
    sourceInventoryCanonicalSha256: computedHash,
    sessions,
    byLineage: Object.fromEntries(Object.entries(byLineage).sort(([a], [b]) => a.localeCompare(b))),
    summary,
    finalTrainingDataset: false
  };
  return { ...result, filterSha256: createHash('sha256').update(stableSerialize(result)).digest('hex') };
}

function parseCli(args) {
  const options = { inventory: null, sessionId: null };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--inventory') options.inventory = args[++index];
    else if (args[index] === '--session') options.sessionId = args[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${args[index]}`);
  }
  if (!options.inventory) throw new Error('USAGE: node scripts/ml3/segmentFilter.js --inventory <path> [--session <id>]');
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const artifact = JSON.parse(readFileSync(options.inventory, 'utf8'));
  const result = filterInventoryArtifact(artifact, { sessionId: options.sessionId });
  console.log(JSON.stringify({
    filterVersion: result.filterVersion,
    qualityPolicyVersion: result.qualityPolicyVersion,
    sourceInventoryCanonicalSha256: result.sourceInventoryCanonicalSha256,
    filterSha256: result.filterSha256,
    byLineage: result.byLineage,
    summary: result.summary,
    sessions: result.sessions.map(session => ({
      sessionId: session.sessionId ?? session.masks?.[0]?.sessionId ?? null,
      lineageStratum: session.lineageStratum ?? session.lineageEvaluation?.lineageStratum ?? null,
      totalSamples: session.totalSamples ?? session.summary?.totalSamples ?? 0,
      accepted: session.accepted ?? session.summary?.accepted ?? 0,
      rejected: session.rejected ?? session.summary?.rejected ?? 0,
      coveragePercent: session.coveragePercent ?? session.summary?.coveragePercent ?? 0,
      reason: session.reason ?? null,
      acceptedIntervals: session.acceptedIntervals?.length ?? 0,
      rejectedIntervals: session.rejectedIntervals?.length ?? 0,
      maskMaterialized: session.maskMaterialized ?? true
    })),
    finalTrainingDataset: false
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
