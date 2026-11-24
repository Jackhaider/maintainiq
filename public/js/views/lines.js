import { api, session } from '../api.js';
import { esc, icon, $, num, empty, errorState, modal, field, handleSubmit, toast } from '../ui.js';
import { SERIES } from '../charts.js';

export async function render(el) {
  const sup = session.isSupervisor;
  el.innerHTML = `
    <div class="page-head"><div><h2>Production lines</h2><p>Machines, availability and installed power per line.</p></div>
      ${sup ? `<button class="btn btn-primary" id="add">${icon('plus')} Add line</button>` : ''}</div>
    <div class="grid line-cards" id="cards">${'<div class="card line-card"><div class="skeleton line"></div><div class="skeleton line"></div><div class="skeleton line"></div></div>'.repeat(4)}</div>`;

  const load = async () => {
    const box = $('#cards', el);
    try {
      const { data } = await api('/production-lines');
      if (!data.length) return (box.innerHTML = `<div class="card">${empty('No production lines yet')}</div>`);
      box.innerHTML = data.map((l, i) => `
        <article class="card line-card">
          <div><div class="code"><span class="swatch" data-i="${i}"></span>${esc(l.code)}</div><h3>${esc(l.name)}</h3><div class="muted">${esc(l.location)}</div></div>
          <div class="stats">
            <div><b>${l.machine_count}</b><small>Machines</small></div>
            <div><b>${l.running}</b><small>Running</small></div>
            <div><b>${l.unavailable}</b><small>Down / maint.</small></div>
          </div>
          <div class="muted">${num(l.installed_power_kw)} kW installed</div>
          ${!sup && session.user.productionLineId === l.id ? '<span class="badge info">Your line</span>' : ''}
          <a class="btn btn-sm" href="#/machines">View machines</a>
        </article>`).join('');
      // Same fixed colour per line as the reports charts (CSSOM, not inline style attributes).
      box.querySelectorAll('.swatch').forEach((s) => { s.style.background = SERIES[Number(s.dataset.i) % SERIES.length]; });
    } catch (err) {
      box.innerHTML = `<div class="card">${errorState(err)}</div>`;
    }
  };

  if (sup) {
    $('#add', el).addEventListener('click', () => {
      const m = modal('Add production line', `<form novalidate><div class="form-alert hidden" role="alert"></div><div class="form-grid">
        ${field('code', 'Code', '<input class="input" id="f-code" name="code" placeholder="PL-XYZ">')}
        ${field('name', 'Name', '<input class="input" id="f-name" name="name">')}
        <div class="span-2">${field('location', 'Location', '<input class="input" id="f-location" name="location" placeholder="Plant 1 - Bay E">')}</div></div>
        <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Add line</button></div></form>`);
      m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
      handleSubmit(m.el.querySelector('form'), async (body) => {
        await api('/production-lines', { method: 'POST', body });
        toast('Production line added');
        m.close();
        load();
      });
    });
  }
  load();
}
