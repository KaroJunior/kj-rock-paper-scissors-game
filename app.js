// Frontend for Karo Junior RPS.
// Single-player runs locally. Multiplayer talks to our backend at /api/*;
// the backend talks to Vatar. The browser never sees Vatar secrets.

import { initVatar, getSession, vatar, matchApi } from './vatar-bridge.js';

// ---------- state ----------
const S = {
  screen: 'menu',
  // single player
  spYou: 0, spCpu: 0,
  // backend session
  token: null, playerId: null,
  // active match
  current: null,       // vatar match object (id, code, status, players, me)
  local: null,         // backend filtered view
  pollTimer: null,
  countdownTimer: null,
  lastRound: 0,
  stake: 0,            // 0 = friendly
  busy: false,
};

// ---------- dom helpers ----------
const $ = (id) => document.getElementById(id);
const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

// ---------- emoji ----------
const emoji = (c) => c === 'rock' ? '✊' : c === 'paper' ? '✋' : c === 'scissors' ? '✌️' : '?';

// ---------- navigation ----------
function goto(screen) {
  S.screen = screen;
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.screen === screen);
  });
  if (screen === 'mp') refreshMpAvailability();
}

// ---------- single player ----------
function playSP(choice) {
  const CPU = ['rock','paper','scissors'];
  const cpu = CPU[Math.floor(Math.random()*3)];
  const p1 = $('sp-p1');
  p1.classList.add('shake');
  setTimeout(() => {
    p1.classList.remove('shake');
    p1.classList.add('pop');
    setText('sp-p1', emoji(choice));
    setText('sp-p2', emoji(cpu));
    setTimeout(() => p1.classList.remove('pop'), 350);

    let text, cls;
    if (choice === cpu) { text = "Tie."; cls = 'res-t'; }
    else if (
      (choice === 'rock' && cpu === 'scissors') ||
      (choice === 'paper'  && cpu === 'rock') ||
      (choice === 'scissors' && cpu === 'paper')
    ) { text = 'You win!'; S.spYou++; cls = 'res-w'; }
    else { text = 'CPU wins.'; S.spCpu++; cls = 'res-l'; }

    setText('sp-you', String(S.spYou));
    setText('sp-cpu', String(S.spCpu));
    setText('sp-verdict', text);
    addTape('sp-tape', `You ${emoji(choice)} · CPU ${emoji(cpu)}`, text, cls);
  }, 320);
}

function addTape(id, text, result, cls) {
  const tape = $(id);
  const row = document.createElement('div');
  row.className = 'row';
  const left = document.createElement('span'); left.textContent = text;
  const right = document.createElement('span'); right.className = cls || ''; right.textContent = result;
  row.append(left, right);
  tape.prepend(row);
  while (tape.children.length > 5) tape.removeChild(tape.lastChild);
}

// ---------- backend api ----------
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && S.token) headers.authorization = `Bearer ${S.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

async function ensureBackendSession() {
  if (S.token) return;
  const session = await getSession();
  const r = await api('/api/session/exchange', { method: 'POST', body: { session }, auth: false });
  S.token = r.token;
  S.playerId = r.playerId;
  setText('whoami', (r.name || 'Player') + ' · ' + r.mode);
}

// ---------- multiplayer availability ----------
function refreshMpAvailability() {
  show('mp-offline', !vatar.ready);
  show('mp-lobby', vatar.ready);
  const badge = $('env-badge');
  if (vatar.ready) { badge.dataset.mode = vatar.mode || 'test'; badge.textContent = (vatar.mode || 'test').toUpperCase(); }
  else { badge.textContent = 'STANDALONE'; }
  setText('mp-mode-hint', S.stake > 0 ? `Staked · ${S.stake}` : 'Friendly');
}

// ---------- Vatar callbacks ----------
async function onVatarMatch(m) {
  S.current = m;
  if (!m) return;

  if (m.status === 'open') {
    goto('match');
    setText('mt-title', 'Waiting');
    setText('mt-code', m.code || '');
    setStatus('warn', 'Waiting for opponent to join');
    setText('mt-verdict', 'Share the code: ' + (m.code || '—'));
    show('mt-moves', false);
    return;
  }
  if (m.status === 'playing') {
    setStatus('ok', 'Match started');
    setText('mt-verdict', 'Fetching match…');
    try { await registerMatch(m.id); } catch (e) { setStatus('err', "Couldn't start: " + e.message); }
    return;
  }
  if (m.status === 'done') {
    stopPolling(); stopTimer();
    setStatus('ok', 'Match complete');
    const won = m.winner && vatar.player && m.winner === vatar.player.id;
    setText('mt-verdict', m.winner ? (won ? 'You win!' : 'You lose.') : 'Settled.');
    show('mt-moves', false);
    show('mt-after', true);
    return;
  }
  if (m.status === 'cancelled' || m.status === 'void') {
    stopPolling(); stopTimer();
    setStatus('warn', 'Match ' + m.status);
    show('mt-moves', false);
    show('mt-after', true);
  }
}

async function registerMatch(vatarMatchId) {
  await ensureBackendSession();
  const view = await api('/api/match/register', { method: 'POST', body: { vatarMatchId } });
  S.local = view;
  S.lastRound = view.round || 0;
  goto('match');
  setText('mt-title', 'Match');
  setText('mt-code', view.code || '');
  show('mt-moves', true);
  show('mt-after', false);
  setStatus('ok', view.opponent ? 'Both players connected' : 'Waiting…');
  startPolling(vatarMatchId);
}

// ---------- polling ----------
function startPolling(matchId) {
  stopPolling();
  S.pollTimer = setInterval(() => pollOnce(matchId), 1500);
  pollOnce(matchId);
}
function stopPolling() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

async function pollOnce(matchId) {
  try {
    const view = await api(`/api/match/${encodeURIComponent(matchId)}`);
    renderMatch(view);
  } catch (e) {
    if (e.status === 401) S.token = null;
    if (e.status === 404) { stopPolling(); setStatus('err', 'Match unavailable'); }
  }
}

function renderMatch(v) {
  S.local = v;
  const moves = document.querySelectorAll('#mt-moves .move');
  const complete = v.status === 'resolved';

  setText('mt-p1', emoji(v.yourChoice));
  if (complete) setText('mt-p2', emoji(v.opponentChoice));

  moves.forEach((btn) => {
    btn.disabled = complete || v.youSubmitted;
    btn.classList.toggle('is-picked', btn.dataset.choice === v.yourChoice);
  });

  if (complete) {
    stopTimer();
    setStatus('ok', 'Round complete');
    let text = "It's a draw.";
    if (v.winner === 'you') text = 'You win!';
    else if (v.winner === 'opponent') text = 'You lose.';
    setText('mt-verdict', text);
    show('mt-moves', false);
    show('mt-after', true);
    addTape('mt-tape', `${emoji(v.yourChoice)} vs ${emoji(v.opponentChoice)}`, text,
      v.winner === 'you' ? 'res-w' : v.winner === 'opponent' ? 'res-l' : 'res-t');
    return;
  }

  if (v.youSubmitted && v.opponentSubmitted) setText('mt-verdict', 'Revealing…');
  else if (v.youSubmitted) { setText('mt-verdict', "Waiting for opponent…"); setText('mt-p2', '…'); }
  else if (v.opponentSubmitted) { setText('mt-verdict', 'Opponent moved. Your turn.'); setText('mt-p2', '…'); }
  else setText('mt-verdict', 'Make your move.');

  renderTimer(v.deadline);
}

function setStatus(kind, text) {
  const el = $('mt-status');
  el.dataset.kind = kind;
  el.textContent = text;
}

// ---------- timer ----------
function renderTimer(deadline) {
  if (!deadline) { show('mt-timer', false); return; }
  show('mt-timer', true);
  stopTimer();
  const total = 20000; // must match server TURN_MS
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const pct = Math.max(0, Math.min(1, left / total));
    $('mt-timer-fill').style.width = (pct * 100).toFixed(1) + '%';
    setText('mt-timer-text', Math.ceil(left / 1000) + 's');
    $('mt-timer').classList.toggle('is-low', left < 5000);
    if (left <= 0) stopTimer();
  };
  tick();
  S.countdownTimer = setInterval(tick, 200);
}
function stopTimer() { if (S.countdownTimer) { clearInterval(S.countdownTimer); S.countdownTimer = null; } show('mt-timer', false); }

// ---------- multiplayer actions ----------
async function mpSetStake(value) {
  // Staked mode disabled until platform approval. Only 0 is honored.
  S.stake = value === 'staked' ? 0 : Number(value) || 0;
  document.querySelectorAll('[data-action="mp-set-stake"]').forEach((b) => {
    const on = String(S.stake) === b.dataset.stake || (S.stake === 0 && b.dataset.stake === '0');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  refreshMpAvailability();
}

async function mpQuick() {
  if (S.busy) return;
  S.busy = true;
  try {
    await ensureBackendSession();
    // Docs: Vatar.match.quick({ stake }) — pairs with another player waiting at the same stake.
    await matchApi().quick({ stake: S.stake });
  } catch (e) {
    setStatus('err', `Quick match failed: ${e.code || e.message}`);
  } finally { S.busy = false; }
}

async function mpCreate() {
  if (S.busy) return;
  S.busy = true;
  try {
    await ensureBackendSession();
    await matchApi().create({ stake: S.stake, seats: 2 });
  } catch (e) {
    setStatus('err', `Create failed: ${e.code || e.message}`);
  } finally { S.busy = false; }
}

async function mpJoin() {
  const code = ($('mp-code').value || '').trim().toUpperCase();
  if (!code) return;
  if (S.busy) return;
  S.busy = true;
  try {
    await ensureBackendSession();
    await matchApi().join(code);
  } catch (e) {
    setStatus('err', `Join failed: ${e.code || e.message}`);
  } finally { S.busy = false; }
}

async function mpPlay(choice) {
  if (!S.local) return;
  document.querySelectorAll('#mt-moves .move').forEach((b) => (b.disabled = true));
  try {
    const r = await api(`/api/match/${encodeURIComponent(S.local.matchId)}/choice`, {
      method: 'POST', body: { choice },
    });
    if (r.resolved && r.vatar && !r.vatar.ok) {
      setStatus('warn', 'Round decided, settlement pending');
    }
  } catch (e) {
    setStatus('err', 'Error: ' + e.message);
    document.querySelectorAll('#mt-moves .move').forEach((b) => (b.disabled = false));
  }
}

async function mpLeave() {
  stopPolling(); stopTimer();
  try { await matchApi().leave(); } catch { /* best effort */ }
  S.current = null; S.local = null;
  goto('mp');
}

async function mpAgain() {
  // Leave the finished match and return to lobby.
  try { await matchApi().leave(); } catch { /* ignore */ }
  S.current = null; S.local = null;
  goto('mp');
}

// ---------- delegated clicks ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'goto':      return goto(el.dataset.screen);
    case 'sp-play':   return playSP(el.dataset.choice);
    case 'mp-set-stake': return mpSetStake(el.dataset.stake);
    case 'mp-quick':  return mpQuick();
    case 'mp-create': return mpCreate();
    case 'mp-show-join': show('mp-join-row', true); return;
    case 'mp-join':   return mpJoin();
    case 'mp-play':   return mpPlay(el.dataset.choice);
    case 'mp-leave':  return mpLeave();
    case 'mp-again':  return mpAgain();
  }
});

// Enter in code field triggers join
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'mp-code') mpJoin();
});

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  goto('menu');
  await initVatar({
    onMatch: onVatarMatch,
    onPause: () => stopTimer(),
    onResume: () => { if (S.current && S.current.id) startPolling(S.current.id); },
  });

  // Reconnection: if a match is already in progress for this player, resume it.
  if (vatar.ready && vatar.player) {
    setText('whoami', vatar.player.name || 'Player');
    try {
      const m = await matchApi().current();
      if (m && m.id) { S.current = m; onVatarMatch(m); }
    } catch { /* ignore */ }
  }
});