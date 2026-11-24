import { api, session } from '../api.js';
import { esc, icon, $, $$, dateTime, duration, ago, badge, empty, errorState, loading, modal, field, options, handleSubmit, toast, label, nowLocalInput } from '../ui.js';

const REASONS = ['mechanical', 'electrical', 'material', 'changeover', 'other'];
const REASON_TONE = { mechanical: 'serious', electrical: 'warning', material: 'info', changeover: '', other: '' };

export async function render(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Downtime tracking</h2><p>Every stoppage, its cause and how long it lasted.</p></div>
      <button class="btn btn-primary" id="log">${icon('plus')} Log stoppage</button>
    </div>
    <div class="card mb"><div class="card-head"><div><h3>Ongoing stoppages</h3><div class="sub">Close them when the machine is running again</div></div></div><div id="ongoing">${loading(2)}</div></div>
    <div class="toolbar">
      <select class="select" id="machine" aria-label="Filter by machine"><option value="">All machines</option></select>
      <input class="input" type="date" id="from" aria-label="From date">
      <input class="input" type="date" id="to" aria-label="To date">
    </div>
    <div class="card" id="history">${loading(6)}</div>`;

  const { data: machines } = await api('/machines');
  $('#machine', el).innerHTML += options(machines.map((m) => [m.id, `${m.asset_tag} · ${m.name}`]));

  const loadOngoing = async () => {
    const box = $('#ongoing', el);
    try {
      const { data } = await api('/downtime', { query: { ongoing: 'true' } });
      box.innerHTML = data.length
        ? `<ul class="list">${data.map((d) => `<li><div class="grow"><strong>${esc(d.machine_name)} <span class="mono muted">${esc(d.asset_tag)}</span></strong>
            <small>${esc(label(d.reason_category))} · ${esc(d.description || '')} · started ${ago(d.started_at)} by ${esc(d.reported_by_name)}</small></div>
            <span class="badge critical">${duration(d.duration_minutes)}</span>
            ${session.isSupervisor || d.reported_by === session.user.id ? `<button class="btn btn-sm" data-end="${d.id}">Mark ended now</button>` : ''}</li>`).join('')}</ul>`
        : empty('No ongoing stoppages', 'Every machine is producing.');
      $$('[data-end]', box).forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await api(`/downtime/${b.dataset.end}/end`, { method: 'PATCH', body: {} });
            toast('Stoppage closed');
            loadAll();
          } catch (err) { toast(err.message, 'error'); }
        })
      );
    } catch (err) { box.innerHTML = errorState(err); }
  };

  const loadHistory = async () => {
    const box = $('#history', el);
    try {
      const { data } = await api('/downtime', { query: { machineId: $('#machine', el).value, from: $('#from', el).value, to: $('#to', el).value, limit: 200 } });
      if (!data.length) return (box.innerHTML = empty('No stoppages in this range'));
      const total = data.reduce((s, d) => s + d.duration_minutes, 0);
      box.innerHTML = `<div class="card-head"><div><h3>History</h3><div class="sub">${data.length} stoppages · ${duration(total)} in total${data.length === 200 ? ' (latest 200)' : ''}</div></div></div>
        <div class="table-wrap"><table class="data">
        <thead><tr><th>Machine</th><th>Reason</th><th>Started</th><th>Ended</th><th class="num">Duration</th><th>Reported by</th></tr></thead>
        <tbody>${data.map((d) => `<tr>
          <td class="title-cell"><strong>${esc(d.machine_name)}</strong><small class="mono">${esc(d.asset_tag)} · ${esc(d.production_line)}</small></td>
          <td>${badge(d.reason_category, REASON_TONE[d.reason_category])}<br><small class="muted">${esc(d.description || '')}</small></td>
          <td>${dateTime(d.started_at)}</td>
          <td>${d.ended_at ? dateTime(d.ended_at) : '<span class="badge critical">Ongoing</span>'}</td>
          <td class="num">${duration(d.duration_minutes)}</td>
          <td>${esc(d.reported_by_name)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { box.innerHTML = errorState(err); }
  };

  const loadAll = () => Promise.all([loadOngoing(), loadHistory()]);
  ['#machine', '#from', '#to'].forEach((s) => $(s, el).addEventListener('change', loadHistory));

  $('#log', el).addEventListener('click', () => {
    const m = modal('Log a stoppage', `
      <form novalidate><div class="form-alert hidden" role="alert"></div><div class="form-grid">
        <div class="span-2">${field('machineId', 'Machine', `<select class="select" id="f-machineId" name="machineId" data-type="int">${options(machines.map((x) => [x.id, `${x.asset_tag} · ${x.name}`]), '', { blank: 'Select machine' })}</select>`)}</div>
        ${field('reasonCategory', 'Reason', `<select class="select" id="f-reasonCategory" name="reasonCategory">${options(REASONS.map((r) => [r, label(r)]), '', { blank: 'Select reason' })}</select>`)}
        ${field('startedAt', 'Started', `<input class="input" id="f-startedAt" name="startedAt" type="datetime-local" value="${nowLocalInput()}">`)}
        ${field('endedAt', 'Ended (leave empty if still down)', '<input class="input" id="f-endedAt" name="endedAt" type="datetime-local">')}
        <div class="span-2">${field('description', 'What happened?', '<textarea class="textarea" id="f-description" name="description"></textarea>')}</div>
      </div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
    m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
    handleSubmit(m.el.querySelector('form'), async (body) => {
      await api('/downtime', { method: 'POST', body });
      toast('Stoppage logged');
      m.close();
      loadAll();
    });
  });

  loadAll();
}
