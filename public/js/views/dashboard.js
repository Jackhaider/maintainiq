import { api, session } from '../api.js';
import { esc, icon, int, num, duration, ago, date, priorityBadge, woStatusBadge, empty, errorState, loading, monthLabel } from '../ui.js';
import { lineChart, barChart, donut } from '../charts.js';

export async function render(el) {
  const sup = session.isSupervisor;
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Good ${greeting()}, ${esc(session.user.fullName.split(' ')[0])}</h2>
      <p>${sup ? 'Plant-wide overview across every production line.' : 'Overview of your production line.'}</p></div>
      <a class="btn btn-primary" href="#/work-orders?new=1">${icon('plus')} New maintenance request</a>
    </div>
    <div class="grid kpis" id="kpis">${'<div class="card kpi"><div class="skeleton line"></div><div class="skeleton line"></div></div>'.repeat(4)}</div>
    <div class="grid cols-3-1 mb">
      <div class="card"><div class="card-head"><div><h3>Energy consumption</h3><div class="sub">kWh per day, last 30 days</div></div></div>
        <div class="card-body" id="energy-chart"><div class="skeleton block"></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Machine status</h3><div class="sub">Right now</div></div></div>
        <div class="card-body" id="status-donut"><div class="skeleton block"></div></div></div>
    </div>
    <div class="grid cols-2 mb">
      <div class="card"><div class="card-head"><div><h3>Priority work orders</h3><div class="sub">Open jobs, most urgent first</div></div>
        <a class="btn btn-sm" href="#/work-orders">View all</a></div><div id="wo-list">${loading()}</div></div>
      <div class="card"><div class="card-head"><div><h3>Ongoing stoppages</h3><div class="sub">Machines currently down</div></div>
        <a class="btn btn-sm" href="#/downtime">Downtime log</a></div><div id="down-list">${loading()}</div></div>
    </div>
    ${sup ? `<div class="card"><div class="card-head"><div><h3>Monthly downtime</h3><div class="sub">Hours lost per month, all lines</div></div>
      <a class="btn btn-sm" href="#/reports">Reports</a></div><div class="card-body" id="downtime-chart"><div class="skeleton block"></div></div></div>` : ''}`;

  const safe = (p, target, fn) =>
    p.then(fn).catch((err) => { el.querySelector(target).innerHTML = errorState(err); });

  safe(api('/reports/summary'), '#kpis', ({ data }) => renderKpis(el.querySelector('#kpis'), data));
  safe(api('/energy/daily', { query: { days: 30 } }), '#energy-chart', ({ data }) => {
    const box = el.querySelector('#energy-chart');
    if (!data.length) return (box.innerHTML = empty('No energy readings yet'));
    box.innerHTML = '';
    lineChart(box, data.map((d) => ({ label: date(d.reading_date).slice(0, 6), title: date(d.reading_date), value: d.total_kwh })), {
      name: 'Energy', format: (v) => `${int(v)} kWh`,
    });
  });
  safe(api('/machines'), '#status-donut', ({ data }) => {
    const count = (s) => data.filter((m) => m.status === s).length;
    const segs = [
      { label: 'Running', value: count('running'), color: 'var(--good)' },
      { label: 'Idle', value: count('idle'), color: 'var(--neutral)' },
      { label: 'Maintenance', value: count('maintenance'), color: 'var(--warning)' },
      { label: 'Down', value: count('down'), color: 'var(--critical)' },
    ];
    const box = el.querySelector('#status-donut');
    box.innerHTML = '<div class="donut-wrap"><div class="d"></div><div class="donut-legend"></div></div>';
    donut(box.querySelector('.d'), segs, { centerLabel: 'machines' });
    box.querySelector('.donut-legend').innerHTML = segs
      .map((s) => `<div><span class="badge ${{ Running: 'good', Idle: '', Maintenance: 'warning', Down: 'critical' }[s.label]}">${s.label}</span><b>${s.value}</b></div>`)
      .join('');
  });
  safe(api('/work-orders'), '#wo-list', ({ data }) => {
    const open = data.filter((w) => w.status !== 'closed').slice(0, 6);
    el.querySelector('#wo-list').innerHTML = open.length
      ? `<ul class="list">${open
          .map((w) => `<li><div class="grow"><strong><a href="#/work-orders?id=${w.id}">${esc(w.title)}</a></strong>
            <small><span class="mono">${esc(w.asset_tag)}</span> · ${esc(w.machine_name)} · ${ago(w.created_at)}</small></div>
            ${priorityBadge(w.priority)} ${woStatusBadge(w.status)}</li>`)
          .join('')}</ul>`
      : empty('No open work orders', 'Everything is up to date.');
  });
  safe(api('/downtime', { query: { ongoing: 'true' } }), '#down-list', ({ data }) => {
    el.querySelector('#down-list').innerHTML = data.length
      ? `<ul class="list">${data
          .map((d) => `<li><div class="grow"><strong>${esc(d.machine_name)} <span class="mono muted">${esc(d.asset_tag)}</span></strong>
            <small>${esc(d.description || d.reason_category)} · started ${ago(d.started_at)}</small></div>
            <span class="badge critical">Down ${duration(d.duration_minutes)}</span></li>`)
          .join('')}</ul>`
      : empty('No machines down', 'All stoppages have been closed.');
  });
  if (sup) {
    safe(api('/reports/monthly-downtime', { query: { months: 6 } }), '#downtime-chart', ({ data }) => {
      const box = el.querySelector('#downtime-chart');
      box.innerHTML = '';
      barChart(box, data.map((d) => monthLabel(d.month)), [{ name: 'Downtime', color: 'var(--s1)', values: data.map((d) => d.downtime_minutes / 60) }], {
        format: (v) => `${num(v)} h`, height: 220,
      });
    });
  }
}

function renderKpis(box, s) {
  const m = s.machines;
  const avail = m.total ? Math.round((m.running / m.total) * 100) : 0;
  box.innerHTML = `
    <div class="card kpi"><div class="label">${icon('machine')} Machines running</div>
      <div class="value">${m.running}<small>/ ${m.total}</small></div>
      <div class="foot"><span>${avail}% available</span><span class="muted">${m.down} down · ${m.maintenance} in maintenance</span></div>
      <div class="bar" aria-hidden="true"><span data-w="${m.running}" data-c="var(--good)"></span><span data-w="${m.idle}" data-c="var(--neutral)"></span><span data-w="${m.maintenance}" data-c="var(--warning)"></span><span data-w="${m.down}" data-c="var(--critical)"></span></div></div>
    <div class="card kpi"><div class="label">${icon('wrench')} Open work orders</div>
      <div class="value">${s.workOrders.open_total}</div>
      <div class="foot"><span>${s.workOrders.open_urgent} high or critical</span><span class="muted">${s.workOrders.overdue} overdue</span></div></div>
    <div class="card kpi"><div class="label">${icon('clock')} Downtime, last 30 days</div>
      <div class="value">${num(s.downtime.minutes_last_30_days / 60)}<small>hours</small></div>
      <div class="foot"><span>${s.downtime.ongoing} stoppage${s.downtime.ongoing === 1 ? '' : 's'} ongoing</span></div></div>
    <div class="card kpi"><div class="label">${icon('bolt')} Energy, last 30 days</div>
      <div class="value">${num(s.energy.kwh_last_30_days / 1000)}<small>MWh</small></div>
      <div class="foot"><span>${s.workOrders.closed_last_30_days} work orders closed in 30 days</span></div></div>`;
  // Segment widths/colours via the CSSOM (CSP blocks inline style attributes).
  box.querySelectorAll('.bar span').forEach((sp) => {
    sp.style.flex = `${Number(sp.dataset.w)} 0 0`;
    sp.style.background = sp.dataset.c;
  });
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
}
