// Circuit browsing is presentation-only. The existing select remains authoritative.
const SHORT_NAMES = { 21: 'Interlagos', 14: 'Spa-Francorchamps', 16: 'Monza', 4: 'Suzuka', 8: 'Monaco' };
const FEATURED = [21, 14, 16, 4, 8, 12, 11, 19];
export const trackDisplayName = track => SHORT_NAMES[track.id] || track.name;
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function filterTracks(tracks, query = '', featuredOnly = false) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return tracks.filter(track => (!featuredOnly || FEATURED.includes(track.id)) &&
    words.every(word => normalize(`${trackDisplayName(track)} ${track.name} ${track.location}`).includes(word)))
    .sort((a, b) => {
      const ai = FEATURED.indexOf(a.id), bi = FEATURED.indexOf(b.id);
      return (ai < 0 ? FEATURED.length : ai) - (bi < 0 ? FEATURED.length : bi) || a.id - b.id;
    });
}

export function initTrackPicker(tracks, createPreview) {
  const byId = id => document.getElementById(id);
  const select = byId('trackSelect');
  const trigger = byId('track-picker-open');
  const dialog = byId('track-dialog');
  const search = byId('track-search');
  const grid = byId('track-grid');
  const filters = [...dialog.querySelectorAll('[data-track-filter]')];
  let featuredOnly = false;
  const cards = new Map();
  const svgNS = 'http://www.w3.org/2000/svg';

  for (const track of tracks) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-option';
    button.dataset.trackId = track.id;
    button.setAttribute('aria-label', `Escolher ${trackDisplayName(track)}, ${track.location}, ${track.lengthKm}`);
    const heading = document.createElement('span');
    heading.className = 'track-option-meta';
    const number = document.createElement('span');
    number.textContent = String(track.id).padStart(2, '0');
    const status = document.createElement('span');
    status.className = 'track-option-status';
    heading.append(number, status);
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 320 200');
    svg.setAttribute('aria-hidden', 'true');
    const preview = createPreview(track);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', preview.path);
    const start = document.createElementNS(svgNS, 'circle');
    start.setAttribute('cx', preview.start.x);
    start.setAttribute('cy', preview.start.y);
    start.setAttribute('r', '4');
    svg.append(path, start);
    const name = document.createElement('strong');
    name.textContent = trackDisplayName(track);
    const location = document.createElement('span');
    location.className = 'track-option-location';
    location.textContent = track.location;
    const length = document.createElement('span');
    length.className = 'track-option-length';
    length.textContent = `${track.lengthKm} / ${track.elevationDiff} de desnível`;
    button.append(heading, svg, name, location, length);
    button.addEventListener('click', () => {
      select.value = String(track.id);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      dialog.close();
    });
    cards.set(track.id, { button, status });
  }

  function syncSelection() {
    const track = tracks.find(item => item.id === Number(select.value));
    if (!track) return;
    byId('track-picker-name').textContent = trackDisplayName(track);
    byId('track-picker-detail').textContent = `${track.location} · ${track.lengthKm}`;
    byId('track-picker-path').setAttribute('d', createPreview(track).path);
    trigger.setAttribute('aria-label', `Trocar circuito. Selecionado: ${trackDisplayName(track)}`);
    for (const [id, { button, status }] of cards) {
      const active = id === track.id;
      button.setAttribute('aria-pressed', String(active));
      status.textContent = active ? '✓ SELECIONADO' : 'ESCOLHER ↗';
    }
  }
  function renderResults() {
    const matches = filterTracks(tracks, search.value, featuredOnly);
    grid.replaceChildren(...matches.map(track => cards.get(track.id).button));
    byId('track-results').textContent = `${matches.length} ${matches.length === 1 ? 'circuito disponível' : 'circuitos disponíveis'}`;
    byId('track-empty').hidden = matches.length !== 0;
    for (const filter of filters) filter.setAttribute('aria-pressed', String((filter.dataset.trackFilter === 'featured') === featuredOnly));
  }
  trigger.addEventListener('click', () => {
    search.value = '';
    featuredOnly = false;
    renderResults();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    byId('track-catalogue').scrollTop = 0;
    search.focus({ preventScroll: true });
  });
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  filters.forEach(filter => filter.addEventListener('click', () => {
    featuredOnly = filter.dataset.trackFilter === 'featured';
    renderResults();
  }));
  search.addEventListener('input', renderResults);
  byId('track-search-reset').addEventListener('click', () => {
    search.value = '';
    featuredOnly = false;
    renderResults();
    search.focus();
  });
  select.addEventListener('change', syncSelection);
  syncSelection();
  select.hidden = true;
  byId('track-field-label').htmlFor = trigger.id;
  trigger.hidden = false;
}
