/*
 * Capture real screenshots of the running app with headless Chrome over the DevTools protocol.
 * No extra dependencies (uses Node 18+ fetch/WebSocket).
 *
 *   BASE_URL=http://localhost:3000 DEMO_PASSWORD=... node scripts/screenshots.js
 *
 * Saves PNGs to docs/screenshots/. Also reports any console errors seen on each page.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD || process.env.SEED_PASSWORD;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PORT = 9333;

const SHOTS = [
  { file: 'login.png', user: null, hash: '', w: 1440, h: 900 },
  { file: 'dashboard.png', user: 'supervisor@maintainiq.demo', hash: '#/dashboard', w: 1440, h: 1180 },
  { file: 'machines.png', user: 'supervisor@maintainiq.demo', hash: '#/machines', w: 1440, h: 900 },
  { file: 'work-orders.png', user: 'supervisor@maintainiq.demo', hash: '#/work-orders', w: 1440, h: 900 },
  { file: 'work-order-detail.png', user: 'supervisor@maintainiq.demo', hash: '#/work-orders?id=1', w: 1440, h: 900 },
  { file: 'downtime.png', user: 'supervisor@maintainiq.demo', hash: '#/downtime', w: 1440, h: 900 },
  { file: 'energy.png', user: 'supervisor@maintainiq.demo', hash: '#/energy', w: 1440, h: 900 },
  { file: 'production-lines.png', user: 'supervisor@maintainiq.demo', hash: '#/lines', w: 1440, h: 800 },
  { file: 'notes.png', user: 'supervisor@maintainiq.demo', hash: '#/notes', w: 1440, h: 800 },
  { file: 'reports.png', user: 'supervisor@maintainiq.demo', hash: '#/reports', w: 1440, h: 1500 },
  { file: 'users.png', user: 'supervisor@maintainiq.demo', hash: '#/users', w: 1440, h: 760 },
  { file: 'operator-dashboard.png', user: 'operator@maintainiq.demo', hash: '#/dashboard', w: 1440, h: 1000 },
  { file: 'dashboard-dark.png', user: 'supervisor@maintainiq.demo', hash: '#/dashboard', w: 1440, h: 1180, dark: true },
  { file: 'mobile-dashboard.png', user: 'operator@maintainiq.demo', hash: '#/dashboard', w: 390, h: 1500, mobile: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!PASSWORD) throw new Error('Set DEMO_PASSWORD (or SEED_PASSWORD).');
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'miq-shots-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank']);

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error('Chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  for (const shot of SHOTS) {
    consoleErrors.length = 0;
    await send('Emulation.setDeviceMetricsOverride', { width: shot.w, height: shot.h, deviceScaleFactor: shot.mobile ? 2 : 1, mobile: Boolean(shot.mobile) });
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(800);
    await evaluate(`localStorage.clear(); localStorage.setItem('maintainiq.theme', '${shot.dark ? 'dark' : 'light'}'); true`);
    if (shot.user) {
      // Log in through the real API, exactly like the login form does.
      const ok = await evaluate(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({email:'${shot.user}', password:${JSON.stringify(PASSWORD)}})}).then(r => r.json()).then(j => {
          localStorage.setItem('maintainiq.token', j.data.token); localStorage.setItem('maintainiq.user', JSON.stringify(j.data.user)); return true; })`);
      if (!ok) throw new Error(`login failed for ${shot.user}`);
    }
    // A hash-only navigation would keep the old page; reload so the app starts fresh with the new session/theme.
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await send('Page.navigate', { url: `${BASE}/${shot.hash}` });
    await sleep(2200);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(data, 'base64'));
    console.log(`${shot.file.padEnd(26)} ${consoleErrors.length ? `CONSOLE ERRORS: ${consoleErrors.join(' | ')}` : 'ok, no console errors'}`);
  }

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
