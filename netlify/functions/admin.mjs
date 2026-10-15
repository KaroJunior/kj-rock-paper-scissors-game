// Admin dashboard: server-rendered HTML pages, session cookie auth, CSRF on login.
// Read-only. No mutation of player data.
import crypto from 'node:crypto';
import { getDb } from './_lib/firebase.mjs';
import {
  issueAdminToken, requireAdminFromCookie, parseCookies,
  newCsrfToken, csrfMatches, ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE,
} from './_lib/auth.mjs';

// ---------- helpers ----------
function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...extraHeaders },
  });
}
function secureEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function checkCreds(user, pass) {
  const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASSWORD;
  if (!U || !P) return false;
  return secureEq(user, U) && secureEq(pass, P);
}
async function form(url, req) {
  const ct = req.headers.get('content-type') || '';
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

// ---------- pages ----------
const STYLE = `
:root{--ink:#0a0a0a;--paper:#f5f2e8;--paper-2:#fffdf5;--accent:#ffe500;--win:#00b56a;--lose:#e5333c;
--rule:3px solid var(--ink);--shadow:6px 6px 0 var(--ink);--mono:"SF Mono",ui-monospace,Menlo,monospace;
--font:"Inter","Segoe UI",system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--ink:#f5f2e8;--paper:#111013;--paper-2:#1a191d;--shadow:6px 6px 0 var(--ink)}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:var(--font);font-weight:600;line-height:1.3;min-height:100dvh}
h1,h2,h3,p{margin:0}
a{color:inherit}
.wrap{max-width:960px;margin:0 auto;padding:24px 20px}
.top{display:flex;justify-content:space-between;align-items:center;border:var(--rule);background:var(--paper-2);box-shadow:var(--shadow);padding:14px 18px}
.top h1{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.02em}
.top form{display:inline}
.logout{border:var(--rule);background:var(--paper);padding:8px 14px;font-family:var(--mono);font-size:12px;text-transform:uppercase;cursor:pointer;box-shadow:3px 3px 0 var(--ink)}
.logout:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:20px}
.card{border:var(--rule);background:var(--paper-2);box-shadow:var(--shadow);padding:18px}
.card .k{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.7}
.card .v{font-size:34px;font-weight:900;margin-top:6px}
.card.win .v{color:var(--win)} .card.lose .v{color:var(--lose)}
.panel{border:var(--rule);background:var(--paper-2);box-shadow:var(--shadow);padding:20px;margin-top:20px}
.panel h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed rgba(0,0,0,.12);font-family:var(--mono);font-size:13px}
.row:last-child{border-bottom:0}
.muted{opacity:.6}
.login{max-width:400px;margin:80px auto;padding:0 20px}
.login .card{padding:28px}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.field label{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.field input{border:var(--rule);background:var(--paper);padding:12px;font-family:var(--mono);font-size:15px}
.btn{display:block;width:100%;border:var(--rule);background:var(--accent);box-shadow:var(--shadow);padding:14px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}
.btn:active{transform:translate(3px,3px);box-shadow:3px 3px 0 var(--ink)}
.err{border:var(--rule);background:var(--lose);color:var(--paper-2);padding:10px;font-family:var(--mono);font-size:12px;margin-bottom:12px}
`;

function pageLogin(csrf, error) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · RPS</title><style>${STYLE}</style></head>
<body><div class="login"><div class="card">
<h1 style="font-size:22px;text-transform:uppercase;font-weight:900;margin-bottom:20px">Admin sign in</h1>
${error ? `<div class="err">${error}</div>` : ''}
<form method="POST" action="/admin/login" autocomplete="off">
  <div class="field"><label for="u">Username</label><input id="u" name="username" required autocomplete="username"></div>
  <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" required autocomplete="current-password"></div>
  <input type="hidden" name="csrf" value="${csrf}">
  <button class="btn" type="submit">Sign in</button>
</form>
</div></div></body></html>`;
}

function pageDashboard(stats) {
  const m = stats.matches;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · RPS</title><style>${STYLE}</style></head>
<body><div class="wrap">
<div class="top">
  <h1>Karo Junior RPS · Admin</h1>
  <form method="POST" action="/admin/logout"><button class="logout" type="submit">Sign out</button></form>
</div>

<div class="grid">
  <div class="card"><div class="k">Total matches</div><div class="v">${m.total}</div></div>
  <div class="card"><div class="k">Active</div><div class="v">${m.active}</div></div>
  <div class="card"><div class="k">Completed</div><div class="v">${m.resolved}</div></div>
  <div class="card"><div class="k">Waiting to start</div><div class="v">${m.waiting}</div></div>
</div>

<div class="grid">
  <div class="card"><div class="k">Friendly matches</div><div class="v">${m.friendly}</div></div>
  <div class="card"><div class="k">Staked matches</div><div class="v">${m.staked}</div></div>
  <div class="card win"><div class="k">Rounds completed</div><div class="v">${stats.roundsCompleted}</div></div>
  <div class="card"><div class="k">Matches · last 24h</div><div class="v">${stats.matchesLast24h}</div></div>
</div>

<div class="panel">
  <h2>Recent results</h2>
  ${stats.recent.length === 0 ? '<p class="muted">No completed matches yet.</p>' :
    stats.recent.map((r) => `<div class="row"><span>${r.code} · ${r.mode}</span><span>${r.result}</span></div>`).join('')}
</div>

<div class="panel">
  <h2>Errors & failed operations</h2>
  ${stats.errors.length === 0 ? '<p class="muted">No recent errors.</p>' :
    stats.errors.map((e) => `<div class="row"><span>${e.code}</span><span>${e.result || e.http || 'error'}</span></div>`).join('')}
</div>

<p class="muted" style="margin-top:24px;font-family:var(--mono);font-size:12px">
  Generated ${stats.generatedAt} · read-only view
</p>
</div></body></html>`;
}

// ---------- data ----------
async function loadStats() {
  const db = getDb();
  // Single fetch of matches. Cap for safety in case the collection grows large;
  // callers only need recent + aggregate.
  const snap = await db.collection('vatar_matches').orderBy('startedAt', 'desc').limit(500).get();

  let total = 0, waiting = 0, active = 0, resolved = 0, friendly = 0, staked = 0, roundsCompleted = 0;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  let last24h = 0;
  const recent = [];
  const errors = [];

  snap.forEach((doc) => {
    const m = doc.data();
    total++;
    if (m.status === 'active')   active++;
    else if (m.status === 'resolved') resolved++;
    else if (m.status === 'waiting')  waiting++;
    if (m.stake === 0) friendly++; else staked++;
    if (m.startedAt && m.startedAt >= since) last24h++;
    if (Array.isArray(m.rounds)) roundsCompleted += m.rounds.filter((r) => r.status === 'complete').length;
    else if (m.status === 'resolved') roundsCompleted++;

    if (m.status === 'resolved' && recent.length < 8) {
      recent.push({
        code: m.code || m.matchId?.slice(0, 8) || '—',
        mode: m.mode || 'test',
        result: m.winner === 'draw' ? 'draw' : 'settled',
      });
    }
    if (m.vatarResult && (m.vatarResult.http >= 400 || m.vatarResult.ok === false) && errors.length < 8) {
      errors.push({
        code: m.code || m.matchId?.slice(0, 8) || '—',
        result: 'http ' + (m.vatarResult.http ?? '?'),
      });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    matches: { total, active, resolved, waiting, friendly, staked },
    roundsCompleted,
    matchesLast24h: last24h,
    recent,
    errors,
  };
}

// ---------- router ----------
async function route(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // /admin/login  (GET: page, POST: submit)
  if (path === '/admin/login') {
    if (method === 'GET') {
      const csrf = newCsrfToken();
      const headers = { 'set-cookie': `rps_csrf=${csrf}; Path=/; Max-Age=600; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}` };
      return html(pageLogin(csrf), 200, headers);
    }
    if (method === 'POST') {
      const body = await form(url, req);
      if (!csrfMatches(req, body)) return html(pageLogin('', 'Session expired. Reload and try again.'), 400);
      const { username = '', password = '' } = body;
      if (!checkCreds(username, password)) return html(pageLogin(body.csrf || '', 'Invalid username or password.'), 401);

      const token = issueAdminToken();
      const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`;
      const clearCsrf = 'rps_csrf=; Path=/; Max-Age=0; SameSite=Strict';
      return redirect('/admin', { 'set-cookie': cookie, 'set-cookie2': clearCsrf });
    }
    return new Response('method not allowed', { status: 405 });
  }

  if (path === '/admin/logout' && method === 'POST') {
    const clear = `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
    return redirect('/admin/login', { 'set-cookie': clear });
  }

  // /admin/stats.json — for programmatic use
  if (path === '/admin/stats.json' && method === 'GET') {
    if (!requireAdminFromCookie(req)) return new Response('unauthorized', { status: 401 });
    try {
      const stats = await loadStats();
      return new Response(JSON.stringify(stats, null, 2), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    } catch (e) {
      console.error('admin stats error', e);
      return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  // /admin → dashboard or login
  if ((path === '/admin' || path === '/admin/') && method === 'GET') {
    if (!requireAdminFromCookie(req)) return redirect('/admin/login');
    try {
      const stats = await loadStats();
      return html(pageDashboard(stats));
    } catch (e) {
      console.error('admin dashboard error', e);
      return html('<p style="font-family:sans-serif;padding:20px">Dashboard failed to load. Check function logs.</p>', 500);
    }
  }

  return new Response('not found', { status: 404 });
}

export default async (req) => {
  try { return await route(req); }
  catch (e) { console.error('admin error', e && e.stack || e); return new Response('server error', { status: 500 }); }
};

export const config = { path: '/admin/*' };