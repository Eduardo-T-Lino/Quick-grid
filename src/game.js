import { canvas, ctx } from './canvas.js';
import { BOT_CONFIGS } from './constants.js';
import { F1_TRACKS } from './f1Tracks.js';
import { Car } from './car.js';
import { generateTrackPath, drawTrack } from './track.js';
import { updateHUD, showVictoryScreen, drawGhosts } from './ui.js';
import { mainCamera } from './camera.js';
import { drawMinimap } from './minimap.js';
import { fetchTrackRecords, saveTrackRecords, fetchBotTrainingData, saveBotTrainingData, fetchBotOffsetMemory, saveBotOffsetMemory } from './api.js';
import { drawBotDebugOverlay } from './ai.js';
import { mlTelemetry, onlineUploader, telemetryPerformance } from './ml/telemetry/index.js';

// ========== SHARED GAME STATE ==========
export const state = {
  keys: {},
  cars: [],
  finishedCarsOrder: [],
  trackPath: [],
  rawWaypoints: [],
  particles: [],
  skidMarks: [],
  floatingNotices: [],
  totalLaps: 3,
  selectedTrack: 21, // Padrão: Interlagos, Brasil 🇧🇷
  selectedTrackData: F1_TRACKS.find(t => t.id === 21) || F1_TRACKS[0],
  botDifficulty: 'pro',
  isRunning: false,
  raceFinished: false,
  gameMode: 'race',
  transmissionMode: 'manual',
  trackCondition: 'dry',

  bestLapTime: null,
  bestLapPath: [],
  currentLapPath: [],
  ghostLapFrameIndex: 0,
  bestRaceTime: null,
  bestRacePath: [],
  currentRacePath: [],
  ghostRaceFrameIndex: 0,

  timerSeconds: 45,
  timerInterval: null,
  firstFinishedCar: false,
  onPlayerLapCompleted(car) { mlTelemetry.recordCompletedLap(car); },

  startFinishTimer() {
    if (!this.firstFinishedCar && this.gameMode !== 'ghost') {
      this.firstFinishedCar = true;
      this.timerSeconds = 45;
      if (typeof document !== 'undefined') {
        const timerBox = document.getElementById('timer-box');
        if (timerBox) {
          timerBox.style.display = 'block';
          timerBox.innerText = `⏱️ TEMPO RESTANTE: ${this.timerSeconds}s`;
        }
      }

      this.timerInterval = setInterval(() => {
        this.timerSeconds--;
        if (typeof document !== 'undefined') {
          const timerBox = document.getElementById('timer-box');
          if (timerBox) {
            timerBox.innerText = `⏱️ TEMPO RESTANTE: ${this.timerSeconds}s`;
          }
        }
        if (this.timerSeconds <= 0) {
          clearInterval(this.timerInterval); this.timerInterval = null;
          finishRaceByTimeout();
        }
      }, 1000);
    }
  }
};

// ========== RECORDS & BACKEND SYNC ==========
async function loadRecords(trackId, laps) {
  state.bestLapTime = null; state.bestLapPath = [];
  state.bestRaceTime = null; state.bestRacePath = [];

  // Tentar buscar do backend
  const backendData = await fetchTrackRecords(trackId, laps);
  if (backendData && (backendData.bestLapTime || backendData.bestRaceTime)) {
    if (backendData.bestLapTime) {
      state.bestLapTime = backendData.bestLapTime;
      state.bestLapPath = backendData.bestLapPath || [];
    }
    if (backendData.bestRaceTime) {
      state.bestRaceTime = backendData.bestRaceTime;
      state.bestRacePath = backendData.bestRacePath || [];
    }
    return;
  }

  // Fallback no localStorage
  try {
    const sLapTime = localStorage.getItem(`cr_f1_t${trackId}_l${laps}_best_lap_time`);
    const sLapPath = localStorage.getItem(`cr_f1_t${trackId}_l${laps}_best_lap_path`);
    const sRaceTime = localStorage.getItem(`cr_f1_t${trackId}_l${laps}_best_race_time`);
    const sRacePath = localStorage.getItem(`cr_f1_t${trackId}_l${laps}_best_race_path`);
    if (sLapTime && sLapPath) { state.bestLapTime = parseFloat(sLapTime); state.bestLapPath = JSON.parse(sLapPath); }
    if (sRaceTime && sRacePath) { state.bestRaceTime = parseFloat(sRaceTime); state.bestRacePath = JSON.parse(sRacePath); }
  } catch (e) { }
}

export function syncRecordToBackend() {
  saveTrackRecords({
    trackId: state.selectedTrack,
    laps: state.totalLaps,
    bestLapTime: state.bestLapTime,
    bestLapPath: state.bestLapPath,
    bestRaceTime: state.bestRaceTime,
    bestRacePath: state.bestRacePath,
    playerName: state.cars[0] ? state.cars[0].name : 'Piloto'
  });
}

function syncBotTrainingEndRace() {
  const botStats = {};
  const aiModels = {};
  state.cars.filter(c => c.isBot).forEach(bot => {
    botStats[bot.name] = {
      treats: bot.petTreats || 0,
      discipline: bot.discipline || 1.0,
      skill: bot.botSkill || 1.0,
      cleanLaps: Math.max(0, bot.currentLap - 1)
    };
    if (bot.brain) {
      aiModels[bot.name] = bot.brain.exportModel();
    }
  });
  saveBotTrainingData(botStats);
  saveBotOffsetMemory(aiModels);
}

// ========== COLLISIONS ==========
function handleCarCollisions() {
  if (state.gameMode === 'ghost') return;
  for (let i = 0; i < state.cars.length; i++) {
    for (let j = i + 1; j < state.cars.length; j++) {
      let c1 = state.cars[i], c2 = state.cars[j];
      let dx = c2.x - c1.x, dy = c2.y - c1.y, dist = Math.hypot(dx, dy);
      let minDist = c1.radius + c2.radius;

      if (dist < minDist && dist > 0) {
        let nx = dx / dist, ny = dy / dist, overlap = minDist - dist;
        c1.x -= nx * overlap * 0.5; c1.y -= ny * overlap * 0.5;
        c2.x += nx * overlap * 0.5; c2.y += ny * overlap * 0.5;

        // Impulso inelástico: preserva parte do momento sem transformar contato em "pinball".
        let rvx = c2.vx - c1.vx, rvy = c2.vy - c1.vy;
        let normalSpeed = rvx * nx + rvy * ny;
        if (normalSpeed < 0) {
          const restitution = 0.18;
          const impulse = -(1 + restitution) * normalSpeed * 0.5;
          c1.vx -= impulse * nx; c1.vy -= impulse * ny;
          c2.vx += impulse * nx; c2.vy += impulse * ny;
          const impactYaw = impulse * 0.08;
          c1.yawRate -= impactYaw * ((nx * Math.sin(c1.angle)) - (ny * Math.cos(c1.angle)));
          c2.yawRate += impactYaw * ((nx * Math.sin(c2.angle)) - (ny * Math.cos(c2.angle)));
        }
      }
    }
  }
}

function updateRanks() {
  let sorted = [...state.cars].sort((a, b) => b.progress - a.progress);
  sorted.forEach((car, index) => car.rank = index + 1);
}

function checkRaceEnd() {
  if (state.cars.every(c => c.finished) && !state.raceFinished) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.raceFinished = true;
    if (mlTelemetry.enabled) mlTelemetry.stop();
    syncBotTrainingEndRace();
    syncRecordToBackend();
    showVictoryScreen();
  }
}

function finishRaceByTimeout() {
  if (!state.raceFinished) {
    state.raceFinished = true;
    if (mlTelemetry.enabled) mlTelemetry.stop();
    state.cars.forEach(car => {
      if (!car.finished) {
        car.finished = true;
        state.finishedCarsOrder.push(car);
      }
    });
    syncBotTrainingEndRace();
    syncRecordToBackend();
    showVictoryScreen();
  }
}

// ========== RESIZE ==========
export function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ========== MENU ACTIONS ==========
export function toggleModeUI() {
  const mode = document.getElementById('gameMode').value;
  document.getElementById('botOptionsGroup').style.display = mode === 'ghost' ? 'none' : 'block';
}

export function clearRecords() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('cr_f1_')) localStorage.removeItem(key);
    }
    state.bestLapTime = null; state.bestLapPath = [];
    state.bestRaceTime = null; state.bestRacePath = [];
    alert('Recordes limpos com sucesso!');
  } catch (e) { }
}

export function backToMenu() {
  if (mlTelemetry.enabled) mlTelemetry.stop();
  if (state.timerInterval) clearInterval(state.timerInterval);
  document.getElementById('timer-box').style.display = 'none';
  physicsAccumulator = 0;
  lastFrameTime = performance.now();
  document.getElementById('shift-alert').style.display = 'none';
  document.getElementById('win-screen').style.display = 'none';
  document.getElementById('menu').style.display = 'block';
  state.isRunning = false;
}

export async function startGame() {
  state.gameMode = document.getElementById('gameMode').value;
  state.transmissionMode = document.getElementById('transMode').value;
  state.trackCondition = document.getElementById('trackCondition').value;
  state.selectedTrack = parseInt(document.getElementById('trackSelect').value);
  state.totalLaps = parseInt(document.getElementById('lapCount').value);
  state.botDifficulty = document.getElementById('botDifficulty').value;

  if (onlineUploader.consentEnabled) {
    mlTelemetry.start({ trackId: state.selectedTrack, scope: 'PLAYER_ONLY', onlineOnly: true });
  }

  resizeCanvas();
  generateTrackPath(state.selectedTrack);
  await loadRecords(state.selectedTrack, state.totalLaps);

  // Carregar histórico de treino e offsetMemory dos bots
  const botTrainingHistory = await fetchBotTrainingData();
  const botOffsetMemory = await fetchBotOffsetMemory();

  state.cars = []; state.particles = []; state.skidMarks = []; state.floatingNotices = [];
  state.finishedCarsOrder = [];
  state.raceFinished = false;
  state.firstFinishedCar = false;

  state.currentLapPath = []; state.currentRacePath = [];
  state.ghostLapFrameIndex = 0; state.ghostRaceFrameIndex = 0;

  if (state.timerInterval) clearInterval(state.timerInterval);
  document.getElementById('timer-box').style.display = 'none';

  const numBots = (state.gameMode === 'race') ? parseInt(document.getElementById('botCount').value) : 0;

  // Carro do Jogador (P1): posicionado no ÚLTIMO slot do grid (index = numBots)
  state.cars.push(new Car('#ff2222', 'Você (P1)', false, numBots, state.transmissionMode === 'auto'));

  // Bots / Adversários: posicionados nos slots 0 até numBots - 1 (à frente do jogador)
  if (state.gameMode === 'race') {
    for (let i = 0; i < numBots; i++) {
      let bCfg = BOT_CONFIGS[i % BOT_CONFIGS.length];
      let botCar = new Car(bCfg.color, bCfg.name, true, i, true);

      // Injetar memória de treino do backend
      if (botTrainingHistory && botTrainingHistory.bots && botTrainingHistory.bots[bCfg.name]) {
        const saved = botTrainingHistory.bots[bCfg.name];
        botCar.petTreats = saved.treats || 0;
        botCar.discipline = saved.discipline || 1.0;
        botCar.botSkill = Math.max(botCar.botSkill, saved.skill || botCar.botSkill);
      }

      // Injetar cérebro de Machine Learning salvo (RL persistente entre corridas)
      if (botOffsetMemory && botOffsetMemory[bCfg.name] && botCar.brain) {
        botCar.brain.importModel(botOffsetMemory[bCfg.name]);
      }

      state.cars.push(botCar);
    }
  }

  // Centralizar câmera imediatamente no jogador (P1)
  if (state.cars.length > 0) {
    mainCamera.x = state.cars[0].x;
    mainCamera.y = state.cars[0].y;
  }

  document.getElementById('menu').style.display = 'none';
  state.isRunning = true;
  gameLoop();
}

// ========== GAME LOOP ==========
let lastFrameTime = performance.now();
let physicsAccumulator = 0;
const PHYSICS_STEP_MS = 1000 / 60;

function gameLoop(now = performance.now()) {
  if (!state.isRunning) return;
  const frameStart = performance.now();

  // Física fixa a 60 Hz: o carro tem a mesma resposta em telas de 60, 120 ou 144 Hz.
  physicsAccumulator += Math.min(100, now - lastFrameTime);
  lastFrameTime = now;
  let physicsTickTime = now - physicsAccumulator; // Timestamp do início dos ticks acumulados
  while (physicsAccumulator >= PHYSICS_STEP_MS) {
    state.cars.forEach(car => car.update());
    handleCarCollisions();
    physicsAccumulator -= PHYSICS_STEP_MS;
    physicsTickTime += PHYSICS_STEP_MS;
    // Capturar telemetria DENTRO do tick físico: state(t) e action(t) são do mesmo frame.
    // lastThrottleInput/lastBrakeInput/lastSteerInput são gravados NESTE update (sem atraso de frame).
    const collectorStart = performance.now();
    mlTelemetry.update(physicsTickTime, state);
    telemetryPerformance.recordCollector(performance.now() - collectorStart);
  }
  updateRanks();

  const playerCar = state.cars[0];
  mainCamera.update(playerCar, canvas);

  // 2. Limpar Tela
  ctx.fillStyle = '#060a08';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 3. Renderizar Espaço de Mundo (Com transformações da Câmera)
  mainCamera.apply(ctx, canvas);

  // Desenhar Pista de Mundo
  drawTrack(canvas);

  // Marcas de Pneu / Skidmarks (em escala métrica de 0.35m de pneu)
  for (let i = state.skidMarks.length - 1; i >= 0; i--) {
    let sm = state.skidMarks[i];
    ctx.save();
    ctx.globalAlpha = sm.opacity * (sm.life / 180);
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(sm.x, sm.y, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    sm.life--;
    if (sm.life <= 0) state.skidMarks.splice(i, 1);
  }

  // Partículas (Fumaça, Brita, Faíscas)
  for (let i = state.particles.length - 1; i >= 0; i--) {
    state.particles[i].update();
    state.particles[i].draw();
    if (state.particles[i].life <= 0) state.particles.splice(i, 1);
  }

  // Avisos flutuantes de Pet / Punição
  for (let i = state.floatingNotices.length - 1; i >= 0; i--) {
    state.floatingNotices[i].update();
    state.floatingNotices[i].draw();
    if (state.floatingNotices[i].life <= 0) state.floatingNotices.splice(i, 1);
  }

  // Fantasmas e Carros
  drawGhosts();
  state.cars.forEach(car => car.draw());
  drawBotDebugOverlay(ctx); // Debug overlay (ativo apenas se window.DEBUG_BOT_AI = true)

  mainCamera.restore(ctx);

  // 4. Renderizar Elementos de Tela / HUD Fixos
  drawMinimap(ctx, canvas, state);
  updateHUD();
  checkRaceEnd();

  telemetryPerformance.recordFrame(performance.now() - frameStart, now);

  requestAnimationFrame(gameLoop);
}
