// Cliente de Comunicação com a API Backend do Jogo

const API_BASE = 'http://localhost:3001/api';

export async function fetchTrackRecords(trackId, laps) {
  try {
    const res = await fetch(`${API_BASE}/records/${trackId}/${laps}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Backend indisponível, usando localStorage como fallback:', e.message);
    return null;
  }
}

export async function saveTrackRecords(data) {
  try {
    const res = await fetch(`${API_BASE}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Erro salvando recordes no backend:', e.message);
    return null;
  }
}

export async function fetchBotTrainingData() {
  try {
    const res = await fetch(`${API_BASE}/bots/training`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Erro obtendo dados dos bots:', e.message);
    return null;
  }
}

export async function saveBotTrainingData(botStats) {
  try {
    const res = await fetch(`${API_BASE}/bots/training`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botStats })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Erro salvando treino dos bots:', e.message);
    return null;
  }
}

export async function fetchLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Erro obtendo leaderboard:', e.message);
    return null;
  }
}

export async function fetchBotOffsetMemory() {
  try {
    const res = await fetch(`${API_BASE}/bots/offsets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    // Fallback: localStorage
    try {
      const raw = localStorage.getItem('bot_offset_memory');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
}

export async function saveBotOffsetMemory(offsetData) {
  // Salva no localStorage como fallback primário (sem depender do backend)
  try {
    localStorage.setItem('bot_offset_memory', JSON.stringify(offsetData));
  } catch { }
  // Tenta salvar no backend também
  try {
    const res = await fetch(`${API_BASE}/bots/offsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offsetData)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Salvando offset memory apenas no localStorage:', e.message);
    return null;
  }
}
