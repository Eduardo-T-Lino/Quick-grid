// ========== SIMULAÇÃO DE CORRIDA COMPLETA COM TELEMETRIA REAL ==========
// Simula 2 voltas completas em Interlagos com a geometria corrigida da pista e valida o pipeline

import { writeFileSync } from 'fs';
import { TelemetryCollector } from '../src/ml/telemetry/telemetryCollector.js';
import { formatSamplesToJSONL } from '../src/ml/telemetry/telemetryExport.js';
import { generateTrackPath } from '../src/track.js';
import { state } from '../src/game.js';
import { runAnalysis } from './analyse_telemetry.js';

// 1. Gerar pista oficial com a nova geometria corrigida
generateTrackPath(21);
const trackPath = state.trackPath;
const totalPoints = trackPath.length;

console.log(`[SIMULAÇÃO] Pista Interlagos gerada: ${totalPoints} pontos, ${state.totalTrackLength.toFixed(1)}m`);

// 2. Inicializar Coletor de Telemetria
const collector = new TelemetryCollector({ enabled: true, sampleRateHz: 10, scope: 'PLAYER_ONLY' });
collector.start();

const mockPlayerCar = {
  isBot: false,
  name: 'A. Senna (Player)',
  x: trackPath[0].x,
  y: trackPath[0].y,
  vx: 1.25,
  vy: 0.0,
  angle: trackPath[0].angle,
  yawRate: 0.0,
  currentLap: 1,
  pathIndex: 0,
  currentSurface: 'TARMAC',
  currentLaneOffset: 0.0,
  steerAmount: 0.0,
  lastThrottleInput: 1.0,
  lastBrakeInput: 0.0,
  lastSteerInput: 0.0
};

const gameState = {
  trackPath,
  totalTrackLength: state.totalTrackLength,
  selectedTrackId: 21,
  selectedTrackData: state.selectedTrackData,
  cars: [mockPlayerCar]
};

// 3. Simular 100 segundos de corrida a 60 FPS (6000 frames)
const dtMs = 1000 / 60;
let simTime = 0;

for (let frame = 0; frame < 6000; frame++) {
  simTime += dtMs;

  // Atualizar cinemática do carro na pista
  const pIdx = Math.floor((frame * 0.95) % totalPoints);
  mockPlayerCar.pathIndex = pIdx;
  const cp = trackPath[pIdx];
  mockPlayerCar.x = cp.x;
  mockPlayerCar.y = cp.y;
  mockPlayerCar.angle = cp.angle;

  const curv = cp.effectiveCurvature || cp.curvature || 0;

  // Comportamento dinâmico em retas vs curvas
  if (curv > 0.015) {
    // Apex / Curva fechada
    mockPlayerCar.vx = 0.85 * Math.cos(cp.angle);
    mockPlayerCar.vy = 0.85 * Math.sin(cp.angle);
    mockPlayerCar.yawRate = 0.022;
    mockPlayerCar.steerAmount = 0.65;
    mockPlayerCar.lastThrottleInput = 0.40;
    mockPlayerCar.lastBrakeInput = 0.0;
    mockPlayerCar.lastSteerInput = 0.65;
  } else if (trackPath[(pIdx + 20) % totalPoints].curvature > 0.018) {
    // Entrada / Frenagem para curva
    mockPlayerCar.vx = 1.05 * Math.cos(cp.angle);
    mockPlayerCar.vy = 1.05 * Math.sin(cp.angle);
    mockPlayerCar.yawRate = 0.008;
    mockPlayerCar.steerAmount = 0.20;
    mockPlayerCar.lastThrottleInput = 0.0;
    mockPlayerCar.lastBrakeInput = 0.85;
    mockPlayerCar.lastSteerInput = 0.20;
  } else {
    // Reta Full Throttle
    mockPlayerCar.vx = 1.32 * Math.cos(cp.angle);
    mockPlayerCar.vy = 1.32 * Math.sin(cp.angle);
    mockPlayerCar.yawRate = 0.001;
    mockPlayerCar.steerAmount = 0.0;
    mockPlayerCar.lastThrottleInput = 1.0;
    mockPlayerCar.lastBrakeInput = 0.0;
    mockPlayerCar.lastSteerInput = 0.0;
  }

  // Chamar o update da telemetria
  collector.update(simTime, gameState);
}

// 4. Salvar arquivo JSONL e Executar Análise
const jsonlData = formatSamplesToJSONL(collector.session.samples);
const outPath = 'scripts/synthetic_capture_test.jsonl';
writeFileSync(outPath, jsonlData, 'utf8');

console.log(`\n[SIMULAÇÃO] Captura concluída: ${collector.session.samples.length} samples salvos em ${outPath}`);
console.log('Executando Quality Gate Analyser na nova captura...\n');

await runAnalysis(outPath);
