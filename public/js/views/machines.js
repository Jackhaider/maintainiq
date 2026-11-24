import { api, session } from '../api.js';
import {
  esc, icon, $, num, date, machineBadge, woStatusBadge, priorityBadge, empty, errorState, loading,
  modal, drawer, field, options, handleSubmit, toast, confirmDialog, label,
} from '../ui.js';

const STATUSES = ['running', 'idle', 'maintenance', 'down'];

export async function render(el) {
  const sup = session.isSupervisor;
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Machines</h2><p>${sup ? 'Every machine across the plant.' : 'Machines on your production line.'}</p></div>
      ${sup ? `<button class="btn btn-primary" id="add">${icon('plus')} Add machine</button>` : ''}
    </div>
    <div class="toolbar">
      <input class="input grow" id="search" type="search" placeholder="Search name, asset tag or type" aria-label="Search machines">
      <select class="select" id="status" aria-label="Filter by status">${options(STATUSES.map((s) => [s, label(s)]), '', { blank: 'All statuses' })}</select>
      ${sup ? '<select class="select" id="line" aria-label="Filter by line"><option value="">All lines</option></select>' : ''}
    </div>
    <div class="card" id="table">${loading(6)}</div>`;

  let lines = [];
  if (sup) {
    lines = (await api('/production-lines')).data;
    $('#line', el).innerHTML += options(lines.map((l) => [l.id, l.name]));
    $('#add', el).addEventListener('click', () => openForm(null, lines, load));
  }

  let timer;
  const load = async () => {
    const box = $('#table', el);
    try {
      const { data } = await api('/machines', {
        query: { search: $('#search', el).value.trim(), status: $('#status', el).value, lineId: sup ? $('#line', el).value : '' },
      });
      if (!data.length) return (box.innerHTML = empty('No machines match', 'Try clearing the filters.'));
      box.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Asset</th><th>Machine</th><th>Line</th><th>Status</th><th class="num">Rated power</th><th class="num">Open jobs</th><th>Installed</th></tr></thead>
        <tbody>${data.map((m) => `<tr class="clickable" data-id="${m.id}">
          <td class="mono">${esc(m.asset_tag)}</td>
          <td class="title-cell"><strong>${esc(m.name)}</strong><small>${esc(m.machine_type)}${m.manufacturer ? ` · ${esc(m.manufacturer)}` : ''}</small></td>
          <td>${esc(m.production_line)}</td>
          <td>${machineBadge(m.status)}</td>
          <td class="num">${num(m.rated_power_kw)} kW</td>
          <td class="num">${m.open_work_orders || '<span class="muted">0</span>'}</td>
          <td>${date(m.installed_on)}</td></tr>`).join('')}</tbody></table></div>`;
      box.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openDetail(Number(tr.dataset.id), lines, load)));
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };

  $('#search', el).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  $('#status', el).addEventListener('change', load);
  if (sup) $('#line', el).addEventListener('change', load);
  load();
}

async function openDetail(id, lines, reload) {
  const sup = session.isSupervisor;
  const d = drawer('Machine', loading(6));
  try {
    const [{ data: m }, { data: orders }] = await Promise.all([api(`/machines/${id}`), api('/work-orders', { query: { machineId: id } })]);
    d.el.querySelector('h3').textContent = `${m.asset_tag} · ${m.name}`;
    d.el.querySelector('.modal-body').innerHTML = `
      <dl class="kv">
        <dt>Status</dt><dd>${machineBadge(m.status)}</dd>
        <dt>Production line</dt><dd>${esc(m.production_line)} <span class="mono muted">${esc(m.production_line_code)}</span></dd>
        <dt>Type</dt><dd>${esc(m.machine_type)}</dd>
        <dt>Manufacturer</dt><dd>${esc(m.manufacturer || '—')}</dd>
        <dt>Rated power</dt><dd>${num(m.rated_power_kw)} kW</dd>
        <dt>Installed</dt><dd>${date(m.installed_on)}</dd>
      </dl>
      <div class="field"><label for="st">Change status</label>
        <div class="actions-row"><select class="select" id="st">${options(STATUSES.map((s) => [s, label(s)]), m.status)}</select>
        <button class="btn" id="st-save">Update</button></div></div>
      ${sup ? `<div class="actions-row mt"><button class="btn" id="edit">Edit details</button><button class="btn btn-danger" id="del">Delete</button></div>` : ''}
      <div class="section-title">Work orders (${orders.length})</div>
      ${orders.length ? `<ul class="list card">${orders.map((w) => `<li><div class="grow"><strong><a href="#/work-orders?id=${w.id}">${esc(w.title)}</a></strong>
        <small>${date(w.created_at)} · ${esc(w.requested_by_name)}</small></div>${priorityBadge(w.priority)} ${woStatusBadge(w.status)}</li>`).join('')}</ul>`
        : empty('No work orders for this machine')}`;

    const body = d.el;
    $('#st-save', body).addEventListener('click', async () => {
      try {
        await api(`/machines/${id}/status`, { method: 'PATCH', body: { status: $('#st', body).value } });
        toast('Status updated');
        d.close();
        reload();
      } catch (err) { toast(err.message, 'error'); }
    });
    if (sup) {
      $('#edit', body).addEventListener('click', () => { d.close(); openForm(m, lines, reload); });
      $('#del', body).addEventListener('click', async () => {
        if (!(await confirmDialog(`Delete ${m.asset_tag}? Machines with history cannot be deleted.`, { okText: 'Delete', danger: true }))) return;
        try {
          await api(`/machines/${id}`, { method: 'DELETE' });
          toast('Machine deleted');
          d.close();
          reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  } catch (err) {
    d.el.querySelector('.modal-body').innerHTML = errorState(err);
  }
}

function openForm(m, lines, reload) {
  const isEdit = Boolean(m);
  const md = modal(isEdit ? `Edit ${m.asset_tag}` : 'Add machine', `
    <form novalidate><div class="form-alert hidden" role="alert"></div>
      <div class="form-grid">
        ${field('assetTag', 'Asset tag', `<input class="input" id="f-assetTag" name="assetTag" value="${esc(m?.asset_tag || '')}" required>`)}
        ${field('productionLineId', 'Production line', `<select class="select" id="f-productionLineId" name="productionLineId" data-type="int">${options(lines.map((l) => [l.id, l.name]), m?.production_line_id, { blank: 'Select line' })}</select>`)}
        <div class="span-2">${field('name', 'Name', `<input class="input" id="f-name" name="name" value="${esc(m?.name || '')}" required>`)}</div>
        ${field('machineType', 'Type', `<input class="input" id="f-machineType" name="machineType" value="${esc(m?.machine_type || '')}" required>`)}
        ${field('manufacturer', 'Manufacturer', `<input class="input" id="f-manufacturer" name="manufacturer" value="${esc(m?.manufacturer || '')}" data-nullable>`)}
        ${field('ratedPowerKw', 'Rated power (kW)', `<input class="input" id="f-ratedPowerKw" name="ratedPowerKw" type="number" step="0.01" min="0.01" data-type="number" value="${m?.rated_power_kw ?? ''}">`)}
        ${field('installedOn', 'Installed on', `<input class="input" id="f-installedOn" name="installedOn" type="date" value="${esc(m?.installed_on || '')}" data-nullable>`)}
        ${field('status', 'Status', `<select class="select" id="f-status" name="status">${options(STATUSES.map((s) => [s, label(s)]), m?.status || 'running')}</select>`)}
      </div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Add machine'}</button></div>
    </form>`);
  md.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', md.close));
  handleSubmit(md.el.querySelector('form'), async (body) => {
    if (isEdit) await api(`/machines/${m.id}`, { method: 'PATCH', body });
    else await api('/machines', { method: 'POST', body });
    toast(isEdit ? 'Machine updated' : 'Machine added');
    md.close();
    reload();
  });
}
