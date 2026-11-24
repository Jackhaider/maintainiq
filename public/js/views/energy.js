import { api, session } from '../api.js';
import { esc, $, $$, num, int, date, empty, errorState, loading, field, options, handleSubmit, toast, todayISO, confirmDialog } from '../ui.js';
import { lineChart } from '../charts.js';

export async function render(el) {
  el.innerHTML = `
    <div class="page-head"><div><h2>Energy monitoring</h2><p>Daily kWh per machine, entered from the meters on the line.</p></div></div>
    <div class="grid cols-3-1 mb">
      <div class="card"><div class="card-head"><div><h3>Daily consumption</h3><div class="sub" id="chart-sub">kWh per day</div></div>
        <div class="tabs" role="tablist">${[30, 90, 180].map((d) => `<button class="tab" data-days="${d}" aria-selected="${d === 30}">${d} d</button>`).join('')}</div></div>
        <div class="card-body" id="chart"><div class="skeleton block"></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Submit a reading</h3><div class="sub">One reading per machine per day</div></div></div>
        <div class="card-body"><form id="reading" novalidate><div class="form-alert hidden" role="alert"></div>
          <div class="grid">
            ${field('machineId', 'Machine', '<select class="select" id="f-machineId" name="machineId" data-type="int"></select>')}
            ${field('readingDate', 'Date', `<input class="input" id="f-readingDate" name="readingDate" type="date" max="${todayISO()}" value="${todayISO()}">`)}
            ${field('kwh', 'Energy used (kWh)', '<input class="input" id="f-kwh" name="kwh" type="number" step="0.01" min="0" data-type="number">')}
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Submit reading</button></div></form></div></div>
    </div>
    <div class="toolbar"><select class="select" id="filter" aria-label="Filter readings by machine"><option value="">All machines</option></select></div>
    <div class="card" id="table">${loading(6)}</div>`;

  const { data: machines } = await api('/machines');
  const machineOpts = options(machines.map((m) => [m.id, `${m.asset_tag} · ${m.name}`]));
  $('#f-machineId', el).innerHTML = `<option value="">Select machine</option>${machineOpts}`;
  $('#filter', el).innerHTML += machineOpts;

  const loadChart = async (days) => {
    const box = $('#chart', el);
    try {
      const { data } = await api('/energy/daily', { query: { days } });
      $('#chart-sub', el).textContent = `kWh per day, last ${days} days · total ${num(data.reduce((s, d) => s + d.total_kwh, 0) / 1000)} MWh`;
      box.innerHTML = '';
      if (!data.length) return (box.innerHTML = empty('No readings in this period'));
      lineChart(box, data.map((d) => ({ label: date(d.reading_date).slice(0, 6), title: date(d.reading_date), value: d.total_kwh })), {
        name: 'Energy', format: (v) => `${int(v)} kWh`, height: 260,
      });
    } catch (err) { box.innerHTML = errorState(err); }
  };

  const loadTable = async () => {
    const box = $('#table', el);
    try {
      const { data } = await api('/energy', { query: { machineId: $('#filter', el).value, limit: 100 } });
      if (!data.length) return (box.innerHTML = empty('No readings yet'));
      box.innerHTML = `<div class="card-head"><div><h3>Recent readings</h3><div class="sub">Latest ${data.length}</div></div></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Machine</th><th>Line</th><th class="num">kWh</th><th>Recorded by</th>${session.isSupervisor ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.map((r) => `<tr><td>${date(r.reading_date)}</td>
          <td class="title-cell"><strong>${esc(r.machine_name)}</strong><small class="mono">${esc(r.asset_tag)}</small></td>
          <td>${esc(r.production_line)}</td><td class="num">${num(r.kwh, 2)}</td><td>${esc(r.recorded_by_name)}</td>
          ${session.isSupervisor ? `<td class="num"><button class="btn btn-sm btn-ghost btn-danger" data-del="${r.id}">Delete</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
      $$('[data-del]', box).forEach((b) =>
        b.addEventListener('click', async () => {
          if (!(await confirmDialog('Delete this reading?', { okText: 'Delete', danger: true }))) return;
          try { await api(`/energy/${b.dataset.del}`, { method: 'DELETE' }); toast('Reading deleted'); loadTable(); } catch (err) { toast(err.message, 'error'); }
        })
      );
    } catch (err) { box.innerHTML = errorState(err); }
  };

  let days = 30;
  $$('[data-days]', el).forEach((t) =>
    t.addEventListener('click', () => {
      days = Number(t.dataset.days);
      $$('[data-days]', el).forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      loadChart(days);
    })
  );
  $('#filter', el).addEventListener('change', loadTable);

  const form = $('#reading', el);
  handleSubmit(form, async (body) => {
    await api('/energy', { method: 'POST', body });
    toast('Reading saved');
    $('#f-kwh', form).value = '';
    loadChart(days);
    loadTable();
  });

  loadChart(days);
  loadTable();
}
