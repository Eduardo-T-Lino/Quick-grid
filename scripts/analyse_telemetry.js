// ========== ML TELEMETRY DATASET ANALYSER (FASE ML1.5 QUALITY GATE) ==========
// Usage: node scripts/analyse_telemetry.js <path_to_jsonl_file>
// Realiza auditoria completa de:
// 1. Schema & Causalidade V2
// 2. Frequência Nominal vs Real, Distribuição de Deltas & Sequence Gaps
// 3. Voltas Observadas vs Completas vs Parciais
// 4. Agrupamento de Episódios Contíguos (Off-Track, Spin, Collision)
// 5. Distribuição de Ações do Piloto & Detecção de Desbalanceamento (Teclado)
// 6. Plausibilidade Geométrica e Física das Features
// 7. Veredito Final de Qualidade em 4 Níveis (Schema, Causalidade, Data Quality, Readiness)

import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';

export const NUMERIC_FEATURES = [
  // carState (Observation)
  'carState.speed',
  'carState.forwardVelocity',
  'carState.lateralVelocity',
  'carState.heading',
  'carState.headingError',
  'carState.yawRate',
  'carState.slipAngle',
  'carState.crossTrackError',
  'carState.steeringAngle',
  // trackState (Observation)
  'trackState.trackProgress',
  'trackState.currentCurvature',
  'trackState.futureCurvature5m',
  'trackState.futureCurvature10m',
  'trackState.futureCurvature20m',
  'trackState.futureCurvature40m',
  'trackState.targetSpeed',
  'trackState.distanceToLeftEdge',
  'trackState.distanceToRightEdge',
  // driverAction (Action Labels)
  'driverAction.steering',
  'driverAction.throttle',
  'driverAction.brake',
];

export function getDeep(obj, path) {
  const parts = path.split('.');
  let v = obj;
  for (const p of parts) {
    if (v == null) return null;
    v = v[p];
  }
  return v;
}

export function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

// Helper para agrupar flags booleanas consecutivas em episódios contíguos
export function groupConsecutiveEpisodes(flagsArray) {
  let episodeCount = 0;
  let sampleCount = 0;
  let currentEpisodeLength = 0;
  let longestEpisodeLength = 0;

  for (let i = 0; i < flagsArray.length; i++) {
    if (flagsArray[i]) {
      sampleCount++;
      currentEpisodeLength++;
      if (currentEpisodeLength === 1) {
        episodeCount++;
      }
      if (currentEpisodeLength > longestEpisodeLength) {
        longestEpisodeLength = currentEpisodeLength;
      }
    } else {
      currentEpisodeLength = 0;
    }
  }

  return {
    sampleCount,
    episodeCount,
    longestEpisodeLength
  };
}

// Helper para classificar voltas em completas e parciais
export function classifyLaps(lapStatsMap) {
  const observedLapNumbers = [];
  const completedLaps = [];
  const partialLaps = [];

  for (const [lapNumStr, s] of Object.entries(lapStatsMap)) {
    const lapNum = parseInt(lapNumStr, 10);
    observedLapNumbers.push(lapNum);

    const progressRange = (s.maxProgress !== undefined && s.minProgress !== undefined)
      ? (s.maxProgress - s.minProgress)
      : 0;
    const isFullProgress = (s.minProgress <= 0.08 && s.maxProgress >= 0.92) || progressRange >= 0.88;

    if (isFullProgress && s.sampleCount >= 100) {
      completedLaps.push(lapNum);
    } else {
      partialLaps.push({
        lapNumber: lapNum,
        sampleCount: s.sampleCount,
        minProgress: s.minProgress,
        maxProgress: s.maxProgress
      });
    }
  }

  observedLapNumbers.sort((a, b) => a - b);
  completedLaps.sort((a, b) => a - b);

  return { observedLapNumbers, completedLaps, partialLaps };
}

export function runAnalysis(file) {
  return new Promise((resolve, reject) => {
    const stats = {};
    for (const f of NUMERIC_FEATURES) {
      stats[f] = { values: [], nanCount: 0, nullCount: 0 };
    }

    let totalLines = 0;
    let validSamples = 0;
    let invalidSamples = 0;
    let playerSamples = 0;
    let botSamples = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;
    let prevTimestamp = null;
    const deltaMsList = [];
    const schemaVersionsFound = new Set();

    const offTrackFlags = [];
    const collisionFlags = [];
    const spinFlags = [];
    const isRecoveringFlags = [];

    const lapStats = {};
    let surfaces = {};

    let throttleFullCount = 0;
    let brakeActiveCount = 0;
    let steerActiveCount = 0;
    let overlapPedalCount = 0;
    let throttleZeroCount = 0;
    let throttleOneCount = 0;
    let brakeZeroCount = 0;
    let brakeOneCount = 0;

    console.log(`\n📂 Analisando arquivo de telemetria: ${file}\n`);
    let fileStats;
    try {
      fileStats = statSync(file);
      console.log(`   Tamanho do arquivo: ${(fileStats.size / 1024).toFixed(1)} KB\n`);
    } catch (e) {
      console.error(`❌ Erro ao acessar o arquivo: ${e.message}`);
      return reject(e);
    }

    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      totalLines++;

      let sample;
      try {
        sample = JSON.parse(line);
      } catch {
        invalidSamples++;
        return;
      }

      const ver = sample.schemaVersion;
      schemaVersionsFound.add(ver);

      if (ver !== 2 && ver !== 1) {
        invalidSamples++;
        return;
      }
      validSamples++;

      const meta = sample.metadata;
      if (meta?.driverType === 'PLAYER') playerSamples++;
      else botSamples++;

      const ts = meta?.timestamp;
      if (ts != null) {
        if (firstTimestamp == null) firstTimestamp = ts;
        lastTimestamp = ts;
        if (prevTimestamp != null) {
          const dt = ts - prevTimestamp;
          deltaMsList.push(dt);
        }
        prevTimestamp = ts;
      }

      const lap = meta?.lapNumber || 1;
      if (!lapStats[lap]) {
        lapStats[lap] = {
          sampleCount: 0,
          minProgress: 1.0,
          maxProgress: 0.0
        };
      }
      lapStats[lap].sampleCount++;
      const prog = sample.trackState?.trackProgress;
      if (prog != null && Number.isFinite(prog)) {
        if (prog < lapStats[lap].minProgress) lapStats[lap].minProgress = prog;
        if (prog > lapStats[lap].maxProgress) lapStats[lap].maxProgress = prog;
      }

      const isOff = Boolean(sample.eventState?.offTrack);
      const isCol = Boolean(sample.eventState?.collision);
      const isSpn = Boolean(sample.eventState?.spin);
      const isRec = Boolean(sample.eventState?.isRecovering);

      offTrackFlags.push(isOff);
      collisionFlags.push(isCol);
      spinFlags.push(isSpn);
      isRecoveringFlags.push(isRec);

      const surf = sample.trackState?.surface || 'UNKNOWN';
      surfaces[surf] = (surfaces[surf] || 0) + 1;

      const th = sample.driverAction?.throttle || 0;
      const br = sample.driverAction?.brake || 0;
      const st = sample.driverAction?.steering || 0;

      if (th > 0.9) throttleFullCount++;
      if (br > 0.1) brakeActiveCount++;
      if (Math.abs(st) > 0.1) steerActiveCount++;
      if (th > 0 && br > 0) overlapPedalCount++;

      if (th === 0) throttleZeroCount++;
      if (th >= 0.99) throttleOneCount++;
      if (br === 0) brakeZeroCount++;
      if (br >= 0.99) brakeOneCount++;

      for (const f of NUMERIC_FEATURES) {
        const v = getDeep(sample, f);
        if (v == null) { stats[f].nullCount++; }
        else if (!Number.isFinite(v)) { stats[f].nanCount++; }
        else { stats[f].values.push(v); }
      }
    });

    rl.on('close', () => {
      const nominalSampleRate = 10.0;
      const nominalIntervalMs = 1000 / nominalSampleRate;
      const sequenceGapThresholdMs = 2.5 * nominalIntervalMs;

      const sortedDeltas = deltaMsList.slice().sort((a, b) => a - b);
      const medianDeltaMs = percentile(sortedDeltas, 50);
      const p95DeltaMs = percentile(sortedDeltas, 95);
      const maxDeltaMs = sortedDeltas.length > 0 ? sortedDeltas[sortedDeltas.length - 1] : 0;
      const sequenceGaps = deltaMsList.filter(dt => dt > sequenceGapThresholdMs);
      const sequenceGapCount = sequenceGaps.length;

      const durationSec = (lastTimestamp != null && firstTimestamp != null && lastTimestamp > firstTimestamp)
        ? (lastTimestamp - firstTimestamp) / 1000
        : (validSamples / nominalSampleRate);
      const actualHz = durationSec > 0 ? (validSamples / durationSec) : nominalSampleRate;
      const bytesPerSample = validSamples > 0 ? (fileStats.size / validSamples) : 0;
      const mbPerHour = (bytesPerSample * actualHz * 3600) / (1024 * 1024);

      const { observedLapNumbers, completedLaps, partialLaps } = classifyLaps(lapStats);

      const offTrackEp = groupConsecutiveEpisodes(offTrackFlags);
      const spinEp = groupConsecutiveEpisodes(spinFlags);
      const collisionEp = groupConsecutiveEpisodes(collisionFlags);
      const recoveringEp = groupConsecutiveEpisodes(isRecoveringFlags);

      console.log('====================================================');
      console.log('📊 RESUMO DA SESSÃO DE TELEMETRIA ML');
      console.log('====================================================');
      console.log(`  Total de linhas lidas:        ${totalLines}`);
      console.log(`  Samples válidos:              ${validSamples}`);
      console.log(`  Samples inválidos/corrompidos:${invalidSamples}`);
      console.log(`  PLAYER samples:               ${playerSamples}`);
      console.log(`  BOT samples:                  ${botSamples}`);
      console.log(`  Duração capturada:            ${durationSec.toFixed(1)} segundos`);
      console.log(`  Bytes/sample médios:          ${bytesPerSample.toFixed(0)} bytes`);
      console.log(`  Estimativa MB/hora (1 Carro): ${mbPerHour.toFixed(2)} MB/h`);

      console.log('\n====================================================');
      console.log('⏱️  SAMPLE RATE & ANÁLISE TEMPORAL (SEQUENCE GAPS)');
      console.log('====================================================');
      console.log(`  • Nominal Sample Rate:  ${nominalSampleRate.toFixed(1)} Hz (Intervalo nominal: ${nominalIntervalMs.toFixed(0)} ms)`);
      console.log(`  • Real Global Rate:     ${actualHz.toFixed(2)} Hz`);
      console.log(`  • Median Delta (p50):   ${medianDeltaMs.toFixed(2)} ms`);
      console.log(`  • p95 Delta:            ${p95DeltaMs.toFixed(2)} ms`);
      console.log(`  • Max Delta:            ${maxDeltaMs.toFixed(2)} ms`);
      console.log(`  • Sequence Gap Count:   ${sequenceGapCount} (threshold > ${sequenceGapThresholdMs.toFixed(0)} ms)`);

      if (sequenceGapCount > 0) {
        console.log(`\n  ⚠️  SEQUENCE BREAK DETECTADO: ${sequenceGapCount} gap(s) temporal(is) significativo(s) encontrado(s).`);
        sequenceGaps.forEach((gap, idx) => {
          console.log(`     - Gap #${idx + 1}: ${(gap / 1000).toFixed(2)}s (${gap.toFixed(0)} ms)`);
        });
        console.log('     ℹ️  NOTA: Amostras após sequence gaps NÃO devem ser tratadas como sequência contínua');
        console.log('        em janelas temporais de modelos sequenciais (LSTM, Transformer, RL, etc.).');
      } else {
        console.log('  ✅ Sequência temporal 100% contínua e sem descontinuidades de amostragem.');
      }

      console.log('\n====================================================');
      console.log('🏁 VOLTAS OBSERVADAS, COMPLETAS & PARCIAIS');
      console.log('====================================================');
      console.log(`  • Voltas observadas (lapNumbers): [ ${observedLapNumbers.join(', ')} ] (Total: ${observedLapNumbers.length})`);
      console.log(`  • Voltas completas concluídas:    [ ${completedLaps.join(', ')} ] (Total: ${completedLaps.length})`);
      if (partialLaps.length > 0) {
        console.log(`  • Voltas parciais / incompletas:  ${partialLaps.length}`);
        partialLaps.forEach(p => {
          console.log(`     - Volta ${p.lapNumber}: ${p.sampleCount} samples, progresso [${p.minProgress.toFixed(3)} -> ${p.maxProgress.toFixed(3)}]`);
        });
      } else {
        console.log('  • Voltas parciais: 0');
      }

      console.log('\n====================================================');
      console.log('🏷️  VALIDAÇÃO DE SCHEMA & VERSIONAMENTO');
      console.log('====================================================');
      const versionsArray = Array.from(schemaVersionsFound);
      console.log(`  Schema versions encontradas: [ ${versionsArray.join(', ')} ]`);

      if (schemaVersionsFound.has(1)) {
        console.log('\n  ⚠️  ATENÇÃO: Telemetria legada Schema V1 (S_{t+1} -> A_t) detectada!');
        console.log('     NÃO utilize amostras com schemaVersion = 1 para treinamento de Behavioral Cloning.');
        console.log('     O pipeline causal homologado requer schemaVersion = 2 (S_t -> A_t).\n');
      }

      if (schemaVersionsFound.has(2)) {
        console.log('  ✅ Schema V2 (Causal S_t -> A_t): HOMOLOGADO PARA TREINAMENTO.');
      }

      console.log('\n====================================================');
      console.log('🎮 DISTRIBUIÇÃO DAS AÇÕES DO PILOTO (DRIVER ACTION)');
      console.log('====================================================');
      const pctThFull = ((throttleFullCount / Math.max(1, validSamples)) * 100).toFixed(1);
      const pctBrake = ((brakeActiveCount / Math.max(1, validSamples)) * 100).toFixed(1);
      const pctSteer = ((steerActiveCount / Math.max(1, validSamples)) * 100).toFixed(1);
      const pctOverlap = ((overlapPedalCount / Math.max(1, validSamples)) * 100).toFixed(1);

      const pctThBinary = (((throttleZeroCount + throttleOneCount) / Math.max(1, validSamples)) * 100).toFixed(1);
      const pctBrBinary = (((brakeZeroCount + brakeOneCount) / Math.max(1, validSamples)) * 100).toFixed(1);

      console.log(`  • Full Throttle (throttle > 0.9):     ${throttleFullCount.toString().padStart(6)} (${pctThFull}%)`);
      console.log(`  • Frenagem Ativa (brake > 0.1):       ${brakeActiveCount.toString().padStart(6)} (${pctBrake}%)`);
      console.log(`  • Esterço Curva (|steering| > 0.1):   ${steerActiveCount.toString().padStart(6)} (${pctSteer}%)`);
      console.log(`  • Trail / Overlap (throttle > 0 && brake > 0): ${overlapPedalCount.toString().padStart(6)} (${pctOverlap}%)`);
      console.log(`  • Assinatura Teclado (Throttle binário {0,1}): ${pctThBinary}%`);
      console.log(`  • Assinatura Teclado (Brake binário {0,1}):    ${pctBrBinary}%`);

      let isImbalanced = false;
      if (parseFloat(pctThFull) > 80.0 || parseFloat(pctBrake) < 5.0 || parseFloat(pctThBinary) > 90.0) {
        isImbalanced = true;
        console.log('\n  ⚠️  DATA IMBALANCE WARNING:');
        console.log('     As ações de acelerador e freio apresentam forte desbalanceamento típico de controle via teclado');
        console.log(`     (Acelerador a fundo: ${pctThFull}% | Frenagem ativa: ${pctBrake}% | Entradas binárias {0,1}).`);
        console.log('     Recomendação para treinamento (ML3):');
        console.log('     - Steering: regressão contínua;');
        console.log('     - Throttle / Brake: avaliar perdas balanceadas, BCE/classification heads ou reamostragem ponderada.');
      }

      console.log('\n====================================================');
      console.log('🚩 EVENTOS & EPISÓDIOS CONTÍGUOS');
      console.log('====================================================');
      console.log(`  • offTrack:     ${offTrackEp.sampleCount.toString().padStart(5)} samples | ${offTrackEp.episodeCount} episódio(s) (Maior: ${offTrackEp.longestEpisodeLength} samples / ~${(offTrackEp.longestEpisodeLength*0.1).toFixed(1)}s)`);
      console.log(`  • collision:    ${collisionEp.sampleCount.toString().padStart(5)} samples | ${collisionEp.episodeCount} episódio(s) (Maior: ${collisionEp.longestEpisodeLength} samples)`);
      console.log(`  • spin:         ${spinEp.sampleCount.toString().padStart(5)} samples | ${spinEp.episodeCount} episódio(s) (Maior: ${spinEp.longestEpisodeLength} samples / ~${(spinEp.longestEpisodeLength*0.1).toFixed(1)}s)`);
      console.log(`  • isRecovering: ${recoveringEp.sampleCount.toString().padStart(5)} samples | ${recoveringEp.episodeCount} episódio(s) (Maior: ${recoveringEp.longestEpisodeLength} samples)`);

      console.log('\n  Superfícies:');
      for (const [s, c] of Object.entries(surfaces)) {
        console.log(`    - ${s.padEnd(8)}: ${c.toString().padStart(5)} samples (${((c / Math.max(1, validSamples)) * 100).toFixed(1)}%)`);
      }

      console.log('\n====================================================');
      console.log('📐 ESTATÍSTICAS POR FEATURE');
      console.log('====================================================');

      const constantFeatures = [];
      const suspectFeatures = [];

      for (const f of NUMERIC_FEATURES) {
        const s = stats[f];
        if (s.values.length === 0) {
          console.log(`  ⚠️  ${f}: NENHUM VALOR (null=${s.nullCount}, nan=${s.nanCount})`);
          suspectFeatures.push(f);
          continue;
        }

        const sorted = s.values.slice().sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length;
        const p50 = percentile(sorted, 50);
        const p95 = percentile(sorted, 95);
        const absValues = s.values.map(Math.abs).sort((a, b) => a - b);
        const p95abs = percentile(absValues, 95);

        const isConstant = (max - min) < 1e-8;
        const flag = isConstant ? '🚨 CONSTANTE' : (s.nanCount + s.nullCount > 0 ? '⚠️ ' : '✓ ');
        if (isConstant) constantFeatures.push(f);

        console.log(`\n  ${flag} ${f}`);
        console.log(`     n=${s.values.length}  min=${min.toFixed(5)}  max=${max.toFixed(5)}  mean=${mean.toFixed(5)}`);
        console.log(`     p50=${p50.toFixed(5)}  p95=${p95.toFixed(5)}  p95|abs|=${p95abs.toFixed(5)}`);
        if (s.nanCount > 0) console.log(`     NaN count: ${s.nanCount}`);
        if (s.nullCount > 0) console.log(`     null count: ${s.nullCount}`);
      }

      if (constantFeatures.length > 0) {
        console.log('\n====================================================');
        console.log('🚨 FEATURES CONSTANTEMENTE ZERO OU INVARIANTES:');
        constantFeatures.forEach(f => console.log(`  - ${f}`));
        console.log('====================================================');
      }

      console.log('\n====================================================');
      console.log('🏁 VEREDITO FINAL DE QUALIDADE (FASE ML1.5)');
      console.log('====================================================');

      const isSchemaValid = (validSamples > 0 && invalidSamples === 0 && schemaVersionsFound.has(2) && !schemaVersionsFound.has(1));
      const isCausalityValid = schemaVersionsFound.has(2);
      
      let dataQualityStatus = 'PASS';
      if (!isSchemaValid || constantFeatures.length > 0) {
        dataQualityStatus = 'FAIL';
      } else if (isImbalanced || sequenceGapCount > 0 || offTrackEp.sampleCount > 0) {
        dataQualityStatus = 'WARNING';
      }

      let trainingReadiness = 'READY';
      if (dataQualityStatus === 'FAIL') {
        trainingReadiness = 'BLOCKED';
      } else if (dataQualityStatus === 'WARNING' || partialLaps.length > 0) {
        trainingReadiness = 'NEEDS_CURATION';
      }

      console.log(`  SCHEMA STATUS:       ${isSchemaValid ? 'VALID' : 'INVALID'}`);
      console.log(`  CAUSALITY STATUS:    ${isCausalityValid ? 'VALID (Schema V2 S_t -> A_t)' : 'INVALID'}`);
      console.log(`  DATA QUALITY:        ${dataQualityStatus}`);
      console.log(`  TRAINING READINESS:  ${trainingReadiness}`);
      console.log('====================================================\n');

      resolve({
        totalLines,
        validSamples,
        invalidSamples,
        playerSamples,
        botSamples,
        durationSec,
        nominalSampleRate,
        actualHz,
        medianDeltaMs,
        p95DeltaMs,
        maxDeltaMs,
        sequenceGapCount,
        observedLapNumbers,
        completedLaps,
        partialLaps,
        offTrackEp,
        spinEp,
        collisionEp,
        isImbalanced,
        isSchemaValid,
        isCausalityValid,
        dataQualityStatus,
        trainingReadiness
      });
    });
  });
}

// Auto-run if executed directly as script
if (process.argv[1] && process.argv[1].endsWith('analyse_telemetry.js')) {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error('Usage: node scripts/analyse_telemetry.js <path_to_jsonl_file>');
    process.exit(1);
  }
  runAnalysis(targetFile).catch(err => {
    console.error('Fatal error during analysis:', err);
    process.exit(1);
  });
}
