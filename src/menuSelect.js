// Keep native select values/events as the shared source of truth.
export function initMenuSelects() {
  let closeActive = () => {};
  const refreshers = [];
  document.querySelectorAll('.race-setup select:not(#trackSelect)').forEach(select => {
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.id ||= `${select.id}-label`;
    const shell = document.createElement('div'); shell.className = 'menu-select';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = `${select.id}-trigger`; trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}-value`);
    trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${select.id}-options`);
    const value = document.createElement('span'); value.id = `${trigger.id}-value`;
    const arrow = document.createElement('span'); arrow.className = 'select-arrow'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
    trigger.append(value, arrow);
    const list = document.createElement('div'); list.id = `${select.id}-options`; list.className = 'select-options'; list.hidden = true;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-labelledby', label.id);
    select.after(shell); shell.append(trigger, list); select.hidden = true; label.htmlFor = trigger.id;
    let active = select.selectedIndex;
    const options = [...select.options].map((option, i) => {
      const row = document.createElement('div'); row.id = `${select.id}-option-${i}`; row.className = 'select-option';
      row.setAttribute('role', 'option'); row.textContent = option.textContent;
      row.addEventListener('click', () => choose(i)); list.append(row); return row;
    });
    function refresh() {
      value.textContent = select.selectedOptions[0]?.textContent || '';
      trigger.disabled = select.disabled;
      options.forEach((row, i) => { row.setAttribute('aria-selected', String(i === select.selectedIndex)); row.classList.toggle('is-active', i === active); });
    }
    function close() { list.hidden = true; shell.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant'); }
    function highlight(index) {
      active = Math.max(0, Math.min(options.length - 1, index)); refresh();
      trigger.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      closeActive(); closeActive = close; list.hidden = false; shell.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true'); highlight(select.selectedIndex);
    }
    function choose(index) {
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
    shell.addEventListener('focusout', event => { if (!shell.contains(event.relatedTarget)) close(); });
    select.addEventListener('change', refresh); refreshers.push(refresh); refresh();
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-select')) closeActive(); });
  document.querySelector('.race-setup').addEventListener('change', () => refreshers.forEach(refresh => refresh()));
}
