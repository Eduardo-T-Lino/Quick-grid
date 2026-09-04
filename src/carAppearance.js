// Artwork only. Metre-sized sprite bounds do not define collision geometry.
const sprites = new WeakMap();
const SCALE = 40, WIDTH = 6.4, HEIGHT = 3.2;
function polygon(ctx, points, color) {
  ctx.fillStyle = color; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fill();
}
function createSprite(car) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE; canvas.height = HEIGHT * SCALE;
  const c = canvas.getContext('2d');
  c.scale(SCALE, SCALE); c.translate(WIDTH / 2, HEIGHT / 2);
  // Sharp, baked shadow; no per-frame blur or gradient creation.
  c.fillStyle = '#0007'; c.beginPath(); c.roundRect(-2.7, -.96, 5.55, 2.14, .45); c.fill();
  c.fillStyle = '#070a10'; c.fillRect(-1.9, -1.06, 1.0, 2.12);
  polygon(c, [[-2.55,-.84],[-2.16,-1.03],[1.8,-1.03],[2.62,-.68],[2.73,-.48],[2.73,.48],[2.62,.68],[1.8,1.03],[-2.16,1.03],[-2.55,.84]], '#0b111b');
  const paint = c.createLinearGradient(0, -1, 0, 1);
  paint.addColorStop(0, '#ecf2ff'); paint.addColorStop(.09, car.color);
  paint.addColorStop(.72, car.color); paint.addColorStop(1, '#111b2c');
  polygon(c, [[-2.36,-.67],[-1.98,-.95],[-1.12,-.92],[-.72,-.78],[.9,-.78],[1.18,-.94],[1.96,-.89],[2.38,-.54],[2.46,0],[2.38,.54],[1.96,.89],[1.18,.94],[.9,.78],[-.72,.78],[-1.12,.92],[-1.98,.95],[-2.36,.67]], paint);
  // Contrasting endurance livery, closed GT cockpit and glass reflections.
  polygon(c, [[-2.3,-.16],[2.34,-.16],[2.4,.06],[-2.3,.06]], '#f6efe6');
  polygon(c, [[-2.3,.1],[2.37,.1],[2.31,.18],[-2.3,.18]], '#13243a');
  polygon(c, [[-1.24,-.61],[.48,-.67],[1.04,-.45],[1.04,.45],[.48,.67],[-1.24,.61],[-1.5,.38],[-1.5,-.38]], '#060d17');
  polygon(c, [[.38,-.59],[.91,-.4],[.91,.4],[.38,.59]], '#7198b6');
  polygon(c, [[.4,-.56],[.91,-.4],[.82,-.27],[.4,-.42]], '#bed7e6');
  polygon(c, [[-1.15,-.5],[-.92,-.56],[-.92,.56],[-1.15,.5],[-1.36,.28],[-1.36,-.28]], '#41617f');
  c.fillStyle = car.color; c.beginPath(); c.roundRect(-.86, -.49, 1.12, .98, .16); c.fill();
  c.fillStyle = '#f2eee7'; c.fillRect(-.62,-.3,.58,.6);
  c.save(); c.translate(-.33, 0); c.rotate(Math.PI / 2); c.font = 'bold .43px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#152032';
  // Stable number from the existing anonymous grid index; never a physics field.
  c.fillText(String(Number(car.participantId?.split('_')[1] || 0) + 1).padStart(2, '0'), 0, .01); c.restore();
  for (const side of [-1, 1]) {
    c.fillStyle = '#0b1119'; c.fillRect(1.29, side * .57 - .1, .52, .2);
    c.fillStyle = '#122137'; c.fillRect(-2.0, side * .61 - .09, .52, .18);
    c.fillStyle = '#d3edff'; c.fillRect(1.99, side * .53 - .07, .27, .14);
    c.fillStyle = '#e9f8ff'; c.fillRect(2.24, side * .43 - .06, .09, .12);
    c.fillStyle = '#0b111b'; c.fillRect(.54, side * .98 - .1, .3, .2);
    c.fillStyle = '#c5d1db'; c.fillRect(.64, side * .99 - .065, .12, .13);
    c.fillStyle = '#561821'; c.fillRect(-2.33, side * .53 - .045, .11, .28);
  }
  // Rear diffuser fins, wing mounts and carbon wing.
  c.fillStyle = '#080d14';
  for (let i = -3; i <= 3; i++) c.fillRect(-2.62, i * .2, .35, .055);
  c.fillStyle = '#141d2a'; c.fillRect(-2.33, -.6, .3, .1); c.fillRect(-2.33, .5, .3, .1);
  c.fillStyle = '#070c14'; c.fillRect(-2.6,-1.06,.33,2.12);
  c.fillStyle = '#6a7b90'; c.fillRect(-2.59,-1.06,.055,2.12);
  c.fillStyle = car.color; c.fillRect(-2.66,-1.1,.44,.1); c.fillRect(-2.66,1,.44,.1);
  return canvas;
}
export function getCarSprite(car) {
  let cached = sprites.get(car);
  if (!cached || cached.color !== car.color) {
    cached = { color: car.color, canvas: createSprite(car) };
    sprites.set(car, cached);
  }
  return cached.canvas;
}
export function drawCarAppearance(ctx, car, pose = car) {
  ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(pose.angle);
  ctx.drawImage(getCarSprite(car), -WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT);
  // Steering and braking stay live, drawn on top of the baked body.
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(1.4, side * .95); ctx.rotate((car.steerAmount || 0) * .35);
    ctx.fillStyle = '#080b10'; ctx.fillRect(-.38,-.19,.75,.38);
    ctx.fillStyle = '#657386'; ctx.fillRect(-.12,-.12,.22,.24);
    ctx.restore();
  }
  if (car.brakePressure > .1 || car.currentSurface === 'GRAVEL') {
    ctx.fillStyle = '#ff483b'; ctx.fillRect(-2.39,-.68,.1,.28); ctx.fillRect(-2.39,.4,.1,.28);
    ctx.fillRect(-2.66,-.12,.1,.24);
  }
  ctx.restore();
}
