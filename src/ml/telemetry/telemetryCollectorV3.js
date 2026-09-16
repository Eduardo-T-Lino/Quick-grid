import { TelemetryCollector } from './telemetryCollector.js';
import { TelemetrySessionV3 } from './telemetrySessionV3.js';
import { createTelemetrySampleV3 } from './telemetrySchemaV3.js';
import {
  DATASET_GENERATION_ID,
  FEATURE_ACTION_MANIFEST_VERSION,
  RUNTIME_DATASET_CONTRACT_VERSION,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  RUNTIME_TELEMETRY_SCHEMA_VERSION,
  SOURCE_RUNTIME_FINGERPRINT_SHA256
} from '../lineage/runtimeDatasetContract.js';
import { BASELINE_MANIFEST } from '../lineage/baselineManifest.js';

export const V3_REMOTE_INGEST_STATUS = 'V3_REMOTE_INGEST_NOT_READY';
export const V3_CAPTURE_READINESS = 'READY_FOR_CONTROLLED_COLLECTION';

export class TelemetryCollectorV3 extends TelemetryCollector {
  constructor(options = {}) {
    if (options.sampleRateHz !== undefined && options.sampleRateHz !== 10)
      throw new Error('V3_SAMPLE_RATE_MUST_BE_10_HZ');
    if (options.scope !== undefined && options.scope !== 'PLAYER_ONLY')
      throw new Error('V3_SCOPE_MUST_BE_PLAYER_ONLY');
    super({ ...options, sampleRateHz: 10, scope: 'PLAYER_ONLY' });
    this.session = this.createSession(options);
    this.remoteIngestStatus = V3_REMOTE_INGEST_STATUS;
    this.captureReadiness = V3_CAPTURE_READINESS;
    this.onlineOnly = false;
    this.onlineSessionReady = false;
  }

  createSession(options = {}) {
    return new TelemetrySessionV3({
      sessionId: options.sessionId,
      maxBufferSize: options.maxBufferSize
    });
  }

  start(options = {}) {
    if (options.scope !== undefined && options.scope !== 'PLAYER_ONLY')
      throw new Error('V3_SCOPE_MUST_BE_PLAYER_ONLY');
    if (options.online || options.onlineOnly || options.remote || options.remoteUpload
      || options.upload || options.uploader)
      throw new Error(V3_REMOTE_INGEST_STATUS);
    this.enabled = true;
    this.scope = 'PLAYER_ONLY';
    this.session = this.createSession(options);
    this.lastSampleTime = 0;
    this.sampleCounter = 0;
    this.lapStats.clear();
    this.onlineOnly = false;
    this.onlineSessionReady = false;
    console.log(`[ML-TELEMETRY-V3] Coleta local iniciada. Session: ${this.session.sessionId} | Rate: 10Hz | Scope: PLAYER_ONLY`);
    return this.getStats();
  }

  stop() {
    this.enabled = false;
    console.log(`[ML-TELEMETRY-V3] Coleta local parada. Total de samples: ${this.session.samples.length}`);
  }

  recordCompletedLap() {
    return false;
  }

  getStats() {
    return {
      enabled: this.enabled,
      captureReadiness: this.captureReadiness,
      remoteIngestStatus: this.remoteIngestStatus,
      ...this.session.getStats()
    };
  }

  sampleCar(car, trackPath, _halfW, _totalTrackLength, trackId, timestamp) {
    if (!car || car.isBot || !car.mlObservationV3 || !Number.isInteger(Number(trackId))) return false;
    const obs = car.mlObservationV3;
    const futureCurvatures = this.getFutureCurvaturesInMeters(
      trackPath, obs.pathIndex, [5, 10, 20]
    );
    const sample = createTelemetrySampleV3({
      schemaVersion: RUNTIME_TELEMETRY_SCHEMA_VERSION,
      metadata: {
        schemaVersion: RUNTIME_TELEMETRY_SCHEMA_VERSION,
        sessionId: this.session.sessionId,
        sampleIndex: this.sampleCounter,
        timestamp,
        trackId: Number(trackId),
        lapNumber: car.currentLap || 1,
        driverType: 'PLAYER',
        datasetGenerationId: DATASET_GENERATION_ID,
        runtimeDatasetContractVersion: RUNTIME_DATASET_CONTRACT_VERSION,
        gameBuildVersion: BASELINE_MANIFEST.lineage.gameBuildVersion,
        physicsVersion: BASELINE_MANIFEST.lineage.physicsVersion,
        trackGeometryVersion: BASELINE_MANIFEST.lineage.trackGeometryVersion,
        featureActionManifestVersion: FEATURE_ACTION_MANIFEST_VERSION,
        sourceRuntimeFingerprintSha256: SOURCE_RUNTIME_FINGERPRINT_SHA256,
        simulationFingerprintSha256: RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256
      },
      carState: {
        speed: obs.speed,
        forwardVelocity: obs.forwardVelocity,
        lateralVelocity: obs.lateralVelocity,
        yawRate: obs.yawRate,
        slipAngle: obs.slipAngle,
        steeringAngle: obs.steeringAngle,
        crossTrackError: obs.crossTrackError,
        headingError: obs.headingError
      },
      trackState: {
        distanceToLeftEdge: obs.distanceToLeftEdge,
        distanceToRightEdge: obs.distanceToRightEdge,
        currentCurvature: obs.currentCurvature,
        futureCurvature5m: futureCurvatures[0],
        futureCurvature10m: futureCurvatures[1],
        futureCurvature20m: futureCurvatures[2],
        trackProgress: obs.trackProgress,
        surface: obs.surface,
        slope: obs.slope
      },
      powertrainState: {
        gear: obs.gear,
        rpm: obs.rpm,
        engineAcceleration: obs.engineAcceleration,
        brakePressure: obs.brakePressure,
        automaticTransmission: obs.automaticTransmission
      },
      boostState: {
        active: obs.boostActive,
        charge: obs.boostCharge,
        cooldownSeconds: obs.boostCooldownSeconds,
        needsRelease: obs.boostNeedsRelease,
        carry: obs.boostCarry
      },
      dynamicsState: {
        rearSlip: obs.rearSlip,
        tyreTemperatureCelsius: obs.tyreTemperatureCelsius,
        tyreWear: obs.tyreWear
      },
      aeroState: {
        wakeIntensity: obs.wakeIntensity,
        wakeSpeedAllowanceKmh: obs.wakeSpeedAllowanceKmh
      },
      environmentState: { trackCondition: obs.trackCondition },
      driverAction: {
        steering: typeof car.lastSteerInput === 'number' ? car.lastSteerInput : 0,
        throttle: typeof car.lastThrottleInput === 'number' ? car.lastThrottleInput : 0,
        brake: typeof car.lastBrakeInput === 'number' ? car.lastBrakeInput : 0,
        boostRequested: Boolean(car.lastBoostRequested),
        gearShiftRequest: Number.isInteger(car.lastGearShiftRequest) ? car.lastGearShiftRequest : 0
      },
      eventState: {
        offTrack: obs.offTrack,
        collision: obs.collision,
        spin: obs.spin,
        isRecovering: obs.isRecovering
      }
    });
    if (!this.session.addSample(sample)) return false;
    this.sampleCounter++;
    return sample;
  }
}
