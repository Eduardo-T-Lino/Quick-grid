import { SIMULATION_FINGERPRINT_SHA256 } from '../ml/lineage/baselineManifest.js';
export const ONLINE_VERSION = `qg-online-2/${SIMULATION_FINGERPRINT_SHA256}`;
export const ONLINE_LIMITS = Object.freeze({ players: 8, rooms: 16, rounds: 12, voteMs: 20000, reconnectMs: 20000 });
export const INPUT_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'];
export const CAR_FIELDS = ['x', 'y', 'z', 'angle', 'vx', 'vy', 'yawRate', 'gear', 'rpm', 'steerAmount',
  'tyreTemp', 'tyreWear', 'brakePressure', 'boostCharge', 'boostActive', 'boostCooldown', 'boostNeedsRelease',
  'wakeIntensity', 'rearSlip', 'tcActive', 'absActive', 'currentSurface', 'currentLap', 'currentLapTime',
  'totalRaceTime', 'finished', 'rank', 'progress', 'isAuto'];
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
export const validPilot = value => typeof value === 'string' && /^[\p{L}\p{N} ._'’-]{2,24}$/u.test(value.trim());
