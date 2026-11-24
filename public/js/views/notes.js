import { api } from '../api.js';
import { esc, $, dateTime, woStatusBadge, empty, errorState, loading } from '../ui.js';

export async function render(el) {
  el.innerHTML = `
    <div class="page-head"><div><h2>Maintenance notes</h2><p>The latest notes written on work orders. Add notes from a work order.</p></div></div>
    <div class="toolbar"><input class="input grow" id="search" type="search" placeholder="Search notes or work order titles" aria-label="Search notes"></div>
    <div class="card" id="feed">${loading(6)}</div>`;

  let timer;
  const load = async () => {
    const box = $('#feed', el);
    try {
      const { data } = await api('/notes', { query: { limit: 100, search: $('#search', el).value.trim() } });
      box.innerHTML = data.length
        ? data.map((n) => `<div class="note-card">
            <div class="meta"><strong>${esc(n.author_name)}</strong> · ${dateTime(n.created_at)} ·
              <a href="#/work-orders?id=${n.work_order_id}">WO-${String(n.work_order_id).padStart(4, '0')} ${esc(n.work_order_title)}</a>
              · <span class="mono">${esc(n.asset_tag)}</span> ${woStatusBadge(n.work_order_status)}</div>
            <p>${esc(n.note)}</p></div>`).join('')
        : empty('No notes found');
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };
  $('#search', el).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  load();
}
