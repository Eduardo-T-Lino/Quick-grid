import assert from 'node:assert/strict';
import { normalizeLaps, playerSteering, excludePauseTime } from '../src/raceSettings.js';
import { readLocalRecords, formatRecordTime } from '../src/recordsView.js';
import { F1_TRACKS } from '../src/f1Tracks.js';

let passed = 0;
const test = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`); };
test('lap count supports every integer from 3 through 80 and clamps invalid values', () => {
  for (let i = 3; i <= 80; i++) assert.equal(normalizeLaps(String(i)), i);
  for (const value of ['', null, undefined, 'oops', Infinity, -1, 1, 2]) assert.equal(normalizeLaps(value), 3);
  assert.equal(normalizeLaps(100), 80); assert.equal(normalizeLaps(10.8), 10);
});
test('steering builds progressively, is symmetric, firmer at speed, with full low-speed lock', () => {
  let slow = 0, fast = 0, left = 0, previous = 0;
  for (let i = 0; i < 300; i++) {
    slow = playerSteering(slow, 1, 0); fast = playerSteering(fast, 1, 1); left = playerSteering(left, -1, 1);
    assert.ok(fast >= previous && fast < slow && slow <= 1); assert.equal(fast, -left); previous = fast;
  }
  assert.ok(slow > .999); assert.ok(fast > .879 && fast < .881);
  assert.ok(playerSteering(0, 1, 1) < .1);
});
test('steering recentres completely and opposite lock remains reachable', () => {
  let steer = .88;
  for (let i = 0; i < 60; i++) steer = playerSteering(steer, 0, 1);
  assert.equal(steer, 0);
  for (let i = 0; i < 60; i++) steer = playerSteering(steer, -1, 1);
  assert.ok(steer < -.85);
});
test('pause excludes elapsed wall time from cars, AI sectors, telemetry laps and finish deadline', () => {
  const state = { finishDeadline: 50000, cars: [
    { raceStartTime: 100, lapStartTime: 200, totalRaceTime: 1, brain: { sectorEntryTime: 300 } },
    { raceStartTime: 100, lapStartTime: 200, finished: true },
    { raceStartTime: 0, lapStartTime: 0 }
  ] };
  const sequence = { nextAt: Infinity, releasedAt: 100 };
  const tracker = { startTime: 200 };
  const collector = { lastSampleTime: 1000, session: { activeLapTrackers: new Map([['player', tracker]]) } };
  excludePauseTime(state, sequence, collector, 30000);
  assert.equal(state.cars[0].raceStartTime, 30100); assert.equal(state.cars[0].lapStartTime, 30200);
  assert.equal(state.cars[0].totalRaceTime, 1); assert.equal(state.cars[0].brain.sectorEntryTime, 30300);
  assert.equal(state.cars[1].raceStartTime, 100); assert.equal(state.cars[2].raceStartTime, 0);
  assert.equal(state.finishDeadline, 80000); assert.equal(tracker.startTime, 30200); assert.equal(collector.lastSampleTime, 31000);
  assert.equal(sequence.nextAt, Infinity); assert.equal(sequence.releasedAt, 30100);
});
test('countdown pause preserves the remaining delay and supports repeated pauses', () => {
  const sequence = { nextAt: 1200, releasedAt: null, lights: 3 };
  excludePauseTime({ cars: [] }, sequence, {}, 5000);
  excludePauseTime({ cars: [] }, sequence, {}, 3000);
  assert.equal(sequence.nextAt, 9200); assert.equal(sequence.releasedAt, null); assert.equal(sequence.lights, 3);
});
test('records retain legacy distances and do not require a ghost path', () => {
  const entries = new Map([
    ['cr_f1_t21_l3_best_lap_time', '84.251'], ['cr_f1_t21_l3_best_race_time', '260.157'],
    ['cr_f1_t21_l1_best_lap_time', '80'], ['cr_f1_t14_l80_best_race_time', '9999'],
    ['cr_f1_t999_l3_best_lap_time', '10'], ['cr_f1_t21_l81_best_lap_time', '10'],
    ['cr_f1_t21_l5_best_lap_time', 'NaN'], ['cr_f1_t21_l6_best_lap_time', '-10'],
    ['cr_f1_t21_l7_best_lap_time', '0'], ['unrelated', '123']
  ]);
  const storage = { length: entries.size, key: i => [...entries.keys()][i], getItem: key => entries.get(key) };
  const { records, unavailable } = readLocalRecords(storage, F1_TRACKS);
  assert.equal(unavailable, false); assert.equal(records.length, 3);
  assert.equal(records.find(row => row.laps === 3).race, 260.157);
  assert.equal(records.find(row => row.laps === 1).lap, 80);
  assert.equal(entries.size, 10);
});
test('blocked local storage yields an explicit unavailable state', () => {
  assert.deepEqual(readLocalRecords({ get length() { throw Error('blocked'); } }, F1_TRACKS), { records: [], unavailable: true });
});
test('record formatting carries millisecond rounding and supports long 80-lap sessions', () => {
  assert.equal(formatRecordTime(59.9999), '01:00.000');
  assert.equal(formatRecordTime(84.251), '01:24.251');
  assert.equal(formatRecordTime(7200), '120:00.000');
  assert.equal(formatRecordTime(null), '—'); assert.equal(formatRecordTime(NaN), '—');
});
console.log(`${passed} PASSOU | 0 FALHOU`);
