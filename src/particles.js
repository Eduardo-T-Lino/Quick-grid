import { ctx } from './canvas.js';

export class Particle {
  constructor(x, y, vx, vy, color, life, size = 0.35) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.life = life; this.maxLife = life;
    this.size = size;
  }
  update() { this.x += this.vx; this.y += this.vy; this.life--; }
  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife) * 0.75;
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export class SparkParticle {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx + (Math.random() - 0.5) * 0.3;
    this.vy = vy + (Math.random() - 0.5) * 0.3;
    this.life = 14 + Math.floor(Math.random() * 8);
    this.maxLife = this.life;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.90; this.vy *= 0.90;
    this.life--;
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.fillStyle = '#ffaa00';
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 3;
    ctx.beginPath(); ctx.arc(this.x, this.y, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export class FloatingNotice {
  constructor(x, y, text, color = '#ffd700') {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 60; this.maxLife = 60;
  }
  update() { this.y -= 0.08; this.life--; }
  draw() {
    ctx.save();
    let alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 1.1px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color;
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}
