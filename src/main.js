import './styles/main.css';
import './styles/paddock.css';
import './styles/trackPicker.css';
import './styles/race.css';
import './styles/menus.css';
import './styles/raceSetup.css';
import './styles/auth.css';
import './styles/hud.css';
import './styles/online.css';
import './styles/controls.css';
import './styles/menuPages.css';
import { initMenuPages } from './menuPages.js';
import { createKeyboardControls } from './controlBindings.js';
import { initControlsSettings } from './controlsSettings.js';
import { initOnline } from './online/ui.js';
import { initAuth } from './auth.js';
import { initSessionControls } from './sessionControls.js';
import { initRecordsView } from './recordsView.js';
import { initMenuSelects } from './menuSelect.js';
import { initPaddock } from './paddock.js';
import { F1_TRACKS } from './f1Tracks.js';
import { state, resizeCanvas, startGame, backToMenu, clearRecords, toggleModeUI } from './game.js';
import { onlineUploader, mlTelemetry } from './ml/telemetry/index.js';
import { TELEMETRY_VERSIONS } from './constants.js';

const CONSENT_STORAGE_KEY = 'quick-grid-telemetry-consent';

function applyTelemetryConsent(granted) {
  try { localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
    consentGranted: Boolean(granted),
    consentVersion: TELEMETRY_VERSIONS.CONSENT_VERSION
  })); } catch { /* Consent remains valid only for this tab if persistence is unavailable. */ }
  onlineUploader.setConsent(Boolean(granted));
  if (!granted && mlTelemetry.onlineOnly) { mlTelemetry.enabled = false; mlTelemetry.clear(); }
  const status = document.getElementById('consent-status');
  if (status) status.textContent = onlineUploader.consentEnabled
    ? 'Telemetria online permitida. Você pode desativar quando quiser.'
    : (granted && !onlineUploader.deploymentAllowed
      ? 'Telemetria online indisponível neste preview.'
      : 'Telemetria online desativada. O jogo continua normalmente.');
}

function initTelemetryConsent() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)); } catch {}
  const valid = saved?.consentVersion === TELEMETRY_VERSIONS.CONSENT_VERSION;
  applyTelemetryConsent(valid && saved.consentGranted === true);
  document.getElementById('consent-allow')?.addEventListener('click', () => applyTelemetryConsent(true));
  document.getElementById('consent-deny')?.addEventListener('click', () => applyTelemetryConsent(false));
}

// ========== POPULATE TRACK SELECTOR DYNAMICALLY ==========
function populateTrackSelect() {
  const select = document.getElementById('trackSelect');
  if (!select) return;

  // Organizar pistas: favoritas primeiro (Interlagos, Spa, Monza, Suzuka, Monaco), depois por ID
  const favorites = [21, 14, 16, 4, 8, 12, 11, 19];
  const sorted = [...F1_TRACKS].sort((a, b) => {
    const aFav = favorites.indexOf(a.id);
    const bFav = favorites.indexOf(b.id);
    if (aFav !== -1 && bFav !== -1) return aFav - bFav;
    if (aFav !== -1) return -1;
    if (bFav !== -1) return 1;
    return a.id - b.id;
  });

  for (const track of sorted) {
    const opt = document.createElement('option');
    opt.value = track.id;
    opt.textContent = `${track.id === 21 ? 'Interlagos' : track.name} · ${track.lengthKm}`;
    if (track.id === 21) opt.selected = true; // Interlagos como padrão
    select.appendChild(opt);
  }
}

// ========== EVENT LISTENERS ==========
const keyboardControls = createKeyboardControls(() => state);
window.addEventListener('keydown', e => keyboardControls.down(e, Boolean(state.onlineSession?.menuOpen || e.target.closest?.('input, select, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]'))));
window.addEventListener('keyup', e => keyboardControls.up(e));
window.addEventListener('blur', keyboardControls.clear);
window.addEventListener('quick-grid:menu', keyboardControls.clear);
window.addEventListener('resize', resizeCanvas);

// ========== EXPOSE MENU FUNCTIONS TO HTML onclick ==========
window.startGame = startGame;
window.backToMenu = backToMenu;
window.clearRecords = clearRecords;
window.toggleModeUI = toggleModeUI;

// ========== INIT ==========
resizeCanvas();
populateTrackSelect();
initPaddock({ tracks: F1_TRACKS, startGame, clearRecords, toggleModeUI });
initMenuSelects();
initRecordsView(F1_TRACKS);
initSessionControls();
initTelemetryConsent();
initAuth();
initOnline();
initMenuPages();
initControlsSettings(keyboardControls.clear);
