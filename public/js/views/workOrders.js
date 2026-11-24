import { api, session } from '../api.js';
import {
  esc, icon, $, $$, date, dateTime, ago, priorityBadge, woStatusBadge, empty, errorState, loading, modal, drawer,
  field, options, handleSubmit, toast, confirmDialog, label,
} from '../ui.js';

const TABS = [['', 'All'], ['open', 'Open'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['closed', 'Closed']];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['corrective', 'preventive', 'inspection'];

const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

export async function render(el) {
  const sup = session.isSupervisor;
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Work orders</h2><p>${sup ? 'Assign, track and close maintenance jobs.' : 'Maintenance requests for your line.'}</p></div>
      <button class="btn btn-primary" id="new">${icon('plus')} ${sup ? 'New work order' : 'New maintenance request'}</button>
    </div>
    <div class="toolbar">
      <div class="tabs" role="tablist">${TABS.map(([v, t]) => `<button class="tab" role="tab" data-status="${v}" aria-selected="${v === '' ? 'true' : 'false'}">${t}</button>`).join('')}</div>
      <select class="select" id="priority" aria-label="Filter by priority">${options(PRIORITIES.map((p) => [p, label(p)]), '', { blank: 'Any priority' })}</select>
      <label class="muted"><input type="checkbox" id="mine"> Only mine</label>
    </div>
    <div class="card" id="table">${loading(6)}</div>`;

  let status = '';
  const load = async () => {
    const box = $('#table', el);
    try {
      const { data } = await api('/work-orders', {
        query: { status, priority: $('#priority', el).value, mine: $('#mine', el).checked ? 'true' : '' },
      });
      if (!data.length) return (box.innerHTML = empty('No work orders here', 'Nothing matches the current filter.'));
      box.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>#</th><th>Work order</th><th>Machine</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Due</th></tr></thead>
        <tbody>${data.map((w) => {
          const overdue = w.status !== 'closed' && w.due_date && w.due_date < new Date().toISOString().slice(0, 10);
          return `<tr class="clickable" data-id="${w.id}">
            <td class="mono muted">WO-${String(w.id).padStart(4, '0')}</td>
            <td class="title-cell"><strong>${esc(w.title)}</strong><small>${label(w.order_type)} · raised by ${esc(w.requested_by_name)} ${ago(w.created_at)}</small></td>
            <td><span class="mono">${esc(w.asset_tag)}</span><br><small class="muted">${esc(w.production_line)}</small></td>
            <td>${priorityBadge(w.priority)}</td>
            <td>${woStatusBadge(w.status)}</td>
            <td>${esc(w.assigned_to_name || '—')}</td>
            <td>${w.status === 'closed' ? `<span class="muted">Closed ${date(w.closed_at)}</span>` : `${date(w.due_date)}${overdue ? ' <span class="badge critical">Overdue</span>' : ''}`}</td></tr>`;
        }).join('')}</tbody></table></div>`;
      $$('tr[data-id]', box).forEach((tr) => tr.addEventListener('click', () => openDetail(Number(tr.dataset.id), load)));
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };

  $$('[data-status]', el).forEach((tab) =>
    tab.addEventListener('click', () => {
      status = tab.dataset.status;
      $$('[data-status]', el).forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      load();
    })
  );
  $('#priority', el).addEventListener('change', load);
  $('#mine', el).addEventListener('change', load);
  $('#new', el).addEventListener('click', () => openCreate(load));

  await load();
  const params = hashParams();
  if (params.get('new')) openCreate(load);
  if (params.get('id')) openDetail(Number(params.get('id')), load);
}

async function openCreate(reload) {
  const sup = session.isSupervisor;
  const [{ data: machines }, users] = await Promise.all([api('/machines'), sup ? api('/users') : Promise.resolve({ data: [] })]);
  const m = modal(sup ? 'New work order' : 'New maintenance request', `
    <form novalidate><div class="form-alert hidden" role="alert"></div>
      <div class="form-grid">
        <div class="span-2">${field('machineId', 'Machine', `<select class="select" id="f-machineId" name="machineId" data-type="int">${options(machines.map((x) => [x.id, `${x.asset_tag} · ${x.name}`]), '', { blank: 'Select machine' })}</select>`)}</div>
        <div class="span-2">${field('title', 'Title', '<input class="input" id="f-title" name="title" placeholder="e.g. Hydraulic hose leaking at cylinder 2">')}</div>
        <div class="span-2">${field('description', 'Description', '<textarea class="textarea" id="f-description" name="description" placeholder="What did you observe? When did it start?"></textarea>')}</div>
        ${field('priority', 'Priority', `<select class="select" id="f-priority" name="priority">${options(PRIORITIES.map((p) => [p, label(p)]), 'medium')}</select>`)}
        ${field('orderType', 'Type', `<select class="select" id="f-orderType" name="orderType">${options(TYPES.map((t) => [t, label(t)]), 'corrective')}</select>`)}
        ${field('dueDate', 'Due date', '<input class="input" id="f-dueDate" name="dueDate" type="date">')}
        ${sup ? field('assignedTo', 'Assign to', `<select class="select" id="f-assignedTo" name="assignedTo" data-type="int">${options(users.data.filter((u) => u.is_active).map((u) => [u.id, `${u.full_name} (${u.role})`]), '', { blank: 'Unassigned' })}</select>`) : ''}
      </div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Submit</button></div>
    </form>`);
  m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
  handleSubmit(m.el.querySelector('form'), async (body) => {
    const res = await api('/work-orders', { method: 'POST', body });
    toast(`WO-${String(res.data.id).padStart(4, '0')} created`);
    m.close();
    reload();
  });
}

async function openDetail(id, reload) {
  const sup = session.isSupervisor;
  const d = drawer('Work order', loading(8));
  const body = d.el.querySelector('.modal-body');

  const paint = async () => {
    try {
      const { data: w } = await api(`/work-orders/${id}`);
      const users = sup ? (await api('/users')).data.filter((u) => u.is_active) : [];
      const me = session.user.id;
      const closed = w.status === 'closed';
      d.el.querySelector('h3').textContent = `WO-${String(w.id).padStart(4, '0')} · ${w.title}`;
      body.innerHTML = `
        <div class="actions-row">${priorityBadge(w.priority)} ${woStatusBadge(w.status)} <span class="badge plain">${label(w.order_type)}</span></div>
        <p>${esc(w.description || 'No description.')}</p>
        <dl class="kv">
          <dt>Machine</dt><dd><span class="mono">${esc(w.asset_tag)}</span> · ${esc(w.machine_name)}</dd>
          <dt>Line</dt><dd>${esc(w.production_line)}</dd>
          <dt>Raised by</dt><dd>${esc(w.requested_by_name)} · ${dateTime(w.created_at)}</dd>
          <dt>Assigned to</dt><dd>${esc(w.assigned_to_name || 'Unassigned')}</dd>
          <dt>Due</dt><dd>${date(w.due_date)}</dd>
          ${closed ? `<dt>Closed</dt><dd>${dateTime(w.closed_at)}</dd>` : ''}
        </dl>
        ${!closed ? `<div class="actions-row">
          ${sup ? `<select class="select" id="assignee" aria-label="Assignee">${options(users.map((u) => [u.id, u.full_name]), w.assigned_to, { blank: 'Choose assignee' })}</select><button class="btn" id="assign">Assign</button>` : ''}
          ${(sup || w.assigned_to === me) && w.status !== 'in_progress' ? '<button class="btn" id="start">Start work</button>' : ''}
          ${sup ? '<button class="btn btn-primary" id="close">Close work order</button>' : ''}
        </div>` : ''}
        <div class="section-title">Maintenance notes (${w.notes.length})</div>
        ${w.notes.length ? `<ul class="timeline">${w.notes.map((n) => `<li><div class="meta"><strong>${esc(n.author_name)}</strong> · ${dateTime(n.created_at)}</div><p>${esc(n.note)}</p></li>`).join('')}</ul>` : '<p class="muted">No notes yet.</p>'}
        ${!closed || sup ? `<form id="note-form" novalidate>${field('note', 'Add a note', '<textarea class="textarea" id="f-note" name="note" placeholder="What was checked, replaced or found?"></textarea>')}
          <div class="form-actions"><button class="btn btn-primary" type="submit">Add note</button></div></form>` : ''}
        ${sup ? '<div class="section-title">Danger zone</div><button class="btn btn-danger" id="delete">Delete work order</button>' : ''}`;

      const act = async (fn, msg) => {
        try { await fn(); toast(msg); await paint(); reload(); } catch (err) { toast(err.message, 'error'); }
      };
      $('#assign', body)?.addEventListener('click', () => {
        const v = Number($('#assignee', body).value);
        if (!v) return toast('Choose someone to assign', 'error');
        act(() => api(`/work-orders/${id}/assign`, { method: 'POST', body: { assignedTo: v } }), 'Work order assigned');
      });
      $('#start', body)?.addEventListener('click', () => act(() => api(`/work-orders/${id}/start`, { method: 'POST' }), 'Work started'));
      $('#close', body)?.addEventListener('click', () => {
        const m = modal('Close work order', `<form novalidate>${field('resolution', 'Resolution (saved as a note)', '<textarea class="textarea" id="f-resolution" name="resolution" placeholder="What fixed it?"></textarea>')}
          <div class="form-alert hidden"></div><div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Close work order</button></div></form>`);
        m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
        handleSubmit(m.el.querySelector('form'), async (b) => {
          await api(`/work-orders/${id}/close`, { method: 'POST', body: b });
          m.close();
          toast('Work order closed');
          await paint();
          reload();
        });
      });
      const nf = $('#note-form', body);
      if (nf) handleSubmit(nf, async (b) => { await api(`/work-orders/${id}/notes`, { method: 'POST', body: b }); toast('Note added'); await paint(); });
      $('#delete', body)?.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this work order and all of its notes?', { okText: 'Delete', danger: true }))) return;
        try { await api(`/work-orders/${id}`, { method: 'DELETE' }); toast('Work order deleted'); d.close(); reload(); } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) {
      body.innerHTML = errorState(err);
    }
  };
  paint();
}
