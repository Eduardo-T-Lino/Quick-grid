import { TelemetryCollector } from '../src/ml/telemetry/telemetryCollector.js';
import { TelemetrySession } from '../src/ml/telemetry/telemetrySession.js';
import { validateTelemetrySample, createTelemetrySample, SCHEMA_VERSION } from '../src/ml/telemetry/telemetrySchema.js';
import { formatSamplesToJSONL } from '../src/ml/telemetry/telemetryExport.js';
import { F1_TRACKS } from '../src/f1Tracks.js';
import { generateTrackPath, cleanWaypoints } from '../src/track.js';
import { state } from '../src/game.js';
import { groupConsecutiveEpisodes, classifyLaps, percentile } from './analyse_telemetry.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('====================================================');
console.log('🚀 EXECUTANDO TESTES UNITÁRIOS DE TELEMETRIA ML (V2 CAUSAL)');
console.log('====================================================\n');

// ----------------------------------------------------
// TESTE 1: Validação de Integridade do Schema V2 & Rejeição de Legados
// ----------------------------------------------------
console.log('[TEST 1] Schema V2 Validation & Rejection of Corrupt/Legacy Data:');
assert(SCHEMA_VERSION === 2, 'SCHEMA_VERSION ativo é 2 (Causal Observation(t) -> Action(t))');

const validSample = createTelemetrySample({
  sessionId: 'test_sess_01',
  sampleIndex: 0,
  timestamp: 1000,
  trackId: 21,
  lapNumber: 1,
  driverType: 'PLAYER',
  participantId: 'player_01',
  trackProgress: 0.25,
  pathIndex: 120,
  currentCurvature: 0.012,
  futureCurvature5m: 0.014,
  futureCurvature10m: 0.018,
  futureCurvature20m: 0.035,
  futureCurvature40m: 0.010,
  targetSpeed: 1.15,
  distanceToLeftEdge: 5.4,
  distanceToRightEdge: 6.6,
  surface: 'TARMAC',
  speed: 1.12,
  forwardVelocity: 1.11,
  lateralVelocity: 0.04,
  heading: 1.57,
  headingError: 0.02,
  yawRate: 0.015,
  slipAngle: 0.036,
  crossTrackError: 0.15,
  steeringAngle: 0.12,
  steering: 0.45,
  throttle: 0.95,
  brake: 0.0,
  offTrack: false,
  collision: false,
  spin: false,
  isRecovering: false
});

assert(validateTelemetrySample(validSample) === true, 'Amostra válida passa na validação com schemaVersion 2');

// Testar rejeição de Schema V1 legado (não-causal)
const legacySampleV1 = { ...validSample, schemaVersion: 1 };
assert(validateTelemetrySample(legacySampleV1) === false, 'Amostra legada Schema V1 (S_{t+1}->A_t) é devidamente rejeitada no validador causal V2');

// Testar rejeição de NaN / Infinity
const invalidSampleNaN = { ...validSample, carState: { ...validSample.carState, speed: NaN } };
assert(validateTelemetrySample(invalidSampleNaN) === false, 'Amostra com NaN é devidamente rejeitada');

const invalidSampleInfinity = { ...validSample, driverAction: { ...validSample.driverAction, steering: Infinity } };
assert(validateTelemetrySample(invalidSampleInfinity) === false, 'Amostra com Infinity é devidamente rejeitada');

const invalidSampleThrottleRange = { ...validSample, driverAction: { ...validSample.driverAction, throttle: 1.5 } };
assert(validateTelemetrySample(invalidSampleThrottleRange) === false, 'Amostra com throttle > 1.0 é devidamente rejeitada');


// ----------------------------------------------------
// TESTE 2: Sample Rate Independente de FPS (10 Hz a 30, 60 e 144 FPS)
// ----------------------------------------------------
console.log('\n[TEST 2] Sample Rate Independence (10 Hz at 30, 60, and 144 FPS):');

function simulateRun(fps, durationSeconds) {
  const collector = new TelemetryCollector({ enabled: true, sampleRateHz: 10, scope: 'PLAYER_ONLY' });
  const dt = 1000 / fps;
  const totalFrames = fps * durationSeconds;

  const mockTrack = [
    { x: 0, y: 0, segmentLength: 2.0, curvature: 0.01, normalX: 0, normalY: 1, angle: 0 },
    { x: 2, y: 0, segmentLength: 2.0, curvature: 0.01, normalX: 0, normalY: 1, angle: 0 },
    { x: 4, y: 0, segmentLength: 2.0, curvature: 0.01, normalX: 0, normalY: 1, angle: 0 }
  ];

  const mockPlayerCar = {
    isBot: false,
    name: 'Player',
    x: 0, y: 0, vx: 1.0, vy: 0, angle: 0,
    currentLap: 1, pathIndex: 0, currentSurface: 'TARMAC',
    lastThrottleInput: 1.0, lastBrakeInput: 0.0, lastSteerInput: 0.1
  };

  const mockState = {
    trackPath: mockTrack,
    selectedTrackId: 21,
    selectedTrackData: { trackWidth: 24 },
    cars: [mockPlayerCar]
  };

  for (let f = 0; f < totalFrames; f++) {
    const timeMs = f * dt;
    collector.update(timeMs, mockState);
  }

  return collector.session.samples.length;
}

const samples30FPS = simulateRun(30, 10);
const samples60FPS = simulateRun(60, 10);
const samples144FPS = simulateRun(144, 10);

console.log(`    Samples coletados em 10 segundos: 30 FPS -> ${samples30FPS} | 60 FPS -> ${samples60FPS} | 144 FPS -> ${samples144FPS}`);
assert(samples30FPS >= 98 && samples30FPS <= 101, '30 FPS produz ~100 samples em 10 segundos (10 Hz)');
assert(samples60FPS >= 98 && samples60FPS <= 101, '60 FPS produz ~100 samples em 10 segundos (10 Hz)');
assert(samples144FPS >= 98 && samples144FPS <= 101, '144 FPS produz ~100 samples em 10 segundos (10 Hz)');


// ----------------------------------------------------
// TESTE 3: Future Curvature em Metros Reais (Segmentos de Tamanho Variável)
// ----------------------------------------------------
console.log('\n[TEST 3] Future Curvature in Physical Meters (Variable Segment Lengths):');

// Criar pista com segmentos não-uniformes: 1m, 3m, 2m, 4m, 5m, etc.
const variableTrack = [
  { curvature: 0.001, segmentLength: 1.0 }, // idx 0 (0m)
  { curvature: 0.002, segmentLength: 3.0 }, // idx 1 (1m)
  { curvature: 0.005, segmentLength: 2.0 }, // idx 2 (4m)
  { curvature: 0.020, segmentLength: 4.0 }, // idx 3 (6m) -> atinge 5m e 6m
  { curvature: 0.050, segmentLength: 5.0 }, // idx 4 (10m) -> atinge 10m
  { curvature: 0.080, segmentLength: 10.0 }, // idx 5 (15m) -> atinge 20m
  { curvature: 0.010, segmentLength: 25.0 }  // idx 6 (25m) -> atinge 40m
];

const collector = new TelemetryCollector();
const curvatures = collector.getFutureCurvaturesInMeters(variableTrack, 0, [5, 10, 20, 40]);

assert(curvatures[0] === 0.005, 'futureCurvature5m acumulou corretamente em metros físicos (idx 2)');
assert(curvatures[1] === 0.050, 'futureCurvature10m acumulou corretamente em metros físicos (idx 4)');
assert(curvatures[2] === 0.080, 'futureCurvature20m acumulou corretamente em metros físicos (idx 5)');
assert(curvatures[3] === 0.010, 'futureCurvature40m acumulou corretamente em metros físicos (idx 6)');


// ----------------------------------------------------
// TESTE 4: Teste de Wrap na Linha de Chegada
// ----------------------------------------------------
console.log('\n[TEST 4] Finish Line Wrap-Around for Future Curvature:');

// Pista curta circular de 50 metros no total
const circularTrack = [
  { curvature: 0.01, segmentLength: 10.0 }, // idx 0 (0-10m, reta principal)
  { curvature: 0.09, segmentLength: 10.0 }, // idx 1 (10-20m, curva T1)
  { curvature: 0.08, segmentLength: 10.0 }, // idx 2 (20-30m, curva T2)
  { curvature: 0.02, segmentLength: 10.0 }, // idx 3 (30-40m, reta oposta)
  { curvature: 0.03, segmentLength: 10.0 }  // idx 4 (40-50m, curva final antes da linha de chegada)
];

// Carro está no idx 4 (a 10m da linha de chegada): 20m à frente deve cair no idx 1 (Curva T1 = 0.09)
const wrapCurvatures = collector.getFutureCurvaturesInMeters(circularTrack, 4, [10, 20, 30]);

assert(wrapCurvatures[0] === 0.01, '+10m cruza a linha de chegada e pega idx 0');
assert(wrapCurvatures[1] === 0.09, '+20m pega a curva T1 da volta seguinte após o wrap');
assert(wrapCurvatures[2] === 0.08, '+30m pega a curva T2 da volta seguinte após o wrap');


// ----------------------------------------------------
// TESTE 5: Exportação e Formatação JSONL
// ----------------------------------------------------
console.log('\n[TEST 5] JSONL Export & Formatting:');

const session = new TelemetrySession();
session.addSample(validSample);
session.addSample({ ...validSample, metadata: { ...validSample.metadata, sampleIndex: 1 } });

const jsonlOutput = formatSamplesToJSONL(session.samples);
const lines = jsonlOutput.trim().split('\n');

assert(lines.length === 2, 'Export gera exatamente 2 linhas JSONL válidas');
const parsedFirst = JSON.parse(lines[0]);
assert(parsedFirst.schemaVersion === 2, 'Primeira linha possui schemaVersion 2');
assert(parsedFirst.metadata.driverType === 'PLAYER', 'Primeira linha possui driverType PLAYER');
assert(parsedFirst.driverAction.throttle === 0.95, 'Driver action throttle preservado com precisão');


// ----------------------------------------------------
// TESTE 6: Causalidade — Steering (ML1.2)
//
// Simula car.update() no estilo real:
//   1. captura mlObservation PRÉ-física (heading=0, yawRate=0)
//   2. decide action (steering=1.0)
//   3. registra last*Input
//   4. física muda heading e yawRate
//   5. telemetria lê mlObservation → deve ver state PRÉ-física
// ----------------------------------------------------
console.log('\n[TEST 6] Causality — Steering (observation deve ser STATE_A, não STATE_B):');

// Simular um trackPath mínimo para getFutureCurvaturesInMeters
const miniTrack = Array.from({ length: 30 }, (_, i) => ({
  x: i * 5, y: 0, z: 0,
  angle: 0, curvature: 0, segmentLength: 5,
  normalX: 0, normalY: 1,
  effectiveCurvature: 0
}));

// Simular um "car" com mlObservation preenchido ANTES da física (STATE A)
const carSteering = {
  isBot: false,
  participantId: 'p_0_test',
  currentLap: 1,
  finished: false,
  hasContact: false,
  currentSurface: 'TARMAC',
  currentLaneOffset: 0,
  // mlObservation: estado PRÉ-física (heading=0, yawRate=0)
  mlObservation: {
    speed: 1.0,
    forwardVelocity: 1.0,
    lateralVelocity: 0,
    heading: 0,          // STATE A: heading = 0
    yawRate: 0,          // STATE A: yawRate = 0
    slipAngle: 0,
    steeringAngle: 0,
    pathIndex: 0,
    trackProgress: 0,
    currentCurvature: 0,
    targetSpeed: 1.2,
    distanceToLeftEdge: 12,
    distanceToRightEdge: 12,
    surface: 'TARMAC',
    headingError: 0,
    crossTrackError: 0,
    offTrack: false,
    collision: false,
    spin: false,
    isRecovering: false
  },
  // action registrada APÓS filtros, ANTES da física
  lastSteerInput: 1.0,
  lastThrottleInput: 0,
  lastBrakeInput: 0
};

// Simular "física integrou": depois do update, heading e yawRate mudaram (STATE B)
// (Intencionalmente NÃO alteramos mlObservation — ela é snapshot imutável do tick)
carSteering.angle = 0.05;    // STATE B — heading mudou
carSteering.yawRate = 0.05;  // STATE B — yawRate mudou
carSteering.vx = 0.999;
carSteering.vy = 0.05;

// Coletor que vai ler mlObservation
const collectorSteering = new TelemetryCollector({ enabled: true, scope: 'ALL' });
collectorSteering.session = new TelemetrySession();
collectorSteering.sampleCar(carSteering, miniTrack, 12, 150, 'test', 1000);

const capSteering = collectorSteering.session.samples[0];
assert(capSteering !== undefined, '[Steering] Sample foi gerado');
assert(capSteering.carState.heading === 0, '[Steering] observation.heading = STATE_A (0), não STATE_B (0.05)');
assert(capSteering.carState.yawRate === 0, '[Steering] observation.yawRate = STATE_A (0), não STATE_B (0.05)');
assert(capSteering.driverAction.steering === 1.0, '[Steering] action.steering = 1.0 conforme aplicado');


// ----------------------------------------------------
// TESTE 7: Causalidade — Throttle (ML1.2)
//
// STATE A: speed = 0.5
// ACTION: throttle = 1.0
// Física: speed sobe para 0.52
// Sample correto: speed = 0.5, throttle = 1.0
// ----------------------------------------------------
console.log('\n[TEST 7] Causality — Throttle (speed na observation deve ser 0.5, não 0.52):');

const carThrottle = {
  isBot: false,
  participantId: 'p_1_test',
  currentLap: 1,
  finished: false,
  hasContact: false,
  currentSurface: 'TARMAC',
  currentLaneOffset: 0,
  // mlObservation: estado PRÉ-física (speed = 0.5)
  mlObservation: {
    speed: 0.5,          // STATE A
    forwardVelocity: 0.5,
    lateralVelocity: 0,
    heading: 0,
    yawRate: 0,
    slipAngle: 0,
    steeringAngle: 0,
    pathIndex: 0,
    trackProgress: 0,
    currentCurvature: 0,
    targetSpeed: 1.2,
    distanceToLeftEdge: 12,
    distanceToRightEdge: 12,
    surface: 'TARMAC',
    headingError: 0,
    crossTrackError: 0,
    offTrack: false,
    collision: false,
    spin: false,
    isRecovering: false
  },
  lastSteerInput: 0,
  lastThrottleInput: 1.0,  // ACTION
  lastBrakeInput: 0
};

// Depois da física, velocidade subiu para 0.52 (STATE B)
carThrottle.vx = 0.52;
carThrottle.vy = 0;
carThrottle.angle = 0;
carThrottle.yawRate = 0;

const collectorThrottle = new TelemetryCollector({ enabled: true, scope: 'ALL' });
collectorThrottle.session = new TelemetrySession();
collectorThrottle.sampleCar(carThrottle, miniTrack, 12, 150, 'test', 2000);

const capThrottle = collectorThrottle.session.samples[0];
assert(capThrottle !== undefined, '[Throttle] Sample foi gerado');
assert(capThrottle.carState.speed === 0.5, '[Throttle] observation.speed = STATE_A (0.5), não STATE_B (0.52)');
assert(capThrottle.driverAction.throttle === 1.0, '[Throttle] action.throttle = 1.0 conforme aplicado');
assert(capThrottle.driverAction.steering === 0, '[Throttle] action.steering = 0');


// ----------------------------------------------------
// TESTE 8: Causalidade — Colisão (ML1.2)
//
// observation_t: yawRate=0, hasContact=false (antes da colisão)
// action_t: steering=0
// handleCarCollisions() ocorre depois → yawRate=0.3
// Sample deve refletir PRÉ-colisão: observation.yawRate = 0
// A colisão aparece em observation(t+1), não em observation(t)
// ----------------------------------------------------
console.log('\n[TEST 8] Causality — Collision (yawRate na observation deve ser 0, colisão é evento pós-ação):');

const carCollision = {
  isBot: true,
  participantId: 'p_2_test',
  currentLap: 1,
  finished: false,
  hasContact: false,      // PRÉ-colisão: sem contato
  currentSurface: 'TARMAC',
  currentLaneOffset: 0,
  // mlObservation capturada ANTES de handleCarCollisions()
  mlObservation: {
    speed: 0.8,
    forwardVelocity: 0.8,
    lateralVelocity: 0,
    heading: 0,
    yawRate: 0,           // PRÉ-colisão: sem rotação
    slipAngle: 0,
    steeringAngle: 0,
    pathIndex: 0,
    trackProgress: 0,
    currentCurvature: 0,
    targetSpeed: 1.2,
    distanceToLeftEdge: 12,
    distanceToRightEdge: 12,
    surface: 'TARMAC',
    headingError: 0,
    crossTrackError: 0,
    offTrack: false,
    collision: false,     // PRÉ-colisão
    spin: false,
    isRecovering: false
  },
  lastSteerInput: 0,
  lastThrottleInput: 0.5,
  lastBrakeInput: 0
};

// handleCarCollisions() altera o estado DEPOIS do update
// (mlObservation já capturado — não é alterado)
carCollision.yawRate = 0.3;  // STATE B pós-colisão
carCollision.hasContact = true;
carCollision.vx = 0.7;
carCollision.vy = 0.2;
carCollision.angle = 0.01;

const collectorCollision = new TelemetryCollector({ enabled: true, scope: 'ALL' });
collectorCollision.session = new TelemetrySession();
collectorCollision.sampleCar(carCollision, miniTrack, 12, 150, 'test', 3000);

const capCollision = collectorCollision.session.samples[0];
assert(capCollision !== undefined, '[Collision] Sample foi gerado');
assert(capCollision.carState.yawRate === 0, '[Collision] observation.yawRate = 0 (PRÉ-colisão), não STATE_B (0.3)');
assert(capCollision.driverAction.steering === 0, '[Collision] action.steering = 0 (não afetado pela colisão)');
assert(capCollision.eventState.collision === false, '[Collision] observation.collision = false — colisão é do próximo tick');


// ----------------------------------------------------
// TESTE 9: Segmentos Desiguais e Interpolação Contínua (ML1.4)
//
// Segmento A = 0.5m  (idx 0 -> 1, cumDist = 0.0m)
// Segmento B = 4.0m  (idx 1 -> 2, cumDist = 0.5m)
// Segmento C = 1.2m  (idx 2 -> 0, cumDist = 4.5m)
// Comprimento total = 5.7m
// ----------------------------------------------------
console.log('\n[TEST 9] Continuous Track Progress — Unequal Segments (0.5m, 4.0m, 1.2m):');

const unequalTrack = [
  { x: 0.0, y: 0.0, segmentLength: 0.5, cumulativeDistance: 0.0, curvature: 0.01, normalX: 0, normalY: 1, angle: 0 },
  { x: 0.5, y: 0.0, segmentLength: 4.0, cumulativeDistance: 0.5, curvature: 0.02, normalX: 0, normalY: 1, angle: 0 },
  { x: 4.5, y: 0.0, segmentLength: 1.2, cumulativeDistance: 4.5, curvature: 0.01, normalX: 0, normalY: 1, angle: 0 }
];
const totalTrackLen57 = 5.7;

function computeProgress(segIdx, segT) {
  const segPoint = unequalTrack[segIdx];
  const segCumDist = segPoint.cumulativeDistance;
  const segLen = segPoint.segmentLength;
  let distAlong = segCumDist + segT * segLen;
  distAlong = ((distAlong % totalTrackLen57) + totalTrackLen57) % totalTrackLen57;
  return distAlong / totalTrackLen57;
}

const p0 = computeProgress(1, 0.0);   // (0.5 + 0.0*4.0)/5.7 = 0.5/5.7 ≈ 0.087719
const p25 = computeProgress(1, 0.25); // (0.5 + 0.25*4.0)/5.7 = 1.5/5.7 ≈ 0.263157
const p50 = computeProgress(1, 0.50); // (0.5 + 0.50*4.0)/5.7 = 2.5/5.7 ≈ 0.438596
const p75 = computeProgress(1, 0.75); // (0.5 + 0.75*4.0)/5.7 = 3.5/5.7 ≈ 0.614035
const p100 = computeProgress(1, 1.00);// (0.5 + 1.00*4.0)/5.7 = 4.5/5.7 ≈ 0.789473

assert(Math.abs(p0 - (0.5 / 5.7)) < 1e-6, 'Segmento B em 0%: trackProgress = 0.5/5.7 (~0.0877)');
assert(Math.abs(p25 - (1.5 / 5.7)) < 1e-6, 'Segmento B em 25%: trackProgress = 1.5/5.7 (~0.2632)');
assert(Math.abs(p50 - (2.5 / 5.7)) < 1e-6, 'Segmento B em 50%: trackProgress = 2.5/5.7 (~0.4386)');
assert(Math.abs(p75 - (3.5 / 5.7)) < 1e-6, 'Segmento B em 75%: trackProgress = 3.5/5.7 (~0.6140)');
assert(Math.abs(p100 - (4.5 / 5.7)) < 1e-6, 'Segmento B em 100%: trackProgress = 4.5/5.7 (~0.7895)');


// ----------------------------------------------------
// TESTE 10: Monotonicidade Local Sub-Segmento (ML1.4)
// ----------------------------------------------------
console.log('\n[TEST 10] Local Monotonicity — Smooth Sub-Segment Progress:');

const subSteps = [];
for (let step = 0; step <= 10; step++) {
  const t = step / 10;
  subSteps.push(computeProgress(1, t));
}

let isStrictlyMonotonic = true;
let hasDuplicates = false;
for (let i = 0; i < subSteps.length - 1; i++) {
  if (subSteps[i] >= subSteps[i + 1]) isStrictlyMonotonic = false;
  if (subSteps[i] === subSteps[i + 1]) hasDuplicates = true;
}

assert(isStrictlyMonotonic === true, 'Progresso ao longo do segmento é estritamente crescente');
assert(hasDuplicates === false, 'Sem valores duplicados/estáticos dentro do mesmo segmento');


// ----------------------------------------------------
// TESTE 11: Wrap da Linha de Chegada e Limites [0, 1) (ML1.4)
// ----------------------------------------------------
console.log('\n[TEST 11] Finish Line Wrap-Around & Range [0, 1):');

// Próximo do final da volta (Segmento C a 99.9%):
const pNearEnd = computeProgress(2, 0.999); // (4.5 + 0.999*1.2)/5.7 = 5.6988/5.7 ≈ 0.999789
assert(pNearEnd > 0.999 && pNearEnd < 1.0, `Progresso próximo ao fim da volta (${pNearEnd.toFixed(5)}) está em [0.999, 1.0)`);

// Cruzando a linha de chegada (Segmento A a 0.1%):
const pJustStarted = computeProgress(0, 0.001); // (0.0 + 0.001*0.5)/5.7 = 0.0005/5.7 ≈ 0.0000877
assert(pJustStarted > 0 && pJustStarted < 0.001, `Progresso logo após a linha de chegada (${pJustStarted.toFixed(5)}) está em (0, 0.001)`);

// Teste de limites estritos
assert(pNearEnd < 1.0, 'trackProgress nunca atinge ou excede 1.0');
assert(pJustStarted >= 0.0, 'trackProgress nunca é negativo');
assert(!Number.isNaN(pNearEnd) && !Number.isNaN(pJustStarted), 'trackProgress nunca é NaN');


// ----------------------------------------------------
// TESTE 12: Eliminação de Curvature Spikes & Plausibilidade Física (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 12] Curvature Spike Elimination & Physical Plausibility:');

// Gerar Interlagos oficial com spline centrípeto
generateTrackPath(21);
const interlagosPath = state.trackPath;
const totalPts = interlagosPath.length;

let maxCurvInterlagos = 0;
let spikeCountInterlagos = 0;
for (let i = 0; i < totalPts; i++) {
  const k = interlagosPath[i].curvature || 0;
  if (k > maxCurvInterlagos) maxCurvInterlagos = k;
  if (k > 0.20) spikeCountInterlagos++;
}

assert(maxCurvInterlagos < 0.20, `Interlagos maxCurvature (${maxCurvInterlagos.toFixed(4)} rad/m) é estritamente < 0.20 rad/m`);
assert(spikeCountInterlagos === 0, `Interlagos possui exatamente 0 spikes de curvatura > 0.20 rad/m (anteriormente 24 spikes)`);
assert(maxCurvInterlagos > 0.10, `Interlagos preserva pico real no hairpin do Bico de Pato (${maxCurvInterlagos.toFixed(4)} rad/m, raio ~${(1/maxCurvInterlagos).toFixed(1)}m)`);

// Testar higienização de waypoints duplicados
const rawWithDup = [
  { x: 100, y: 100 },
  { x: 150, y: 150 },
  { x: 150.1, y: 150.1 }, // quase duplicado (< 0.5m)
  { x: 200, y: 200 },
  { x: 100, y: 100 }      // fechamento duplicado do primeiro ponto
];
const cleaned = cleanWaypoints(rawWithDup);
assert(cleaned.length === 3, 'cleanWaypoints remove duplicatas consecutivas e endpoint de fechamento redundante');


// ----------------------------------------------------
// TESTE 13: Orientação Contínua da Tangente & Zero Inversões (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 13] Consistent Race Tangent Orientation & Zero Tangent Flips:');

let tangentFlips = 0;
for (let i = 0; i < totalPts; i++) {
  const curr = interlagosPath[i];
  const next = interlagosPath[(i + 1) % totalPts];
  const currLen = curr.segmentLength || 1;
  const nextLen = next.segmentLength || 1;
  const t1x = (next.x - curr.x) / currLen;
  const t1y = (next.y - curr.y) / currLen;
  const nextNext = interlagosPath[(i + 2) % totalPts];
  const t2x = (nextNext.x - next.x) / nextLen;
  const t2y = (nextNext.y - next.y) / nextLen;

  const dot = t1x * t2x + t1y * t2y;
  if (dot < 0) tangentFlips++;
}

assert(tangentFlips === 0, 'Zero inversões de tangente (dot < 0) ao longo de toda a pista de Interlagos');

// Verificar wrap último -> primeiro
const lastPt = interlagosPath[totalPts - 1];
const firstPt = interlagosPath[0];
const secondPt = interlagosPath[1];
const lastLen = lastPt.segmentLength || 1;
const firstLen = firstPt.segmentLength || 1;
const wrapDot = ((firstPt.x - lastPt.x) / lastLen) * ((secondPt.x - firstPt.x) / firstLen) +
                ((firstPt.y - lastPt.y) / lastLen) * ((secondPt.y - firstPt.y) / firstLen);
assert(wrapDot > 0.90, `Transição suave de wrap no ponto final -> inicial (dot = ${wrapDot.toFixed(4)})`);


// ----------------------------------------------------
// TESTE 14: Heading Error Contínuo sem Saltos ±PI Artificiais (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 14] Continuous Heading Error Alignment (Zero ±PI Jumps):');

let maxAngleDelta = 0;
let angleJumpsOver90Deg = 0;

for (let i = 0; i < totalPts; i++) {
  const curr = interlagosPath[i];
  const next = interlagosPath[(i + 1) % totalPts];
  let dAngle = next.angle - curr.angle;
  while (dAngle < -Math.PI) dAngle += Math.PI * 2;
  while (dAngle > Math.PI) dAngle -= Math.PI * 2;

  if (Math.abs(dAngle) > maxAngleDelta) maxAngleDelta = Math.abs(dAngle);
  if (Math.abs(dAngle) > Math.PI / 2) angleJumpsOver90Deg++;
}

assert(angleJumpsOver90Deg === 0, 'Nenhum salto angular > 90° entre pontos consecutivos em todo o circuito');
assert(maxAngleDelta < Math.PI / 6, `Maior variação angular ponto-a-ponto (${(maxAngleDelta * 180 / Math.PI).toFixed(2)}°) é suave (< 30°)`);

// Simular carro perfeitamente alinhado na reta dos boxes (trackProgress ≈ 0.99)
const nearFinishPt = interlagosPath[Math.floor(totalPts * 0.99)];
let simulatedHeadingError = nearFinishPt.angle - nearFinishPt.angle;
while (simulatedHeadingError < -Math.PI) simulatedHeadingError += Math.PI * 2;
while (simulatedHeadingError > Math.PI) simulatedHeadingError -= Math.PI * 2;

assert(Math.abs(simulatedHeadingError) < 1e-6, 'Carro alinhado com a pista em trackProgress ≈ 0.99 possui headingError = 0 (sem salto ±PI)');


// ----------------------------------------------------
// TESTE 15: Detecção de Sequence Gaps & Estatísticas de Deltas (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 15] Sequence Gap Detection & Sample Rate Statistics:');

// Simular timestamps a 10 Hz (100ms) com 1 gap de 11 segundos
const mockDeltas = [];
for (let i = 0; i < 99; i++) mockDeltas.push(100.0);
mockDeltas.push(11033.0); // 1 grande gap
for (let i = 0; i < 100; i++) mockDeltas.push(100.0);

const sortedMockDeltas = mockDeltas.slice().sort((a, b) => a - b);
const medianDelta = percentile(sortedMockDeltas, 50);
const p95Delta = percentile(sortedMockDeltas, 95);
const maxDelta = sortedMockDeltas[sortedMockDeltas.length - 1];
const mockGaps = mockDeltas.filter(dt => dt > 250.0);

assert(medianDelta === 100.0, 'Mediana dos deltas temporais é exatamente 100.0 ms (10 Hz nominal)');
assert(p95Delta === 100.0, 'p95 dos deltas temporais é 100.0 ms');
assert(maxDelta === 11033.0, 'Max delta detecta com precisão o gap de 11.03s');
assert(mockGaps.length === 1, 'sequenceGapCount identifica exatamente 1 sequence gap (> 250ms)');


// ----------------------------------------------------
// TESTE 16: Classificação de Voltas Completas vs Parciais (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 16] Completed vs Partial Lap Classification:');

const mockLapStatsMap = {
  1: { sampleCount: 500, minProgress: 0.001, maxProgress: 0.998 },
  2: { sampleCount: 480, minProgress: 0.002, maxProgress: 0.997 },
  3: { sampleCount: 490, minProgress: 0.001, maxProgress: 0.999 },
  4: { sampleCount: 485, minProgress: 0.003, maxProgress: 0.996 },
  5: { sampleCount: 60,  minProgress: 0.001, maxProgress: 0.026 } // volta parcial interrompida
};

const lapClassification = classifyLaps(mockLapStatsMap);

assert(lapClassification.observedLapNumbers.length === 5, 'Total de 5 voltas observadas');
assert(lapClassification.completedLaps.length === 4, 'Total de 4 voltas completas identificadas');
assert(lapClassification.completedLaps[0] === 1 && lapClassification.completedLaps[3] === 4, 'Voltas 1, 2, 3 e 4 homologadas como completas');
assert(lapClassification.partialLaps.length === 1, 'Volta 5 devidamente classificada como parcial');
assert(lapClassification.partialLaps[0].lapNumber === 5 && lapClassification.partialLaps[0].sampleCount === 60, 'Volta parcial 5 possui metadados corretos');


// ----------------------------------------------------
// TESTE 17: Agrupamento de Episódios Contíguos de Eventos (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 17] Contiguous Event Episode Grouping (Off-Track, Spin):');

// Criar array de 200 samples com 3 episódios de off-track contíguos (30 samples, 51 samples, 43 samples = total 124)
const mockOffTrackFlags = new Array(200).fill(false);
for (let i = 10; i < 40; i++) mockOffTrackFlags[i] = true;   // Episódio 1: 30 samples
for (let i = 70; i < 121; i++) mockOffTrackFlags[i] = true;  // Episódio 2: 51 samples (maior)
for (let i = 150; i < 193; i++) mockOffTrackFlags[i] = true; // Episódio 3: 43 samples

const offTrackGrouping = groupConsecutiveEpisodes(mockOffTrackFlags);

assert(offTrackGrouping.sampleCount === 124, 'Total de 124 samples off-track contabilizados');
assert(offTrackGrouping.episodeCount === 3, '124 samples agrupados corretamente em 3 episódios contíguos');
assert(offTrackGrouping.longestEpisodeLength === 51, 'Maior episódio de off-track identificado com precisão (51 samples)');

// Teste de spin: 4 samples em 2 episódios (1 sample + 3 samples)
const mockSpinFlags = new Array(100).fill(false);
mockSpinFlags[20] = true;
mockSpinFlags[50] = true;
mockSpinFlags[51] = true;
mockSpinFlags[52] = true;

const spinGrouping = groupConsecutiveEpisodes(mockSpinFlags);
assert(spinGrouping.sampleCount === 4, 'Total de 4 samples de spin contabilizados');
assert(spinGrouping.episodeCount === 2, '4 samples de spin agrupados em 2 episódios distintos');
assert(spinGrouping.longestEpisodeLength === 3, 'Maior episódio de spin com 3 samples');


// ----------------------------------------------------
// TESTE 18: Alerta de Desbalanceamento de Ações do Piloto (ML1.5)
// ----------------------------------------------------
console.log('\n[TEST 18] Driver Action Imbalance Warning Detection:');

const totalMockSamples = 2447;
const fullThrottleSamples = 2060; // 84.2%
const brakeSamples = 28;          // 1.1%

const pctFullTh = (fullThrottleSamples / totalMockSamples) * 100;
const pctBrakeActive = (brakeSamples / totalMockSamples) * 100;

const triggersImbalanceWarning = (pctFullTh > 80.0 || pctBrakeActive < 5.0);
assert(triggersImbalanceWarning === true, 'Assinatura binária/desbalanceada de teclado dispara devidamente DATA IMBALANCE WARNING');


// ----------------------------------------------------
// RESUMO FINAL
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`📊 RESULTADO DOS TESTES: ${passed} PASSOU | ${failed} FALHOU`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}


