import { trackDisplayName } from './trackPicker.js';

export function readLocalRecords(storage, tracks) {
  const records = new Map();
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const match = /^cr_f1_t(\d+)_l(\d+)_best_(lap|race)_time$/.exec(key);
      if (!match) continue;
      const track = tracks.find(track => track.id === Number(match[1]));
      const laps = Number(match[2]), time = Number(storage.getItem(key));
      if (!track || laps < 1 || laps > 80 || !Number.isFinite(time) || time <= 0) continue;
      const id = `${track.id}/${laps}`;
      if (!records.has(id)) records.set(id, { track, laps, lap: null, race: null });
      records.get(id)[match[3]] = time;
    }
  } catch { return { records: [], unavailable: true }; }
  return { records: [...records.values()].sort((a, b) => trackDisplayName(a.track).localeCompare(trackDisplayName(b.track), 'pt-BR') || a.laps - b.laps), unavailable: false };
}

export function formatRecordTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const millis = Math.round(seconds * 1000);
  return `${String(Math.floor(millis / 60000)).padStart(2, '0')}:${String(Math.floor(millis / 1000) % 60).padStart(2, '0')}.${String(millis % 1000).padStart(3, '0')}`;
}

export function initRecordsView(tracks) {
  const byId = id => document.getElementById(id);
  const tabs = [byId('tab-race'), byId('tab-records')];
  function refresh() {
    let result;
    try { result = readLocalRecords(localStorage, tracks); } catch { result = { records: [], unavailable: true }; }
    const { records, unavailable } = result;
    const query = byId('records-search').value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const filtered = records.filter(row => `${trackDisplayName(row.track)} ${row.track.location}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(query));
    byId('records-count').textContent = new Set(records.map(row => row.track.id)).size;
    byId('records-sessions').textContent = records.length;
    byId('records-rows').replaceChildren();
    for (const record of filtered) {
      const row = document.createElement('tr');
      const name = document.createElement('th'); name.scope = 'row';
      const title = document.createElement('strong'); title.textContent = trackDisplayName(record.track);
      const location = document.createElement('small'); location.textContent = record.track.location;
      name.append(title, location); row.append(name);
      for (const text of [`${record.laps} voltas`, formatRecordTime(record.lap), formatRecordTime(record.race)]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      byId('records-rows').append(row);
    }
    byId('records-table').hidden = !filtered.length;
    byId('records-empty').hidden = Boolean(filtered.length);
    byId('records-empty-title').textContent = unavailable ? 'Recordes indisponíveis.' : records.length ? 'Nenhum circuito encontrado.' : 'SEU PRIMEIRO TEMPO VEM AÍ.';
    byId('records-empty-description').textContent = unavailable ? 'O navegador bloqueou o acesso aos dados locais.' : records.length ? 'Tente buscar outro circuito ou cidade.' : 'Complete uma volta para marcar seu lugar aqui. Seus melhores tempos ficam salvos neste navegador.';
    byId('records-result').textContent = `${filtered.length} ${filtered.length === 1 ? 'registro' : 'registros'}`;
  }
  function activate(index, focus = false) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1;
      byId(tab.getAttribute('aria-controls')).hidden = i !== index;
    });
    if (index === 1) refresh();
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); activate(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
      }
    });
  });
  byId('records-search').addEventListener('input', refresh);
  byId('records-race').addEventListener('click', () => activate(0, true));
  window.addEventListener('storage', () => { if (!byId('records-panel').hidden) refresh(); });
  window.addEventListener('quick-grid:records-cleared', refresh);
  window.addEventListener('quick-grid:menu', () => { if (!byId('records-panel').hidden) refresh(); });
}
