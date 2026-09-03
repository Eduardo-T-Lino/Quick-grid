// Canvas singleton – all modules import from here to avoid circular deps
export const canvas = typeof document !== 'undefined' ? document.getElementById('gameCanvas') : null;
export const ctx = canvas ? canvas.getContext('2d') : null;
