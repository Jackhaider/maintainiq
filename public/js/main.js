// App entry: session handling, the shell (sidebar + topbar) and a small hash router.
import { session, api } from './api.js';
import { h, $, $$, esc, icon, initials, errorState } from './ui.js';
import { renderLogin } from './views/login.js';

// Each route lazy-loads its view module on first visit.
const ROUTES = {
  dashboard: { title: 'Dashboard', icon: 'dashboard', load: () => import('./views/dashboard.js') },
  machines: { title: 'Machines', icon: 'machine', load: () => import('./views/machines.js') },
  'work-orders': { title: 'Work Orders', icon: 'wrench', load: () => import('./views/workOrders.js') },
  downtime: { title: 'Downtime', icon: 'pause', load: () => import('./views/downtime.js') },
  energy: { title: 'Energy', icon: 'bolt', load: () => import('./views/energy.js') },
  lines: { title: 'Production Lines', icon: 'layers', load: () => import('./views/lines.js') },
  notes: { title: 'Maintenance Notes', icon: 'note', load: () => import('./views/notes.js') },
  reports: { title: 'Reports & Analytics', icon: 'chart', supervisor: true, load: () => import('./views/reports.js') },
  users: { title: 'User Management', icon: 'users', supervisor: true, load: () => import('./views/users.js') },
};
const NAV = [
  ['Operations', ['dashboard', 'machines', 'work-orders', 'downtime', 'energy']],
  ['Plant', ['lines', 'notes']],
  ['Management', ['reports', 'users']],
];

const root = $('#root');

function routeName() {
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
  return ROUTES[name] ? name : 'dashboard';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('maintainiq.theme', theme);
}

function renderShell() {
  const user = session.user;
  const nav = NAV.map(([section, names]) => {
    const links = names
      .filter((n) => !ROUTES[n].supervisor || session.isSupervisor)
      .map((n) => `<a href="#/${n}" data-route="${n}">${icon(ROUTES[n].icon)}<span>${ROUTES[n].title}</span></a>`)
      .join('');
    return links ? `<div class="nav-section">${section}</div>${links}` : '';
  }).join('');

  root.innerHTML = '';
  root.append(h(`<div class="app">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="brand"><span class="brand-mark">M</span> MaintainIQ</div>
      <nav class="nav">${nav}</nav>
      <div class="sidebar-footer">${session.isSupervisor ? 'All production lines' : 'Your line only'} · v1.0</div>
    </aside>
    <div class="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-sm menu-btn" id="menu-btn" aria-label="Open menu">${icon('menu')}</button>
        <div><h1 id="page-title"></h1></div>
        <div class="topbar-right">
          <button class="btn btn-ghost btn-sm" id="theme-btn" aria-label="Toggle dark mode"></button>
          <div class="user-chip">
            <span class="avatar">${esc(initials(user.fullName))}</span>
            <span class="who"><strong>${esc(user.fullName)}</strong><small>${esc(user.role)}</small></span>
          </div>
          <button class="btn btn-ghost btn-sm" id="logout-btn" aria-label="Log out" title="Log out">${icon('logout')}</button>
        </div>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
  </div>`));

  const app = $('.app');
  const themeBtn = $('#theme-btn');
  const paintThemeBtn = () => {
    themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  };
  paintThemeBtn();
  themeBtn.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    paintThemeBtn();
    navigate(); // redraw charts with the new palette
  });
  $('#menu-btn').addEventListener('click', () => app.classList.toggle('nav-open'));
  $('.scrim').addEventListener('click', () => app.classList.remove('nav-open'));
  $('#logout-btn').addEventListener('click', () => {
    session.clear();
    location.hash = '';
    start();
  });
}

let renderToken = 0;
async function navigate() {
  if (!session.token) return start();
  if (!$('.app')) renderShell();
  const name = routeName();
  const route = ROUTES[name];
  const view = $('#view');
  $('.app').classList.remove('nav-open');
  $$('.nav a').forEach((a) => (a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#page-title').textContent = route.title;
  document.title = `${route.title} · MaintainIQ`;

  if (route.supervisor && !session.isSupervisor) {
    view.innerHTML = `<div class="card">${errorState(new Error('This page is only available to supervisors.'))}</div>`;
    return;
  }

  const token = ++renderToken;
  view.innerHTML = '';
  try {
    const mod = await route.load();
    if (token !== renderToken) return; // the user navigated away while the module loaded
    const container = document.createElement('div');
    container.className = 'view';
    view.append(container);
    await mod.render(container);
  } catch (err) {
    if (token === renderToken) view.innerHTML = `<div class="card">${errorState(err)}</div>`;
  }
}

async function start() {
  if (!session.token) {
    renderLogin(root, () => {
      if (!location.hash) location.hash = '#/dashboard';
      renderShell();
      navigate();
    });
    return;
  }
  // Confirm the stored token is still valid (and refresh the role in case it changed).
  try {
    const me = await api('/auth/me');
    session.save(session.token, me.data);
    renderShell();
    navigate();
  } catch {
    session.clear();
    start();
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('session-expired', () => start());
// Logging in or out in another tab changes localStorage: rebuild this tab so its shell
// (name, role, menu) never belongs to a different user than the data it shows.
window.addEventListener('storage', (e) => {
  if (e.key === 'maintainiq.token' || e.key === null) location.reload();
});
start();
