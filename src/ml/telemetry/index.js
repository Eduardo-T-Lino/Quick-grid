import { TelemetryCollector } from './telemetryCollector.js';
import { exportTelemetrySession } from './telemetryExport.js';
import { SCHEMA_VERSION, validateTelemetrySample } from './telemetrySchema.js';
import { OnlineTelemetryUploader, onlineUploader } from './telemetryUploader.js';
import { telemetryPerformance } from './performanceMetrics.js';

export const mlTelemetry = new TelemetryCollector({
  enabled: typeof window !== 'undefined' && Boolean(window.ML_TELEMETRY_ENABLED),
  sampleRateHz: 10,
  scope: 'PLAYER_ONLY' // 'PLAYER_ONLY' por padrão em DEV para coletar dados humanos
});

// Registrar APIs globais no window para controle interativo no Console do Browser
if (typeof window !== 'undefined') {
  window.startMLTelemetry = (options = {}) => mlTelemetry.start(options);
  window.stopMLTelemetry = () => mlTelemetry.stop();
  window.getMLTelemetryStats = () => mlTelemetry.getStats();
  window.exportMLTelemetry = (trackId) => mlTelemetry.export(trackId);
  window.clearMLTelemetry = () => mlTelemetry.clear();

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
    uploader: onlineUploader,
    schemaVersion: SCHEMA_VERSION,
    validateSample: validateTelemetrySample,
    exportSession: exportTelemetrySession
  };
}

export {
  SCHEMA_VERSION,
  validateTelemetrySample,
  TelemetryCollector,
  exportTelemetrySession,
  OnlineTelemetryUploader,
  onlineUploader,
  telemetryPerformance
};
