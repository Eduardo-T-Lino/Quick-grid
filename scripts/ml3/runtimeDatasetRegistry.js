import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BASELINE_MANIFEST, stableSerialize } from '../../src/ml/lineage/baselineManifest.js';
import {
  DATASET_GENERATION_ID,
  DATASET_GENERATION_VERSION,
  FEATURE_ACTION_MANIFEST_VERSION,
  RUNTIME_DATASET_CONTRACT_VERSION,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  RUNTIME_TELEMETRY_SCHEMA_VERSION,
  SOURCE_RUNTIME_FINGERPRINT_SHA256,
  SURFACE_ENCODING,
  TRACK_CONDITION_ENCODING,
  V3_OBSERVATION_FEATURES,
  V3_TARGET_ORDER
} from '../../src/ml/lineage/runtimeDatasetContract.js';

export const DATASET_REGISTRY_FORMAT_VERSION = 1;
export const EMPTY_GENERATION_STATUS = 'CONTRACT_FROZEN_NO_DATA';
export const PROMOTED_GENERATION_STATUS = 'PROMOTED';

function fail(code) {
  throw new Error(code);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function equalArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function withoutManifestHash(manifest) {
  const { manifestSha256: _ignored, ...canonical } = manifest;
  return canonical;
}

export function calculateGenerationManifestSha256(manifest) {
  return createHash('sha256').update(stableSerialize(withoutManifestHash(manifest))).digest('hex');
}

function validateRuntimeLineage(manifest) {
  const expected = BASELINE_MANIFEST.lineage;
  const actual = manifest.runtimeLineage;
  if (!isObject(actual)
    || actual.gameBuildVersion !== expected.gameBuildVersion
    || actual.physicsVersion !== expected.physicsVersion
    || actual.trackGeometryVersion !== expected.trackGeometryVersion)
    fail('MIXED_RUNTIME_LINEAGE');
  if (manifest.sourceRuntimeFingerprintSha256 !== SOURCE_RUNTIME_FINGERPRINT_SHA256
    || manifest.simulationFingerprintSha256 !== RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256)
    fail('RUNTIME_FINGERPRINT_MISMATCH');
}

function validateStoragePolicy(policy) {
  if (!isObject(policy)
    || policy.rawTelemetry !== 'OUTSIDE_GIT_DURABLE_STORAGE'
    || policy.largeDatasets !== 'OUTSIDE_GIT_DURABLE_STORAGE'
    || policy.manifestsAndHashes !== 'VERSIONED_IN_GIT'
    || policy.localArtifacts !== 'CACHE_ONLY'
    || policy.databaseSoleCopyAllowed !== false
    || policy.cleanMachineRecoveryRequired !== true)
    fail('INVALID_STORAGE_POLICY');
}

function validateDurableStorageReference(reference) {
  const objectUri = typeof reference?.objectUri === 'string'
    ? reference.objectUri.replaceAll('\\', '/') : '';
  if (!isObject(reference)
    || !/^[a-z][a-z0-9+.-]*:\/\//i.test(objectUri)
    || objectUri.startsWith('file:') || objectUri.startsWith('artifacts/')
    || objectUri.includes('/artifacts/')
    || !isSha256(reference.sha256)
    || !Number.isSafeInteger(reference.byteSize) || reference.byteSize <= 0)
    fail('PROMOTED_DATASET_DURABLE_STORAGE_REQUIRED');
}

export function validateGenerationManifest(manifest) {
  if (!isObject(manifest)) fail('INVALID_GENERATION_MANIFEST');
  if (manifest.manifestFormatVersion !== DATASET_REGISTRY_FORMAT_VERSION)
    fail('GENERATION_MANIFEST_FORMAT_MISMATCH');
  if (manifest.generationId !== DATASET_GENERATION_ID
    || manifest.generationVersion !== DATASET_GENERATION_VERSION)
    fail('GENERATION_IDENTITY_MISMATCH');
  if (manifest.runtimeDatasetContractVersion !== RUNTIME_DATASET_CONTRACT_VERSION
    || manifest.schemaVersion !== RUNTIME_TELEMETRY_SCHEMA_VERSION
    || manifest.featureActionManifestVersion !== FEATURE_ACTION_MANIFEST_VERSION)
    fail('GENERATION_CONTRACT_MISMATCH');
  validateRuntimeLineage(manifest);
  if (!equalArray(manifest.canonicalObservationOrder, V3_OBSERVATION_FEATURES))
    fail('OBSERVATION_ORDER_MISMATCH');
  if (!equalArray(manifest.canonicalTargetOrder, V3_TARGET_ORDER))
    fail('TARGET_ORDER_MISMATCH');
  if (!isObject(manifest.encodings)
    || manifest.encodings.surface?.version !== SURFACE_ENCODING.version
    || !equalArray(manifest.encodings.surface?.domain, SURFACE_ENCODING.domain)
    || manifest.encodings.trackCondition?.version !== TRACK_CONDITION_ENCODING.version
    || !equalArray(manifest.encodings.trackCondition?.domain, TRACK_CONDITION_ENCODING.domain))
    fail('ENCODING_CONTRACT_MISMATCH');
  if (manifest.sampleRateHz !== BASELINE_MANIFEST.rates.sampleRateHz)
    fail('SAMPLE_RATE_MISMATCH');
  if (manifest.trackScope?.mode !== 'ALL_RUNTIME_TRACKS'
    || !equalArray(manifest.driverScope?.driverTypes, ['PLAYER'])
    || !equalArray(manifest.driverScope?.transmissionModes, ['AUTO', 'MANUAL']))
    fail('COLLECTION_SCOPE_MISMATCH');
  if (!Number.isSafeInteger(manifest.sessionCount) || manifest.sessionCount < 0
    || !Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0)
    fail('GENERATION_COUNTS_INVALID');
  validateStoragePolicy(manifest.storagePolicy);

  if (manifest.status === EMPTY_GENERATION_STATUS) {
    if (manifest.collectionStatus !== 'NOT_STARTED' || manifest.sessionCount !== 0
      || manifest.rowCount !== 0 || manifest.promoted !== false
      || manifest.durableStorage !== null || !equalArray(manifest.artifacts, []))
      fail('EMPTY_GENERATION_STATE_INVALID');
  } else if (manifest.status === PROMOTED_GENERATION_STATUS) {
    if (manifest.collectionStatus !== 'COMPLETE' || manifest.promoted !== true
      || manifest.sessionCount < 1 || manifest.rowCount < 1)
      fail('PROMOTED_GENERATION_STATE_INVALID');
    validateDurableStorageReference(manifest.durableStorage);
  } else fail('GENERATION_STATUS_INVALID');

  if (!isSha256(manifest.manifestSha256)
    || calculateGenerationManifestSha256(manifest) !== manifest.manifestSha256)
    fail('GENERATION_MANIFEST_HASH_MISMATCH');
  return true;
}

function validateManifestPath(manifestPath) {
  return typeof manifestPath === 'string'
    && manifestPath.length > 0
    && manifestPath.split('/').every(part => part && part !== '.' && part !== '..')
    && !path.isAbsolute(manifestPath);
}

export function validateDatasetRegistry(registry, resolveManifest) {
  if (!isObject(registry) || registry.registryFormatVersion !== DATASET_REGISTRY_FORMAT_VERSION
    || !Array.isArray(registry.generations)) fail('INVALID_DATASET_REGISTRY');
  if (typeof resolveManifest !== 'function') fail('REGISTRY_MANIFEST_RESOLVER_REQUIRED');

  const seen = new Map();
  for (const entry of registry.generations) {
    if (!isObject(entry) || typeof entry.generationId !== 'string'
      || typeof entry.generationVersion !== 'string' || !validateManifestPath(entry.manifestPath)
      || !isSha256(entry.manifestSha256)) fail('INVALID_REGISTRY_ENTRY');
    const prior = seen.get(entry.generationId);
    if (prior) {
      if (prior.generationVersion === entry.generationVersion
        && prior.manifestSha256 !== entry.manifestSha256) fail('MUTABLE_VERSION_COLLISION');
      fail('DUPLICATE_GENERATION_ID');
    }
    seen.set(entry.generationId, entry);
    const manifest = resolveManifest(entry);
    validateGenerationManifest(manifest);
    if (entry.generationId !== manifest.generationId
      || entry.generationVersion !== manifest.generationVersion
      || entry.status !== manifest.status
      || entry.manifestSha256 !== manifest.manifestSha256)
      fail('REGISTRY_MANIFEST_MISMATCH');
  }
  return true;
}

export function validateChecksumsFile(contents, manifest) {
  const expected = `${manifest.manifestSha256}  manifest.json`;
  if (typeof contents !== 'string' || contents.trim() !== expected)
    fail('CHECKSUMS_FILE_MISMATCH');
  return true;
}

export function loadDatasetRegistry(registryRoot, fsApi = fs) {
  const registryPath = path.join(registryRoot, 'registry.json');
  const registry = JSON.parse(fsApi.readFileSync(registryPath, 'utf8'));
  const manifests = new Map();
  validateDatasetRegistry(registry, entry => {
    const manifestPath = path.resolve(registryRoot, entry.manifestPath);
    const expectedRoot = `${path.resolve(registryRoot)}${path.sep}`;
    if (!manifestPath.startsWith(expectedRoot)) fail('REGISTRY_PATH_ESCAPE');
    const manifest = JSON.parse(fsApi.readFileSync(manifestPath, 'utf8'));
    const checksums = fsApi.readFileSync(path.join(path.dirname(manifestPath), 'checksums.sha256'), 'utf8');
    validateChecksumsFile(checksums, manifest);
    manifests.set(entry.generationId, manifest);
    return manifest;
  });
  return { registry, manifests };
}
