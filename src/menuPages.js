import { state } from './game.js';

const pages = ['home', 'race', 'online', 'records'];
export function showMenuPage(page, { focus = false, history = true } = {}) {
  if (!pages.includes(page)) page = 'home';
  const menu = document.getElementById('menu');
  menu.style.display = 'block'; state.keys = {};
  if (state.onlineSession) state.onlineSession.menuOpen = true;
  for (const name of pages) {
    const tab = document.getElementById(`tab-${name}`), selected = name === page;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    if (selected) {
      document.querySelector('.header-section b').textContent = tab.textContent.trim().replace(/^\d+\s*/, '');
      if (focus) tab.focus();
    }
  }
  menu.scrollTop = 0;
  if (history && location.hash !== `#${page}`) window.history.pushState(null, '', `#${page}`);
  window.dispatchEvent(new CustomEvent('quick-grid:page', { detail: page }));
}

export function initMenuPages() {
  const footer = document.querySelector('.paddock-footer');
  footer.before(document.getElementById('online-dialog'));
  for (const [i, name] of pages.entries()) {
    const tab = document.getElementById(`tab-${name}`);
    tab.addEventListener('click', () => showMenuPage(name));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (i + (event.key === 'ArrowLeft' ? -1 : 1) + pages.length) % pages.length;
      showMenuPage(pages[next], { focus: true });
    });
  }
  document.querySelectorAll('[data-menu-page]').forEach(button => button.addEventListener('click', () => showMenuPage(button.dataset.menuPage, { focus: true })));
  document.querySelector('.wordmark').addEventListener('click', event => { event.preventDefault(); showMenuPage('home'); });
  window.addEventListener('popstate', () => {
    // Browser navigation never unpauses an offline race underneath the menu.
    if (!state.isRunning || state.onlineSession) showMenuPage(location.hash.slice(1), { history: false });
  });
  showMenuPage(location.hash.slice(1), { history: false });
}
