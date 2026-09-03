// ========== ML TELEMETRY EXPORT UTILITIES ==========
// Exporta telemetria para JSONL (formato padrão de datasets de Imitation Learning)

/**
 * Converte um array de amostras para o formato JSONL (uma linha por amostra).
 * @param {Array<Object>} samples - Lista de objetos de telemetria
 * @returns {string} String formatada em JSONL
 */
export function formatSamplesToJSONL(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return '';
  return samples.map(s => JSON.stringify(s)).join('\n') + '\n';
}

/**
 * Dispara o download de um arquivo no browser.
 * @param {string} content - Conteúdo do arquivo
 * @param {string} filename - Nome do arquivo a ser salvo
 * @param {string} mimeType - Tipo MIME (ex: 'application/x-ndjson', 'application/json')
 */
export function triggerBrowserDownload(content, filename, mimeType = 'application/x-ndjson') {
  if (typeof document === 'undefined') return;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exporta a sessão ativa para arquivos JSONL de telemetria e JSON de resumos de voltas.
 * @param {TelemetrySession} session - Instância da sessão de telemetria
 * @param {string|number} trackId - Identificador do circuito
 */
export function exportTelemetrySession(session, trackId = 'track') {
  if (!session || session.samples.length === 0) {
    console.warn('[ML-TELEMETRY] Nenhum sample gravado para exportar.');
    return { samplesExported: 0, lapsExported: 0 };
  }

  const jsonlContent = formatSamplesToJSONL(session.samples);
  const sampleFilename = `quick-grid-telemetry-${trackId}-${session.sessionId}.jsonl`;
  triggerBrowserDownload(jsonlContent, sampleFilename, 'application/x-ndjson');

  // Exportar também resumos de voltas se existirem
  if (session.lapSummaries.length > 0) {
    const lapsContent = JSON.stringify(session.lapSummaries, null, 2);
    const lapsFilename = `quick-grid-laps-${trackId}-${session.sessionId}.json`;
    triggerBrowserDownload(lapsContent, lapsFilename, 'application/json');
  }

  console.log(`[ML-TELEMETRY] Exportados ${session.samples.length} samples em ${sampleFilename}`);
  return {
    samplesExported: session.samples.length,
    lapsExported: session.lapSummaries.length,
    sampleFilename,
    jsonl: jsonlContent
  };
}
