import { api, session } from '../api.js';
import { h, $, $$, field, options, handleSubmit } from '../ui.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = '';
  root.append(h(`<div class="auth-screen">
    <section class="auth-hero">
      <div class="brand"><span class="brand-mark">M</span> MaintainIQ</div>
      <div>
        <h1>Keep every line running, and know what it costs.</h1>
        <p>Work orders, downtime and energy readings for the whole plant in one place, with reports built from the live data.</p>
        <ul class="auth-points">
          <li>Operators raise requests and log stoppages from the line</li>
          <li>Supervisors assign, track and close work orders</li>
          <li>Monthly downtime and energy reports per production line</li>
        </ul>
      </div>
      <p class="muted">Demo project · Node.js, Express, MySQL, vanilla JavaScript</p>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" aria-selected="true" data-tab="login">Sign in</button>
          <button class="tab" role="tab" aria-selected="false" data-tab="register">Create account</button>
        </div>

        <div data-panel="login">
          <h2>Welcome back</h2>
          <p class="sub">Sign in with your plant account.</p>
          <form id="login-form" novalidate>
            <div class="form-alert hidden" role="alert"></div>
            ${field('email', 'Email', '<input class="input" id="f-email" name="email" type="email" autocomplete="username" required>')}
            ${field('password', 'Password', '<input class="input" id="f-password" name="password" type="password" autocomplete="current-password" required>')}
            <button class="btn btn-primary" type="submit">Sign in</button>
          </form>
          <div class="demo-box">
            <strong>Demo accounts</strong> (password is shared with reviewers separately)
            <div class="demo-actions">
              <button class="btn btn-sm" data-demo="supervisor@maintainiq.demo">Supervisor</button>
              <button class="btn btn-sm" data-demo="operator@maintainiq.demo">Operator · Press Shop</button>
            </div>
          </div>
        </div>

        <div data-panel="register" class="hidden">
          <h2>Create an operator account</h2>
          <p class="sub">Supervisor accounts are created by an existing supervisor.</p>
          <form id="register-form" novalidate>
            <div class="form-alert hidden" role="alert"></div>
            ${field('fullName', 'Full name', '<input class="input" id="f-fullName" name="fullName" autocomplete="name" required>')}
            ${field('email', 'Work email', '<input class="input" id="f-remail" name="email" type="email" autocomplete="email" required>')}
            ${field('productionLineId', 'Production line', '<select class="select" id="f-productionLineId" name="productionLineId" data-type="int" required><option value="">Loading…</option></select>')}
            ${field('password', 'Password (min. 8 characters)', '<input class="input" id="f-rpassword" name="password" type="password" autocomplete="new-password" minlength="8" required>')}
            <button class="btn btn-primary" type="submit">Create account</button>
          </form>
        </div>
      </div>
    </section>
  </div>`));

  // Tabs
  $$('[data-tab]', root).forEach((tab) =>
    tab.addEventListener('click', () => {
      $$('[data-tab]', root).forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('[data-panel]', root).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
    })
  );

  // Demo buttons only fill the email; the password is never shipped in the frontend.
  $$('[data-demo]', root).forEach((b) =>
    b.addEventListener('click', () => {
      $('#f-email').value = b.dataset.demo;
      $('#f-password').focus();
    })
  );

  const done = (res) => {
    session.save(res.data.token, res.data.user);
    onSuccess();
  };

  handleSubmit($('#login-form'), async (body) => done(await api('/auth/login', { method: 'POST', body })));
  handleSubmit($('#register-form'), async (body) => done(await api('/auth/register', { method: 'POST', body })));

  api('/public/production-lines')
    .then((res) => {
      $('#f-productionLineId').innerHTML = options(res.data.map((l) => [l.id, `${l.name} (${l.code})`]), '', { blank: 'Select your line' });
    })
    .catch(() => {
      $('#f-productionLineId').innerHTML = '<option value="">Could not load lines</option>';
    });
}
