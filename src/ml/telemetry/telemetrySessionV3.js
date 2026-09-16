import {
  DATASET_GENERATION_ID,
  FEATURE_ACTION_MANIFEST_VERSION,
  RUNTIME_DATASET_CONTRACT_VERSION,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  RUNTIME_TELEMETRY_SCHEMA_VERSION
} from '../lineage/runtimeDatasetContract.js';
import { validateTelemetrySampleV3 } from './telemetrySchemaV3.js';

export class TelemetrySessionV3 {
  constructor(options = {}) {
    this.sessionId = options.sessionId || this.generateSessionId();
    this.startTime = performance.now();
    this.schemaVersion = RUNTIME_TELEMETRY_SCHEMA_VERSION;
    this.datasetGenerationId = DATASET_GENERATION_ID;
    this.runtimeDatasetContractVersion = RUNTIME_DATASET_CONTRACT_VERSION;
    this.featureActionManifestVersion = FEATURE_ACTION_MANIFEST_VERSION;
    this.simulationFingerprintSha256 = RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256;
    this.sampleRateHz = 10;
    this.sampleIntervalMs = 100;
    this.scope = 'PLAYER_ONLY';
    this.maxBufferSize = options.maxBufferSize || 30000;
    this.samples = [];
    this.lapSummaries = [];
    this.activeLapTrackers = new Map();
    this.lastSampleIndex = -1;
    this.stats = { totalSamples: 0, playerSamples: 0, botSamples: 0, rejectedSamples: 0 };
  }

  generateSessionId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'sess_v3_';
    for (let index = 0; index < 10; index++)
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${id}_${Date.now()}`;
  }

  addSample(sample) {
    const expectedIndex = this.lastSampleIndex + 1;
    if (!validateTelemetrySampleV3(sample)
      || sample.metadata.sessionId !== this.sessionId
      || sample.metadata.driverType !== 'PLAYER'
      || sample.metadata.sampleIndex !== expectedIndex) {
      this.stats.rejectedSamples++;
      return false;
    }
    if (this.samples.length >= this.maxBufferSize) this.samples.shift();
    this.samples.push(sample);
    this.lastSampleIndex = sample.metadata.sampleIndex;
    this.stats.totalSamples++;
    this.stats.playerSamples++;
    return true;
  }

  getStats() {
    const memoryEstimateBytes = this.samples.reduce((total, sample) =>
      total + JSON.stringify(sample).length, 0);
    return {
      sessionId: this.sessionId,
      schemaVersion: this.schemaVersion,
      datasetGenerationId: this.datasetGenerationId,
      runtimeDatasetContractVersion: this.runtimeDatasetContractVersion,
      featureActionManifestVersion: this.featureActionManifestVersion,
      simulationFingerprintSha256: this.simulationFingerprintSha256,
      scope: this.scope,
      sampleRateHz: this.sampleRateHz,
      totalSamples: this.stats.totalSamples,
      playerSamples: this.stats.playerSamples,
      botSamples: this.stats.botSamples,
      rejectedSamples: this.stats.rejectedSamples,
      currentBufferSize: this.samples.length,
      maxBufferSize: this.maxBufferSize,
      estimatedMemoryBytes: memoryEstimateBytes,
      estimatedMemoryMB: Number((memoryEstimateBytes / (1024 * 1024)).toFixed(2)),
      lapsRecorded: 0
    };
  }

  clear() {
    this.samples = [];
    this.lapSummaries = [];
    this.activeLapTrackers.clear();
    this.lastSampleIndex = -1;
    this.stats.totalSamples = 0;
    this.stats.playerSamples = 0;
    this.stats.botSamples = 0;
    this.stats.rejectedSamples = 0;
  }
}
