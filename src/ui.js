import { ctx } from './canvas.js';
import { MAX_SPEED_KMH, MAX_INTERNAL_SPEED } from './constants.js';
import { state } from './game.js';
import { createLeaderboardView } from './leaderboardView.js';

function setHudText(id, value) {
  const element = document.getElementById(id);
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

let updateLeaderboard;

export function updateHUD() {
  const p1 = state.cars[0];
  if (!p1) return;

  const { totalLaps, gameMode, selectedTrackData } = state;

  setHudText('top-pos', `POS: ${p1.rank}º / ${state.cars.length}`);
  setHudText('top-lap', `VOLTA: ${Math.min(p1.currentLap, totalLaps)} / ${totalLaps}`);

  let minutes = Math.floor(p1.currentLapTime / 60);
  let seconds = (p1.currentLapTime % 60).toFixed(2);
  setHudText('top-time', `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);

  setHudText('player-name', p1.name);
  setHudText('speed-val', p1.getKmh());
  setHudText('gear-val', `${p1.gear}ª MARCHA`);
  setHudText('mode-tag', p1.isAuto ? 'AUTO' : 'MANUAL');
  const tyreStatus = document.getElementById('tyre-status');
  const assistStatus = document.getElementById('assist-status');
  const tyreTemp = Math.round(p1.tyreTemp || 0);
  setHudText('tyre-status', `PNEUS ${tyreTemp}°C`);
  tyreStatus.style.color = tyreTemp < 60 ? '#65b9ff' : (tyreTemp > 112 ? '#ff684f' : '#7dff9a');
  setHudText('assist-status', p1.tcActive ? 'TC ATUANDO' : (p1.absActive ? 'ABS ATUANDO' : 'TC / ABS'));
  assistStatus.style.color = (p1.tcActive || p1.absActive) ? '#ffd45a' : '#9eabb8';

  let rpmPercent = Math.min(100, Math.max(0, ((p1.rpm - 1000) / 7500) * 100));
  document.getElementById('rpm-bar').style.transform = `scaleX(${rpmPercent / 100})`;

  const shiftTextEl = document.getElementById('shift-text');
  const shiftAlertEl = document.getElementById('shift-alert');
  const physicsAlertEl = document.getElementById('physics-alert');

  // Alerta de Troca de Marcha
  if (!p1.isAuto && !p1.finished) {
    if (p1.gear < p1.maxGear && p1.rpm > 7400) {
      setHudText('shift-alert', '⬆️ TROQUE DE MARCHA! (SETA ↑)');
      shiftAlertEl.className = 'shift-up-alert';
      shiftAlertEl.style.display = 'block';

      setHudText('shift-text', '⬆️ SUBIR MARCHA!');
      shiftTextEl.style.color = '#ff3333';
    } else if (p1.gear > 1 && p1.rpm < 2200 && p1.getKmh() > 15) {
      setHudText('shift-alert', '⬇️ REDUZA A MARCHA! (SETA ↓)');
      shiftAlertEl.className = 'shift-down-alert';
      shiftAlertEl.style.display = 'block';

      setHudText('shift-text', '⬇️ REDUZIR MARCHA!');
      shiftTextEl.style.color = '#ffcc00';
    } else {
      shiftAlertEl.style.display = 'none';
      setHudText('shift-text', `${Math.round(p1.rpm)} RPM`);
      shiftTextEl.style.color = '#ffffff';
    }
  } else {
    shiftAlertEl.style.display = 'none';
    setHudText('shift-text', `${Math.round(p1.rpm)} RPM`);
    shiftTextEl.style.color = '#ffffff';
  }

  // Alertas de Física & Superfície (Brita, Sub/Sobre-esterço)
  if (p1.currentSurface === 'GRAVEL' && !p1.finished) {
    setHudText('physics-alert', '⚠️ CAIXA DE BRITA! (PERDA DE ADERÊNCIA)');
    physicsAlertEl.className = 'alert-gravel';
    physicsAlertEl.style.display = 'block';
  } else if (state.trackCondition === 'wet' && !p1.finished && (p1.tcActive || p1.absActive)) {
    setHudText('physics-alert', '🌧️ PISTA MOLHADA — TC / ABS ATUANDO');
    physicsAlertEl.className = 'alert-understeer';
    physicsAlertEl.style.display = 'block';
  } else if (p1.physicsState === 'UNDERSTEER' && !p1.finished) {
    setHudText('physics-alert', '⚠️ PASSANDO RETO! (SUB-ESTERÇO)');
    physicsAlertEl.className = 'alert-understeer';
    physicsAlertEl.style.display = 'block';
  } else if (p1.physicsState === 'OVERSTEER' && !p1.finished) {
    setHudText('physics-alert', '🚨 TRASEIRA SOLTA! (SOBRE-ESTERÇO)');
    physicsAlertEl.className = 'alert-oversteer';
    physicsAlertEl.style.display = 'block';
  } else {
    physicsAlertEl.style.display = 'none';
  }

  updateLeaderboard ||= createLeaderboardView(document.getElementById('hud-leaderboard'));
  updateLeaderboard(state);
}

export function showVictoryScreen() {
  document.getElementById('shift-alert').style.display = 'none';
  document.getElementById('physics-alert').style.display = 'none';

  const winScreen = document.getElementById('win-screen');
  const podiumList = document.getElementById('podium-list');

  let finalStandings = [...state.finishedCarsOrder];
  state.cars.forEach(c => { if (!finalStandings.includes(c)) finalStandings.push(c); });

  const player1 = state.cars[0];
  const { selectedTrackData, totalLaps, gameMode } = state;

  let podiumHTML = `
    <div style="font-size:0.85em; margin-bottom:12px; color:#aaa; line-height: 1.5;">
      🏁 <b>${selectedTrackData ? selectedTrackData.name : 'Grande Prêmio'}</b><br>
      📍 ${selectedTrackData ? selectedTrackData.location : ''} | Extensão: ${selectedTrackData ? selectedTrackData.lengthKm : ''}<br>
      ⏱️ Seu Tempo Total: <b>${player1 && player1.totalRaceTime ? player1.totalRaceTime.toFixed(2) + 's' : 'DNF'}</b>
    </div>
  `;

  if (gameMode === 'ghost') {
    podiumHTML += `
      <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
        <span style="color:#00ffff;">⚡ Recorde da Volta: <b>${state.bestLapTime ? state.bestLapTime.toFixed(2) + 's' : '--'}</b></span><br>
        <span style="color:#ffd700;">🏆 Recorde da Corrida: <b>${state.bestRaceTime ? state.bestRaceTime.toFixed(2) + 's' : '--'}</b></span>
      </div>
    `;
  } else {
    podiumHTML += finalStandings.map((car, idx) => `
      <div style="color: ${car.color}; font-weight: bold; margin-bottom: 3px;">
        ${idx + 1}º Lugar: ${car.name} ${car.totalRaceTime ? `(${car.totalRaceTime.toFixed(2)}s)` : '(DNF)'}
      </div>
    `).join('');
  }

  podiumList.innerHTML = podiumHTML;
  winScreen.style.display = 'block';
}

export function drawGhostCar(x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.globalAlpha = 0.40; ctx.shadowColor = color; ctx.shadowBlur = 4;
  ctx.fillStyle = color; ctx.fillRect(-2.5, -1.0, 5.0, 2.0);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-0.4, -0.4, 1.2, 0.8);
  ctx.restore();
}

export function drawGhosts() {
  if (state.gameMode !== 'ghost') return;

  if (state.bestLapPath && state.bestLapPath.length > 0) {
    let fLap = state.bestLapPath[state.ghostLapFrameIndex];
    if (fLap) {
      drawGhostCar(fLap.x, fLap.y, fLap.a, '#00ffff');
      state.ghostLapFrameIndex = (state.ghostLapFrameIndex + 1) % state.bestLapPath.length;
    }
  }

  if (state.bestRacePath && state.bestRacePath.length > 0) {
    let fRace = state.bestRacePath[state.ghostRaceFrameIndex];
    if (fRace) {
      drawGhostCar(fRace.x, fRace.y, fRace.a, '#ffd700');
      state.ghostRaceFrameIndex++;
    }
  }
}
