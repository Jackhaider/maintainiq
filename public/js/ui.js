// Shared UI helpers: escaping, formatting, badges, states, toasts, modals and forms.

/** Escape text before putting it into innerHTML. Every value from the API goes through this. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Build a DOM element from an HTML string (the caller is responsible for escaping). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- formatting ----------
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export const num = (n, digits = 1) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(Number(n) || 0);
export const int = (n) => nf.format(Math.round(Number(n) || 0));

function parseDate(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T'));
}
export function date(s) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
export function dateTime(s) {
  const d = parseDate(s);
  return d ? `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—';
}
export function ago(s) {
  const d = parseDate(s);
  if (!d) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  if (mins < 43200) return `${Math.round(mins / 1440)} d ago`;
  return date(s);
}
export function duration(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  return m % 60 ? `${hrs} h ${m % 60} min` : `${hrs} h`;
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};
export const todayISO = () => {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const nowLocalInput = () => {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const initials = (name) => (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const label = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ---------- badges (status colour is always paired with a text label) ----------
const MACHINE_TONE = { running: 'good', idle: 'plain-neutral', maintenance: 'warning', down: 'critical' };
const PRIORITY_TONE = { critical: 'critical', high: 'serious', medium: 'warning', low: '' };
const WO_TONE = { open: 'info', assigned: 'warning', in_progress: 'serious', closed: 'good' };
export const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(label(text))}</span>`;
export const machineBadge = (s) => badge(s, MACHINE_TONE[s] === 'plain-neutral' ? '' : MACHINE_TONE[s]);
export const priorityBadge = (p) => badge(p, PRIORITY_TONE[p]);
export const woStatusBadge = (s) => badge(s, WO_TONE[s]);

// ---------- icons (inline SVG, stroke = currentColor) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  machine: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V4h10v3M7 13h4M15 12v2"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------- loading / empty / error states ----------
export const loading = (rows = 4) => `<div class="card-body">${'<div class="skeleton line"></div>'.repeat(rows)}</div>`;
export const empty = (title, text = '') => `<div class="state">${icon('inbox')}<strong>${esc(title)}</strong>${esc(text)}</div>`;
export const errorState = (err) =>
  `<div class="state error">${icon('alert')}<strong>Could not load data</strong>${esc(err.message)}</div>`;

// ---------- toasts ----------
export function toast(message, type = 'success') {
  const el = h(`<div class="toast ${type}" role="status">${esc(message)}</div>`);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- modal & drawer ----------
function openOverlay(inner, cls = '') {
  const overlay = h(`<div class="overlay ${cls}" role="dialog" aria-modal="true"></div>`);
  overlay.append(inner);
  document.body.append(overlay);
  const previouslyFocused = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  $$('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  setTimeout(() => ($('input, select, textarea, button:not([data-close])', inner) || inner).focus?.(), 30);
  return { el: inner, close };
}

export function modal(title, bodyHtml) {
  const box = h(`<div class="modal">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`);
  return openOverlay(box);
}

export function drawer(title, bodyHtml) {
  const box = h(`<aside class="drawer">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${bodyHtml}</div></aside>`);
  return openOverlay(box, 'drawer-overlay');
}

export function confirmDialog(message, { okText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal('Please confirm', `<p>${esc(message)}</p>
      <div class="form-actions"><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? 'btn-primary btn-danger-solid' : 'btn-primary'}" data-ok>${esc(okText)}</button></div>`);
    let answered = false;
    $('[data-ok]', m.el).addEventListener('click', () => { answered = true; m.close(); resolve(true); });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { observer.disconnect(); if (!answered) resolve(false); }
    });
    observer.observe(document.body, { childList: true });
  });
}

// ---------- forms ----------
/** Read named fields into an object. Empty optional fields are left out; data-type="number"/"int" are converted. */
export function formData(form) {
  const out = {};
  $$('[name]', form).forEach((el) => {
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (v === '' && el.dataset.nullable === undefined) return;
    if (v === '' && el.dataset.nullable !== undefined) v = null;
    else if (el.dataset.type === 'number' || el.dataset.type === 'int') v = Number(v);
    out[el.name] = v;
  });
  return out;
}

/** Show validation errors from an ApiError next to the matching inputs. */
export function showFormErrors(form, err) {
  $$('.field-error', form).forEach((e) => (e.textContent = ''));
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  const alertBox = $('.form-alert', form);
  let unplaced = [];
  (err.details || []).forEach((d) => {
    const input = d.field && $(`[name="${d.field}"]`, form);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      const slot = input.closest('.field')?.querySelector('.field-error');
      if (slot) slot.textContent = d.message;
    } else unplaced.push(d.message);
  });
  if (!err.details?.length) unplaced = [err.message];
  if (alertBox) {
    alertBox.textContent = unplaced.join('. ');
    alertBox.classList.toggle('hidden', !unplaced.length);
  }
}

/** Submit handler wrapper: disables the button while the request runs and shows errors. */
export function handleSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    const original = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      showFormErrors(form, { details: [] });
      $('.form-alert', form)?.classList.add('hidden');
      await fn(formData(form));
    } catch (err) {
      showFormErrors(form, err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  });
}

export const field = (name, labelText, control) =>
  `<div class="field"><label for="f-${name}">${esc(labelText)}</label>${control}<div class="field-error"></div></div>`;

export const options = (items, selected, { blank } = {}) =>
  (blank ? `<option value="">${esc(blank)}</option>` : '') +
  items.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');

/** Download rows as a CSV file (used by the reports page). */
export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
