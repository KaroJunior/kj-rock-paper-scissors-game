// Admin dashboard client. Reads stats from /api/admin/*, rendered client-side.
// The server is authoritative for auth; this file never decides who is admin.

const root = document.getElementById('root');

const state = {
  busy: false,
};

async function fetchStats() {
  const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
  if (res.status === 401) return { authed: false };
  if (!res.ok) throw new Error('stats_failed_' + res.status);
  return { authed: true, stats: await res.json() };
}

async function login(username, password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.ok;
}

async function logout() {
  try {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* ignore */ }
  renderLogin();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderLogin(error) {
  root.innerHTML = `
    <div class="login"><div class="card">
      <h1 style="font-size:22px;text-transform:uppercase;font-weight:900;margin-bottom:20px">Admin sign in</h1>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
      <form id="login-form" autocomplete="off" novalidate>
        <div class="field">
          <label for="u">Username</label>
          <input id="u" name="username" required autocomplete="username" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="field">
          <label for="p">Password</label>
          <input id="p" name="password" type="password" required autocomplete="current-password" />
        </div>
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>Sign in</button>
      </form>
    </div></div>`;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    state.busy = true;
    const u = document.getElementById('u').value;
    const p = document.getElementById('p').value;
    const ok = await login(u, p);
    state.busy = false;
    if (!ok) { renderLogin('Invalid username or password.'); return; }
    await loadAndRender();
  });
}

function renderDashboard(stats) {
  const m = stats.matches || {};
  const recent = Array.isArray(stats.recent) ? stats.recent : [];
  const errors = Array.isArray(stats.errors) ? stats.errors : [];

  root.innerHTML = `
    <div class="wrap">
      <div class="top">
        <h1>Karo Junior RPS · Admin</h1>
        <form id="logout-form"><button class="logout" type="submit">Sign out</button></form>
      </div>

      <div class="grid">
        <div class="card"><div class="k">Total matches</div><div class="v">${esc(m.total ?? 0)}</div></div>
        <div class="card"><div class="k">Active</div><div class="v">${esc(m.active ?? 0)}</div></div>
        <div class="card"><div class="k">Completed</div><div class="v">${esc(m.resolved ?? 0)}</div></div>
        <div class="card"><div class="k">Waiting to start</div><div class="v">${esc(m.waiting ?? 0)}</div></div>
      </div>

      <div class="grid">
        <div class="card"><div class="k">Friendly matches</div><div class="v">${esc(m.friendly ?? 0)}</div></div>
        <div class="card"><div class="k">Staked matches</div><div class="v">${esc(m.staked ?? 0)}</div></div>
        <div class="card win"><div class="k">Rounds completed</div><div class="v">${esc(stats.roundsCompleted ?? 0)}</div></div>
        <div class="card"><div class="k">Matches · last 24h</div><div class="v">${esc(stats.matchesLast24h ?? 0)}</div></div>
      </div>

      <div class="panel">
        <h2>Recent results</h2>
        ${recent.length === 0
          ? '<p class="muted">No completed matches yet.</p>'
          : recent.map((r) => `<div class="row"><span>${esc(r.code)} · ${esc(r.mode)}</span><span>${esc(r.result)}</span></div>`).join('')}
      </div>

      <div class="panel">
        <h2>Errors &amp; failed operations</h2>
        ${errors.length === 0
          ? '<p class="muted">No recent errors.</p>'
          : errors.map((e) => `<div class="row"><span>${esc(e.code)}</span><span>${esc(e.result || e.http || 'error')}</span></div>`).join('')}
      </div>

      <p class="muted" style="margin-top:24px;font-family:var(--mono);font-size:12px">
        Generated ${esc(stats.generatedAt || new Date().toISOString())} · read-only view
      </p>
    </div>`;

  document.getElementById('logout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    logout();
  });
}

function renderError(message) {
  root.innerHTML = `<div class="wrap"><div class="panel">
    <h2>Something went wrong</h2>
    <p class="muted">${esc(message)}</p>
  </div></div>`;
}

async function loadAndRender() {
  try {
    const r = await fetchStats();
    if (!r.authed) { renderLogin(); return; }
    renderDashboard(r.stats);
  } catch (e) {
    renderError(e.message || 'Failed to load stats. Check function logs.');
  }
}

loadAndRender();