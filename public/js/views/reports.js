import { api } from '../api.js';
import { esc, icon, $, $$, num, int, duration, date, machineBadge, label, empty, errorState, loading, monthLabel, downloadCsv } from '../ui.js';
import { barChart, SERIES } from '../charts.js';

export async function render(el) {
  el.innerHTML = `
    <div class="page-head"><div><h2>Reports & analytics</h2><p>Every figure below is a live SQL query over the current data.</p></div>
      <div class="tabs" role="tablist">${[3, 6, 12].map((m) => `<button class="tab" data-months="${m}" aria-selected="${m === 6}">${m} months</button>`).join('')}</div></div>
    <div class="grid cols-2 mb">
      ${card('energy', 'Energy per production line', 'Monthly kWh · JOIN energy → machines → lines, GROUP BY line, month')}
      ${card('downtime', 'Monthly downtime', 'Hours lost · GROUP BY month')}
    </div>
    <div class="grid cols-2 mb">
      ${card('above', 'Machines with above-average downtime', 'All-time · subquery compares each machine with the plant average', true)}
      ${card('reasons', 'Downtime by cause', 'GROUP BY reason category', true)}
    </div>
    <div class="mb">${card('workload', 'Maintenance workload', 'Per person · LEFT JOIN users → work orders', true)}</div>
    ${card('machines', 'Machines and their work orders', 'LEFT JOIN machines → work orders, so machines with no jobs still appear', true)}`;

  const csvData = {};
  $$('[data-csv]', el).forEach((b) => b.addEventListener('click', () => downloadCsv(`maintainiq-${b.dataset.csv}.csv`, csvData[b.dataset.csv] || [])));

  const run = (key, path, query, draw) => {
    const box = $(`#r-${key}`, el);
    box.innerHTML = loading(5);
    return api(path, { query })
      .then(({ data }) => {
        csvData[key] = data;
        box.innerHTML = '';
        if (!data.length) return (box.innerHTML = empty('No data for this period'));
        draw(box, data);
      })
      .catch((err) => { box.innerHTML = errorState(err); });
  };

  const loadPeriod = (months) => {
    run('energy', '/reports/monthly-energy', { months }, (box, data) => {
      const monthsList = [...new Set(data.map((r) => r.month))];
      const lines = [...new Map(data.map((r) => [r.code, r.production_line])).entries()];
      box.classList.add('card-body');
      barChart(box, monthsList.map(monthLabel), lines.map(([code, name], i) => ({
        name, color: SERIES[i % SERIES.length],
        values: monthsList.map((m) => (data.find((r) => r.month === m && r.code === code)?.total_kwh || 0) / 1000),
      })), { format: (v) => `${num(v)} MWh` });
    });
    run('downtime', '/reports/monthly-downtime', { months }, (box, data) => {
      box.classList.add('card-body');
      barChart(box, data.map((d) => monthLabel(d.month)), [{ name: 'Downtime', color: 'var(--s1)', values: data.map((d) => d.downtime_minutes / 60) }], {
        format: (v) => `${num(v)} h`,
      });
      const total = data.reduce((s, d) => s + d.events, 0);
      box.insertAdjacentHTML('beforeend', `<p class="muted">${int(total)} stoppages · average ${duration(data.reduce((s, d) => s + d.downtime_minutes, 0) / Math.max(total, 1))} each</p>`);
    });
    run('reasons', '/reports/downtime-by-reason', { months }, (box, data) => {
      const max = Math.max(...data.map((d) => d.downtime_minutes));
      box.innerHTML = table(['Cause', 'Events', 'Hours', ''], data.map((d) => [
        esc(label(d.reason_category)), int(d.events), num(d.downtime_minutes / 60), meter(d.downtime_minutes / max),
      ]), [1, 2]);
      paintMeters(box);
    });
  };

  run('above', '/reports/above-average-downtime', {}, (box, data) => {
    box.innerHTML = `<p class="card-body muted">Plant average: <strong>${duration(data[0].plant_average_minutes)}</strong> of downtime per machine</p>` +
      table(['Machine', 'Line', 'Events', 'Downtime'], data.map((r) => [
        `<span class="mono">${esc(r.asset_tag)}</span> ${esc(r.machine_name)}`, esc(r.production_line), int(r.events), duration(r.downtime_minutes),
      ]), [2, 3]);
  });
  run('workload', '/reports/maintenance-workload', {}, (box, data) => {
    box.innerHTML = table(['Person', 'Role', 'Line', 'Active', 'Overdue', 'Closed', 'Avg. hours to close'], data.map((r) => [
      esc(r.full_name), esc(label(r.role)), esc(r.production_line || 'All lines'), int(r.active), r.overdue ? `<span class="badge critical">${r.overdue}</span>` : '0', int(r.closed),
      r.avg_hours_to_close === null ? '<span class="muted">—</span>' : num(r.avg_hours_to_close),
    ]), [3, 4, 5, 6]);
  });
  run('machines', '/reports/machine-work-orders', {}, (box, data) => {
    box.innerHTML = table(['Machine', 'Line', 'Status', 'Total', 'Open', 'Critical', 'Last job'], data.map((r) => [
      `<span class="mono">${esc(r.asset_tag)}</span> ${esc(r.machine_name)}`, esc(r.production_line), machineBadge(r.status),
      int(r.total_work_orders), int(r.open_work_orders), int(r.critical_work_orders), date(r.last_work_order_at),
    ]), [3, 4, 5]);
  });

  $$('[data-months]', el).forEach((t) => t.addEventListener('click', () => {
    $$('[data-months]', el).forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    loadPeriod(Number(t.dataset.months));
  }));
  loadPeriod(6);
}

function card(key, title, sub, flush = false) {
  return `<div class="card"><div class="card-head"><div><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div></div>
    <button class="btn btn-sm" data-csv="${key}" title="Download CSV">${icon('download')} CSV</button></div>
    <div id="r-${key}" ${flush ? '' : ''}></div></div>`;
}

function table(headers, rows, numericCols = []) {
  return `<div class="table-wrap"><table class="data"><thead><tr>${headers.map((hd, i) => `<th class="${numericCols.includes(i) ? 'num' : ''}">${hd}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numericCols.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const meter = (ratio) => `<div class="meter"><div class="track"><div class="fill" data-r="${ratio.toFixed(3)}"></div></div></div>`;
function paintMeters(box) {
  box.querySelectorAll('.fill[data-r]').forEach((f) => { f.style.width = `${Number(f.dataset.r) * 100}%`; });
}
