import {
  DATASET_GENERATION_ID,
  FEATURE_ACTION_MANIFEST_VERSION,
  RUNTIME_DATASET_CONTRACT_VERSION,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  RUNTIME_TELEMETRY_SCHEMA_VERSION,
  SOURCE_RUNTIME_FINGERPRINT_SHA256,
  V3_FIELD_SPECIFICATIONS,
  V3_OBSERVATION_FEATURES,
  V3_TARGET_ORDER
} from '../lineage/runtimeDatasetContract.js';
import { BASELINE_MANIFEST } from '../lineage/baselineManifest.js';

const GROUPS = Object.freeze([
  'metadata', 'carState', 'trackState', 'powertrainState', 'boostState',
  'dynamicsState', 'aeroState', 'environmentState', 'driverAction', 'eventState'
]);
const TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', ...GROUPS]);
const ALL_SPECS = Object.freeze(Object.values(V3_FIELD_SPECIFICATIONS).flat());

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function keysForGroup(group) {
  return ALL_SPECS
    .map(field => field.path.split('.'))
    .filter(parts => parts.length === 2 && parts[0] === group)
    .map(parts => parts[1]);
}

function matchesSpec(value, field) {
  const { type, range } = field;
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (type === 'integer' && !Number.isInteger(value)) return false;
  if (type === 'boolean' && typeof value !== 'boolean') return false;
  if (type === 'string' && (typeof value !== 'string' || value.length < (range.minLength ?? 0))) return false;
  if (type === 'enum' && !range.values.includes(value)) return false;
  if ((type === 'number' || type === 'integer') && range.min !== undefined && value < range.min) return false;
  if ((type === 'number' || type === 'integer') && range.max !== undefined && value > range.max) return false;
  if (range.values && type !== 'enum' && !range.values.includes(value)) return false;
  if (range.value !== undefined && value !== range.value) return false;
  if (range.pattern && (typeof value !== 'string' || !(new RegExp(range.pattern)).test(value))) return false;
  return true;
}

export function validateTelemetrySampleV3(sample) {
  if (!exactKeys(sample, TOP_LEVEL_KEYS)) return false;
  for (const group of GROUPS) {
    if (!exactKeys(sample[group], keysForGroup(group))) return false;
  }
  for (const field of ALL_SPECS) {
    if (!matchesSpec(getPath(sample, field.path), field)) return false;
  }
  const metadata = sample.metadata;
  return sample.schemaVersion === RUNTIME_TELEMETRY_SCHEMA_VERSION
    && metadata.schemaVersion === RUNTIME_TELEMETRY_SCHEMA_VERSION
    && metadata.datasetGenerationId === DATASET_GENERATION_ID
    && metadata.runtimeDatasetContractVersion === RUNTIME_DATASET_CONTRACT_VERSION
    && metadata.gameBuildVersion === BASELINE_MANIFEST.lineage.gameBuildVersion
    && metadata.physicsVersion === BASELINE_MANIFEST.lineage.physicsVersion
    && metadata.trackGeometryVersion === BASELINE_MANIFEST.lineage.trackGeometryVersion
    && metadata.featureActionManifestVersion === FEATURE_ACTION_MANIFEST_VERSION
    && metadata.sourceRuntimeFingerprintSha256 === SOURCE_RUNTIME_FINGERPRINT_SHA256
    && metadata.simulationFingerprintSha256 === RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

export function createTelemetrySampleV3(sample) {
  if (!validateTelemetrySampleV3(sample)) throw new Error('INVALID_TELEMETRY_V3_SAMPLE');
  return clone(sample);
}

function encodeFeature(path, value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (path === 'trackState.surface')
    return V3_FIELD_SPECIFICATIONS.observations.find(field => field.path === path).range.values.indexOf(value);
  if (path === 'environmentState.trackCondition')
    return V3_FIELD_SPECIFICATIONS.observations.find(field => field.path === path).range.values.indexOf(value);
  return value;
}

export function buildObservationVectorV3(sample) {
  if (!validateTelemetrySampleV3(sample)) throw new Error('INVALID_TELEMETRY_V3_SAMPLE');
  return V3_OBSERVATION_FEATURES.map(path => encodeFeature(path, getPath(sample, path)));
}

export function buildTargetVectorV3(sample) {
  if (!validateTelemetrySampleV3(sample)) throw new Error('INVALID_TELEMETRY_V3_SAMPLE');
  return V3_TARGET_ORDER.map(path => encodeFeature(path, getPath(sample, path)));
}
