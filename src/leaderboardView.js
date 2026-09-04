// Keep five DOM rows alive. Speed/gap updates no longer parse and replace the whole HUD.
export function createLeaderboardView(root) {
  const make = (tag, className) => { const node = document.createElement(tag); node.className = className; return node; };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const title = make('div', 'leader-title');
  const gap = make('div', 'leader-gap');
  const ghost = make('div', 'leader-ghost');
  const rows = Array.from({ length: 5 }, () => {
    const node = make('div', 'leader-row');
    const name = make('span', 'leader-name'), speed = make('span', 'leader-speed');
    node.append(name, speed); return { node, name, speed, color: null, player: null };
  });
  root.replaceChildren(title, gap, ghost, ...rows.map(row => row.node));
  return state => {
    const p1 = state.cars[0];
    const race = state.gameMode === 'race';
    text(title, state.selectedTrackData?.location || (race ? 'CORRIDA GT3' : 'CONTRATEMPO GT3'));
    ghost.hidden = race;
    if (!race) {
      text(ghost, `⚡ Melh. Volta: ${state.bestLapTime ? state.bestLapTime.toFixed(2) + 's' : '--'}`);
      gap.hidden = true; rows.forEach(row => { row.node.hidden = true; }); return;
    }
    const sorted = [...state.cars].sort((a, b) => a.rank - b.rank);
    const total = sorted.length, rank = p1.rank;
    const start = rank <= 1 ? 0 : rank >= total ? Math.max(0, total - 5) : Math.max(0, rank - 3);
    const end = rank <= 1 ? Math.min(total - 1, 4) : rank >= total ? total - 1 : Math.min(total - 1, rank + 1);
    const ahead = sorted.find(car => car.rank === rank - 1);
    gap.hidden = !ahead || ahead.finished;
    if (!gap.hidden) {
      const distance = Math.hypot(ahead.x - p1.x, ahead.y - p1.y), rounded = Math.round(distance);
      text(gap, `▲ ${ahead.name.split(' ').pop()} — ${rounded < 1000 ? rounded + 'm' : (distance / 1000).toFixed(1) + 'km'}`);
    }
    rows.forEach((row, i) => {
      const car = i <= end - start ? sorted[start + i] : null;
      row.node.hidden = !car;
      if (!car) return;
      if (row.color !== car.color) { row.node.style.color = car.color; row.color = car.color; }
      const player = !car.isBot;
      if (row.player !== player) { row.node.classList.toggle('is-player', player); row.player = player; }
      text(row.name, `${car.rank}º ${player ? '▶ ' : ''}${car.name.split(' ').pop()}`);
      text(row.speed, `${car.getKmh()} km/h`);
    });
  };
}
