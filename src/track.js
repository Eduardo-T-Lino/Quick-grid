// Renderizador Hiper-Realista de Circuitos da Fórmula 1 com Malha Homogênea (24m de largura)
// Malha densa contínua a cada ~1.5m para eliminar qualquer descontinuidade.

import { ctx } from './canvas.js';
import { F1_TRACKS } from './f1Tracks.js';
import { state } from './game.js';
import { mainCamera } from './camera.js';
import { MAX_INTERNAL_SPEED } from './constants.js';

// Dicionário de Nomes Oficiais das Curvas F1 por Pista
const TRACK_SECTORS = {
  21: [ // Interlagos 🇧🇷
    { pct: 0.05, name: 'S DO SENNA (T1 & T2)' },
    { pct: 0.14, name: 'CURVA DO SOL' },
    { pct: 0.25, name: 'RETA OPOSTA (DRS)' },
    { pct: 0.38, name: 'DESCIDA DO LAGO' },
    { pct: 0.48, name: 'FERRADURA' },
    { pct: 0.60, name: 'PINHEIRINHO' },
    { pct: 0.72, name: 'BICO DE PATO' },
    { pct: 0.85, name: 'JUNÇÃO' },
    { pct: 0.95, name: 'SUBIDA DOS BOXES' }
  ],
  14: [ // Spa-Francorchamps 🇧🇪
    { pct: 0.04, name: 'LA SOURCE' },
    { pct: 0.12, name: 'EAU ROUGE & RAIDILLON (17%)' },
    { pct: 0.26, name: 'KEMMEL STRAIGHT (DRS)' },
    { pct: 0.40, name: 'LES COMBES' },
    { pct: 0.55, name: 'POUHON (260 KM/H)' },
    { pct: 0.70, name: 'STAVELOT' },
    { pct: 0.85, name: 'BLANCHIMONT' },
    { pct: 0.96, name: 'BUS STOP CHICANE' }
  ],
  16: [ // Monza 🇮🇹
    { pct: 0.08, name: 'VARIANTE DEL RETTIFILO (T1)' },
    { pct: 0.22, name: 'CURVA GRANDE (BIASSONO)' },
    { pct: 0.38, name: 'VARIANTE DELLA ROGGIA' },
    { pct: 0.50, name: 'LESMO 1 & LESMO 2' },
    { pct: 0.68, name: 'VARIANTE ASCARI' },
    { pct: 0.88, name: 'CURVA PARABOLICA (ALBORETO)' }
  ],
  4: [ // Suzuka 🇯🇵
    { pct: 0.08, name: 'CURVAS 1 & 2' },
    { pct: 0.20, name: 'ESSES DO 1º SETOR' },
    { pct: 0.35, name: 'DEGNER 1 & 2' },
    { pct: 0.48, name: 'HAIRPIN' },
    { pct: 0.65, name: 'SPOON CURVE' },
    { pct: 0.82, name: '130R (300 KM/H)' },
    { pct: 0.94, name: 'CASIO TRIANGLE' }
  ],
  8: [ // Monaco 🇲🇨
    { pct: 0.08, name: 'SAINTE-DÉVOTE' },
    { pct: 0.22, name: 'BEAU RIVAGE & MASSENET' },
    { pct: 0.35, name: 'CASINO SQUARE' },
    { pct: 0.46, name: 'LOEWS HAIRPIN (48 KM/H)' },
    { pct: 0.62, name: 'TÚNEL DE MONTE CARLO' },
    { pct: 0.74, name: 'NOUVELLE CHICANE' },
    { pct: 0.84, name: 'PISCINA (LOUIS CHIRON)' },
    { pct: 0.95, name: 'LA RASCASSE' }
  ]
};

function getCentripetalKnot(p0, p1, alpha = 0.5) {
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return Math.pow(d, alpha) || 1e-4;
}

// Spline Catmull-Rom Centrípeto (alpha = 0.5)
// Elimina matematicamente auto-interseções, cusps e oscilações de overshoot (Fase ML1.5)
function centripetalCatmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
  const dt0 = getCentripetalKnot(p0, p1, alpha);
  const dt1 = getCentripetalKnot(p1, p2, alpha);
  const dt2 = getCentripetalKnot(p2, p3, alpha);

  const t0 = 0;
  const t1 = t0 + dt0;
  const t2 = t1 + dt1;
  const t3 = t2 + dt2;

  const evalT = t1 + t * (t2 - t1);

  // Algoritmo de Pirâmide de Barry & Goldman
  const a1_x = ((t1 - evalT) * p0.x + (evalT - t0) * p1.x) / (t1 - t0);
  const a1_y = ((t1 - evalT) * p0.y + (evalT - t0) * p1.y) / (t1 - t0);
  const a1_z = ((t1 - evalT) * (p0.z || 0) + (evalT - t0) * (p1.z || 0)) / (t1 - t0);

  const a2_x = ((t2 - evalT) * p1.x + (evalT - t1) * p2.x) / (t2 - t1);
  const a2_y = ((t2 - evalT) * p1.y + (evalT - t1) * p2.y) / (t2 - t1);
  const a2_z = ((t2 - evalT) * (p1.z || 0) + (evalT - t1) * (p2.z || 0)) / (t2 - t1);

  const a3_x = ((t3 - evalT) * p2.x + (evalT - t2) * p3.x) / (t3 - t2);
  const a3_y = ((t3 - evalT) * p2.y + (evalT - t2) * p3.y) / (t3 - t2);
  const a3_z = ((t3 - evalT) * (p2.z || 0) + (evalT - t2) * (p3.z || 0)) / (t3 - t2);

  const b1_x = ((t2 - evalT) * a1_x + (evalT - t0) * a2_x) / (t2 - t0);
  const b1_y = ((t2 - evalT) * a1_y + (evalT - t0) * a2_y) / (t2 - t0);
  const b1_z = ((t2 - evalT) * a1_z + (evalT - t0) * a2_z) / (t2 - t0);

  const b2_x = ((t3 - evalT) * a2_x + (evalT - t1) * a3_x) / (t3 - t1);
  const b2_y = ((t3 - evalT) * a2_y + (evalT - t1) * a3_y) / (t3 - t1);
  const b2_z = ((t3 - evalT) * a2_z + (evalT - t1) * a3_z) / (t3 - t1);

  const c_x = ((t2 - evalT) * b1_x + (evalT - t1) * b2_x) / (t2 - t1);
  const c_y = ((t2 - evalT) * b1_y + (evalT - t1) * b2_y) / (t2 - t1);
  const c_z = ((t2 - evalT) * b1_z + (evalT - t1) * b2_z) / (t2 - t1);

  return { x: c_x, y: c_y, z: c_z };
}

// Higienização de waypoints duplicados/quase duplicados e remoção do ponto final de fechamento
export function cleanWaypoints(raw) {
  if (!raw || raw.length === 0) return [];
  const cleaned = [];
  const N = raw.length;
  for (let i = 0; i < N; i++) {
    const curr = raw[i];
    const prev = cleaned[cleaned.length - 1];
    if (!prev) {
      cleaned.push(curr);
    } else {
      const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      if (d > 0.5) {
        cleaned.push(curr);
      }
    }
  }
  // Wrap último -> primeiro (se o último ponto for duplicata exata do primeiro)
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    const d = Math.hypot(last.x - first.x, last.y - first.y);
    if (d <= 0.5) {
      cleaned.pop();
    }
  }
  return cleaned;
}

export function generateTrackPath(trackId) {
  const trackData = F1_TRACKS.find(t => t.id === trackId) || F1_TRACKS[0];
  state.selectedTrackData = trackData;
  state.rawWaypoints = cleanWaypoints(trackData.waypoints);

  state.trackPath = [];
  const numRaw = state.rawWaypoints.length;

  for (let i = 0; i < numRaw; i++) {
    let p0 = state.rawWaypoints[(i - 1 + numRaw) % numRaw];
    let p1 = state.rawWaypoints[i];
    let p2 = state.rawWaypoints[(i + 1) % numRaw];
    let p3 = state.rawWaypoints[(i + 2) % numRaw];

    // Densidade física homogênea (~1.5 metros por ponto) baseada no comprimento do segmento
    const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const stepsPerSegment = Math.max(4, Math.round(segDist / 1.5));

    for (let step = 0; step < stepsPerSegment; step++) {
      let t = step / stepsPerSegment;
      let pt = centripetalCatmullRomPoint(p0, p1, p2, p3, t, 0.5);
      state.trackPath.push(pt);
    }
  }

  const totalPoints = state.trackPath.length;
  for (let i = 0; i < totalPoints; i++) {
    let curr = state.trackPath[i];
    let next = state.trackPath[(i + 1) % totalPoints];
    let prev = state.trackPath[(i - 1 + totalPoints) % totalPoints];

    let dx = next.x - curr.x;
    let dy = next.y - curr.y;
    let dz = (next.z || 0) - (curr.z || 0);
    let len = Math.hypot(dx, dy) || 1;

    curr.angle = Math.atan2(dy, dx);
    curr.normalX = -dy / len;
    curr.normalY = dx / len;
    curr.segmentLength = len;
    curr.slope = dz / len;

    // Ângulo de chegada (prev→curr) e saída (curr→next) para calcular curvatura.
    // Usando atan2 do vetor (não do ponto) para máxima precisão numérica.
    let a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    let a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    let diff = a2 - a1;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    // Comprimento do arco entre prev e next (denominador para curvatura em rad/m).
    const prevLen = Math.hypot(curr.x - prev.x, curr.y - prev.y) || 1;
    const arcLen = (prevLen + len) * 0.5;
    curr.curvature = Math.abs(diff) / arcLen;
  }

  // Acumular distância física ao longo da pista para trackProgress linear em metros
  let accumDist = 0;
  for (let i = 0; i < totalPoints; i++) {
    state.trackPath[i].cumulativeDistance = accumDist;
    accumDist += state.trackPath[i].segmentLength;
  }
  state.totalTrackLength = accumDist;

  // Calcular Perfil Global de Velocidade Física da Pista (Backward Pass + Curvatura Filtrada)
  computeTrackSpeedProfile(state.trackPath);
}

// ── PERFIL GLOBAL DE VELOCIDADE FÍSICA ──────────────────────────────────────
export function computeTrackSpeedProfile(trackPath) {
  const N = trackPath.length;
  if (N === 0) return;

  // 1. FILTRO DE CURVATURA COM PRESERVAÇÃO DE PICOS REAIS (Fase 18 e 19)
  const weights = [0.06, 0.24, 0.40, 0.24, 0.06];
  for (let i = 0; i < N; i++) {
    let smoothed = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = (i + k + N) % N;
      smoothed += (trackPath[idx].curvature || 0) * weights[k + 2];
    }
    trackPath[i].smoothedCurvature = smoothed;
    // Preservação de pico: garante que o pico real de uma curva fechada nunca seja atenuado
    trackPath[i].effectiveCurvature = Math.max(trackPath[i].curvature || 0, smoothed);
  }

  // 2. VELOCIDADE ANALÍTICA DE CURVA COM DOWNFORCE QUADRÁTICO
  for (let i = 0; i < N; i++) {
    const kappa = trackPath[i].effectiveCurvature;
    if (kappa <= 0.0148) {
      // Raio >= 67.5m: 100% Flat-Out a 285 km/h sem freio!
      trackPath[i].curveLimit = MAX_INTERNAL_SPEED;
    } else {
      // Curva média / fechada: velocidade limite com física GT3
      const vAnalytic = Math.sqrt(0.0468 / (kappa - 0.01481));
      trackPath[i].curveLimit = Math.max(0.35, Math.min(MAX_INTERNAL_SPEED, vAnalytic));
    }
    trackPath[i].safeBrakingLimit = trackPath[i].curveLimit;
    trackPath[i].targetSpeed = trackPath[i].curveLimit;
  }

  // 3. BACKWARD PASS FÍSICO (Rampa de Frenagem Antecipada)
  const aBrake = 0.0155;
  for (let iter = 0; iter < 2; iter++) {
    for (let i = N - 1; i >= 0; i--) {
      const nextIdx = (i + 1) % N;
      const dist = trackPath[i].segmentLength || 1.5;
      const maxAllowedEntry = Math.sqrt((trackPath[nextIdx].safeBrakingLimit ** 2) + 2 * aBrake * dist);
      if (maxAllowedEntry < trackPath[i].safeBrakingLimit) {
        trackPath[i].safeBrakingLimit = maxAllowedEntry;
        trackPath[i].targetSpeed = maxAllowedEntry;
      }
    }
  }

  // 4. FORWARD PASS (Referência de Aceleração do Motor)
  const aAccel = 0.0075;
  for (let i = 0; i < N; i++) {
    trackPath[i].accelerationReference = trackPath[i].safeBrakingLimit;
  }
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < N; i++) {
      const prevIdx = (i - 1 + N) % N;
      const dist = trackPath[prevIdx].segmentLength || 1.5;
      const maxExitSpeed = Math.sqrt((trackPath[prevIdx].accelerationReference ** 2) + 2 * aAccel * dist);
      if (maxExitSpeed < trackPath[i].accelerationReference) {
        trackPath[i].accelerationReference = maxExitSpeed;
      }
    }
  }
}

export function drawTrack(canvas) {
  const { trackPath, selectedTrackData, trackCondition } = state;
  if (!trackPath || trackPath.length === 0) return;

  const trackWidth = (selectedTrackData && selectedTrackData.trackWidth) || 24; // 24 metros
  const kerbColors = (selectedTrackData && selectedTrackData.kerbColors) || { primary: '#d32f2f', secondary: '#ffffff' };
  const escapeType = (selectedTrackData && selectedTrackData.escapeType) || 'gravel_asphalt';
  const totalPoints = trackPath.length;

  // 1. ÁREAS DE ESCAPE EXTERNAS (Caixas de Brita e Asfalto de Segurança)
  ctx.beginPath();
  trackPath.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();

  if (escapeType === 'walls' || escapeType === 'barriers') {
    // Circuito de rua (Monaco, Baku, Vegas, Jeddah)
    ctx.strokeStyle = '#252a30';
    ctx.lineWidth = trackWidth + 6.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Barreiras Tecpro de concreto / Armco
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = trackWidth + 7.5;
    ctx.stroke();
  } else {
    // Pistas tradicionais: Caixa de Brita de 20m de largura
    ctx.strokeStyle = '#8a7752'; // Cor de cascalho/areia de escape
    ctx.lineWidth = trackWidth + 22.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Faixa de asfalto de segurança intermediária
    ctx.strokeStyle = '#2b333d';
    ctx.lineWidth = trackWidth + 6.5;
    ctx.stroke();

    // Guardrail metálico externo ao redor da brita
    ctx.strokeStyle = '#5a626d';
    ctx.lineWidth = trackWidth + 23.5;
    ctx.stroke();
  }

  // 2. ZEBRAS 3D AUTÊNTICAS (KERBS) NAS ENTRADAS E SAÍDAS DE CURVA
  const kerbWidth = trackWidth + 3.2; // 1.6m de zebra em cada lado

  for (let i = 0; i < totalPoints; i += 2) {
    let p = trackPath[i];
    if (p.curvature > 0.008) { // Curva detectada
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle + Math.PI / 2);

      let isPrimary = (Math.floor(i / 3) % 2 === 0);
      ctx.fillStyle = isPrimary ? kerbColors.primary : kerbColors.secondary;

      // Zebra chanfrada 3D
      ctx.fillRect(-kerbWidth / 2, -1.5, kerbWidth, 3.0);

      // Relevo chanfrado escuro
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(-kerbWidth / 2, 0.5, kerbWidth, 1.0);
      ctx.restore();
    }
  }

  // 3. ASFALTO PRINCIPAL DA PISTA (24m de largura)
  ctx.beginPath();
  trackPath.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.lineWidth = trackWidth;
  ctx.strokeStyle = trackCondition === 'wet' ? '#202b34' : '#181b20';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Reflexos sutis deixam claro que o asfalto está molhado sem poluir a corrida.
  if (trackCondition === 'wet') {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#88b9d7';
    ctx.lineWidth = trackWidth * 0.58;
    ctx.stroke();
    ctx.restore();
  }

  // 4. LINHA DE EMBORRACHAMENTO DA TRAJETÓRIA IDEAL (Racing Line Groove)
  ctx.save();
  ctx.beginPath();
  trackPath.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.lineWidth = trackWidth * 0.38;
  ctx.strokeStyle = 'rgba(10, 11, 14, 0.50)';
  ctx.stroke();
  ctx.restore();

  // 5. SOMBREADO DE RELEVO E ELEVAÇÃO 3D (Subidas iluminadas, descidas sombreadas)
  for (let i = 0; i < totalPoints; i += 3) {
    let p = trackPath[i];
    if (Math.abs(p.slope) > 0.004) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle + Math.PI / 2);

      if (p.slope > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.15, p.slope * 3.5)})`;
      } else {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.30, Math.abs(p.slope) * 5.0)})`;
      }
      ctx.fillRect(-trackWidth / 2, -2.0, trackWidth, 4.0);
      ctx.restore();
    }
  }

  // 6. LINHAS BRANCAS DE LIMITE DE PISTA (Track Limits - 25cm)
  const borderDist = trackWidth / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 0.40;

  // Borda Esquerda
  ctx.beginPath();
  trackPath.forEach((p, i) => {
    let lx = p.x + p.normalX * borderDist;
    let ly = p.y + p.normalY * borderDist;
    if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
  });
  ctx.closePath();
  ctx.stroke();

  // Borda Direita
  ctx.beginPath();
  trackPath.forEach((p, i) => {
    let rx = p.x - p.normalX * borderDist;
    let ry = p.y - p.normalY * borderDist;
    if (i === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
  });
  ctx.closePath();
  ctx.stroke();

  // 6b. BARREIRAS FÍSICAS NAS BORDAS DA PISTA (PÓS CAIXA DE BRITA)
  // Armco / Guardrail no limite externo da brita para pistas tradicionais
  // Muros de concreto para pistas de rua
  const barrierDist = (escapeType === 'walls' || escapeType === 'barriers') ? (borderDist + 3.0) : (borderDist + 11.5);

  if (escapeType === 'walls' || escapeType === 'barriers') {
    // === MUROS DE CONCRETO JERSEY (circuitos urbanos) ===
    // Bloco cinza com faixa laranja/branca
    for (let i = 0; i < totalPoints; i += 4) {
      let p = trackPath[i];
      // Lado esquerdo
      ctx.save();
      ctx.translate(p.x + p.normalX * barrierDist, p.y + p.normalY * barrierDist);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#8a8e94';
      ctx.fillRect(-1.5, -0.55, 3.0, 1.1);
      ctx.fillStyle = '#e87020';
      ctx.fillRect(-1.5, -0.55, 3.0, 0.22);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1.5, -0.55 + 0.22, 3.0, 0.18);
      ctx.restore();
      // Lado direito
      ctx.save();
      ctx.translate(p.x - p.normalX * barrierDist, p.y - p.normalY * barrierDist);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#8a8e94';
      ctx.fillRect(-1.5, -0.55, 3.0, 1.1);
      ctx.fillStyle = '#e87020';
      ctx.fillRect(-1.5, -0.55, 3.0, 0.22);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1.5, -0.55 + 0.22, 3.0, 0.18);
      ctx.restore();
    }
  } else {
    // === ARMCO / GUARDRAIL METÁLICO (pistas de circuito tradicional) ===
    // Trilho metálico contínuo
    ctx.save();
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 0.55;
    // Borda esquerda
    ctx.beginPath();
    trackPath.forEach((p, i) => {
      let lx = p.x + p.normalX * barrierDist;
      let ly = p.y + p.normalY * barrierDist;
      if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    });
    ctx.closePath();
    ctx.stroke();
    // Borda direita
    ctx.beginPath();
    trackPath.forEach((p, i) => {
      let rx = p.x - p.normalX * barrierDist;
      let ry = p.y - p.normalY * barrierDist;
      if (i === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Postes de suporte do guardrail a cada ~6m
    for (let i = 0; i < totalPoints; i += 4) {
      let p = trackPath[i];
      // Poste esquerdo
      ctx.save();
      ctx.translate(p.x + p.normalX * barrierDist, p.y + p.normalY * barrierDist);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#4a5260';
      ctx.fillRect(-0.14, -0.85, 0.28, 0.85);
      ctx.fillStyle = '#7a8494';
      ctx.fillRect(-0.55, -0.25, 1.1, 0.22);
      ctx.restore();
      // Poste direito
      ctx.save();
      ctx.translate(p.x - p.normalX * barrierDist, p.y - p.normalY * barrierDist);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#4a5260';
      ctx.fillRect(-0.14, -0.85, 0.28, 0.85);
      ctx.fillStyle = '#7a8494';
      ctx.fillRect(-0.55, -0.25, 1.1, 0.22);
      ctx.restore();
    }
  }

  // 7. LINHA QUADRICULADA DE LARGADA / CHEGADA
  const startP = trackPath[0];
  ctx.save();
  ctx.translate(startP.x, startP.y);
  ctx.rotate(startP.angle + Math.PI / 2);

  const checkW = 1.5;
  for (let i = -trackWidth / 2; i < trackWidth / 2; i += checkW) {
    for (let j = -0.8; j < 0.8; j += 0.8) {
      ctx.fillStyle = ((Math.floor(i / checkW) + Math.floor(j / 0.8)) % 2 === 0) ? '#ffffff' : '#111111';
      ctx.fillRect(i, j, checkW, 0.8);
    }
  }
  ctx.restore();

  // 8. GRID DE LARGADA DEMARCADO (Slots 1º ao 20º em metros reais)
  for (let slot = 0; slot < 10; slot++) {
    let slotDist = 8 + slot * 9;
    let gridIdx = (totalPoints - Math.floor(slotDist * 2.5) + totalPoints) % totalPoints;
    let gp = trackPath[gridIdx];

    [-1, 1].forEach((colSide, colIdx) => {
      let slotNum = slot * 2 + colIdx + 1;
      let slotX = gp.x + (gp.normalX * colSide * 4.5);
      let slotY = gp.y + (gp.normalY * colSide * 4.5);

      ctx.save();
      ctx.translate(slotX, slotY);
      ctx.rotate(gp.angle);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 0.30;
      ctx.strokeRect(-2.6, -1.3, 5.2, 2.6);

      ctx.font = 'bold 1.1px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(slotNum.toString(), 0, 0.4);
      ctx.restore();
    });
  }

  // 9. PLACAS DE METROS DE FRENAGEM (150m, 100m, 50m)
  for (let i = 0; i < totalPoints; i += 35) {
    let p = trackPath[i];
    let nextP = trackPath[(i + 25) % totalPoints];
    if (nextP.curvature > 0.015) {
      let signX = p.x + p.normalX * (trackWidth / 2 + 3.2);
      let signY = p.y + p.normalY * (trackWidth / 2 + 3.2);

      ctx.save();
      ctx.translate(signX, signY);
      ctx.rotate(p.angle + Math.PI / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1.8, -0.7, 3.6, 1.4);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 0.9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('100m', 0, 0.35);
      ctx.restore();
    }
  }

  // 10. NOMES HISTÓRICOS DAS CURVAS DA PISTA
  const trackId = (selectedTrackData && selectedTrackData.id) || 21;
  const sectors = TRACK_SECTORS[trackId] || [];
  sectors.forEach(sec => {
    let pointIdx = Math.floor(sec.pct * totalPoints) % totalPoints;
    let sp = trackPath[pointIdx];
    if (sp) {
      ctx.save();
      ctx.translate(sp.x + sp.normalX * (trackWidth / 2 + 6.5), sp.y + sp.normalY * (trackWidth / 2 + 6.5));
      ctx.rotate(sp.angle);
      ctx.font = 'bold 1.4px sans-serif';
      ctx.fillStyle = '#00e5ff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.textAlign = 'center';
      ctx.fillText(sec.name, 0, 0);
      ctx.restore();
    }
  });
}
