const icons = {
  race: '<path d="M4 20V5m0 0c4-4 8 4 16 0v9c-8 4-12-4-16 0M9 4v9m6-8v9M4 9c4-4 8 4 16 0"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3m6 1 2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  rain: '<path d="M6 15a4 4 0 0 1-.5-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9H6m2 3-1 3m6-3-1 3m6-3-1 3"/>',
  auto: '<path d="M5 8a8 8 0 0 1 14-1l2 3m0-5v5h-5M3 14l2 3a8 8 0 0 0 14-1M3 19v-5h5m1 1 3-7 3 7m-5-2h4"/>',
  manual: '<path d="M6 4v16m12-16v16M6 12h12m-6-8v8"/><circle cx="6" cy="4" r="1"/><circle cx="18" cy="4" r="1"/>',
};
const choices = {
  gameMode: { style: 'cards', items: [['Corrida', 'Dispute posições no grid', 'race'], ['Contrarrelógio', 'Supere seu melhor tempo', 'clock']] },
  trackCondition: { style: 'compact', items: [['Seca', 'Pneus slick', 'sun'], ['Molhada', 'Pista de chuva', 'rain']] },
  transMode: { style: 'compact', items: [['Automática', 'Troca assistida', 'auto'], ['Manual', 'Você nas marchas', 'manual']] },
  botCount: { style: 'numbers', items: [['1', 'Duelo'], ['3', 'Grid curto'], ['19', 'Grid completo']] }
};
const difficultyNotes = ['Um ritmo mais tranquilo para começar.', 'Mais ritmo e disputa por cada posição.', 'O ritmo mais forte dos adversários.'];
function icon(name) {
  const span = document.createElement('span'); span.className = 'config-icon'; span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  return span;
}
function bars(level) {
  const span = document.createElement('span'); span.className = 'level-bars'; span.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) { const bar = document.createElement('i'); bar.classList.toggle('lit', i < level); span.append(bar); }
  return span;
}
function choiceCopy(title, description) {
  const copy = document.createElement('span'); copy.className = 'choice-copy';
  const strong = document.createElement('strong'); strong.textContent = title;
  const small = document.createElement('small'); small.textContent = description; copy.append(strong, small); return copy;
}
function checkMark() {
  const mark = document.createElement('span'); mark.className = 'choice-check'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true'); return mark;
}
// Keep native select values/events as the shared source of truth.
export function initMenuSelects() {
  let closeActive = () => {};
  const refreshers = [];
  document.querySelectorAll('.race-setup select:not(#trackSelect)').forEach(select => {
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.id ||= `${select.id}-label`;
    const shell = document.createElement('div'); shell.className = 'menu-select';
    if (choices[select.id]) {
      const config = choices[select.id];
      shell.className = `config-choices config-choices--${config.style}`;
      shell.setAttribute('role', 'radiogroup'); shell.setAttribute('aria-labelledby', label.id);
      select.after(shell); select.hidden = true; label.removeAttribute('for');
      const choose = i => {
        if (select.disabled || select.options[i].disabled) return;
        select.selectedIndex = i; select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const buttons = config.items.map(([title, detail, symbol], i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'config-choice';
        button.id = `${select.id}-option-${i}`; button.setAttribute('role', 'radio');
        if (symbol) button.append(icon(symbol));
        button.append(choiceCopy(title, detail), checkMark());
        button.addEventListener('click', () => choose(i));
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (i + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
          choose(next); buttons[next].focus();
        });
        shell.append(button); return button;
      });
      const refresh = () => {
        shell.setAttribute('aria-disabled', String(select.disabled));
        buttons.forEach((button, i) => {
          const selected = i === select.selectedIndex;
          button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
          button.disabled = select.disabled || select.options[i].disabled;
        });
      };
      select.addEventListener('change', refresh); refreshers.push(refresh); refresh();
      return;
    }
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = `${select.id}-trigger`; trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}-value`);
    trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${select.id}-options`);
    const copy = choiceCopy('', '');
    const value = copy.querySelector('strong'); value.id = `${trigger.id}-value`;
    const hint = copy.querySelector('small'); hint.id = `${trigger.id}-hint`; trigger.setAttribute('aria-describedby', hint.id);
    const level = bars(3);
    const arrow = document.createElement('span'); arrow.className = 'select-arrow'; arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 8 5 5 5-5"/></svg>';
    trigger.append(level, copy, arrow);
    const list = document.createElement('div'); list.id = `${select.id}-options`; list.className = 'select-options'; list.hidden = true;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-labelledby', label.id);
    select.after(shell); shell.append(trigger, list); select.hidden = true; label.htmlFor = trigger.id;
    let active = select.selectedIndex;
    const options = [...select.options].map((option, i) => {
      const row = document.createElement('div'); row.id = `${select.id}-option-${i}`; row.className = 'select-option';
      row.setAttribute('role', 'option');
      row.append(bars(i + 1), choiceCopy(option.textContent, difficultyNotes[i]), checkMark());
      row.addEventListener('click', () => choose(i)); list.append(row); return row;
    });
    function refresh() {
      value.textContent = select.selectedOptions[0]?.textContent || '';
      hint.textContent = difficultyNotes[select.selectedIndex];
      [...level.children].forEach((bar, i) => bar.classList.toggle('lit', i <= select.selectedIndex));
      trigger.disabled = select.disabled;
      options.forEach((row, i) => { row.setAttribute('aria-selected', String(i === select.selectedIndex)); row.classList.toggle('is-active', i === active); });
      if (select.disabled) close();
    }
    function close() { list.hidden = true; shell.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant'); }
    function highlight(index) {
      active = Math.max(0, Math.min(options.length - 1, index)); refresh();
      trigger.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      closeActive(); closeActive = close;
      const rect = trigger.getBoundingClientRect(), below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
      shell.dataset.side = below < 245 && above > below ? 'above' : 'below';
      list.style.maxHeight = `${Math.max(80, Math.min(260, shell.dataset.side === 'above' ? above : below))}px`;
      list.hidden = false; shell.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true'); highlight(select.selectedIndex);
    }
    function choose(index) {
      if (select.disabled || select.options[index].disabled) return;
      select.selectedIndex = index; active = index;
      select.dispatchEvent(new Event('change', { bubbles: true })); refresh(); close(); trigger.focus();
    }
    trigger.addEventListener('click', () => list.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      const key = event.key;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        if (list.hidden) open();
        else highlight(key === 'Home' ? 0 : key === 'End' ? options.length - 1 : active + (key === 'ArrowDown' ? 1 : -1));
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault(); list.hidden ? open() : choose(active);
      } else if (key === 'Escape') { event.preventDefault(); close(); }
      else if (key === 'Tab') close();
      else if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
        const found = [...select.options].findIndex(option => option.text.toLocaleLowerCase().startsWith(key.toLocaleLowerCase()));
        if (found >= 0) { event.preventDefault(); if (list.hidden) open(); highlight(found); }
      }
    });
    list.addEventListener('pointerdown', event => event.preventDefault());
    shell.addEventListener('focusout', event => { if (!shell.contains(event.relatedTarget)) close(); });
    select.addEventListener('change', refresh); refreshers.push(refresh); refresh();
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-select')) closeActive(); });
  document.querySelector('.race-setup').addEventListener('change', () => refreshers.forEach(refresh => refresh()));
}
