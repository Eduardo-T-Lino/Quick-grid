// Sistema de Câmera em 3ª Pessoa (Top-Down Chase View Alinhada com a Frente do Carro)
// Acompanha o monoposto com rotação suave e visão panorâmica da pista.

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.rotation = 0;
    this.targetRotation = 0;
    this.zoom = 8.8;          // Pixels por metro: enquadramento mais distante e legível
    this.targetZoom = 8.8;
    this.smoothFactor = 0.10;
    this.rotationSmoothFactor = 0.08;
    this.zoomSmoothFactor = 0.04;
    this.lookaheadDist = 24;  // Metros à frente
  }

  update(targetCar, canvas) {
    if (!targetCar) return;

    let speed = Math.hypot(targetCar.vx, targetCar.vy);
    let speedRatio = Math.min(1.0, speed / 1.65);

    // Lookahead suave
    let lookX = Math.cos(targetCar.angle) * (speedRatio * this.lookaheadDist);
    let lookY = Math.sin(targetCar.angle) * (speedRatio * this.lookaheadDist);

    this.targetX = targetCar.x + lookX * 0.45;
    this.targetY = targetCar.y + lookY * 0.45;

    // Rotação suave: carro aponta para CIMA na tela
    this.targetRotation = -(targetCar.angle + Math.PI / 2);

    let diff = this.targetRotation - this.rotation;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.rotation += diff * this.rotationSmoothFactor;

    // Zoom adaptativo: mais contexto em baixa e alta velocidade.
    this.targetZoom = 9.2 - (speedRatio * 2.8);

    // Interpolação de posição e zoom
    this.x += (this.targetX - this.x) * this.smoothFactor;
    this.y += (this.targetY - this.y) * this.smoothFactor;
    this.zoom += (this.targetZoom - this.zoom) * this.zoomSmoothFactor;
  }

  apply(ctx, canvas) {
    ctx.save();
    // Centro da tela com leve offset para frente (+50px) para enquadrar a pista
    ctx.translate(canvas.width / 2, canvas.height / 2 + 50);
    ctx.rotate(this.rotation);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restore(ctx) {
    ctx.restore();
  }

  screenToWorld(screenX, screenY, canvas) {
    let centeredX = (screenX - canvas.width / 2) / this.zoom;
    let centeredY = (screenY - (canvas.height / 2 + 50)) / this.zoom;

    let cos = Math.cos(-this.rotation);
    let sin = Math.sin(-this.rotation);
    let unrotX = centeredX * cos - centeredY * sin;
    let unrotY = centeredX * sin + centeredY * cos;

    return {
      x: unrotX + this.x,
      y: unrotY + this.y
    };
  }

  isVisible(worldX, worldY, radiusMeters, canvas) {
    let maxDim = Math.max(canvas.width, canvas.height);
    let halfSpan = (maxDim / 2) / this.zoom + radiusMeters + 25;
    return (
      worldX >= this.x - halfSpan &&
      worldX <= this.x + halfSpan &&
      worldY >= this.y - halfSpan &&
      worldY <= this.y + halfSpan
    );
  }
}

export const mainCamera = new Camera();
