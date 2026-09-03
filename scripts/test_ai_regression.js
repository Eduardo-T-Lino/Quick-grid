import { F1_TRACKS } from '../src/f1Tracks.js';
import { generateTrackPath } from '../src/track.js';
import { state } from '../src/game.js';
import { Car } from '../src/car.js';

console.log('====================================================');
console.log('🏎️  TESTE DE REGRESSÃO DE FÍSICA & AI DOS BOTS');
console.log('====================================================\n');

const testTracks = [
  { id: 21, name: 'Interlagos', laps: 2 },
  { id: 16, name: 'Monza', laps: 2 },
  { id: 14, name: 'Spa', laps: 2 },
  { id: 8,  name: 'Monaco', laps: 2 },
  { id: 4,  name: 'Suzuka', laps: 2 }
];

testTracks.forEach(({ id, name, laps }) => {
  generateTrackPath(id);
  const trackPath = state.trackPath;
  const totalTrackLen = state.totalTrackLength;

  // Reset car state for simulation
  state.keys = {};
  state.particles = [];
  state.skidMarks = [];
  state.floatingNotices = [];
  state.trackCondition = 'dry';
  state.gameMode = 'race';
  state.totalLaps = laps;

  const botCar = new Car('#ff0000', 'Bot_Regression_1', true, 0, true);
  state.cars = [botCar];

  // Run simulation at 60 FPS for 120 seconds (7200 frames) or until laps finished
  let frame = 0;
  const maxFrames = 60 * 120;
  let offTrackFrames = 0;
  let minSpeedInHairpin = Infinity;
  let maxSpeedInStraight = 0;

  while (frame < maxFrames && !botCar.finished && botCar.currentLap <= laps) {
    botCar.update();
    const spd = Math.hypot(botCar.vx, botCar.vy);
    if (spd > maxSpeedInStraight) maxSpeedInStraight = spd;
    if (spd < minSpeedInHairpin && spd > 0.1) minSpeedInHairpin = spd;
    if (botCar.currentSurface === 'GRAVEL' || botCar.currentSurface === 'RUNOFF') {
      offTrackFrames++;
    }
    frame++;
  }

  const speedKmhMax = Math.round((maxSpeedInStraight / 1.45) * 300);
  const speedKmhMin = Math.round((minSpeedInHairpin / 1.45) * 300);
  const completedLaps = botCar.currentLap - 1;

  console.log(`[TRACK ${id.toString().padStart(2)}] ${name.padEnd(12)}:`);
  console.log(`  - Points: ${trackPath.length}, Length: ${totalTrackLen.toFixed(1)}m`);
  console.log(`  - Laps completed: ${completedLaps}/${laps} in ${frame} frames (${(frame/60).toFixed(1)}s)`);
  console.log(`  - Max Speed: ${speedKmhMax} km/h | Min Apex Speed: ${speedKmhMin} km/h`);
  console.log(`  - Off-track frames: ${offTrackFrames} (${((offTrackFrames/frame)*100).toFixed(2)}%)`);
  
  if (offTrackFrames === 0) {
    console.log(`  ✅ Bot pilotou perfeitamente na pista durante todas as voltas.`);
  } else if (offTrackFrames < 60) {
    console.log(`  ✓ Bot teve ligeiro toque de borda (< 1s) e manteve controle total.`);
  } else {
    console.log(`  ⚠️ Bot teve saídas de pista excessivas (${offTrackFrames} frames).`);
  }
  console.log('');
});
