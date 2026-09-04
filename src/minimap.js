// Minimapa HUD Vetorial de Alta Resolução em Tempo Real
// Mapeia circuitos de 3.3km a 7.0km com marcadores precisos para jogador, bots e ghost.

const mapGeometry = new WeakMap();
const mapWidth = 240, mapHeight = 180, padding = 16;

export function getMinimapGeometry(trackPath) {
  if (mapGeometry.has(trackPath)) return mapGeometry.get(trackPath);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of trackPath) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const worldWidth = (maxX - minX) || 1, worldHeight = (maxY - minY) || 1;
  const innerW = mapWidth - padding * 2, innerH = mapHeight - padding * 2 - 14;
  const scale = Math.min(innerW / worldWidth, innerH / worldHeight);
  const offsetX = padding + (innerW - worldWidth * scale) / 2;
  const offsetY = padding + 16 + (innerH - worldHeight * scale) / 2;
  const toMapX = wx => offsetX + (wx - minX) * scale;
  const toMapY = wy => offsetY + (wy - minY) * scale;
  const path = new Path2D();
  trackPath.forEach((p, i) => {
    if (i === 0) path.moveTo(toMapX(p.x), toMapY(p.y));
    else path.lineTo(toMapX(p.x), toMapY(p.y));
  });
  path.closePath();
  const geometry = { path, toMapX, toMapY };
  mapGeometry.set(trackPath, geometry);
  return geometry;
}

export function drawMinimap(ctx, canvas, state) {
  const { trackPath, cars, selectedTrackData, bestLapPath, ghostLapFrameIndex, gameMode } = state;
  if (!trackPath || trackPath.length === 0) return;

  // Local coordinates let the same geometry follow viewport resizes without rebuilding it.
  const posX = 0, posY = 0;
  const { path, toMapX, toMapY } = getMinimapGeometry(trackPath);

  // 1. Fundo Glassmorphism Translúcido
  ctx.save();
  ctx.translate(16, canvas.height - mapHeight - 16);
  ctx.fillStyle = 'rgba(10, 14, 20, 0.88)';
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(posX, posY, mapWidth, mapHeight, 10);
  ctx.fill();
  ctx.stroke();

  // Cabeçalho do Minimapa com Nome Oficial e Extensão Real em KM
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#00e5ff';
  ctx.textAlign = 'left';
  const trackLoc = selectedTrackData ? selectedTrackData.location : 'Circuito GT3';
  const trackLen = selectedTrackData ? selectedTrackData.lengthKm : '';
  ctx.fillText(trackLoc, posX + 10, posY + 16);

  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#8899aa';
  ctx.textAlign = 'right';
  ctx.fillText(trackLen, posX + mapWidth - 10, posY + 16);

  // 2/3. Reuse the full-resolution outline; markers remain live on every frame.

  // Contorno externo suave
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);

  // Linha central brilhante
  ctx.strokeStyle = '#b0d4ff';
  ctx.lineWidth = 2.5;
  ctx.stroke(path);

  // Linha de largada/chegada no minimapa
  const startP = trackPath[0];
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.arc(toMapX(startP.x), toMapY(startP.y), 4, 0, Math.PI * 2);
  ctx.fill();

  // 4. Carro Fantasma (Modo Ghost)
  if (gameMode === 'ghost' && bestLapPath && bestLapPath.length > 0) {
    let ghostP = bestLapPath[ghostLapFrameIndex];
    if (ghostP) {
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.arc(toMapX(ghostP.x), toMapY(ghostP.y), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 5. Bots / Adversários
  cars.forEach((car) => {
    if (car.finished) return;
    let mx = toMapX(car.x);
    let my = toMapY(car.y);

    if (car.isBot) {
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(mx, my, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // 6. Jogador Principal (Com Anel Pulsante Vermelho/Branco)
  const player = cars[0];
  if (player && !player.finished) {
    let pmx = toMapX(player.x);
    let pmy = toMapY(player.y);

    let pulseRadius = 5.5 + Math.sin(performance.now() * 0.009) * 2.2;
    ctx.strokeStyle = 'rgba(255, 34, 34, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pmx, pmy, pulseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ff2222';
    ctx.beginPath();
    ctx.arc(pmx, pmy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}
