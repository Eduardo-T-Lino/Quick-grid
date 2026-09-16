import { TelemetryCollector } from './telemetryCollector.js';
import {
  TelemetryCollectorV3,
  V3_CAPTURE_READINESS,
  V3_REMOTE_INGEST_STATUS
} from './telemetryCollectorV3.js';
import { exportTelemetrySession } from './telemetryExport.js';
import { SCHEMA_VERSION, validateTelemetrySample } from './telemetrySchema.js';
import { validateTelemetrySampleV3 } from './telemetrySchemaV3.js';
import { OnlineTelemetryUploader, onlineUploader } from './telemetryUploader.js';
import { telemetryPerformance } from './performanceMetrics.js';

export const mlTelemetry = new TelemetryCollector({
  enabled: typeof window !== 'undefined' && Boolean(window.ML_TELEMETRY_ENABLED),
  sampleRateHz: 10,
  scope: 'PLAYER_ONLY' // 'PLAYER_ONLY' por padrão em DEV para coletar dados humanos
});

// V3 is opt-in and local-only during ML3.6. It never shares the V2 uploader.
export const mlTelemetryV3 = new TelemetryCollectorV3({ enabled: false });

// Registrar APIs globais no window para controle interativo no Console do Browser
if (typeof window !== 'undefined') {
  window.startMLTelemetry = (options = {}) => mlTelemetry.start(options);
  window.stopMLTelemetry = () => mlTelemetry.stop();
  window.getMLTelemetryStats = () => mlTelemetry.getStats();
  window.exportMLTelemetry = (trackId) => mlTelemetry.export(trackId);
  window.clearMLTelemetry = () => mlTelemetry.clear();
  window.startMLTelemetryV3 = (options = {}) => mlTelemetryV3.start(options);
  window.stopMLTelemetryV3 = () => mlTelemetryV3.stop();
  window.getMLTelemetryV3Stats = () => mlTelemetryV3.getStats();
  window.exportMLTelemetryV3 = (trackId) => mlTelemetryV3.export(trackId);
  window.clearMLTelemetryV3 = () => mlTelemetryV3.clear();

  // Controle e Estatísticas de Ingestão Online (Fase ML2.1)
  window.setOnlineTelemetryConsent = (enabled) => onlineUploader.setConsent(enabled);
  window.enableOnlineMLTelemetry = () => onlineUploader.setConsent(true);
  window.disableOnlineMLTelemetry = () => onlineUploader.setConsent(false);
  window.getOnlineMLTelemetryStats = () => onlineUploader.getStats();
  window.getMLPerformanceMetrics = () => telemetryPerformance.getStats();
  window.resetMLPerformanceMetrics = () => telemetryPerformance.reset();

  // Exportar utilitários para depuração e testes
  if (import.meta.env?.DEV) window.__ML_TELEMETRY__ = {
    collector: mlTelemetry,
    collectorV3: mlTelemetryV3,
    uploader: onlineUploader,
    schemaVersion: SCHEMA_VERSION,
    validateSample: validateTelemetrySample,
    validateSampleV3: validateTelemetrySampleV3,
    v3CaptureReadiness: V3_CAPTURE_READINESS,
    v3RemoteIngestStatus: V3_REMOTE_INGEST_STATUS,
    exportSession: exportTelemetrySession
  };
}

export {
  SCHEMA_VERSION,
  validateTelemetrySample,
  TelemetryCollector,
  TelemetryCollectorV3,
  V3_CAPTURE_READINESS,
  V3_REMOTE_INGEST_STATUS,
  exportTelemetrySession,
  OnlineTelemetryUploader,
  onlineUploader,
  telemetryPerformance
};
