import { api, session } from '../api.js';
import { esc, icon, $, $$, date, badge, label, empty, errorState, loading, modal, field, options, handleSubmit, toast, initials } from '../ui.js';

export async function render(el) {
  el.innerHTML = `
    <div class="page-head"><div><h2>User management</h2><p>Create accounts, change roles and deactivate people who have left. Users are never deleted, so their history stays intact.</p></div>
      <button class="btn btn-primary" id="add">${icon('plus')} Add user</button></div>
    <div class="card" id="table">${loading(6)}</div>`;

  const { data: lines } = await api('/production-lines');
  const lineOpts = (sel) => options(lines.map((l) => [l.id, l.name]), sel, { blank: 'No line (supervisor)' });

  const load = async () => {
    const box = $('#table', el);
    try {
      const { data } = await api('/users');
      if (!data.length) return (box.innerHTML = empty('No users'));
      box.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Role</th><th>Production line</th><th>Status</th><th>Joined</th><th></th></tr></thead>
        <tbody>${data.map((u) => `<tr>
          <td><div class="actions-row"><span class="avatar">${esc(initials(u.full_name))}</span><div class="title-cell"><strong>${esc(u.full_name)}</strong><small>${esc(u.email)}</small></div></div></td>
          <td>${badge(u.role, u.role === 'supervisor' ? 'info' : '')}</td>
          <td>${esc(u.production_line || 'All lines')}</td>
          <td>${u.is_active ? badge('active', 'good') : badge('inactive', '')}</td>
          <td>${date(u.created_at)}</td>
          <td class="num">${u.id === session.user.id ? '<span class="muted">You</span>' : `<button class="btn btn-sm" data-edit="${u.id}">Edit</button>`}</td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => openEdit(data.find((u) => u.id === Number(b.dataset.edit)))));
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };

  const openEdit = (u) => {
    const m = modal(`Edit ${u.full_name}`, `<form novalidate><div class="form-alert hidden" role="alert"></div><div class="form-grid">
      <div class="span-2">${field('fullName', 'Full name', `<input class="input" id="f-fullName" name="fullName" value="${esc(u.full_name)}">`)}</div>
      ${field('role', 'Role', `<select class="select" id="f-role" name="role">${options([['operator', 'Operator'], ['supervisor', 'Supervisor']], u.role)}</select>`)}
      ${field('productionLineId', 'Production line', `<select class="select" id="f-productionLineId" name="productionLineId" data-type="int" data-nullable>${lineOpts(u.production_line_id)}</select>`)}
      <div class="span-2"><label><input type="checkbox" name="isActive" ${u.is_active ? 'checked' : ''}> Account active</label></div></div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
    m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
    handleSubmit(m.el.querySelector('form'), async (body) => {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      toast('User updated');
      m.close();
      load();
    });
  };

  $('#add', el).addEventListener('click', () => {
    const m = modal('Add user', `<form novalidate><div class="form-alert hidden" role="alert"></div><div class="form-grid">
      <div class="span-2">${field('fullName', 'Full name', '<input class="input" id="f-fullName" name="fullName">')}</div>
      <div class="span-2">${field('email', 'Email', '<input class="input" id="f-email" name="email" type="email">')}</div>
      ${field('role', 'Role', `<select class="select" id="f-role" name="role">${options([['operator', 'Operator'], ['supervisor', 'Supervisor']], 'operator')}</select>`)}
      ${field('productionLineId', 'Production line', `<select class="select" id="f-productionLineId" name="productionLineId" data-type="int">${lineOpts('')}</select>`)}
      <div class="span-2">${field('password', 'Temporary password (min. 8 characters)', '<input class="input" id="f-password" name="password" type="password" autocomplete="new-password">')}</div></div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Create user</button></div></form>`);
    m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', m.close));
    handleSubmit(m.el.querySelector('form'), async (body) => {
      await api('/users', { method: 'POST', body });
      toast(`${label(body.role)} account created`);
      m.close();
      load();
    });
  });

  load();
}
