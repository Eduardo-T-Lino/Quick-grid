import { ctx } from './canvas.js';
import { MAX_SPEED_KMH, MAX_INTERNAL_SPEED } from './constants.js';
import { state } from './game.js';

export function updateHUD() {
  const p1 = state.cars[0];
  if (!p1) return;

  const { totalLaps, gameMode, selectedTrackData } = state;

  document.getElementById('top-pos').innerText = `POS: ${p1.rank}º / ${state.cars.length}`;
  document.getElementById('top-lap').innerText = `VOLTA: ${Math.min(p1.currentLap, totalLaps)} / ${totalLaps}`;

  let minutes = Math.floor(p1.currentLapTime / 60);
  let seconds = (p1.currentLapTime % 60).toFixed(2);
  document.getElementById('top-time').innerText = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  document.getElementById('player-name').innerText = p1.name;
  document.getElementById('speed-val').innerText = p1.getKmh();
  document.getElementById('gear-val').innerText = `${p1.gear}ª MARCHA`;
  document.getElementById('mode-tag').innerText = p1.isAuto ? 'AUTO' : 'MANUAL';
  const tyreStatus = document.getElementById('tyre-status');
  const assistStatus = document.getElementById('assist-status');
  const tyreTemp = Math.round(p1.tyreTemp || 0);
  tyreStatus.innerText = `PNEUS ${tyreTemp}°C`;
  tyreStatus.style.color = tyreTemp < 60 ? '#65b9ff' : (tyreTemp > 112 ? '#ff684f' : '#7dff9a');
  assistStatus.innerText = p1.tcActive ? 'TC ATUANDO' : (p1.absActive ? 'ABS ATUANDO' : 'TC / ABS');
  assistStatus.style.color = (p1.tcActive || p1.absActive) ? '#ffd45a' : '#9eabb8';

  let rpmPercent = Math.min(100, Math.max(0, ((p1.rpm - 1000) / 7500) * 100));
  document.getElementById('rpm-bar').style.width = `${rpmPercent}%`;

  const shiftTextEl = document.getElementById('shift-text');
  const shiftAlertEl = document.getElementById('shift-alert');
  const physicsAlertEl = document.getElementById('physics-alert');

  // Alerta de Troca de Marcha
  if (!p1.isAuto && !p1.finished) {
    if (p1.gear < p1.maxGear && p1.rpm > 7400) {
      shiftAlertEl.innerText = '⬆️ TROQUE DE MARCHA! (SETA ↑)';
      shiftAlertEl.className = 'shift-up-alert';
      shiftAlertEl.style.display = 'block';

      shiftTextEl.innerText = '⬆️ SUBIR MARCHA!';
      shiftTextEl.style.color = '#ff3333';
    } else if (p1.gear > 1 && p1.rpm < 2200 && p1.getKmh() > 15) {
      shiftAlertEl.innerText = '⬇️ REDUZA A MARCHA! (SETA ↓)';
      shiftAlertEl.className = 'shift-down-alert';
      shiftAlertEl.style.display = 'block';

      shiftTextEl.innerText = '⬇️ REDUZIR MARCHA!';
      shiftTextEl.style.color = '#ffcc00';
    } else {
      shiftAlertEl.style.display = 'none';
      shiftTextEl.innerText = `${Math.round(p1.rpm)} RPM`;
      shiftTextEl.style.color = '#ffffff';
    }
  } else {
    shiftAlertEl.style.display = 'none';
    shiftTextEl.innerText = `${Math.round(p1.rpm)} RPM`;
    shiftTextEl.style.color = '#ffffff';
  }

  // Alertas de Física & Superfície (Brita, Sub/Sobre-esterço)
  if (p1.currentSurface === 'GRAVEL' && !p1.finished) {
    physicsAlertEl.innerText = '⚠️ CAIXA DE BRITA! (PERDA DE ADERÊNCIA)';
    physicsAlertEl.className = 'alert-gravel';
    physicsAlertEl.style.display = 'block';
  } else if (state.trackCondition === 'wet' && !p1.finished && (p1.tcActive || p1.absActive)) {
    physicsAlertEl.innerText = '🌧️ PISTA MOLHADA — TC / ABS ATUANDO';
    physicsAlertEl.className = 'alert-understeer';
    physicsAlertEl.style.display = 'block';
  } else if (p1.physicsState === 'UNDERSTEER' && !p1.finished) {
    physicsAlertEl.innerText = '⚠️ PASSANDO RETO! (SUB-ESTERÇO)';
    physicsAlertEl.className = 'alert-understeer';
    physicsAlertEl.style.display = 'block';
  } else if (p1.physicsState === 'OVERSTEER' && !p1.finished) {
    physicsAlertEl.innerText = '🚨 TRASEIRA SOLTA! (SOBRE-ESTERÇO)';
    physicsAlertEl.className = 'alert-oversteer';
    physicsAlertEl.style.display = 'block';
  } else {
    physicsAlertEl.style.display = 'none';
  }

  // Leaderboard HUD — mostra 2 à frente e 2 atrás do jogador
  if (gameMode === 'race') {
    let sorted = [...state.cars].sort((a, b) => a.rank - b.rank);
    const playerRank = p1.rank; // 1-indexed
    const total = sorted.length;

    // Janela dinâmica: 2 à frente e 2 atrás, ajustando nas extremidades
    let windowStart, windowEnd;
    if (playerRank <= 1) {
      // 1º lugar: mostra os 4 atrás
      windowStart = 0;
      windowEnd = Math.min(total - 1, 4);
    } else if (playerRank >= total) {
      // Último: mostra os 4 à frente
      windowStart = Math.max(0, total - 5);
      windowEnd = total - 1;
    } else {
      // Intermediário: 2 à frente + jogador + 2 atrás
      windowStart = Math.max(0, playerRank - 3);
      windowEnd = Math.min(total - 1, playerRank + 1);
    }

    // Gap ao carro diretamente à frente do jogador
    let gapText = '';
    const carAhead = sorted.find(c => c.rank === playerRank - 1);
    if (carAhead && !carAhead.finished) {
      const dist = Math.hypot(carAhead.x - p1.x, carAhead.y - p1.y);
      const distM = Math.round(dist);
      const shortName = carAhead.name.split(' ').pop();
      gapText = `<div style="font-size:0.72em; color:#ffd700; margin-bottom:3px; letter-spacing:0.02em;">▲ ${shortName} &mdash; ${distM < 1000 ? distM + 'm' : (dist / 1000).toFixed(1) + 'km'}</div>`;
    }

    const rows = sorted.slice(windowStart, windowEnd + 1).map(c => {
      const isPlayer = !c.isBot;
      return `<div class="leader-row" style="
        color:${c.color};
        background:${isPlayer ? 'rgba(255,34,34,0.12)' : 'transparent'};
        border-left:${isPlayer ? '2px solid #ff2222' : '2px solid transparent'};
        padding-left:${isPlayer ? '4px' : '6px'};
        font-weight:${isPlayer ? 'bold' : 'normal'};
      "><span>${c.rank}º ${isPlayer ? '▶ ' : ''}${c.name.split(' ').pop()}</span><span>${c.getKmh()} km/h</span></div>`;
    }).join('');

    document.getElementById('hud-leaderboard').innerHTML = `
      <div style="font-size:0.78em; color:#00e5ff; font-weight:bold; margin-bottom:4px;">${selectedTrackData ? selectedTrackData.location : 'CORRIDA GT3'}</div>
      ${gapText}${rows}
    `;
  } else {
    document.getElementById('hud-leaderboard').innerHTML = `
      <div style="font-size:0.8em; color:#00e5ff; font-weight:bold; margin-bottom:4px;">${selectedTrackData ? selectedTrackData.location : 'CONTRATEMPO GT3'}</div>
      <div style="color:#00ffff">⚡ Melh. Volta: ${state.bestLapTime ? state.bestLapTime.toFixed(2) + 's' : '--'}</div>
    `;
  }
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
